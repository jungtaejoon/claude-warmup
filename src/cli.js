import fs from 'node:fs';
import { getPaths } from './paths.js';
import { loadConfig, saveConfig, validateConfigValue, CONFIG_KEYS, DEFAULTS, getSchedule, getPeak } from './config.js';
import { detectLang, setLang, t, has } from './i18n.js';
import { loadState, saveState, acquireLock, releaseLock, waitForLock } from './state.js';
import { appendLog, readLog } from './log.js';
import { findClaude, fetchUsage, authStatus, isDesktopBundled } from './claude.js';
import { getClaudeInfo, ensureWorkDir, doPing, runTick, applyUsageToState, hydrateUsage } from './engine.js';
import { getBackend, buildPathEnv, stableNodePath } from './service/index.js';
import { installAppCopy } from './selfcopy.js';
import { nextScheduledStart, isScheduledAt, MINUTE, HOUR, parseHours, formatHM, formatDays } from './time.js';
import { RESET_MARGIN_MS, WINDOW_MS, nextPeakSlot, gapOptions } from './scheduler.js';
import * as fmt from './format.js';
import { VERSION } from './version.js';

const VALUE_OPTS = new Set(['lang', 'n']);

export function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      if (eq > 0) opts[key] = a.slice(eq + 1);
      else if (VALUE_OPTS.has(key) && i + 1 < argv.length) opts[key] = argv[++i];
      else opts[key] = true;
    } else if (a === '-h') opts.help = true;
    else if (a === '-v' || a === '-V') opts.version = true;
    else if (a === '-n' && i + 1 < argv.length) opts.n = argv[++i];
    else rest.push(a);
  }
  return { cmd: rest[0], args: rest.slice(1), opts };
}

const COMMANDS = {
  status: cmdStatus,
  ping: cmdPing,
  install: cmdInstall,
  enable: cmdInstall,
  start: cmdInstall,
  uninstall: cmdUninstall,
  disable: cmdUninstall,
  stop: cmdUninstall,
  config: cmdConfig,
  logs: cmdLogs,
  log: cmdLogs,
  doctor: cmdDoctor,
  tick: cmdTick,
};

export async function main(argv, { env = process.env } = {}) {
  const { cmd, args, opts } = parseArgs(argv);
  const paths = getPaths(env);
  const config = loadConfig(paths);
  setLang(detectLang(env, typeof opts.lang === 'string' ? opts.lang : config.lang));
  if (opts.version || cmd === 'version') {
    console.log(VERSION);
    return 0;
  }
  if (cmd === 'help' || opts.help) {
    console.log(t('help'));
    return 0;
  }
  const handler = COMMANDS[cmd || 'status'];
  if (!handler) {
    console.error(fmt.fail(t('unknownCommand', { cmd })));
    console.log(t('help'));
    return 2;
  }
  return handler({ paths, config, args, opts });
}

// ---------- shared helpers ----------

export function reasonText(reason) {
  const key = `reason_${reason}`;
  return has(key) ? t(key) : String(reason || t('reason_unknown'));
}

function hintFor(kind) {
  switch (kind) {
    case 'not_logged_in': return t('hintLogin');
    case 'claude_not_found': return t('claudeMissingHint');
    case 'rate_limited': return t('hintRateLimited');
    case 'network': return t('hintNetwork');
    case 'model_unavailable': return t('hintModel');
    default: return '';
  }
}

export function rowLabel(r) {
  if (r.kind === 'session') return t('rowSession');
  if (r.kind === 'weekly_all') return t('rowWeeklyAll');
  if (r.kind === 'weekly_scoped' || r.scopeName) return t('rowWeeklyScoped', { name: r.scopeName || r.label || '?' });
  if (r.group === 'weekly') return t('rowWeeklyScoped', { name: r.label || r.kind || '?' });
  return r.label || r.kind || '?';
}

function describeDays(days) {
  if (days === 'everyday') return t('daysEveryday');
  if (days === 'weekdays') return t('daysWeekdays');
  if (days === 'weekends') return t('daysWeekends');
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return String(days).split(',').map((k) => t(`dow${keys.indexOf(k)}`)).join(', ');
}

