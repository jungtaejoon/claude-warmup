// Linux: a systemd user timer when available, otherwise a crontab line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../proc.js';

export const name = 'systemd';
export const UNIT = 'claude-warmup';
export const CRON_MARK = '# claude-warmup';

export function unitDir(env = process.env, home = os.homedir()) {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user');
}

/** Quote a word for a systemd unit file (and escape % specifiers). */
function sdQuote(s) {
  const v = String(s).replace(/%/g, '%%');
  return /[\s"'\\;]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
}

export function buildService({ nodePath, scriptPath, pathEnv, extraEnv = {} }) {
  const env = Object.entries({ PATH: pathEnv, ...extraEnv }).map(([k, v]) => `Environment=${sdQuote(`${k}=${v}`)}`).join('\n');
  return `[Unit]
Description=Claude Warmup check (starts your Claude 5-hour window early)

[Service]
Type=oneshot
ExecStart=${sdQuote(nodePath)} ${sdQuote(scriptPath)} tick
${env}
Nice=10
TimeoutStartSec=600
`;
}

export function buildTimer({ intervalMin }) {
  return `[Unit]
Description=Run the Claude Warmup check every ${intervalMin} min

[Timer]
OnStartupSec=1min
OnCalendar=*:0/${intervalMin}
Persistent=true
AccuracySec=30s
Unit=${UNIT}.service

[Install]
WantedBy=timers.target
`;
}

export function buildCronLine({ nodePath, scriptPath, intervalMin, pathEnv, extraEnv = {} }) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`).replace(/%/g, '\\%')}'`;
  const minute = intervalMin >= 60 ? '0' : `*/${intervalMin}`;
  const env = Object.entries({ PATH: pathEnv, ...extraEnv }).map(([k, v]) => `${k}=${q(v)}`).join(' ');
  return `${minute} * * * * ${env} ${q(nodePath)} ${q(scriptPath)} tick >/dev/null 2>&1 ${CRON_MARK}`;
}

export function stripCronLines(text) {
  return String(text || '').split('\n').filter((l) => !l.includes(CRON_MARK)).join('\n').replace(/\n+$/, '');
}

async function readCrontab() {
  const r = await runProcess('crontab', ['-l'], { timeoutMs: 15_000 });
  if (r.error) return { ok: false, text: '' };
  if (r.code !== 0) return { ok: /no crontab/i.test(r.stderr), text: '' };
  return { ok: true, text: r.stdout };
}

async function writeCrontab(text) {
  const r = await runProcess('crontab', ['-'], { input: text, timeoutMs: 15_000 });
  if (r.error || r.code !== 0) throw new Error(`crontab failed: ${(r.stderr || r.error?.message || '').trim()}`);
}

async function removeCron() {
  const cur = await readCrontab();
  if (cur.ok && cur.text.includes(CRON_MARK)) {
    const rest = stripCronLines(cur.text);
    await writeCrontab(rest ? `${rest}\n` : '');
  }
}

/** True when systemd keeps this user's timers running after logout (loginctl enable-linger). */
export async function lingerEnabled(user = os.userInfo().username) {
  const r = await runProcess('loginctl', ['show-user', user, '--property=Linger', '--value'], { timeoutMs: 15_000 });
  return !r.error && r.code === 0 && r.stdout.trim() === 'yes';
}

async function systemdAvailable() {
  const r = await runProcess('systemctl', ['--user', 'show-environment'], { timeoutMs: 15_000 });
  return r.code === 0;
}

const unitFiles = () => ({
  service: path.join(unitDir(), `${UNIT}.service`),
  timer: path.join(unitDir(), `${UNIT}.timer`),
});

export async function install(opts) {
  fs.mkdirSync(opts.logDir, { recursive: true });
  if (await systemdAvailable()) {
    const { service, timer } = unitFiles();
    fs.mkdirSync(path.dirname(service), { recursive: true });
    fs.writeFileSync(service, buildService(opts));
    fs.writeFileSync(timer, buildTimer(opts));
    await runProcess('systemctl', ['--user', 'daemon-reload'], { timeoutMs: 30_000 });
    const r = await runProcess('systemctl', ['--user', 'enable', '--now', `${UNIT}.timer`], { timeoutMs: 30_000 });
    if (r.code !== 0) throw new Error(`systemctl --user enable failed: ${(r.stderr || r.stdout).trim()}`);
    await removeCron().catch(() => {}); // never schedule twice
    return { backend: 'systemd', file: timer };
  }
  const cur = await readCrontab();
  if (!cur.ok) {
    throw new Error('Neither a systemd user session nor crontab is available. Run `claude-warmup tick` every few minutes with your own scheduler.');
  }
  const rest = stripCronLines(cur.text);
  await writeCrontab(`${rest ? `${rest}\n` : ''}${buildCronLine(opts)}\n`);
  return { backend: 'cron' };
}

export async function uninstall() {
  const { service, timer } = unitFiles();
  if (fs.existsSync(timer) || fs.existsSync(service)) {
    await runProcess('systemctl', ['--user', 'disable', '--now', `${UNIT}.timer`], { timeoutMs: 30_000 });
    fs.rmSync(timer, { force: true });
    fs.rmSync(service, { force: true });
    await runProcess('systemctl', ['--user', 'daemon-reload'], { timeoutMs: 30_000 });
  }
  await removeCron().catch(() => {});
  return { backend: name };
}

export async function status() {
  const { timer } = unitFiles();
  if (fs.existsSync(timer)) {
    const r = await runProcess('systemctl', ['--user', 'is-active', `${UNIT}.timer`], { timeoutMs: 15_000 });
    return { backend: 'systemd', installed: true, active: r.stdout.trim() === 'active', file: timer };
  }
  const cur = await readCrontab();
  if (cur.ok && cur.text.includes(CRON_MARK)) return { backend: 'cron', installed: true, active: true };
  return { backend: name, installed: false, active: false };
}
