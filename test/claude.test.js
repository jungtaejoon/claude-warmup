import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPingArgs, buildUsageArgs, childEnv, parseStreamJson, classifyError, classifyResult, didCallModel,
  ping, fetchUsage, getFlags, getVersion, authStatus, PING_SYSTEM_PROMPT,
} from '../src/claude.js';
import { sandbox } from './helpers.js';

const ALL_FLAGS = ['--no-session-persistence', '--safe-mode', '--strict-mcp-config', '--system-prompt', '--tools', '--model'];

test('buildPingArgs keeps the prompt before the variadic --tools flag', () => {
  const args = buildPingArgs({ flags: ALL_FLAGS, model: 'haiku', message: 'hi' });
  assert.deepEqual(args.slice(0, 2), ['-p', 'hi']);
  assert.deepEqual(args.slice(-2), ['--tools', '']);
  assert.ok(args.includes('--safe-mode'));
  assert.ok(!args.includes('--strict-mcp-config'), 'safe-mode already covers MCP');
  assert.equal(args[args.indexOf('--system-prompt') + 1], PING_SYSTEM_PROMPT);
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
});

test('buildPingArgs only uses flags the CLI supports', () => {
  const args = buildPingArgs({ flags: [], model: '', message: 'hi' });
  assert.deepEqual(args, ['-p', 'hi', '--output-format', 'stream-json', '--verbose']);
  const mid = buildPingArgs({ flags: ['--strict-mcp-config'], model: 'haiku', message: 'hi' });
  assert.ok(mid.includes('--strict-mcp-config'));
});

test('buildUsageArgs asks for /usage and stays cheap if it ever hit the model', () => {
  const args = buildUsageArgs({ flags: ALL_FLAGS });
  assert.deepEqual(args.slice(0, 2), ['-p', '/usage']);
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  assert.deepEqual(args.slice(-2), ['--tools', '']);
});

test('childEnv drops API keys and parent-session variables, keeps the rest', () => {
  const env = childEnv({
    PATH: '/usr/bin',
    HOME: '/home/x',
    ANTHROPIC_API_KEY: 'sk-ant-xxx',
    ANTHROPIC_BASE_URL: 'https://example.invalid',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_OAUTH_TOKEN: 'keep-me',
    CLAUDE_CODE_GIT_BASH_PATH: 'C:\\git\\bash.exe',
    CLAUDE_CONFIG_DIR: '/home/x/.claude-alt',
    HTTPS_PROXY: 'http://proxy:8080',
  });
  assert.deepEqual(Object.keys(env).sort(), [
    'CLAUDE_CODE_GIT_BASH_PATH', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'HOME', 'HTTPS_PROXY', 'PATH',
  ]);
});

test('parseStreamJson skips noise', () => {
  const events = parseStreamJson('{"type":"system"}\nnot json\n\n{"type":"result"}\n{broken');
  assert.deepEqual(events.map((e) => e.type), ['system', 'result']);
});

test('error classification', () => {
  assert.equal(classifyError('Not logged in · Please run /login'), 'not_logged_in');
  assert.equal(classifyError("You've hit your limit · resets 3pm"), 'rate_limited');
  assert.equal(classifyError("There's an issue with the selected model (haiku). It may not exist"), 'model_unavailable');
  assert.equal(classifyError('getaddrinfo ENOTFOUND api.anthropic.com'), 'network');
  assert.equal(classifyError('something odd'), 'unknown');
  assert.equal(classifyResult({ api_error_status: 429 }, ''), 'rate_limited');
  assert.equal(classifyResult({ api_error_status: 401 }, ''), 'not_logged_in');
  assert.equal(classifyResult({ api_error_status: 529 }, ''), 'server');
});

test('didCallModel', () => {
  assert.equal(didCallModel({ usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 }), false);
  assert.equal(didCallModel({ usage: { cache_read_input_tokens: 10 } }), true);
  assert.equal(didCallModel({ total_cost_usd: 0.001 }), true);
  assert.equal(didCallModel(null), false);
});

test('fake claude: version, flags and auth', async (t) => {
  const box = sandbox('idle');
  t.after(() => box.cleanup());
  const bin = box.config.claudePath;
  assert.equal(await getVersion(bin), '2.1.999');
  const flags = await getFlags(bin);
  for (const f of ['--safe-mode', '--tools', '--system-prompt', '--no-session-persistence']) assert.ok(flags.includes(f), f);
  assert.equal((await authStatus(bin)).loggedIn, true);
});

test('fake claude: ping returns the new window from rate_limit_event', async (t) => {
  const box = sandbox('idle');
  t.after(() => box.cleanup());
  const res = await ping({ bin: box.config.claudePath, flags: ALL_FLAGS, model: 'haiku', message: 'hi', cwd: box.dir });
  assert.equal(res.ok, true);
  assert.equal(res.model, 'claude-haiku-5-5');
  assert.ok(res.sessionResetAt > Date.now() + 4 * 3600e3 - 60e3);
  assert.equal(res.reply, 'ok');
});

test('fake claude: logged-out ping and usage are classified', async (t) => {
  const box = sandbox('logged_out');
  t.after(() => box.cleanup());
  const res = await ping({ bin: box.config.claudePath, flags: ALL_FLAGS, model: 'haiku', message: 'hi', cwd: box.dir });
  assert.equal(res.ok, false);
  assert.equal(res.errorKind, 'not_logged_in');
  const u = await fetchUsage({ bin: box.config.claudePath, flags: ALL_FLAGS, cwd: box.dir });
  assert.equal(u.ok, false);
  assert.equal(u.reason, 'not_logged_in');
  assert.equal(u.calledModel, false);
});

test('fake claude: usage from usage_report and from text only', async (t) => {
  const box = sandbox('active');
  t.after(() => box.cleanup());
  const u = await fetchUsage({ bin: box.config.claudePath, flags: ALL_FLAGS, cwd: box.dir });
  assert.equal(u.ok, true);
  assert.equal(u.source, 'usage_report');
  assert.equal(u.session.percent, 23);
  assert.ok(u.session.resetsAt > Date.now());

  process.env.FAKE_CLAUDE_SCENARIO = 'text_only';
  const v = await fetchUsage({ bin: box.config.claudePath, flags: ALL_FLAGS, cwd: box.dir });
  assert.equal(v.ok, true);
  assert.equal(v.source, 'text');
  assert.equal(v.rows.length, 2);
});

test('missing binary is reported, not thrown', async () => {
  const res = await ping({ bin: '/definitely/not/here/claude', flags: [], model: '', message: 'hi' });
  assert.equal(res.ok, false);
  assert.equal(res.errorKind, 'claude_not_found');
});