export function describeSchedule(config) {
  const hours = parseHours(config.hours);
  const h = !hours || hours.always ? t('hoursAlways') : `${formatHM(hours.start)}–${formatHM(hours.end)}`;
  return `${h} · ${describeDays(config.days)}`;
}

/** "11:30" or "weekdays 11:30", in the output language. */
export function describePeak(config) {
  const p = getPeak(config);
  if (!p) return t('peakOff');
  const hm = formatHM(p.min);
  return p.days.size === 7 ? hm : `${describeDays(formatDays(p.days))} ${hm}`;
}

/** Times of day (inside the schedule's hours) when peak mode may start a window: peak − 5h·k. */
export function peakSlotTimes(config) {
  const peak = getPeak(config);
  if (!peak) return [];
  const hours = parseHours(config.hours) || { always: true };
  const out = [];
  const gap = peak.gap ?? 0;
  // window starts: from the peak forward until the gap, then back from the next peak
  const offsets = [];
  for (let j = 0; j < gap; j++) offsets.push(j * 300);
  for (let k = 1; k <= 4 - gap; k++) offsets.push(-k * 300);
  for (const off of offsets) {
    const m = (((peak.min + off) % 1440) + 1440) % 1440;
    const d = new Date(2026, 0, 5, Math.floor(m / 60), m % 60);
    if (isScheduledAt(d.getTime(), { hours, days: new Set([0, 1, 2, 3, 4, 5, 6]) })) out.push(m);
  }
  return out.sort((a, b) => a - b).map(formatHM);
}

/** "02:30–06:30" for each place the gap can go, or for the chosen one. */
export function gapRanges(config, onlyChosen = false) {
  const peak = getPeak(config);
  if (!peak) return [];
  return gapOptions(peak.min)
    .filter((o) => !onlyChosen || o.m === peak.gap)
    .map((o) => `${formatHM(o.start)}–${formatHM(o.end)}`);
}

function peakRows(config) {
  const peak = getPeak(config);
  if (!peak) return [];
  if (peak.gap === null) return [[t('lblPeak'), t('peakNeedsGap', { peak: describePeak(config) })]];
  return [
    [t('lblPeak'), t('peakRow', { peak: describePeak(config), slots: peakSlotTimes(config).join(', ') })],
    [t('lblGap'), gapRanges(config, true)[0]],
  ];
}

function describeTick(r, now = Date.now()) {
  if (r.action === 'ping') {
    return r.result.ok
      ? t('tickPinged', { when: r.result.windowEndsAt ? fmt.fmtWhen(r.result.windowEndsAt, now) : '?' })
      : t('tickPingFailed', { reason: reasonText(r.result.errorKind) });
  }
  if (r.action === 'error') return t('tickError', { reason: reasonText(r.reason) });
  switch (r.reason) {
    case 'window_active': return t('tickWindowActive', { when: fmt.fmtWhen(r.until, now) });
    case 'outside_schedule': return t('tickOutside');
    case 'backoff': return t('tickBackoff', { when: fmt.fmtWhen(r.until, now) });
    case 'limit_reached': return t('tickBlocked', { when: fmt.fmtWhen(r.until, now) });
    case 'recheck_later':
    case 'no_session_limit': return t('tickNoSessionLimit');
    case 'locked': return t('tickLocked');
    case 'peak_wait': return t('tickPeakWait', { when: fmt.fmtWhen(r.until, now), peak: fmt.fmtWhen(r.peakAt, now) });
    default: return String(r.reason);
  }
}

async function serviceStatus() {
  const backend = getBackend();
  try {
    return await backend.status();
  } catch {
    return { backend: backend.name, installed: false, active: false };
  }
}

// ---------- status ----------

function sessionInfo(usage, now) {
  const s = usage?.ok ? usage.session : null;
  if (!s) return null;
  const active = Boolean(s.resetsAt && s.resetsAt > now);
  return { percent: s.percent, resetsAt: s.resetsAt, active, startedAt: active ? s.resetsAt - WINDOW_MS : null };
}

