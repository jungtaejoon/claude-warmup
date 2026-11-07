import os from 'node:os';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './state.js';
import { parseHours, formatHours, parseDays, formatDays } from './time.js';

export const DEFAULTS = Object.freeze({
  hours: 'always', // when pings may be sent: "always" or "HH:MM-HH:MM" (overnight ranges OK)
  days: 'everyday', // everyday | weekdays | weekends | mon,tue,... | mon-fri
  model: 'haiku', // cheapest model; '' = Claude Code's default
  message: 'hi',
  interval: 5, // minutes between background checks
  claudePath: '', // '' = auto-detect
  lang: '', // '' = auto, 'en', 'ko'
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

export function getSchedule(cfg) {
  return {
    hours: parseHours(cfg.hours) || { always: true },
    days: parseDays(cfg.days) || new Set([0, 1, 2, 3, 4, 5, 6]),
  };
}
