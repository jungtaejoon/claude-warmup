// The warm-up loop: one `tick` per background run, plus the ping bookkeeping it shares
// with the manual `ping` command.
import fs from 'node:fs';
import { loadState, saveState, acquireLock, releaseLock, waitForLock } from './state.js';
import { appendLog } from './log.js';
import { findClaude, getVersion, getFlags, ping, fetchUsage } from './claude.js';
import { precheck, decideWithUsage, backoffMs, windowEndAfterPing, peakGate, WINDOW_MS } from './scheduler.js';
import { getSchedule, getPeak } from './config.js';
import { pickSession } from './usage.js';
import { HOUR, MINUTE } from './time.js';

export function ensureWorkDir(paths) {
  fs.mkdirSync(paths.workDir, { recursive: true });
  return paths.workDir;
}

/** Version + supported flags of a claude binary, cached until the binary changes. */
export async function getClaudeInfo(bin, state, { cwd } = {}) {
  let real = bin;
  try { real = fs.realpathSync(bin); } catch { /* keep bin */ }
  let mtime = 0;
  try { mtime = fs.statSync(real).mtimeMs; } catch { /* unknown */ }
  const cached = state.claudeInfo;
  if (cached && cached.path === bin && cached.real === real && cached.mtime === mtime
      && Array.isArray(cached.flags) && cached.flags.length) {
    return cached;
  }
  const [version, flags] = await Promise.all([getVersion(bin, { cwd }), getFlags(bin, { cwd })]);
  const info = { path: bin, real, mtime, version, flags, usageCallsModel: false, checkedAt: Date.now() };
  state.claudeInfo = info;
  return info;
}

export function serializeUsage(usage) {
  if (!usage?.ok) return null;
  return { fetchedAt: usage.fetchedAt, source: usage.source, rows: usage.rows, extraUsage: usage.extraUsage ?? null };
}

export function hydrateUsage(saved) {
  if (!saved || !Array.isArray(saved.rows)) return null;
  return {
    ok: true,
    cached: true,
    fetchedAt: saved.fetchedAt,
    source: saved.source,
    rows: saved.rows,
    session: pickSession(saved.rows),
    extraUsage: saved.extraUsage ?? null,
  };
}

/** Remember what a successful usage read says about the current session window. */
export function applyUsageToState(state, usage, now) {
  if (!usage?.ok) return;
  state.lastUsage = serializeUsage(usage);
  const s = usage.session;
  if (!s) return;
  state.windowEndsAt = s.resetsAt && s.resetsAt > now ? Math.min(s.resetsAt, now + WINDOW_MS + 5 * MINUTE) : null;
  if (state.windowEndsAt) state.windowSource = 'server';
}

/** Send one warm-up message and record the outcome in `state` (caller saves it). */
export async function doPing({ paths, config, state, info, reason }) {
  const cwd = ensureWorkDir(paths);
  const startedAt = Date.now();
  // Once a minimal ping has worked where the trimmed one failed, keep using the minimal one.
  const flags = info.minimalPing ? [] : info.flags;
  let res = await ping({ bin: info.path, flags, model: config.model, message: config.message, cwd });
  if (!res.ok && res.errorKind === 'model_unavailable' && config.model) {
    res = { ...(await ping({ bin: info.path, flags, model: '', message: config.message, cwd })), modelFallbackFrom: config.model };
  }
  if (!res.ok && res.errorKind === 'unknown' && flags.length) {
    // A future CLI may change what one of our trimming flags means: retry with none of them.
    const plain = await ping({ bin: info.path, flags: [], model: res.modelFallbackFrom ? '' : config.model, message: config.message, cwd });
    if (plain.ok) {
      info.minimalPing = true;
      res = { ...plain, modelFallbackFrom: res.modelFallbackFrom };
    }
  }
  const now = Date.now();

  let resetAt = res.sessionResetAt;
  if (res.ok && !resetAt && !info.usageCallsModel) {
    // The ping didn't say when the window ends: ask /usage.
    const u = await fetchUsage({ bin: info.path, flags: info.flags, cwd });
    if (u.calledModel) info.usageCallsModel = true;
    if (u.ok) {
      state.lastUsage = serializeUsage(u);
      resetAt = u.session?.resetsAt || null;
    }
  }

  if (res.ok) {
    state.windowEndsAt = windowEndAfterPing(resetAt, startedAt);
    state.windowSource = resetAt ? 'server' : 'estimate';
    state.failures = 0;
    state.backoffUntil = null;
    state.blockedUntil = null;
    state.recheckAt = null;
    state.peakWaitUntil = null;
  } else {
    state.failures = (state.failures || 0) + 1;
    if (res.errorKind === 'rate_limited') {
      if (res.limitType === 'five_hour' && res.limitResetAt) state.windowEndsAt = res.limitResetAt;
      else state.blockedUntil = res.limitResetAt || now + HOUR;
    } else {
      const long = res.errorKind === 'not_logged_in' || res.errorKind === 'claude_not_found';
      state.backoffUntil = now + (long ? HOUR : backoffMs(state.failures));
    }
  }

  state.lastPing = {
    at: startedAt,
    ok: res.ok,
    reason,
    model: res.model,
    ms: res.durationMs,
    windowEndsAt: res.ok ? state.windowEndsAt : null,
    windowSource: res.ok ? state.windowSource : null,
    error: res.ok ? null : res.errorKind,
    detail: res.ok ? null : res.errorText.slice(0, 300),
    modelFallbackFrom: res.modelFallbackFrom || null,
    apiKeySource: res.apiKeySource,
  };
  appendLog(paths, {
    ev: 'ping',
    ok: res.ok,
    reason,
    model: res.model || undefined,
    ms: res.durationMs,
    windowEndsAt: res.ok ? state.windowEndsAt : undefined,
    source: res.ok ? state.windowSource : undefined,
    error: res.ok ? undefined : res.errorKind,
    detail: res.ok ? undefined : res.errorText.slice(0, 200),
  });
  return { ...res, windowEndsAt: res.ok ? state.windowEndsAt : null, windowSource: res.ok ? state.windowSource : null };
}