export function computeNext({ now, config, state, svc, session }) {
  if (!svc.active) return { kind: 'off' };
  if (state.backoffUntil && state.backoffUntil > now) return { kind: 'retry', at: state.backoffUntil };
  if (state.blockedUntil && state.blockedUntil > now) return { kind: 'blocked', at: state.blockedUntil };
  let windowEnd;
  if (session) windowEnd = session.active ? session.resetsAt : null;
  else windowEnd = state.windowEndsAt && state.windowEndsAt > now ? state.windowEndsAt : null;
  const base = windowEnd ? windowEnd + RESET_MARGIN_MS : now;
  const peak = getPeak(config);
  if (peak && peak.gap !== null) {
    const slot = nextPeakSlot(base, peak, getSchedule(config), { earlyMs: config.interval * MINUTE });
    if (!slot) return { kind: 'never' };
    if (slot.at <= now + MINUTE) return { kind: 'soon', within: config.interval };
    if (slot.free) return windowEnd && slot.at <= base + MINUTE
      ? { kind: 'afterWindow', at: windowEnd, within: config.interval }
      : { kind: 'scheduleStart', at: slot.at };
    return { kind: 'peakSlot', at: slot.at, peakAt: slot.peakAt };
  }
  const at = nextScheduledStart(base, getSchedule(config));
  if (at === null) return { kind: 'never' };
  if (!windowEnd && at <= now + MINUTE) return { kind: 'soon', within: config.interval };
  if (windowEnd && at <= base + MINUTE) return { kind: 'afterWindow', at: windowEnd, within: config.interval };
  return { kind: 'scheduleStart', at };
}

function describeNext(next, now) {
  switch (next.kind) {
    case 'off': return fmt.color.dim('—');
    case 'retry': return t('nextRetry', { when: fmt.fmtWhen(next.at, now) });
    case 'blocked': return t('nextBlocked', { when: fmt.fmtWhen(next.at, now) });
    case 'never': return t('nextNever');
    case 'soon': return t('nextSoon', { n: next.within });
    case 'afterWindow': return t('nextAfterWindow', { when: fmt.fmtWhen(next.at, now) });
    case 'peakSlot': return t('nextPeakSlot', { when: fmt.fmtWhen(next.at, now), peak: fmt.fmtWhen(next.peakAt, now) });
    default: return t('nextScheduleStart', { when: fmt.fmtWhen(next.at, now) });
  }
}

function describeLastPing(lp, now) {
  if (!lp) return fmt.color.dim(t('never'));
  const when = fmt.fmtWhen(lp.at, now);
  if (lp.ok) {
    const win = lp.windowEndsAt ? fmt.color.dim(` · ${t('windowUntil', { when: fmt.fmtWhen(lp.windowEndsAt, now) })}`) : '';
    return `${when} ${fmt.color.green('✓')} ${fmt.shortModel(lp.model)}${win}`;
  }
  return `${when} ${fmt.color.red('✗')} ${reasonText(lp.error)}`;
}

