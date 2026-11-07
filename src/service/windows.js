// Windows: a Task Scheduler task that runs every N minutes for the current user.
// It starts wscript with a tiny .vbs so no console window flashes up.
import fs from 'node:fs';
import path from 'node:path';
import { runProcess } from '../proc.js';

export const name = 'schtasks';
export const TASK = 'claude-warmup';

export function buildVbs({ nodePath, scriptPath, extraEnv = {} }) {
  const q = (s) => `""${s}""`; // a quote inside a VBScript string literal is ""
  const env = Object.entries(extraEnv)
    .map(([k, v]) => `sh.Environment("Process")("${k}") = "${String(v).replace(/"/g, '""')}"\r\n`)
    .join('');
  return `' Claude Warmup: runs one background check without opening a console window.\r\n`
    + `Set sh = CreateObject("WScript.Shell")\r\n`
    + env
    + `sh.Run "${q(nodePath)} ${q(scriptPath)} tick", 0, True\r\n`;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function localIsoMinute(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

export function buildTaskXml({ vbsPath, intervalMin, start = new Date() }) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Claude Warmup: starts your Claude 5-hour usage window early.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT${intervalMin}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>${localIsoMinute(start)}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>//B //Nologo "${xml(vbsPath)}"</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

const files = (dataDir) => ({ vbs: path.join(dataDir, 'run-hidden.vbs'), xml: path.join(dataDir, 'task.xml') });

export async function install({ nodePath, scriptPath, intervalMin, dataDir, logDir, extraEnv = {} }) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const f = files(dataDir);
  // UTF-16LE with BOM: both wscript and schtasks read non-ASCII paths (e.g. C:\Users\홍길동) correctly.
  fs.writeFileSync(f.vbs, Buffer.from(`\ufeff${buildVbs({ nodePath, scriptPath, extraEnv })}`, 'utf16le'));
  fs.writeFileSync(f.xml, Buffer.from(`\ufeff${buildTaskXml({ vbsPath: f.vbs, intervalMin })}`, 'utf16le'));
  const r = await runProcess('schtasks', ['/Create', '/F', '/TN', TASK, '/XML', f.xml], { timeoutMs: 30_000 });
  if (r.code !== 0) throw new Error(`schtasks /Create failed: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
  return { backend: name, file: f.xml };
}

export async function uninstall({ paths } = {}) {
  await runProcess('schtasks', ['/Delete', '/F', '/TN', TASK], { timeoutMs: 30_000 });
  if (paths?.dataDir) {
    const f = files(paths.dataDir);
    fs.rmSync(f.vbs, { force: true });
    fs.rmSync(f.xml, { force: true });
  }
  return { backend: name };
}

export async function status() {
  const r = await runProcess('schtasks', ['/Query', '/TN', TASK], { timeoutMs: 30_000 });
  const installed = r.code === 0;
  return { backend: name, installed, active: installed };
}
