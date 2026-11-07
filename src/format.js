import { t } from './i18n.js';

let colorEnabled = null;
export function colorOn() {
  if (colorEnabled === null) {
    colorEnabled = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb';
  }
  return colorEnabled;
}
export function setColor(on) {
  colorEnabled = on;
}

const wrap = (code) => (s) => (colorOn() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const color = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  cyan: wrap('36'),
  gray: wrap('90'),
};
export const ok = (s) => `${color.green('✓')} ${s}`;
export const fail = (s) => `${color.red('✗')} ${s}`;
export const warn = (s) => `${color.yellow('!')} ${s}`;

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

function charWidth(cp) {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff)
    || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf)
    || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f)
    || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f)
    || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

/** Terminal column width (Korean/CJK count as 2). */
export function strWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0));
  return w;
}
export const pad = (s, width) => s + ' '.repeat(Math.max(0, width - strWidth(s)));
export const padStart = (s, width) => ' '.repeat(Math.max(0, width - strWidth(s))) + s;

export function bar(percent, width = 20) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((p / 100) * width);
  return '█'.repeat(filled) + color.gray('░'.repeat(width - filled));
}

export function severityColor(severity, percent) {
  const s = severity || (percent >= 90 ? 'critical' : percent >= 70 ? 'warning' : 'normal');
  if (s === 'critical') return color.red;
  if (s === 'warning') return color.yellow;
  return color.green;
}

export function spinner(text) {
  if (!process.stderr.isTTY) return { stop() {} };
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const draw = () => process.stderr.write(`\r${color.cyan(frames[i++ % frames.length])} ${text}`);
  draw();
  const timer = setInterval(draw, 80);
  return {
    stop() {
      clearInterval(timer);
      process.stderr.write('\r\x1b[K');
    },
  };
}

const p2 = (n) => String(n).padStart(2, '0');

export function fmtClock(ms) {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${fmtClock(ms)}`;
}

const startOfDay = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "15:00", "tomorrow 06:00", "Wed 10:00", "11/20 10:00" (relative to now). */
export function fmtWhen(ms, now = Date.now()) {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / 86_400_000);
  const clock = fmtClock(ms);
  if (days === 0) return clock;
  if (days === 1) return `${t('tomorrow')} ${clock}`;
  if (days === -1) return `${t('yesterday')} ${clock}`;
  if (days > 1 && days < 7) return `${t(`dow${new Date(ms).getDay()}`)} ${clock}`;
  return fmtDateTime(ms);
}

export function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (totalMin < 1) return t('durLessMin');
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts = [];
  if (d) parts.push(t('durD', { n: d }));
  if (h) parts.push(t('durH', { n: h }));
  if (m && !d) parts.push(t('durM', { n: m }));
  return parts.join(' ');
}

export const fmtSeconds = (ms) => t('durS', { n: (Math.max(0, ms) / 1000).toFixed(1) });
export const fmtIn = (ms, now = Date.now()) => t('inDur', { dur: fmtDuration(ms - now) });
export const fmtAgo = (ms, now = Date.now()) => t('ago', { dur: fmtDuration(now - ms) });

/** "claude-haiku-4-5-20251001" -> "haiku-4-5" */
export function shortModel(id) {
  if (!id) return '';
  return String(id).replace(/^claude-/, '').replace(/-\d{8}$/, '');
}