function renderStatus(m) {
  const { bold, dim, green, red, gray } = fmt.color;
  const out = [`${bold('Claude Warmup')} ${dim(`v${m.version}`)}`, ''];

  if (m.usage) {
    const when = m.usage.cached
      ? t('usageCached', { when: fmt.fmtWhen(m.usage.fetchedAt, m.now) })
      : t('usageLive', { time: fmt.fmtClock(m.usage.fetchedAt) });
    out.push(`${bold(t('usageHeader'))}  ${dim(when)}`);
    const labels = m.usage.rows.map(rowLabel);
    const w = Math.max(0, ...labels.map(fmt.strWidth)) + 2;
    m.usage.rows.forEach((r, i) => {
      const pct = r.percent ?? 0;
      let tail = '';
      if (r.kind === 'session' && !(r.resetsAt && r.resetsAt > m.now)) tail = dim(t('sessionIdle'));
      else if (r.resetsAt) {
        tail = t('resetsAt', { when: fmt.fmtWhen(r.resetsAt, m.now) });
        if (r.kind === 'session') tail += dim(` (${fmt.fmtIn(r.resetsAt, m.now)})`);
      }
      const paint = fmt.severityColor(r.severity, pct);
      out.push(`  ${fmt.pad(labels[i], w)}${paint(fmt.bar(pct))} ${fmt.padStart(`${Math.round(pct)}%`, 4)}  ${tail}`);
    });
  } else {
    out.push(bold(t('usageHeader')));
    out.push(`  ${fmt.fail(t('usageUnavailable', { reason: reasonText(m.usageError || 'unknown') }))}`);
    const hint = hintFor(m.usageError);
    if (hint) out.push(`  ${dim(hint)}`);
  }
  out.push('');

  out.push(bold(t('autoHeader')));
  const svc = m.service;
  let statusText;
  if (svc.active) statusText = `${green('●')} ${t('svcOn', { backend: svc.backend, n: m.config.interval })}`;
  else if (svc.installed) statusText = `${red('●')} ${t('svcBroken')}`;
  else statusText = `${gray('○')} ${t('svcOff')}`;
  const rows = [
    [t('lblStatus'), statusText],
    [t('lblSchedule'), describeSchedule(m.config)],
    ...peakRows(m.config),
    [t('lblLastPing'), describeLastPing(m.lastPing, m.now)],
    [t('lblNextPing'), describeNext(m.next, m.now)],
  ];
  const lw = Math.max(...rows.map(([l]) => fmt.strWidth(l))) + 3;
  for (const [l, v] of rows) out.push(`  ${fmt.pad(l, lw)}${v}`);
  return out.join('\n');
}

function renderShort(m) {
  if (!m.usage) return t('shortUnavailable');
  const parts = [];
  const s = m.session;
  if (s && s.active) parts.push(t('shortSession', { pct: Math.round(s.percent ?? 0), left: fmt.fmtDuration(s.resetsAt - m.now) }));
  else parts.push(t('shortIdle'));
  const weekly = m.usage.rows.find((r) => r.kind === 'weekly_all');
  if (weekly) parts.push(t('shortWeekly', { pct: Math.round(weekly.percent ?? 0) }));
  return parts.join(' · ');
}

async function cmdStatus({ paths, config, opts }) {
  const now = Date.now();
  let state = loadState(paths);
  const svc = await serviceStatus();
  let usage = null;
  let usageError = null;

  if (opts.cached) {
    usage = hydrateUsage(state.lastUsage);
    if (!usage) usageError = 'usage_unavailable';
  } else {
    const bin = findClaude(config.claudePath);
    if (!bin) usageError = 'claude_not_found';
    else {
      const spin = opts.json || opts.short ? { stop() {} } : fmt.spinner(t('checkingUsage'));
      const cwd = ensureWorkDir(paths);
      const info = await getClaudeInfo(bin, state, { cwd });
      const u = info.usageCallsModel
        ? { ok: false, reason: 'usage_unsupported', calledModel: false }
        : await fetchUsage({ bin, flags: info.flags, cwd });
      spin.stop();
      if (u.calledModel) info.usageCallsModel = true;
      if (u.ok) usage = u;
      else usageError = u.reason;
      // Save what we learned, unless a background check holds the lock right now.
      if (acquireLock(paths.lockFile)) {
        try {
          const fresh = loadState(paths);
          fresh.claudeInfo = state.claudeInfo;
          applyUsageToState(fresh, u, Date.now());
          saveState(paths, fresh);
          state = fresh;
        } finally {
          releaseLock(paths.lockFile);
        }
      }
    }
  }

  const session = sessionInfo(usage, now);
  const model = {
    version: VERSION,
    now,
    config,
    usage: usage ? { source: usage.source, fetchedAt: usage.fetchedAt, cached: Boolean(usage.cached), rows: usage.rows } : null,
    usageError,
    session,
    service: { ...svc, intervalMin: config.interval },
    lastPing: state.lastPing || null,
    windowEndsAt: state.windowEndsAt || null,
    next: computeNext({ now, config, state, svc, session }),
  };
  if (opts.json) console.log(JSON.stringify(model, null, 2));
  else if (opts.short) console.log(renderShort(model));
  else console.log(renderStatus(model));
  return 0;
}

