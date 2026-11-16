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
import { peakGate, nextPeakSlot, gapIndex, gapOptions, gapEndFor, PEAK_LATE_MS } from '../src/scheduler.js';
import { getPeak } from '../src/config.js';

const at = (h, m = 0, day = 9) => new Date(2026, 10, day, h, m).getTime(); // 2026-11-09 is a Monday
const weekdays1130 = getPeak({ peak: '11:30 weekdays', gap: '03:00' }); // gap 02:30–06:30

test('gapIndex: the option holding the time, or the nearest one', () => {
  const p = 11 * 60 + 30;
  assert.equal(gapIndex(p, 3 * 60), 3); // 02:30–06:30
  assert.equal(gapIndex(p, 12 * 60), 0); // 11:30–15:30
  assert.equal(gapIndex(p, 22 * 60), 2); // 21:30–01:30 (over midnight)
  assert.equal(gapIndex(p, 15 * 60 + 50), 0); // between options: 15:30 end is nearer than 16:30 start
  assert.equal(gapOptions(p).length, 5);
  assert.equal(weekdays1130.gap, 3);
  assert.equal(gapEndFor(at(11, 30), 3), at(6, 30));
});

test('peakGate: rests from 5h before the gap ends, then lines up at its end', () => {
  const g = (h, m, day) => peakGate({ now: at(h, m, day), peak: weekdays1130 });
  assert.deepEqual(g(1, 0), { ok: true }); // a window started now ends by 06:00
  assert.deepEqual(g(2, 0), { ok: false, until: at(6, 25), peakAt: at(11, 30) });
  assert.deepEqual(g(6, 25), { ok: true, aligned: true, peakAt: at(11, 30) });
  assert.equal(peakGate({ now: at(6, 30) + PEAK_LATE_MS, peak: weekdays1130 }).aligned, true);
});

test('peakGate: off the gap, windows chain as usual (the old version waited for slots)', () => {
  // Monday 07:25, after your own window ran past 06:30: chain now instead of waiting until 11:25
  assert.deepEqual(peakGate({ now: at(7, 25), peak: weekdays1130 }), { ok: true });
  // Friday 11:25, right before the week's last peak: chain over the weekend
  assert.deepEqual(peakGate({ now: at(11, 25, 13), peak: weekdays1130 }), { ok: true });
  // Saturday and Sunday nights don't rest; Monday's does
  assert.deepEqual(peakGate({ now: at(3, 0, 14), peak: weekdays1130 }), { ok: true });
  assert.deepEqual(peakGate({ now: at(3, 0, 15), peak: weekdays1130 }), { ok: true });
  assert.equal(peakGate({ now: at(3, 0, 16), peak: weekdays1130 }).ok, false);
});

test('peakGate: no gap chosen -> not applied', () => {
  assert.deepEqual(peakGate({ now: at(3, 0), peak: getPeak({ peak: '11:30', gap: '' }) }), { ok: true });
});

test('nextPeakSlot skips the rest and the schedule', () => {
  const sched = { hours: parseHours('06:00-23:00'), days: parseDays('everyday') };
  assert.deepEqual(nextPeakSlot(at(2, 0), weekdays1130, always, { earlyMs: 0 }), { at: at(6, 30), aligned: true, peakAt: at(11, 30) });
  assert.deepEqual(nextPeakSlot(at(23, 30, 8), weekdays1130, sched, { earlyMs: 0 }), { at: at(6, 30), aligned: true, peakAt: at(11, 30) });
  assert.deepEqual(nextPeakSlot(at(8, 0), weekdays1130, always), { at: at(8, 0) });
});

test('precheck: a peak wait costs no network call', () => {
  const r = precheck({ now, schedule: always, state: { peakWaitUntil: now + HOUR } });
  assert.deepEqual(r, { action: 'skip', reason: 'peak_wait', until: now + HOUR, peakAt: null });
});
