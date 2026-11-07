// Everything that talks to the official `claude` CLI lives here.
// claude-warmup never reads your Claude credentials itself: the CLI does the auth.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from './proc.js';
import { usageFromReport, usageFromText, sessionResetFromRateLimits, toMs } from './usage.js';

const IS_WIN = process.platform === 'win32';

/** System prompt for the warm-up message: keeps the request tiny and the reply one word. */
export const PING_SYSTEM_PROMPT = 'This is an automated warm-up check. Reply with one word: ok';

export function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    if (!IS_WIN) fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** The copy of Claude Code that ships inside the Claude desktop app (macOS), newest first. */
export function findDesktopBundledClaude(home = os.homedir()) {
  if (process.platform !== 'darwin') return null;
  const base = path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code');
  let versions;
  try {
    versions = fs.readdirSync(base).filter((v) => /^\d+\.\d+\.\d+/.test(v));
  } catch {
    return null;
  }
  versions.sort(compareVersions).reverse();
  for (const v of versions) {
    const dir = path.join(base, v);
    const candidates = [path.join(dir, 'claude')];
    try {
      for (const sub of fs.readdirSync(dir)) {
        candidates.push(path.join(dir, sub, 'claude.app', 'Contents', 'MacOS', 'claude'), path.join(dir, sub, 'claude'));
      }
    } catch { /* ignore */ }
    for (const c of candidates) if (isExecutableFile(c)) return c;
  }
  return null;
}

export function isDesktopBundled(p) {
  return /[\\/]Application Support[\\/]Claude[\\/]claude-code[\\/]/.test(p || '');
}

/** Locate the claude CLI: configured path, then PATH, then the usual install spots. */
export function findClaude(configuredPath = '', env = process.env, home = os.homedir()) {
  if (configuredPath) return isExecutableFile(configuredPath) ? configuredPath : null;
  const names = IS_WIN ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (isExecutableFile(p)) return p;
    }
  }
  const known = IS_WIN
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
      ]
    : [
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.claude', 'local', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        path.join(home, '.npm-global', 'bin', 'claude'),
        path.join(home, '.bun', 'bin', 'claude'),
        path.join(home, '.volta', 'bin', 'claude'),
      ];
  for (const p of known) if (isExecutableFile(p)) return p;
  return findDesktopBundledClaude(home);
}

const KEEP_ENV = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH', 'CLAUDE_CONFIG_DIR']);
const DROP_ENV = new Set(['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT']);

/**
 * Environment for the claude child process. We drop API keys / alternate providers so the
 * ping is always counted against your Claude subscription (that is the whole point), and
 * drop variables a parent Claude Code session sets so a nested run behaves like a fresh one.
 */
export function childEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (!KEEP_ENV.has(k) && (DROP_ENV.has(k) || /^(CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_|ANTHROPIC_)/.test(k))) continue;
    out[k] = v;
  }
  return out;
}

export function runClaude(bin, args, opts = {}) {
  return runProcess(bin, args, {
    ...opts,
    env: opts.env || childEnv(),
    shellOnWindows: IS_WIN && /\.(cmd|bat)$/i.test(bin),
  });
}

export function parseStreamJson(text) {
  const events = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      events.push(JSON.parse(s));
    } catch { /* not JSON */ }
  }
  return events;
}

const lastOf = (arr, pred) => {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i];
  return null;
};

export function extractUsageReport(events) {
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (e.usage_report && typeof e.usage_report === 'object') return e.usage_report;
    if (e.message && typeof e.message === 'object' && e.message.usage_report) return e.message.usage_report;
  }
  return null;
}

/** Text of the assistant reply (the result event repeats it, so it is only a fallback). */
export function collectText(events) {
  const parts = [];
  for (const e of events) {
    if (e?.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    }
  }
  if (parts.length) return parts.join('\n');
  const result = lastOf(events, (e) => e?.type === 'result' && typeof e.result === 'string');
  return result ? result.result : '';
}

/** True when the run actually reached the model (it cost tokens). */
export function didCallModel(result) {
  if (!result) return false;
  const u = result.usage || {};
  const tokens = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .reduce((sum, k) => sum + (Number(u[k]) || 0), 0);
  return tokens > 0 || Number(result.total_cost_usd) > 0;
}

