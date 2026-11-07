import { spawn } from 'node:child_process';

/** Quote one argument for cmd.exe (only used for .cmd/.bat shims on Windows). */
export function quoteForCmd(arg) {
  const s = String(arg);
  if (s === '') return '""';
  if (/^[\w\-+=.,:/\\@]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Run a program and collect its output. Never throws: spawn errors come back as `error`.
 * stdin is closed (or fed `input`) so tools that read stdin never hang.
 * @returns {Promise<{code: number|null, signal?: string|null, stdout: string, stderr: string, timedOut: boolean, error?: Error}>}
 */
export function runProcess(cmd, args = [], { cwd, env, timeoutMs = 60_000, input, shellOnWindows = false } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer = null;
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: null, stdout, stderr, timedOut, ...extra });
    };

    let child;
    const stdio = [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'];
    try {
      child = shellOnWindows
        ? spawn([cmd, ...args].map(quoteForCmd).join(' '), { cwd, env, stdio, shell: true, windowsHide: true })
        : spawn(cmd, args, { cwd, env, stdio, windowsHide: true });
    } catch (error) {
      finish({ error });
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 3000).unref();
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (stdout.length < 16 * 1024 * 1024) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 1024 * 1024) stderr += d; });
    child.on('error', (error) => finish({ error }));
    child.on('close', (code, signal) => finish({ code, signal }));
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}
