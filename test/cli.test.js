import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, computeNext, describeSchedule, rowLabel } from '../src/cli.js';
import { MESSAGES, setLang, detectLang, t } from '../src/i18n.js';
import { strWidth, fmtDuration, shortModel, pad } from '../src/format.js';
import { DEFAULTS } from '../src/config.js';
import { sandbox } from './helpers.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'claude-warmup.js');
const HOUR = 3600e3;

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['config', 'hours', '06:00-23:00']), { cmd: 'config', args: ['hours', '06:00-23:00'], opts: {} });
  assert.deepEqual(parseArgs(['logs', '-n', '5', '--json']), { cmd: 'logs', args: [], opts: { n: '5', json: true } });
  assert.deepEqual(parseArgs(['--lang', 'ko', 'status', '--no-check']).opts, { lang: 'ko', noCheck: true });
  assert.deepEqual(parseArgs(['--lang=en']).opts, { lang: 'en' });
  assert.equal(parseArgs(['-h']).opts.help, true);
  assert.equal(parseArgs(['-v']).opts.version, true);
});

test('every message exists in both languages', () => {
  assert.deepEqual(Object.keys(MESSAGES.ko).sort(), Object.keys(MESSAGES.en).sort());
  for (const [k, v] of Object.entries(MESSAGES.en)) {
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(vars(MESSAGES.ko[k]), vars(v), `placeholders differ for ${k}`);
  }
});

test('detectLang', () => {
  assert.equal(detectLang({ LANG: 'ko_KR.UTF-8' }), 'ko');
  assert.equal(detectLang({ LANG: 'en_US.UTF-8' }), 'en');
  assert.equal(detectLang({ LANG: 'ko_KR.UTF-8' }, 'en'), 'en');
  assert.equal(detectLang({ LC_ALL: 'C', LANG: 'ko_KR' }), 'ko');
});

test('format helpers', () => {
  setLang('en');
  assert.equal(strWidth('현재 세션'), 9);
  assert.equal(strWidth('\x1b[32mok\x1b[0m'), 2);
  assert.equal(strWidth(pad('한', 4)), 4);
  assert.equal(fmtDuration(4 * HOUR + 57 * 60e3), '4h 57m');
  assert.equal(fmtDuration(30e3), '<1m');
  assert.equal(fmtDuration(50 * HOUR), '2d 2h');
  setLang('ko');
  assert.equal(fmtDuration(4 * HOUR + 57 * 60e3), '4시간 57분');
  assert.equal(shortModel('claude-haiku-4-5-20251001'), 'haiku-4-5');
  assert.equal(shortModel('claude-haiku-5-5'), 'haiku-5-5');
  setLang('en');
});

test('describeSchedule and row labels', () => {
  setLang('en');
  assert.equal(describeSchedule({ hours: 'always', days: 'everyday' }), 'all day · every day');
  assert.equal(describeSchedule({ hours: '06:00-23:00', days: 'mon,wed' }), '06:00–23:00 · Mon, Wed');
  setLang('ko');
  assert.equal(describeSchedule({ hours: 'always', days: 'weekdays' }), '하루 종일 · 평일');
  assert.equal(rowLabel({ kind: 'weekly_scoped', scopeName: 'Opus' }), '주간 · Opus');
  assert.equal(rowLabel({ kind: 'session' }), t('rowSession'));
  setLang('en');
});

test('computeNext', () => {
  const now = new Date(2026, 10, 9, 10, 0).getTime();
  const svc = { active: true };
  const cfg = { ...DEFAULTS };
  assert.equal(computeNext({ now, config: cfg, state: {}, svc: { active: false }, session: null }).kind, 'off');
  assert.equal(computeNext({ now, config: cfg, state: {}, svc, session: null }).kind, 'soon');
  const active = { active: true, resetsAt: now + 2 * HOUR };
  assert.deepEqual(computeNext({ now, config: cfg, state: {}, svc, session: active }), { kind: 'afterWindow', at: now + 2 * HOUR, within: 5 });
  // window ends at 12:00 but the schedule only starts at 18:00
  const evening = { ...cfg, hours: '18:00-23:00' };
  const n = computeNext({ now, config: evening, state: {}, svc, session: active });
  assert.equal(n.kind, 'scheduleStart');
  assert.equal(n.at, new Date(2026, 10, 9, 18, 0).getTime());
  assert.equal(computeNext({ now, config: cfg, state: { backoffUntil: now + HOUR }, svc, session: null }).kind, 'retry');
});

test('the CLI runs end to end against the fake claude', (t) => {
  const box = sandbox('idle');
  t.after(() => box.cleanup());
  const env = { ...process.env, CLAUDE_WARMUP_HOME: box.dir, NO_COLOR: '1' };
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args, '--lang', 'en'], { env, encoding: 'utf8' });

  assert.equal(run('config', 'claudePath', box.config.claudePath).status, 0);
  assert.equal(run('config', 'hours', '25:00').status, 1);

  const status = run('status');
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Current session \(5h\)/);
  assert.match(status.stdout, /no active window/);
  assert.match(status.stdout, /Weekly · Sonnet/);

  const ping = run('ping');
  assert.equal(ping.status, 0, ping.stdout + ping.stderr);
  assert.match(ping.stdout, /Warm-up sent \(haiku-5-5/);

  const json = JSON.parse(run('status', '--json').stdout);
  assert.equal(json.usage.rows.length, 3);
  assert.equal(json.lastPing.ok, true);

  const logs = run('logs');
  assert.match(logs.stdout, /warm-up sent · haiku-5-5 · manual/);

  const short = run('status', '--short', '--cached');
  assert.equal(short.status, 0);
  assert.match(short.stdout, /week 41%/);

  assert.equal(run('nope').status, 2);
});