export function classifyError(text = '') {
  const t = String(text).toLowerCase();
  if (/not logged in|please run \/login|run \/login|invalid api key|authentication_error|unauthorized|oauth token (has )?expired|\b401\b/.test(t)) return 'not_logged_in';
  if (/usage limit|limit reached|rate.?limit|hit your limit|\b429\b/.test(t)) return 'rate_limited';
  if (/model/.test(t) && /(not found|not available|not exist|invalid|unknown|not supported|unavailable|isn't available|issue with the selected model|no access)/.test(t)) return 'model_unavailable';
  if (/enotfound|econnrefused|econnreset|etimedout|network|fetch failed|socket hang up|getaddrinfo|offline/.test(t)) return 'network';
  if (/overloaded|\b5(00|02|03|29)\b/.test(t)) return 'server';
  return 'unknown';
}

const tail = (s, n = 400) => String(s || '').trim().split(/\r?\n/).slice(-4).join(' ').slice(-n);

export function buildPingArgs({ flags = [], model = '', message = 'hi' } = {}) {
  const has = (f) => flags.includes(f);
  // The prompt goes right after -p: `--tools` is variadic and would swallow a later prompt.
  const args = ['-p', message, '--output-format', 'stream-json', '--verbose'];
  if (model) args.push('--model', model);
  if (has('--no-session-persistence')) args.push('--no-session-persistence');
  if (has('--safe-mode')) args.push('--safe-mode');
  else if (has('--strict-mcp-config')) args.push('--strict-mcp-config');
  if (has('--system-prompt')) args.push('--system-prompt', PING_SYSTEM_PROMPT);
  if (has('--tools')) args.push('--tools', '');
  return args;
}

export function buildUsageArgs({ flags = [] } = {}) {
  const has = (f) => flags.includes(f);
  const args = ['-p', '/usage', '--output-format', 'stream-json', '--verbose'];
  if (has('--no-session-persistence')) args.push('--no-session-persistence');
  if (has('--safe-mode')) args.push('--safe-mode');
  else if (has('--strict-mcp-config')) args.push('--strict-mcp-config');
  // Guards: if an old CLI forwarded "/usage" to the model, keep that as cheap as a ping.
  args.push('--model', 'haiku');
  if (has('--system-prompt')) args.push('--system-prompt', PING_SYSTEM_PROMPT);
  if (has('--tools')) args.push('--tools', '');
  return args;
}

export async function getVersion(bin, opts = {}) {
  const r = await runClaude(bin, ['--version'], { ...opts, timeoutMs: 30_000 });
  return /(\d+\.\d+\.\d+)/.exec(r.stdout || '')?.[1] ?? null;
}

export async function getFlags(bin, opts = {}) {
  const r = await runClaude(bin, ['--help'], { ...opts, timeoutMs: 30_000 });
  return [...new Set(String(r.stdout || '').match(/--[a-z][a-z0-9-]*/g) || [])];
}

/** `claude auth status --json` -> object, or null on CLIs without it. */
export async function authStatus(bin, opts = {}) {
  const r = await runClaude(bin, ['auth', 'status', '--json'], { ...opts, timeoutMs: 30_000 });
  try {
    const j = JSON.parse(String(r.stdout || '').trim());
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

/** Send the warm-up message. */
export async function ping({ bin, flags, model, message, cwd, timeoutMs = 180_000 }) {
  const startedAt = Date.now();
  const proc = await runClaude(bin, buildPingArgs({ flags, model, message }), { cwd, timeoutMs });
  const events = parseStreamJson(proc.stdout);
  const result = lastOf(events, (e) => e?.type === 'result');
  const init = events.find((e) => e?.type === 'system' && e.subtype === 'init');
  const rateLimits = events.filter((e) => e?.type === 'rate_limit_event' && e.rate_limit_info).map((e) => e.rate_limit_info);
  const rejected = rateLimits.find((r) => r.status === 'rejected');
  const ok = Boolean(result) && result.subtype === 'success' && result.is_error !== true;

  let errorText = '';
  let errorKind = null;
  if (!ok) {
    errorText = (typeof result?.result === 'string' && result.result)
      || (Array.isArray(result?.errors) && result.errors.join('; '))
      || tail(proc.stderr)
      || proc.error?.message
      || (proc.timedOut ? 'timed out' : `exit code ${proc.code}`);
    if (proc.error?.code === 'ENOENT') errorKind = 'claude_not_found';
    else if (proc.timedOut) errorKind = 'timeout';
    else if (rejected) errorKind = 'rate_limited';
    else errorKind = classifyResult(result, errorText);
  }

  return {
    ok,
    errorKind,
    errorText: String(errorText).slice(0, 500),
    model: init?.model || model || null,
    apiKeySource: init?.apiKeySource ?? null,
    durationMs: Date.now() - startedAt,
    costUsd: result?.total_cost_usd ?? null,
    reply: ok && typeof result.result === 'string' ? result.result.slice(0, 200) : null,
    rateLimits,
    sessionResetAt: sessionResetFromRateLimits(rateLimits),
    limitResetAt: rejected ? toMs(rejected.resetsAt) : null,
    limitType: rejected?.rateLimitType ?? null,
  };
}

/**
 * Read plan usage with `claude -p /usage` (a local command; it should not reach the model).
 * @returns {Promise<{ok: boolean, rows?: object[], session?: object|null, source?: string, reason?: string, detail?: string, calledModel: boolean, fetchedAt?: number}>}
 */
export async function fetchUsage({ bin, flags, cwd, timeoutMs = 90_000 }) {
  const proc = await runClaude(bin, buildUsageArgs({ flags }), { cwd, timeoutMs });
  const events = parseStreamJson(proc.stdout);
  const result = lastOf(events, (e) => e?.type === 'result');
  const calledModel = didCallModel(result);
  const report = extractUsageReport(events);
  let usage = report ? usageFromReport(report) : null;
  if (!usage) usage = usageFromText(collectText(events) || proc.stdout);
  if (usage?.ok) return { ...usage, calledModel, fetchedAt: Date.now() };

  const errorText = (result?.is_error && typeof result.result === 'string' ? result.result : '')
    || tail(proc.stderr)
    || proc.error?.message
    || '';
  let reason;
  if (proc.error?.code === 'ENOENT') reason = 'claude_not_found';
  else if (proc.timedOut) reason = 'timeout';
  else if (usage?.reason) reason = usage.reason;
  else if (result && !result.is_error) {
    // /usage ran but showed no plan rows: logged out, API-key login, or an old CLI.
    const auth = await authStatus(bin, { cwd });
    if (auth && auth.loggedIn === false) reason = 'not_logged_in';
    else if (auth && /api.?key/i.test(String(auth.authMethod || ''))) reason = 'no_plan_data';
    else reason = 'usage_unsupported';
  } else reason = classifyResult(result, errorText || collectText(events));
  return { ok: false, reason, detail: String(errorText).slice(0, 300), calledModel };
}

/** Classify a failed result using the HTTP status Claude Code reports, then the text. */
export function classifyResult(result, text) {
  const status = Number(result?.api_error_status);
  if (status === 401 || status === 403) return 'not_logged_in';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return classifyError(text);
}
