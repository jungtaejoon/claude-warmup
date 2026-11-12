import test from 'node:test';
import assert from 'node:assert/strict';
import { precheck, decideWithUsage, backoffMs, windowEndAfterPing, WINDOW_MS, ESTIMATE_WINDOW_MS } from '../src/scheduler.js';
import { parseHours, parseDays, HOUR, MINUTE } from '../src/time.js';

const always = { hours: parseHours('always'), days: parseDays('everyday') };
const now = new Date(2026, 10, 9, 10, 0).getTime(); // Monday 10:00

test('precheck: outside the schedule does nothing', () => {
  const sched = { hours: parseHours('22:00-23:00'), days: parseDays('everyday') };
  assert.equal(precheck({ now, schedule: sched, state: {} }).reason, 'outside_schedule');
  const weekend = { hours: parseHours('always'), days: parseDays('weekends') };
  assert.equal(precheck({ now, schedule: weekend, state: {} }).reason, 'outside_schedule');
});

test('precheck: a known active window means no network call', () => {
  const r = precheck({ now, schedule: always, state: { windowEndsAt: now + HOUR } });
  assert.deepEqual(r, { action: 'skip', reason: 'window_active', until: now + HOUR });
});

test('precheck: waits a minute past the reset before checking', () => {
  assert.equal(precheck({ now, schedule: always, state: { windowEndsAt: now - 30_000 } }).reason, 'window_active');
  assert.equal(precheck({ now, schedule: always, state: { windowEndsAt: now - 2 * MINUTE } }).action, 'check');
});

test('precheck: backoff, limit and recheck', () => {
  assert.equal(precheck({ now, schedule: always, state: { backoffUntil: now + 1 } }).reason, 'backoff');
  assert.equal(precheck({ now, schedule: always, state: { blockedUntil: now + 1 } }).reason, 'limit_reached');
  assert.equal(precheck({ now, schedule: always, state: { recheckAt: now + 1 } }).reason, 'recheck_later');
  assert.equal(precheck({ now, schedule: always, state: { backoffUntil: now - 1 } }).action, 'check');
});

test('decideWithUsage', () => {
  assert.equal(decideWithUsage({ now, usage: { ok: false } }).action, 'ping');
  assert.equal(decideWithUsage({ now, usage: null }).reason, 'usage_unavailable');
  const active = { ok: true, session: { percent: 12, resetsAt: now + HOUR } };
  assert.deepEqual(decideWithUsage({ now, usage: active }), { action: 'skip', reason: 'window_active', until: now + HOUR });
  const idle = { ok: true, session: { percent: 0, resetsAt: null } };
  assert.deepEqual(decideWithUsage({ now, usage: idle }), { action: 'ping', reason: 'no_active_window' });
  const expired = { ok: true, session: { percent: 80, resetsAt: now - 1 } };
  assert.equal(decideWithUsage({ now, usage: expired }).action, 'ping');
  const noSession = { ok: true, session: null };
  assert.equal(decideWithUsage({ now, usage: noSession }).reason, 'no_session_limit');
});

test('backoffMs grows then caps at an hour', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => backoffMs(n) / MINUTE), [5, 10, 20, 40, 60, 60]);
});

test('windowEndAfterPing trusts sane server times and estimates otherwise', () => {
  assert.equal(windowEndAfterPing(now + 4 * HOUR, now), now + 4 * HOUR);
  assert.equal(windowEndAfterPing(null, now), now + ESTIMATE_WINDOW_MS);
  assert.equal(windowEndAfterPing(now - 1, now), now + ESTIMATE_WINDOW_MS);
  assert.equal(windowEndAfterPing(now + 10 * HOUR, now), now + WINDOW_MS + 5 * MINUTE);
});

// ---------- peak time ----------
import { peakSlots, peakGate, nextPeakSlot, PEAK_LATE_MS } from '../src/scheduler.js';
import { parsePeak } from '../src/config.js';

const at = (h, m = 0, day = 9) => new Date(2026, 10, day, h, m).getTime();
const P14 = parsePeak('14:00');

test('peakSlots: peak − 5h·k, for the peaks around now', () => {
  const slots = peakSlots(at(10), P14).filter((s) => s.peakAt === at(14));
  assert.deepEqual(slots.map((s) => s.at), [at(18, 0, 8), at(23, 0, 8), at(4), at(9)]);
});

test('peakGate: pings at the slot, a little early, or a little late', () => {
  assert.equal(peakGate({ now: at(9), peak: P14 }).ok, true);
  assert.equal(peakGate({ now: at(8, 57), peak: P14 }).ok, true);
  assert.equal(peakGate({ now: at(9) + PEAK_LATE_MS, peak: P14 }).ok, true);
  const hit = peakGate({ now: at(9, 10), peak: P14 });
  assert.equal(hit.slot, at(9));
  assert.equal(hit.peakAt, at(14));
});

test('peakGate: off-slot waits for the next slot instead of starting a misaligned window', () => {
  const r = peakGate({ now: at(10, 30), peak: P14 });
  assert.equal(r.ok, false);
  assert.equal(r.until, at(18) - 5 * MINUTE); // next slot lines up with tomorrow's 14:00
  assert.equal(r.peakAt, at(14, 0, 10));
  const r2 = peakGate({ now: at(5), peak: P14 });
  assert.equal(r2.until, at(9) - 5 * MINUTE);
  assert.equal(r2.peakAt, at(14));
});

test('nextPeakSlot skips slots outside the schedule', () => {
  const sched = { hours: parseHours('06:00-23:00'), days: parseDays('everyday') };
  // 23:00 (end, exclusive) and 04:00 are outside, so after 18:00 the next one is 09:00
  const r = nextPeakSlot(at(19), P14, sched, { earlyMs: 0 });
  assert.equal(r.at, at(9, 0, 10));
  assert.equal(r.peakAt, at(14, 0, 10));
  assert.equal(nextPeakSlot(at(8), P14, always, { earlyMs: 0 }).at, at(9));
});

test('precheck: a peak wait costs no network call', () => {
  const r = precheck({ now, schedule: always, state: { peakWaitUntil: now + HOUR } });
  assert.deepEqual(r, { action: 'skip', reason: 'peak_wait', until: now + HOUR });
});

test('peak on weekdays: weekends chain as usual, aligning starts the day before', () => {
  const wk = parsePeak('11:30 weekdays');
  // 2026-11-14 is a Saturday: the next peak is Monday, far away -> usual chaining
  assert.deepEqual(peakGate({ now: at(12, 0, 14), peak: wk }), { ok: true, free: true });
  // Sunday 12:00: Monday 11:30 is < 25h away -> wait for its first slot, Sunday 15:30 (11:30 - 20h)
  const sun = peakGate({ now: at(12, 0, 15), peak: wk });
  assert.equal(sun.ok, false);
  assert.equal(sun.until, at(15, 30, 15) - 5 * MINUTE);
  assert.equal(sun.peakAt, at(11, 30, 16));
  // Friday afternoon after the last peak of the week -> usual chaining
  assert.deepEqual(peakGate({ now: at(15, 0, 13), peak: wk }), { ok: true, free: true });
  // Monday 06:30 is a slot
  assert.equal(peakGate({ now: at(6, 30, 16), peak: wk }).ok, true);
});
