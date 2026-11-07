import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = ['bin', 'src', 'package.json', 'LICENSE'];

/**
 * Copy this app into the data folder so the background service keeps working even if
 * it was started from `npx` (temporary cache) or from a clone that later moves.
 * @returns the script path the service should run
 */
export function installAppCopy(paths, sourceRoot = PACKAGE_ROOT) {
  const dest = paths.appDir;
  const script = path.join(dest, 'bin', 'claude-warmup.js');
  if (path.resolve(sourceRoot) === path.resolve(dest)) return script;
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const entry of ENTRIES) {
    const src = path.join(sourceRoot, entry);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, entry), { recursive: true });
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  return script;
}
