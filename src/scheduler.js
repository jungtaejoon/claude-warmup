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
  if (state.peakWaitUntil && state.peakWaitUntil > now) return { action: 'skip', reason: 'peak_wait', until: state.peakWaitUntil };
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
// With a peak time set (say 14:00), pings go out only at peak − 5h·k (09:00, 04:00, 23:00 the day
// before, ...), so a chain of windows ends exactly at the peak and a fresh window is ready when
// you need it most. If your own messages started a window at another time, that window can't be
// moved: we just wait for the next aligned slot after it ends.
// 24 hours don't divide into 5-hour windows: between two daily peaks there is room for four
// windows and a 4-hour gap with none. You choose where that gap goes (`config gap`); it can sit
// after any window boundary, i.e. start at peak + 5h·m for m = 0..4.
// A peak can be limited to some days (e.g. weekdays). Far from any peak (a weekend), windows
// just chain as usual; aligning starts once the next peak is within PEAK_LEAD_MS.

/** A ping this much after its slot still counts as on time (the computer may wake late). */
export const PEAK_LATE_MS = 20 * MINUTE;
/** Slots per peak: 5h·k must stay under a day, so k = 1..4. */
const SLOTS_PER_PEAK = 4;
/** Start aligning this long before a peak: the earliest slot (peak − 20h) plus one window, so a usual ping can't run over it. */
export const PEAK_LEAD_MS = (SLOTS_PER_PEAK + 1) * WINDOW_MS;
const ALL_DAYS = new Set([0, 1, 2, 3, 4, 5, 6]);
const DAY_MS = 24 * HOUR;
const DAY_MIN = 1440;
/** Length of the daily gap: what is left of 24h after four 5-hour windows. */
export const GAP_MS = DAY_MS - SLOTS_PER_PEAK * WINDOW_MS;

/** The five places the gap can go for a peak, as minutes after midnight: [{ m, start, end }]. */
export function gapOptions(peakMin) {
  const out = [];
  for (let m = 0; m <= SLOTS_PER_PEAK; m++) {
    const start = (peakMin + m * 300) % DAY_MIN;
    out.push({ m, start, end: (start + GAP_MS / MINUTE) % DAY_MIN });
  }
  return out;
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

/**
 * Aligned ping slots around `ms`, sorted, each with the peak it leads to. For each peak the
 * day before it holds four window starts and the gap: m windows from the previous day's peak
 * time, the gap, then 4 − m windows that end exactly at the peak.
 */
export function peakSlots(ms, peak) {
  const m = peak.gap ?? 0;
  const out = [];
  for (const peakAt of peakTimes(ms, peak)) {
    for (let j = 0; j < m; j++) out.push({ at: peakAt - DAY_MS + j * WINDOW_MS, peakAt });
    for (let k = 1; k <= SLOTS_PER_PEAK - m; k++) out.push({ at: peakAt - k * WINDOW_MS, peakAt });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The first peak after `ms`, or null. */
export function nextPeakAfter(ms, peak) {
  return peakTimes(ms, peak).find((p) => p > ms) ?? null;
}

/**
 * Is `now` a good moment to start a window?
 * - near a slot: yes, it lines up with the peak (`earlyMs` lets a check that runs a little
 *   early go ahead; the window then ends slightly before the peak, which is still fine)
 * - next peak far away (e.g. a weekend): yes, chain windows as usual
 * - otherwise: wait for the next slot
 * @returns {{ok: true, slot?: number, peakAt?: number, free?: true} | {ok: false, until: number, peakAt: number}}
 */
export function peakGate({ now, peak, earlyMs = 5 * MINUTE }) {
  const slots = peakSlots(now, peak);
  const hit = slots.find((s) => now >= s.at - earlyMs && now <= s.at + PEAK_LATE_MS);
  if (hit) return { ok: true, slot: hit.at, peakAt: hit.peakAt };
  const nextPeak = nextPeakAfter(now, peak);
  if (nextPeak === null || nextPeak - now > PEAK_LEAD_MS) return { ok: true, free: true };
  const next = slots.find((s) => s.at - earlyMs > now);
  return { ok: false, until: next.at - earlyMs, peakAt: next.peakAt };
}

/**
 * When the next ping can go out, at or after `fromMs`, inside the schedule.
 * @returns {{at: number, peakAt: number} | {at: number, free: true} | null}
 */
export function nextPeakSlot(fromMs, peak, schedule, { earlyMs = 5 * MINUTE, horizonMs = 8 * 24 * HOUR } = {}) {
  for (let t = Math.ceil(fromMs / MINUTE) * MINUTE; t <= fromMs + horizonMs; t += MINUTE) {
    if (!isScheduledAt(t, schedule)) continue;
    const g = peakGate({ now: t, peak, earlyMs });
    if (g.ok) return g.free ? { at: t, free: true } : { at: t, peakAt: g.peakAt };
    t = Math.max(t, g.until - MINUTE);
  }
  return null;
}
