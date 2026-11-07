import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHM, parseHours, formatHours, inHours, parseDays, formatDays, isScheduledAt, nextScheduledStart, HOUR, MINUTE,
} from '../src/time.js';

const at = (h, m = 0, day = 8) => new Date(2026, 10, day, h, m, 0, 0); // Nov 8 2026 is a Sunday

test('parseHM', () => {
  assert.equal(parseHM('06:30'), 390);
  assert.equal(parseHM('0630'), 390);
  assert.equal(parseHM('6:05'), 365);
  assert.equal(parseHM('24:00'), 1440);
  assert.equal(parseHM('24:30'), null);
  assert.equal(parseHM('7:60'), null);
  assert.equal(parseHM('abc'), null);
});

test('parseHours / formatHours', () => {
  assert.deepEqual(parseHours('always'), { always: true });
  assert.deepEqual(parseHours(''), { always: true });
  assert.deepEqual(parseHours('06:00-23:00'), { always: false, start: 360, end: 1380 });
  assert.deepEqual(parseHours('22:00~06:00'), { always: false, start: 1320, end: 360 });
  assert.deepEqual(parseHours('00:00-24:00'), { always: true });
  assert.equal(parseHours('6-23'), null);
  assert.equal(formatHours(parseHours('6:00-23:30')), '06:00-23:30');
  assert.equal(formatHours(parseHours('06:00-24:00')), '06:00-24:00');
});

test('inHours handles normal and overnight ranges', () => {
  const day = parseHours('06:00-23:00');
  assert.equal(inHours(at(5, 59), day), false);
  assert.equal(inHours(at(6, 0), day), true);
  assert.equal(inHours(at(22, 59), day), true);
  assert.equal(inHours(at(23, 0), day), false);
  const night = parseHours('22:00-02:00');
  assert.equal(inHours(at(23, 30), night), true);
  assert.equal(inHours(at(1, 59), night), true);
  assert.equal(inHours(at(2, 0), night), false);
  assert.equal(inHours(at(12, 0), night), false);
});

test('parseDays understands names, ranges, presets and Korean', () => {
  assert.deepEqual([...parseDays('weekdays')].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseDays('weekends')].sort(), [0, 6]);
  assert.equal(parseDays('everyday').size, 7);
  assert.deepEqual([...parseDays('mon,wed,fri')].sort(), [1, 3, 5]);
  assert.deepEqual([...parseDays('fri-mon')].sort(), [0, 1, 5, 6]);
  assert.deepEqual([...parseDays('월-금')].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseDays('Tuesday thursday')].sort(), [2, 4]);
  assert.equal(parseDays('funday'), null);
  assert.equal(formatDays(parseDays('mon-fri')), 'weekdays');
  assert.equal(formatDays(parseDays('sun,mon')), 'mon,sun');
});

test('nextScheduledStart', () => {
  const sched = { hours: parseHours('06:00-23:00'), days: parseDays('weekdays') };
  // Sunday 12:00 -> Monday 06:00
  assert.equal(nextScheduledStart(at(12).getTime(), sched), at(6, 0, 9).getTime());
  // Monday 10:00 is inside -> itself
  assert.equal(nextScheduledStart(at(10, 0, 9).getTime(), sched), at(10, 0, 9).getTime());
  // Monday 23:30 -> Tuesday 06:00
  assert.equal(nextScheduledStart(at(23, 30, 9).getTime(), sched), at(6, 0, 10).getTime());
  assert.equal(isScheduledAt(at(7, 0, 9).getTime(), sched), true);
  assert.equal(nextScheduledStart(at(23, 30, 9).getTime() + 0.5 * MINUTE, sched) % MINUTE, 0);
  assert.ok(HOUR === 60 * MINUTE);
});