// ---------- ping ----------

async function cmdPing({ paths, config, opts }) {
  const bin = findClaude(config.claudePath);
  if (!bin) {
    console.error(fmt.fail(t('claudeMissing')));
    console.error(`  ${t('claudeMissingHint')}`);
    return 1;
  }
  if (!(await waitForLock(paths.lockFile, 120_000))) {
    console.error(fmt.fail(t('lockBusy')));
    return 1;
  }
  let res;
  try {
    const state = loadState(paths);
    const spin = opts.json ? { stop() {} } : fmt.spinner(t('pingSending', { model: config.model || t('modelDefault') }));
    const info = await getClaudeInfo(bin, state, { cwd: ensureWorkDir(paths) });
    res = await doPing({ paths, config, state, info, reason: 'manual' });
    spin.stop();
    saveState(paths, state);
  } finally {
    releaseLock(paths.lockFile);
  }

  if (opts.json) {
    console.log(JSON.stringify(res, null, 2));
    return res.ok ? 0 : 1;
  }
  const now = Date.now();
  if (res.ok) {
    console.log(fmt.ok(t('pingOk', { model: fmt.shortModel(res.model) || t('modelDefault'), dur: fmt.fmtSeconds(res.durationMs) })));
    if (res.modelFallbackFrom) console.log(fmt.warn(t('pingModelFallback', { model: res.modelFallbackFrom })));
    if (res.windowEndsAt) {
      const key = res.windowSource === 'estimate' ? 'pingWindowEstimate' : 'pingWindow';
      console.log(`  ${t(key, {
        start: fmt.fmtClock(res.windowEndsAt - WINDOW_MS),
        end: fmt.fmtWhen(res.windowEndsAt, now),
        left: fmt.fmtDuration(res.windowEndsAt - now),
      })}`);
    }
    return 0;
  }
  console.log(fmt.fail(t('pingFail', { reason: reasonText(res.errorKind) })));
  if (res.errorText) console.log(fmt.color.dim(`  ${res.errorText.split('\n')[0].slice(0, 200)}`));
  const hint = hintFor(res.errorKind);
  if (hint) console.log(`  ${hint}`);
  return 1;
}

// ---------- install / uninstall ----------

async function cmdInstall({ paths, config, opts }) {
  const backend = getBackend();
  const bin = findClaude(config.claudePath);
  if (!bin) {
    console.error(fmt.fail(t('claudeMissing')));
    console.error(`  ${t('claudeMissingHint')}`);
    if (!opts.force) return 1;
  } else {
    const auth = await authStatus(bin, { cwd: ensureWorkDir(paths) });
    if (auth && auth.loggedIn === false) console.log(fmt.warn(t('installNotLoggedIn')));
    if (isDesktopBundled(bin)) console.log(fmt.warn(t('usingDesktopBundled')));
  }

  console.log(t('installing', { backend: backend.name }));
  let res;
  const nodePath = stableNodePath();
  let scriptPath;
  try {
    scriptPath = installAppCopy(paths);
    res = await backend.install({
      nodePath,
      scriptPath,
      intervalMin: config.interval,
      pathEnv: buildPathEnv({ nodePath, claudeBin: bin }),
      logDir: paths.serviceLogDir,
      dataDir: paths.dataDir,
      // a custom home must follow the service, or it would read another config
      extraEnv: process.env.CLAUDE_WARMUP_HOME ? { CLAUDE_WARMUP_HOME: paths.dataDir } : {},
    });
  } catch (err) {
    console.error(fmt.fail(t('installFailed', { error: err.message })));
    return 1;
  }
  const used = res.backend || backend.name;
  appendLog(paths, { ev: 'install', backend: used });
  if (acquireLock(paths.lockFile)) {
    try {
      const state = loadState(paths);
      state.service = { backend: used, nodePath, scriptPath, version: VERSION, installedAt: Date.now() };
      saveState(paths, state);
    } finally {
      releaseLock(paths.lockFile);
    }
  }
  console.log(fmt.ok(t('installed', { backend: used, n: config.interval })));
  console.log(`  ${t('installedSchedule', { schedule: describeSchedule(config) })}`);

  if (bin && !opts.noCheck) {
    const r = await runTick({ paths, config, waitLockMs: 120_000 });
    console.log(`  ${t('firstCheck', { result: describeTick(r) })}`);
  }
  if (process.platform === 'darwin') console.log(fmt.color.dim(`\n${t('tipMacSleep')}`));
  if (used === 'systemd' && !(await backend.lingerEnabled?.())) console.log(fmt.color.dim(`\n${t('tipLinger')}`));
  console.log(fmt.color.dim(t('tipStatus')));
  return 0;
}

