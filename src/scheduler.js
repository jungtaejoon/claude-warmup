import { HOUR, MINUTE, isScheduledAt } from './time.js';

/** Length of Claude's session (usage) window. */
export const WINDOW_MS = 5 * HOUR;
/** Wait this long after a reset before treating the window as over (clock skew). */
export const RESET_MARGIN_MS = MINUTE;
/** When the server didn't tell us the reset time, assume a full window from the ping. */
export const ESTIMATE_WINDOW_MS = WINDOW_MS + 2 * MINUTE;

/**
 * Cheap first pass that needs no network: is there any reason to look at usage now?
 * @returns {{action: 'skip'|'check', reason?: string, until?: number}}
 */
export function precheck({ now, schedule, state }) {
  if (!isScheduledAt(now, schedule)) return { action: 'skip', reason: 'outside_schedule' };
  if (state.backoffUntil && state.backoffUntil > now) return { action: 'skip', reason: 'backoff', until: state.backoffUntil };
  if (state.blockedUntil && state.blockedUntil > now) return { action: 'skip', reason: 'limit_reached', until: state.blockedUntil };
  if (state.recheckAt && state.recheckAt > now) return { action: 'skip', reason: 'recheck_later', until: state.recheckAt };
  if (state.windowEndsAt && state.windowEndsAt + RESET_MARGIN_MS > now) {
    return { action: 'skip', reason: 'window_active', until: state.windowEndsAt };
  }
  return { action: 'check' };
}

/**
 * Second pass with fresh usage data: ping only when no session window is running.
 * When usage can't be read we ping anyway: a ping inside an active window costs
 * almost nothing and changes nothing.
 */
export function decideWithUsage({ now, usage }) {
  if (!usage || !usage.ok) return { action: 'ping', reason: 'usage_unavailable' };
  const s = usage.session;
  if (!s) return { action: 'skip', reason: 'no_session_limit', until: now + HOUR };
  if (s.resetsAt && s.resetsAt > now) return { action: 'skip', reason: 'window_active', until: s.resetsAt };
  return { action: 'ping', reason: 'no_active_window' };
}

/** 5, 10, 20, 40, 60, 60, ... minutes */
export function backoffMs(failures) {
  const n = Math.max(1, failures);
  return Math.min(60, 5 * 2 ** (n - 1)) * MINUTE;
}

/** Sanity-check a server reset time for the window a ping just started. */
export function windowEndAfterPing(resetAt, pingedAt) {
  if (!resetAt || resetAt <= pingedAt) return pingedAt + ESTIMATE_WINDOW_MS;
  return Math.min(resetAt, pingedAt + WINDOW_MS + 5 * MINUTE);
}
