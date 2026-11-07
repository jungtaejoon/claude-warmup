export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** "06:30" | "0630" | "6:30" -> minutes since midnight (0..1440), or null. */
export function parseHM(input) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(input).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export function formatHM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * "always" | "06:00-23:00" | "22:00-06:00" (overnight) -> { always } or { start, end }.
 * Returns null when the input is not understood.
 */
export function parseHours(input) {
  const v = String(input ?? '').trim().toLowerCase();
  if (['', 'always', 'all', 'anytime', '24h'].includes(v)) return { always: true };
  const m = /^(\d{1,2}:?\d{2})\s*(?:-|~|to)\s*(\d{1,2}:?\d{2})$/.exec(v);
  if (!m) return null;
  const start = parseHM(m[1]);
  const end = parseHM(m[2]);
  if (start === null || end === null) return null;
  if (start % 1440 === end % 1440) return { always: true };
  return { always: false, start: start % 1440, end };
}

export function formatHours(hours) {
  return !hours || hours.always ? 'always' : `${formatHM(hours.start)}-${formatHM(hours.end)}`;
}

export function inHours(date, hours) {
  if (!hours || hours.always) return true;
  const m = date.getHours() * 60 + date.getMinutes();
  if (hours.start < hours.end) return m >= hours.start && m < hours.end;
  return m >= hours.start || m < hours.end;
}

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function dayIndex(token) {
  const s = token.trim().toLowerCase().replace(/요일$/, '');
  const ko = DAY_KO.indexOf(s);
  if (ko >= 0) return ko;
  if (s.length < 3) return -1;
  return DAY_FULL.findIndex((d) => d.startsWith(s));
}

/** "everyday" | "weekdays" | "weekends" | "mon,wed,fri" | "mon-fri" | "월-금" -> Set of 0..6 (0 = Sunday). */
export function parseDays(input) {
  const v = String(input ?? '').trim().toLowerCase();
  if (['', 'everyday', 'daily', 'all', 'always', '매일'].includes(v)) return new Set([0, 1, 2, 3, 4, 5, 6]);
  if (['weekdays', 'weekday', '평일'].includes(v)) return new Set([1, 2, 3, 4, 5]);
  if (['weekends', 'weekend', '주말'].includes(v)) return new Set([0, 6]);
  const out = new Set();
  for (const part of v.split(/[\s,]+/).filter(Boolean)) {
    const range = part.split(/-|~/);
    if (range.length === 2) {
      const a = dayIndex(range[0]);
      const b = dayIndex(range[1]);
      if (a < 0 || b < 0) return null;
      for (let i = a; ; i = (i + 1) % 7) {
        out.add(i);
        if (i === b) break;
      }
    } else if (range.length === 1) {
      const i = dayIndex(part);
      if (i < 0) return null;
      out.add(i);
    } else {
      return null;
    }
  }
  return out.size ? out : null;
}

/** Canonical text for a day set: everyday | weekdays | weekends | mon,tue,... */
export function formatDays(set) {
  const sorted = [...set].sort((a, b) => a - b).join(',');
  if (set.size === 7) return 'everyday';
  if (sorted === '1,2,3,4,5') return 'weekdays';
  if (sorted === '0,6') return 'weekends';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => set.has(d)).map((d) => DAY_KEYS[d]).join(',');
}

export function isScheduledAt(ms, schedule) {
  const d = new Date(ms);
  return schedule.days.has(d.getDay()) && inHours(d, schedule.hours);
}

/** First moment at or after `fromMs` that falls inside the schedule (minute resolution), or null. */
export function nextScheduledStart(fromMs, schedule, horizonMs = 8 * DAY) {
  if (isScheduledAt(fromMs, schedule)) return fromMs;
  const end = fromMs + horizonMs;
  for (let t = Math.ceil(fromMs / MINUTE) * MINUTE; t <= end; t += MINUTE) {
    if (isScheduledAt(t, schedule)) return t;
  }
  return null;
}