async function cmdUninstall({ paths, opts }) {
  const backend = getBackend();
  try {
    await backend.uninstall({ paths });
  } catch (err) {
    console.error(fmt.fail(t('uninstallFailed', { error: err.message })));
    return 1;
  }
  fs.rmSync(paths.appDir, { recursive: true, force: true });
  if (opts.purge) {
    fs.rmSync(paths.dataDir, { recursive: true, force: true });
    if (paths.configDir !== paths.dataDir) fs.rmSync(paths.configDir, { recursive: true, force: true });
    console.log(fmt.ok(t('purged')));
    return 0;
  }
  appendLog(paths, { ev: 'uninstall', backend: backend.name });
  console.log(fmt.ok(t('uninstalled', { dir: paths.dataDir })));
  return 0;
}

// ---------- config ----------

async function cmdConfig({ paths, config, args, opts }) {
  if (opts.reset) {
    saveConfig(paths, { ...DEFAULTS });
    console.log(fmt.ok(t('configReset')));
    return 0;
  }
  let [key, ...vals] = args;
  if (key === 'set') [key, ...vals] = vals;
  else if (key === 'get') {
    key = vals[0];
    vals = [];
  }
  const show = (k, v) => {
    if (v !== '') return String(v);
    if (k === 'peak' || k === 'gap') return t('peakOff');
    return k === 'model' ? t('modelDefault') : t('configAuto');
  };

  if (!key) {
    console.log(fmt.color.bold(t('configHeader', { file: paths.configFile })));
    const w = Math.max(...CONFIG_KEYS.map((k) => k.length)) + 2;
    const vw = Math.max(...CONFIG_KEYS.map((k) => fmt.strWidth(show(k, config[k])))) + 2;
    for (const k of CONFIG_KEYS) {
      console.log(`  ${fmt.pad(k, w)}${fmt.pad(show(k, config[k]), vw)}${fmt.color.dim(t(`configDesc_${k}`))}`);
    }
    console.log(fmt.color.dim(`\n${t('configUsage')}`));
    return 0;
  }
  if (!CONFIG_KEYS.includes(key)) {
    console.error(fmt.fail(t('configUnknownKey', { key, keys: CONFIG_KEYS.join(', ') })));
    return 1;
  }
  if (vals.length === 0) {
    console.log(show(key, config[key]));
    return 0;
  }
  const v = validateConfigValue(key, vals.join(' '));
  if (!v.ok) {
    console.error(fmt.fail(t('configInvalid', { key, hint: t(`configDesc_${key}`) })));
    return 1;
  }
  config[key] = v.value;
  saveConfig(paths, config);
  console.log(fmt.ok(`${key} = ${show(key, v.value)}`));

  if (key === 'hours' || key === 'days') {
    console.log(`  ${t('configScheduleNow', { schedule: describeSchedule(config) })}`);
    const now = Date.now();
    const at = nextScheduledStart(now, getSchedule(config));
    if (at && at > now + MINUTE) console.log(`  ${t('configNextStart', { when: fmt.fmtWhen(at, now) })}`);
  }
  if (key === 'peak' || key === 'gap' || key === 'hours') {
    // A wait computed for the old setting must not hold back the new one.
    const state = loadState(paths);
    if (state.peakWaitUntil) {
      state.peakWaitUntil = null;
      saveState(paths, state);
    }
  }
  if (key === 'peak' || key === 'gap') {
    const peak = getPeak(config);
    if (!peak) {
      console.log(`  ${key === 'peak' ? t('configPeakOff') : t('configGapNoPeak')}`);
    } else if (peak.gap === null) {
      console.log(`  ${t('configGapNeeded', { peak: describePeak(config) })}`);
      console.log(`  ${t('configGapOptions', { options: gapRanges(config).join(' · ') })}`);
      console.log(fmt.color.dim(`  ${t('configGapHow')}`));
    } else {
      console.log(`  ${t('configPeakOn', { slots: peakSlotTimes(config).join(', ') || '—', peak: describePeak(config) })}`);
      console.log(`  ${t('configGapOn', { gap: gapRanges(config, true)[0] })}`);
      if (peak.days.size < 7) console.log(fmt.color.dim(`  ${t('configPeakDays')}`));
      console.log(fmt.color.dim(`  ${t('configPeakNote')}`));
    }
  }
  if (key === 'interval' || key === 'claudePath') {
    const svc = await serviceStatus();
    if (svc.installed) console.log(`  ${t('configReinstall')}`);
  }
  return 0;
}

