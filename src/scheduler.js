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
  if (state.peakWaitUntil && state.peakWaitUntil > now) {
    return { action: 'skip', reason: 'peak_wait', until: state.peakWaitUntil, peakAt: state.peakWaitPeakAt ?? null };
  }
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

// ---------- peak time ----------
// With a peak time (say weekdays 11:30) and a gap you chose (say 02:30–06:30), windows keep
// chaining as usual, except:
//   - no new window is started from 5 hours before the gap ends until it ends ("rest"): a window
//     started then would run past the gap's end;
//   - right at the gap's end a window starts, and windows from there end exactly at the peak.
// 24 hours don't divide into 5-hour windows, which is why there is a gap at all: between two
// daily peaks there is room for four windows and 4 hours with none. It can sit after any window
// boundary, i.e. start at peak + 5h·m for m = 0..4; `config gap` picks m.
// If something knocks the chain off (you start a window yourself at another time), it keeps
// chaining and lines up again at the next gap. Only days with a peak have a rest.

/** A ping this much after the gap's end still counts as lined up (the computer may wake late). */
export const PEAK_LATE_MS = 20 * MINUTE;
/** Windows between two daily peaks: 5h·k must stay under a day, so 4. */
const SLOTS_PER_PEAK = 4;
const ALL_DAYS = new Set([0, 1, 2, 3, 4, 5, 6]);
const DAY_MS = 24 * HOUR;
const DAY_MIN = 1440;
/** Length of the daily gap: what is left of 24h after four 5-hour windows. */
export const GAP_MS = DAY_MS - SLOTS_PER_PEAK * WINDOW_MS;

/** Peak occurrences (local time) from `fromDay` to `toDay` days around `ms`, on the peak's days. */
export function peakTimes(ms, peak, fromDay = -1, toDay = 8) {
  const days = peak.days || ALL_DAYS;
  const out = [];
  for (let day = fromDay; day <= toDay; day++) {
    const d = new Date(ms);
    d.setDate(d.getDate() + day);
    d.setHours(Math.floor(peak.min / 60), peak.min % 60, 0, 0);
    if (days.has(d.getDay())) out.push(d.getTime());
  }
  return out;
}

/** End of the gap that leads into the peak at `peakAt`: from there, 4 − m windows end at the peak. */
export function gapEndFor(peakAt, gap) {
  return peakAt - (SLOTS_PER_PEAK - gap) * WINDOW_MS;
}

/**
 * Can a window start now?
 * - in a rest (gap end − 5h .. gap end − early): no, wait until the gap's end
 * - at the gap's end: yes, and it lines up with the peak
 * - otherwise: yes, chain as usual
 * @returns {{ok: true, aligned?: true, peakAt?: number} | {ok: false, until: number, peakAt: number}}
 */
export function peakGate({ now, peak, earlyMs = 5 * MINUTE }) {
  if (peak.gap === null || peak.gap === undefined) return { ok: true };
  for (const peakAt of peakTimes(now, peak)) {
    const gapEnd = gapEndFor(peakAt, peak.gap);
    const startAt = gapEnd - earlyMs;
    if (now >= gapEnd - WINDOW_MS && now < startAt) return { ok: false, until: startAt, peakAt };
    if (now >= startAt && now <= gapEnd + PEAK_LATE_MS) return { ok: true, aligned: true, peakAt };
  }
  return { ok: true };
}

/**
 * When the next ping can go out, at or after `fromMs`, inside the schedule.
 * @returns {{at: number, aligned?: true, peakAt?: number} | null}
 */
export function nextPeakSlot(fromMs, peak, schedule, { earlyMs = 5 * MINUTE, horizonMs = 8 * 24 * HOUR } = {}) {
  for (let t = Math.ceil(fromMs / MINUTE) * MINUTE; t <= fromMs + horizonMs; t += MINUTE) {
    if (!isScheduledAt(t, schedule)) continue;
    const g = peakGate({ now: t, peak, earlyMs });
    if (g.ok) return g.aligned ? { at: t, aligned: true, peakAt: g.peakAt } : { at: t };
    t = Math.max(t, g.until - MINUTE);
  }
  return null;
}

/** The five places the gap can go for a peak, as minutes after midnight: [{ m, start, end }]. */
export function gapOptions(peakMin) {
  const out = [];
  for (let m = 0; m <= SLOTS_PER_PEAK; m++) {
    const start = (peakMin + m * 300) % DAY_MIN;
    out.push({ m, start, end: (start + GAP_MS / MINUTE) % DAY_MIN });
  }
  return out;
}

/** The gap option that really holds `gapMin`, or null when it falls between two options. */
export function gapExactIndex(peakMin, gapMin) {
  const len = GAP_MS / MINUTE;
  const hit = gapOptions(peakMin).find((o) => (gapMin - o.start + DAY_MIN) % DAY_MIN < len);
  return hit ? hit.m : null;
}

/** Which gap option holds `gapMin` (a time you want left empty); the nearest one if none does. */
export function gapIndex(peakMin, gapMin) {
  const len = GAP_MS / MINUTE;
  let best = 0;
  let bestDist = Infinity;
  for (const o of gapOptions(peakMin)) {
    const into = (gapMin - o.start + DAY_MIN) % DAY_MIN; // minutes after the gap starts
    const dist = into < len ? 0 : Math.min(into - len + 1, DAY_MIN - into);
    if (dist < bestDist) {
      best = o.m;
      bestDist = dist;
    }
  }
  return best;
}

