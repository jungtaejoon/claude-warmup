import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 512 * 1024;
const KEEP_LINES = 1500;

/** Append one JSON line to the activity log. Logging never breaks a check. */
export function appendLog(paths, entry) {
  try {
    fs.mkdirSync(path.dirname(paths.logFile), { recursive: true });
    const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));
    fs.appendFileSync(paths.logFile, `${JSON.stringify({ t: new Date().toISOString(), ...clean })}\n`);
    if (fs.statSync(paths.logFile).size > MAX_BYTES) {
      const lines = fs.readFileSync(paths.logFile, 'utf8').trim().split('\n');
      fs.writeFileSync(paths.logFile, `${lines.slice(-KEEP_LINES).join('\n')}\n`);
    }
  } catch { /* ignore */ }
}

export function readLog(paths, n = 20) {
  let text = '';
  try {
    text = fs.readFileSync(paths.logFile, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.trim().split('\n').slice(-n)) {
    try {
      out.push(JSON.parse(line));
    } catch { /* skip torn line */ }
  }
  return out;
}
