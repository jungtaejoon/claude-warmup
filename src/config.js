import os from 'node:os';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './state.js';
import { gapIndex } from './scheduler.js';
import { parseHours, formatHours, parseDays, formatDays, parseHM, formatHM } from './time.js';

export const DEFAULTS = Object.freeze({
  hours: 'always', // when pings may be sent: "always" or "HH:MM-HH:MM" (overnight ranges OK)
  days: 'everyday', // everyday | weekdays | weekends | mon,tue,... | mon-fri
  model: 'haiku', // cheapest model; '' = Claude Code's default
  message: 'hi',
  interval: 5, // minutes between background checks
  claudePath: '', // '' = auto-detect
  lang: '', // '' = auto, 'en', 'ko'
  peak: '', // '' = off; "HH:MM" or "HH:MM weekdays" = line windows up so one resets right at this time
  gap: '', // with a peak: a time of day to leave without a window ("03:00"); required for the peak to apply
});

export const CONFIG_KEYS = Object.keys(DEFAULTS);

const expandHome = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);

/** @returns {{ok: true, value: any} | {ok: false}} */
export function validateConfigValue(key, input) {
  const raw = String(input ?? '').trim();
  switch (key) {
    case 'hours': {
      const h = parseHours(raw);
      return h ? { ok: true, value: formatHours(h) } : { ok: false };
    }
    case 'days': {
      const d = parseDays(raw);
      return d ? { ok: true, value: formatDays(d) } : { ok: false };
    }
    case 'model':
      if (raw === '' || raw === 'default') return { ok: true, value: '' };
      return /^[A-Za-z0-9._[\]-]+$/.test(raw) ? { ok: true, value: raw } : { ok: false };
    case 'message':
      // passed as one argv entry; keep it shell-safe for Windows .cmd shims too
      if (!raw || raw.length > 200 || raw.startsWith('-') || /["%^&|<>`$\\\r\n]/.test(raw)) return { ok: false };
      return { ok: true, value: raw };
    case 'interval': {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= 60 ? { ok: true, value: n } : { ok: false };
    }
    case 'claudePath':
      if (raw === '' || raw === 'auto') return { ok: true, value: '' };
      return { ok: true, value: path.resolve(expandHome(raw)) };
    case 'lang': {
      const v = raw.toLowerCase();
      if (v === '' || v === 'auto') return { ok: true, value: '' };
      return v === 'en' || v === 'ko' ? { ok: true, value: v } : { ok: false };
    }
    case 'gap': {
      const v = raw.toLowerCase();
      if (['', 'off', 'none', 'no', '끄기'].includes(v)) return { ok: true, value: '' };
      const m = parseHM(raw);
      return m === null ? { ok: false } : { ok: true, value: formatHM(m % 1440) };
    }
    case 'peak': {
      const v = raw.toLowerCase();
      if (['', 'off', 'none', 'no', '끄기'].includes(v)) return { ok: true, value: '' };
      const p = parsePeak(raw);
      return p ? { ok: true, value: formatPeak(p) } : { ok: false };
    }
    default:
      return { ok: false };
  }
}

export function loadConfig(paths) {
  const raw = readJson(paths.configFile, {});
  const cfg = { ...DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const key of CONFIG_KEYS) {
      if (raw[key] === undefined) continue;
      const v = validateConfigValue(key, raw[key]);
      if (v.ok) cfg[key] = v.value;
    }
  }
  return cfg;
}

export function saveConfig(paths, cfg) {
  const out = {};
  for (const key of CONFIG_KEYS) out[key] = cfg[key] ?? DEFAULTS[key];
  writeJsonAtomic(paths.configFile, out);
}

/** "11:30" | "11:30 weekdays" | "weekdays 11:30" | "14:00 mon,wed" -> { min, days }, or null. */
export function parsePeak(input) {
  const tokens = String(input ?? '').trim().split(/\s+/).filter(Boolean);
  const timeIdx = tokens.findIndex((tk) => parseHM(tk) !== null);
  if (timeIdx < 0) return null;
  const min = parseHM(tokens[timeIdx]) % 1440;
  const rest = tokens.filter((_, i) => i !== timeIdx).join(' ');
  const days = rest ? parseDays(rest) : new Set([0, 1, 2, 3, 4, 5, 6]);
  return days ? { min, days } : null;
}

export function formatPeak(p) {
  const hm = formatHM(p.min);
  return p.days.size === 7 ? hm : `${hm} ${formatDays(p.days)}`;
}

/**
 * Peak time as { min, days, gap }, or null when off. `gap` is the chosen gap option (0..4),
 * or null while no gap time is set: then the peak is not applied yet.
 */
export function getPeak(cfg) {
  const p = cfg.peak ? parsePeak(cfg.peak) : null;
  if (!p) return null;
  const gapMin = cfg.gap ? parseHM(cfg.gap) : null;
  return { ...p, gap: gapMin === null ? null : gapIndex(p.min, gapMin % 1440) };
}

export function getSchedule(cfg) {
  return {
    hours: parseHours(cfg.hours) || { always: true },
    days: parseDays(cfg.days) || new Set([0, 1, 2, 3, 4, 5, 6]),
  };
}
