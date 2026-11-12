import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfigValue, loadConfig, saveConfig, DEFAULTS, getSchedule } from '../src/config.js';
import { getPaths } from '../src/paths.js';

test('validateConfigValue normalises good input', () => {
  assert.deepEqual(validateConfigValue('hours', '6:00 - 23:30'), { ok: true, value: '06:00-23:30' });
  assert.deepEqual(validateConfigValue('hours', 'ALWAYS'), { ok: true, value: 'always' });
  assert.deepEqual(validateConfigValue('days', 'mon-fri'), { ok: true, value: 'weekdays' });
  assert.deepEqual(validateConfigValue('days', '토,일'), { ok: true, value: 'weekends' });
  assert.deepEqual(validateConfigValue('days', 'mon wed'), { ok: true, value: 'mon,wed' });
  assert.deepEqual(validateConfigValue('model', 'claude-sonnet-5-5'), { ok: true, value: 'claude-sonnet-5-5' });
  assert.deepEqual(validateConfigValue('model', 'default'), { ok: true, value: '' });
  assert.deepEqual(validateConfigValue('interval', '10'), { ok: true, value: 10 });
  assert.deepEqual(validateConfigValue('lang', 'KO'), { ok: true, value: 'ko' });
  assert.deepEqual(validateConfigValue('message', 'good morning'), { ok: true, value: 'good morning' });
  assert.deepEqual(validateConfigValue('claudePath', 'auto'), { ok: true, value: '' });
});

test('validateConfigValue rejects bad input', () => {
  for (const [k, v] of [
    ['hours', '25:00-26:00'], ['days', 'someday'], ['model', 'rm -rf'], ['interval', '0'], ['interval', '61'],
    ['interval', '2.5'], ['lang', 'fr'], ['message', ''], ['message', '-p'], ['message', 'a"b'], ['message', '100%'],
    ['nope', 'x'],
  ]) {
    assert.equal(validateConfigValue(k, v).ok, false, `${k}=${v}`);
  }
});

test('load/save round trip ignores junk', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-cfg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const paths = getPaths({ CLAUDE_WARMUP_HOME: dir });
  assert.deepEqual(loadConfig(paths), { ...DEFAULTS });
  fs.writeFileSync(paths.configFile, JSON.stringify({ hours: '07:00-22:00', interval: 999, model: 'sonnet', extra: 1 }));
  const cfg = loadConfig(paths);
  assert.equal(cfg.hours, '07:00-22:00');
  assert.equal(cfg.interval, DEFAULTS.interval, 'invalid values fall back to defaults');
  assert.equal(cfg.model, 'sonnet');
  saveConfig(paths, cfg);
  assert.equal(JSON.parse(fs.readFileSync(paths.configFile, 'utf8')).extra, undefined);
});

test('getSchedule', () => {
  const s = getSchedule({ hours: '06:00-23:00', days: 'weekdays' });
  assert.equal(s.hours.start, 360);
  assert.equal(s.days.has(0), false);
  assert.equal(getSchedule({ hours: 'garbage', days: 'garbage' }).hours.always, true);
});

test('getPaths per platform', () => {
  // Literal expectations: the result must not depend on which OS runs the test.
  const home = '/home/u';
  assert.equal(getPaths({}, 'darwin', home).configFile, '/home/u/Library/Application Support/claude-warmup/config.json');
  assert.equal(getPaths({}, 'linux', home).configDir, '/home/u/.config/claude-warmup');
  assert.equal(getPaths({ XDG_DATA_HOME: '/xdg' }, 'linux', home).dataDir, '/xdg/claude-warmup');
  const winHome = 'C:\\Users\\u';
  assert.equal(getPaths({}, 'win32', winHome).configDir, 'C:\\Users\\u\\AppData\\Roaming\\claude-warmup');
  assert.equal(getPaths({ APPDATA: 'C:\\R', LOCALAPPDATA: 'C:\\L' }, 'win32', winHome).stateFile, 'C:\\L\\claude-warmup\\state.json');
});

test('peak: off or HH:MM', () => {
  assert.deepEqual(validateConfigValue('peak', '14:00'), { ok: true, value: '14:00' });
  assert.deepEqual(validateConfigValue('peak', '930'), { ok: true, value: '09:30' });
  assert.deepEqual(validateConfigValue('peak', 'off'), { ok: true, value: '' });
  assert.deepEqual(validateConfigValue('peak', ''), { ok: true, value: '' });
  assert.equal(validateConfigValue('peak', '25:00').ok, false);
  assert.equal(validateConfigValue('peak', 'noon').ok, false);
});

test('peak with days', () => {
  assert.deepEqual(validateConfigValue('peak', '11:30 weekdays'), { ok: true, value: '11:30 weekdays' });
  assert.deepEqual(validateConfigValue('peak', '평일 11:30'), { ok: true, value: '11:30 weekdays' });
  assert.deepEqual(validateConfigValue('peak', '14:00 mon,wed'), { ok: true, value: '14:00 mon,wed' });
  assert.deepEqual(validateConfigValue('peak', '14:00 everyday'), { ok: true, value: '14:00' });
  assert.equal(validateConfigValue('peak', '14:00 someday').ok, false);
});