/**
 * One background check. Cheap when nothing is due (no process spawned); otherwise reads
 * usage with `claude -p /usage` and pings only when no session window is active.
 */
export async function runTick({ paths, config, now = Date.now(), waitLockMs = 0 }) {
  const locked = waitLockMs ? await waitForLock(paths.lockFile, waitLockMs) : acquireLock(paths.lockFile);
  if (!locked) return { action: 'skip', reason: 'locked' };
  try {
    const state = loadState(paths);
    state.lastTickAt = now;
    const pre = precheck({ now, schedule: getSchedule(config), state });
    if (pre.action === 'skip') {
      saveState(paths, state);
      return pre;
    }

    const bin = findClaude(config.claudePath);
    if (!bin) {
      state.backoffUntil = now + HOUR;
      state.lastError = { at: now, kind: 'claude_not_found' };
      appendLog(paths, { ev: 'error', error: 'claude_not_found' });
      saveState(paths, state);
      return { action: 'error', reason: 'claude_not_found' };
    }

    const cwd = ensureWorkDir(paths);
    const info = await getClaudeInfo(bin, state, { cwd });
    let usage = { ok: false, reason: 'usage_unsupported', calledModel: false };
    if (!info.usageCallsModel) {
      usage = await fetchUsage({ bin, flags: info.flags, cwd });
      if (usage.calledModel) info.usageCallsModel = true;
    }
    const checkedAt = Date.now();
    applyUsageToState(state, usage, checkedAt);

    if (!usage.ok && usage.reason === 'not_logged_in') {
      state.failures = (state.failures || 0) + 1;
      state.backoffUntil = checkedAt + HOUR;
      state.lastError = { at: checkedAt, kind: 'not_logged_in' };
      appendLog(paths, { ev: 'check', usage: false, reason: 'not_logged_in', decision: 'backoff' });
      saveState(paths, state);
      return { action: 'error', reason: 'not_logged_in' };
    }

    let decision = decideWithUsage({ now: checkedAt, usage });
    const peak = getPeak(config);
    if (decision.action === 'ping' && peak && peak.gap !== null) {
      // Peak mode: start a window only at a slot that lines the resets up with the peak.
      const gate = peakGate({ now: checkedAt, peak, earlyMs: config.interval * MINUTE });
      if (gate.ok && gate.free) { /* no peak soon (e.g. a weekend): chain windows as usual */ }
      else decision = gate.ok
        ? { action: 'ping', reason: 'peak_slot', peakAt: gate.peakAt }
        : { action: 'skip', reason: 'peak_wait', until: gate.until, peakAt: gate.peakAt };
    }
    appendLog(paths, {
      ev: 'check',
      usage: usage.ok,
      reason: usage.ok ? undefined : usage.reason,
      session: usage.session ? { percent: usage.session.percent, resetsAt: usage.session.resetsAt } : undefined,
      decision: decision.reason,
    });
    if (decision.action === 'skip') {
      if (decision.reason === 'no_session_limit') state.recheckAt = decision.until;
      if (decision.reason === 'peak_wait') state.peakWaitUntil = decision.until;
      saveState(paths, state);
      return decision;
    }

    const result = await doPing({ paths, config, state, info, reason: decision.reason });
    saveState(paths, state);
    return { action: 'ping', reason: decision.reason, result };
  } finally {
    releaseLock(paths.lockFile);
  }
}
