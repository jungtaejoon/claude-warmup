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