// ---------- logs ----------

function formatLogEntry(e) {
  const at = Date.parse(e.t);
  const when = fmt.color.dim(Number.isFinite(at) ? fmt.fmtDateTime(at) : String(e.t));
  switch (e.ev) {
    case 'ping':
      if (e.ok) {
        const win = e.windowEndsAt ? ` · ${t('windowUntil', { when: fmt.fmtDateTime(e.windowEndsAt) })}` : '';
        return `${when}  ${fmt.color.green('✓')} ${t('logPingOk', { model: fmt.shortModel(e.model) || '-', reason: reasonText(e.reason) })}${win}`;
      }
      return `${when}  ${fmt.color.red('✗')} ${t('logPingFail', { reason: reasonText(e.error) })}${e.detail ? fmt.color.dim(` · ${String(e.detail).slice(0, 120)}`) : ''}`;
    case 'check':
      if (!e.usage) return `${when}  · ${t('logCheckNoUsage', { reason: reasonText(e.reason) })}`;
      if (e.decision === 'window_active' && e.session?.resetsAt) {
        return `${when}  · ${t('logCheckActive', { pct: Math.round(e.session.percent ?? 0), when: fmt.fmtDateTime(e.session.resetsAt) })}`;
      }
      return `${when}  · ${t('logCheckIdle')}`;
    case 'install': return `${when}  ${t('logInstall', { backend: e.backend })}`;
    case 'uninstall': return `${when}  ${t('logUninstall')}`;
    case 'error': return `${when}  ${fmt.color.red('✗')} ${reasonText(e.error)}`;
    default: return `${when}  ${e.ev}`;
  }
}

async function cmdLogs({ paths, opts }) {
  const n = Math.max(1, Math.min(1000, parseInt(opts.n || '20', 10) || 20));
  const entries = readLog(paths, n);
  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return 0;
  }
  if (!entries.length) console.log(t('logsEmpty'));
  else for (const e of entries) console.log(formatLogEntry(e));
  console.log(fmt.color.dim(`\n${t('logsFiles', { file: paths.logFile, dir: paths.serviceLogDir })}`));
  return 0;
}

// ---------- doctor ----------

