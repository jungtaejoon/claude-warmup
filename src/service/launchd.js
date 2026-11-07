// macOS: a per-user LaunchAgent that runs `claude-warmup tick` every N minutes.
// launchd also runs a missed interval right after the Mac wakes up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../proc.js';

export const name = 'launchd';
export const LABEL = 'com.claude-warmup.agent';

export function plistPath(home = os.homedir()) {
  return path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildPlist({ nodePath, scriptPath, intervalMin, pathEnv, logDir, extraEnv = {} }) {
  const envEntries = Object.entries({ PATH: pathEnv, ...extraEnv })
    .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(scriptPath)}</string>
    <string>tick</string>
  </array>
  <key>StartInterval</key>
  <integer>${Math.round(intervalMin * 60)}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(path.join(logDir, 'service.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(logDir, 'service.err.log'))}</string>
</dict>
</plist>
`;
}

const domain = () => `gui/${process.getuid()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function install(opts) {
  const file = plistPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(opts.logDir, { recursive: true });
  fs.writeFileSync(file, buildPlist(opts));
  await runProcess('launchctl', ['bootout', `${domain()}/${LABEL}`], { timeoutMs: 15_000 });
  let last = null;
  for (let i = 0; i < 4; i++) {
    last = await runProcess('launchctl', ['bootstrap', domain(), file], { timeoutMs: 15_000 });
    if (last.code === 0) return { backend: name, file };
    await sleep(500 * (i + 1)); // bootout can take a moment to settle
  }
  const legacy = await runProcess('launchctl', ['load', '-w', file], { timeoutMs: 15_000 });
  if (legacy.code === 0 && !/error|failed/i.test(legacy.stderr)) return { backend: name, file };
  throw new Error(`launchctl bootstrap failed: ${(last?.stderr || last?.stdout || '').trim() || `exit ${last?.code}`}`);
}

export async function uninstall() {
  const file = plistPath();
  await runProcess('launchctl', ['bootout', `${domain()}/${LABEL}`], { timeoutMs: 15_000 });
  fs.rmSync(file, { force: true });
  return { backend: name, file };
}

export async function status() {
  const file = plistPath();
  const installed = fs.existsSync(file);
  const r = await runProcess('launchctl', ['print', `${domain()}/${LABEL}`], { timeoutMs: 15_000 });
  const loaded = r.code === 0;
  const lastExit = /last exit code = ([^\n]+)/.exec(r.stdout || '')?.[1]?.trim() ?? null;
  return { backend: name, installed, loaded, active: installed && loaded, file, lastExit };
}
