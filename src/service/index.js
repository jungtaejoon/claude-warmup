import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as launchd from './launchd.js';
import * as linux from './linux.js';
import * as windows from './windows.js';

/**
 * Background service backend for this OS. Each exports:
 *   name, install(opts), uninstall(), status() -> { backend, installed, active, file? }
 */
export function getBackend(platform = process.platform) {
  if (platform === 'darwin') return launchd;
  if (platform === 'win32') return windows;
  return linux;
}

/**
 * The node binary the service should run. process.execPath is often a versioned path
 * (…/node-v24.1.0/bin/node, Cellar/node/24.1.0/…) that disappears on upgrade, so prefer a
 * `node` on PATH (usually a stable symlink) when it is the same binary.
 */
export function stableNodePath(execPath = process.execPath, env = process.env) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
  const target = real(execPath);
  const names = process.platform === 'win32' ? ['node.exe'] : ['node'];
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const n of names) {
      const candidate = path.join(dir, n);
      if (target && real(candidate) === target) return candidate;
    }
  }
  return execPath;
}

/** PATH for the service: node's and claude's folders first, then the usual places. */
export function buildPathEnv({ nodePath, claudeBin, env = process.env, platform = process.platform, home = os.homedir() }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = [];
  const add = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  if (nodePath) add(p.dirname(nodePath));
  if (claudeBin) add(p.dirname(claudeBin));
  if (platform === 'win32') {
    (env.PATH || env.Path || '').split(';').forEach(add);
    return dirs.join(';');
  }
  add(p.join(home, '.local', 'bin'));
  ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].forEach(add);
  return dirs.join(':');
}
