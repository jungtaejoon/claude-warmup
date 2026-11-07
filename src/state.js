import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function loadState(paths) {
  const s = readJson(paths.stateFile, {});
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}

export function saveState(paths, state) {
  writeJsonAtomic(paths.stateFile, state);
}

/** Non-blocking lock so two checks never ping at the same time. Stale locks expire. */
export function acquireLock(file, staleMs = 10 * 60_000) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(file).mtimeMs <= staleMs) return false;
        fs.unlinkSync(file);
      } catch { /* raced with another process; try again */ }
    }
  }
  return false;
}

export function releaseLock(file) {
  try {
    fs.unlinkSync(file);
  } catch { /* already gone */ }
}

export async function waitForLock(file, timeoutMs, stepMs = 500) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (acquireLock(file)) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