async function cmdDoctor({ paths, config }) {
  const lines = [];
  let problems = 0;
  const good = (s) => lines.push(fmt.ok(s));
  const bad = (s) => { problems++; lines.push(fmt.fail(s)); };
  const note = (s) => lines.push(fmt.warn(s));

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 18) good(t('doctorNode', { v: process.version }));
  else bad(t('doctorNodeOld', { v: process.version }));

  const bin = findClaude(config.claudePath);
  if (!bin) {
    bad(config.claudePath ? t('doctorClaudePathMissing', { path: config.claudePath }) : t('doctorClaudeMissing'));
    lines.push(`  ${fmt.color.dim(t('claudeMissingHint'))}`);
  } else {
    const state = loadState(paths);
    const cwd = ensureWorkDir(paths);
    const info = await getClaudeInfo(bin, state, { cwd });
    good(t('doctorClaude', { version: info.version || '?', path: bin }));
    if (isDesktopBundled(bin)) note(t('usingDesktopBundled'));
    const missing = ['--no-session-persistence', '--system-prompt', '--tools'].filter((f) => !info.flags.includes(f));
    if (missing.length) note(t('doctorOldClaude', { flags: missing.join(', ') }));

    const auth = await authStatus(bin, { cwd });
    if (!auth) note(t('doctorAuthUnknown'));
    else if (auth.loggedIn) {
      const method = [auth.authMethod, auth.subscriptionType].filter(Boolean).join(' · ') || '?';
      good(t('doctorAuth', { method }));
      if (/api.?key/i.test(String(auth.authMethod || ''))) note(t('doctorApiKey'));
    } else {
      bad(t('doctorAuthNo'));
    }

    if (info.usageCallsModel) note(t('doctorUsageModel'));
    else {
      const u = await fetchUsage({ bin, flags: info.flags, cwd });
      if (u.calledModel) info.usageCallsModel = true;
      if (u.ok) good(t('doctorUsage', { pct: Math.round(u.session?.percent ?? 0) }));
      else if (u.reason !== 'not_logged_in') note(t('doctorUsageNo', { reason: reasonText(u.reason) }));
      if (acquireLock(paths.lockFile)) {
        try {
          const fresh = loadState(paths);
          fresh.claudeInfo = state.claudeInfo;
          applyUsageToState(fresh, u, Date.now());
          saveState(paths, fresh);
        } finally {
          releaseLock(paths.lockFile);
        }
      }
    }
  }

  const svc = await serviceStatus();
  if (svc.active) good(t('doctorService', { backend: svc.backend }));
  else if (svc.installed) bad(t('doctorServiceBroken'));
  else note(t('doctorServiceOff'));

  const state = loadState(paths);
  const now = Date.now();
  if (svc.installed) {
    const s = state.service;
    if (s && ((s.nodePath && !fs.existsSync(s.nodePath)) || (s.scriptPath && !fs.existsSync(s.scriptPath)))) {
      bad(t('doctorServiceStale', { path: !fs.existsSync(s.nodePath) ? s.nodePath : s.scriptPath }));
    }
    if (!state.lastTickAt) note(t('doctorNoTick'));
    else if (now - state.lastTickAt > Math.max(3 * config.interval * MINUTE, HOUR)) note(t('doctorLastTickStale', { when: fmt.fmtAgo(state.lastTickAt, now) }));
    else good(t('doctorLastTick', { when: fmt.fmtAgo(state.lastTickAt, now) }));
  }
  if (state.lastPing && !state.lastPing.ok) note(t('doctorLastPingFailed', { reason: reasonText(state.lastPing.error) }));

  console.log(fmt.color.bold(`${t('doctorTitle')} v${VERSION}`));
  console.log(lines.join('\n'));
  console.log(fmt.color.dim(`\n${t('doctorPaths', { config: paths.configFile, data: paths.dataDir })}`));
  console.log(problems ? fmt.color.red(t('doctorProblems', { n: problems })) : fmt.color.green(t('doctorAllGood')));
  return problems ? 1 : 0;
}

// ---------- tick ----------

async function cmdTick({ paths, config, opts }) {
  const r = await runTick({ paths, config });
  if (opts.json) console.log(JSON.stringify(r));
  else if (opts.verbose || process.stdout.isTTY) console.log(describeTick(r));
  return 0;
}
