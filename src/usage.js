// Normalises the usage data Claude Code hands out into one shape:
// { ok: true, source, rows: [{ kind, group, percent, resetsAt, severity, scopeName, label }], session }

/** Unix seconds, unix ms, numeric strings or ISO 8601 -> epoch ms (or null). */
export function toMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d+(\.\d+)?$/.test(s)) return toMs(Number(s));
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    kind: typeof row.kind === 'string' ? row.kind : null,
    group: typeof row.group === 'string' ? row.group : null,
    percent: num(row.percent ?? row.utilization),
    resetsAt: toMs(row.resets_at ?? row.resetsAt),
    severity: typeof row.severity === 'string' ? row.severity : null,
    scopeName: row.scope?.model?.display_name || row.scope?.surface?.display_name || null,
    label: typeof row.label === 'string' ? row.label : null,
  };
}

export function pickSession(rows) {
  return rows.find((r) => r.kind === 'session') || rows.find((r) => !r.kind && r.group === 'session') || null;
}

/**
 * The structured twin of `/usage` that Claude Code attaches to its reply in
 * print / stream-json mode (`usage_report`). Experimental upstream, so parse defensively.
 */
export function usageFromReport(report) {
  if (!report || typeof report !== 'object') return null;
  if (report.rate_limits === null) return { ok: false, reason: 'no_plan_data' };
  const limits = report.rate_limits?.limits;
  if (limits === null) return { ok: false, reason: 'usage_fetch_failed' };
  if (!Array.isArray(limits)) return null;
  const rows = limits.map(normalizeRow).filter(Boolean);
  return {
    ok: true,
    source: 'usage_report',
    rows,
    session: pickSession(rows),
    extraUsage: report.rate_limits.extra_usage ?? null,
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Best effort for the human text "3pm", "Nov 12, 10am", "15:00 (Asia/Seoul)". Local time. */
export function parseResetText(text, now = Date.now()) {
  const s = String(text).replace(/\(.*?\)/g, ' ').trim().toLowerCase();
  let h = null;
  let m = 0;
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(s);
  const clock = /\b(\d{1,2}):(\d{2})\b/.exec(s);
  if (ampm) {
    h = Number(ampm[1]) % 12 + (ampm[3] === 'pm' ? 12 : 0);
    m = Number(ampm[2] || 0);
  } else if (clock) {
    h = Number(clock[1]);
    m = Number(clock[2]);
  }
  if (h === null || h > 23 || m > 59) return null;
  const date = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/.exec(s);
  const base = new Date(now);
  if (date) {
    const d = new Date(base.getFullYear(), MONTHS.indexOf(date[1]), Number(date[2]), h, m, 0, 0);
    if (d.getTime() < now - 86_400_000) d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Fallback for CLIs that only print text, e.g. "Current session: 12% used · resets 3pm". */
export function usageFromText(text, now = Date.now()) {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    // eslint-disable-next-line no-control-regex
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const m = /^(.{2,60}?)\s*[:：]\s*(\d{1,3}(?:\.\d+)?)\s*%\s*used(?:\s*[·•|-]\s*resets?\s+(.+))?$/i.exec(line);
    if (!m) continue;
    const label = m[1].trim();
    const scope = /\(([^)]+)\)/.exec(label)?.[1] ?? null;
    let kind = null;
    if (/session/i.test(label)) kind = 'session';
    else if (/week/i.test(label)) kind = scope && !/all models?/i.test(scope) ? 'weekly_scoped' : 'weekly_all';
    rows.push({
      kind,
      group: kind === 'session' ? 'session' : kind ? 'weekly' : null,
      percent: Number(m[2]),
      resetsAt: m[3] ? parseResetText(m[3], now) : null,
      severity: null,
      scopeName: kind === 'weekly_scoped' ? scope : null,
      label,
    });
  }
  return rows.length ? { ok: true, source: 'text', rows, session: pickSession(rows) } : null;
}

/** Session (5h) reset time carried by `rate_limit_event` messages, if any. */
export function sessionResetFromRateLimits(infos) {
  for (const info of infos) {
    const w = info?.unifiedWindows?.five_hour;
    const ms = toMs(w?.resetsAt ?? w?.resets_at);
    if (ms) return ms;
  }
  for (const info of infos) {
    if (info?.rateLimitType === 'five_hour') {
      const ms = toMs(info.resetsAt);
      if (ms) return ms;
    }
  }
  return null;
}
