import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runTick, doPing, getClaudeInfo } from '../src/engine.js';
import { loadState, saveState, acquireLock, releaseLock } from '../src/state.js';
import { readLog } from '../src/log.js';
import { formatHM } from '../src/time.js';
import { sandbox } from './helpers.js';

const HOUR = 3600e3;

test('no active window -> one ping, then quiet until the window ends', async (t) => {
  const box = sandbox('idle');
  t.after(() => box.cleanup());

  const r1 = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r1.action, 'ping');
  assert.equal(r1.reason, 'no_active_window');
  assert.equal(r1.result.ok, true);
  assert.equal(box.pings().length, 1);

  const state = loadState(box.paths);
  assert.equal(state.windowSource, 'server');
  assert.ok(state.windowEndsAt > Date.now() + 4 * HOUR - 60e3);
  assert.equal(state.lastPing.ok, true);
  assert.equal(state.claudeInfo.version, '2.1.999');

  const callsBefore = box.calls().length;
  const r2 = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r2.reason, 'window_active');
  assert.equal(box.calls().length, callsBefore, 'a known active window costs no claude call');

  const events = readLog(box.paths).map((e) => e.ev);
  assert.deepEqual(events, ['check', 'ping']);
});

test('the ping uses haiku, a tiny system prompt and no tools', async (t) => {
  const box = sandbox('idle');
  t.after(() => box.cleanup());
  await runTick({ paths: box.paths, config: box.config });
  const [args] = box.pings();
  assert.equal(args[1], 'hi');
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  for (const f of ['--no-session-persistence', '--safe-mode', '--system-prompt', '--tools']) assert.ok(args.includes(f), f);
});

test('an already active window (e.g. you are working) -> no ping', async (t) => {
  const box = sandbox('active');
  t.after(() => box.cleanup());
  const r = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r.action, 'skip');
  assert.equal(r.reason, 'window_active');
  assert.equal(box.pings().length, 0);
  assert.ok(loadState(box.paths).windowEndsAt > Date.now());
});

test('usage not readable -> ping anyway, use the reset time from the ping', async (t) => {
  const box = sandbox('text_only');
  t.after(() => box.cleanup());
  // text_only reports an idle session as text: ping, and the ping carries the reset time
  const r = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r.action, 'ping');
  assert.equal(r.result.ok, true);
  assert.equal(loadState(box.paths).windowSource, 'server');
});

test('no usage and no reset info -> estimated 5h window', async (t) => {
  const box = sandbox('no_report');
  t.after(() => box.cleanup());
  const r = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r.action, 'ping');
  assert.equal(r.reason, 'usage_unavailable');
  const state = loadState(box.paths);
  assert.equal(state.windowSource, 'estimate');
  const left = state.windowEndsAt - Date.now();
  assert.ok(left > 5 * HOUR - 60e3 && left <= 5 * HOUR + 2 * 60e3, String(left));
});

test('logged out -> no ping attempt, back off for an hour', async (t) => {
  const box = sandbox('logged_out');
  t.after(() => box.cleanup());
  const r = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r.action, 'error');
  assert.equal(r.reason, 'not_logged_in');
  assert.equal(box.pings().length, 0);
  const state = loadState(box.paths);
  assert.ok(state.backoffUntil > Date.now() + HOUR - 60e3);
  assert.equal((await runTick({ paths: box.paths, config: box.config })).reason, 'backoff');
});

test('outside the schedule -> nothing runs at all', async (t) => {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const hours = `${formatHM((mins + 120) % 1440)}-${formatHM((mins + 180) % 1440)}`;
  const box = sandbox('idle', { hours });
  t.after(() => box.cleanup());
  const r = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r.reason, 'outside_schedule');
  assert.equal(box.calls().length, 0);
});

test('model not available -> retried with the default model', async (t) => {
  const box = sandbox('model_missing');
  t.after(() => box.cleanup());
  const r = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r.result.ok, true);
  assert.equal(r.result.modelFallbackFrom, 'haiku');
  const pings = box.pings();
  assert.equal(pings.length, 2);
  assert.ok(!pings[1].includes('--model'));
});

test('a 5-hour limit hit -> wait for that reset instead of retrying', async (t) => {
  const box = sandbox('rejected_5h');
  t.after(() => box.cleanup());
  const state = {};
  const info = await getClaudeInfo(box.config.claudePath, state);
  const res = await doPing({ paths: box.paths, config: box.config, state, info, reason: 'manual' });
  assert.equal(res.ok, false);
  assert.equal(res.errorKind, 'rate_limited');
  assert.ok(state.windowEndsAt > Date.now());
  assert.equal(state.backoffUntil, undefined);
});

test('a held lock makes a concurrent tick skip', async (t) => {
  const box = sandbox('idle');
  t.after(() => box.cleanup());
  assert.equal(acquireLock(box.paths.lockFile), true);
  const r = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r.reason, 'locked');
  releaseLock(box.paths.lockFile);
  assert.equal(fs.existsSync(box.paths.lockFile), false);
});

test('a stale lock is taken over', async (t) => {
  const box = sandbox('active');
  t.after(() => box.cleanup());
  fs.mkdirSync(box.paths.dataDir, { recursive: true });
  fs.writeFileSync(box.paths.lockFile, '12345');
  const old = new Date(Date.now() - 20 * 60e3);
  fs.utimesSync(box.paths.lockFile, old, old);
  const r = await runTick({ paths: box.paths, config: box.config });
  assert.equal(r.reason, 'window_active');
});

test('state survives a corrupt file', (t) => {
  const box = sandbox('idle');
  t.after(() => box.cleanup());
  fs.mkdirSync(box.paths.dataDir, { recursive: true });
  fs.writeFileSync(box.paths.stateFile, '{not json');
  assert.deepEqual(loadState(box.paths), {});
  saveState(box.paths, { a: 1 });
  assert.deepEqual(loadState(box.paths), { a: 1 });
});
