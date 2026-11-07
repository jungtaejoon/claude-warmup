import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlist, LABEL } from '../src/service/launchd.js';
import { buildService, buildTimer, buildCronLine, stripCronLines, CRON_MARK } from '../src/service/linux.js';
import { buildVbs, buildTaskXml } from '../src/service/windows.js';
import { buildPathEnv, getBackend, stableNodePath } from '../src/service/index.js';
import { installAppCopy } from '../src/selfcopy.js';
import { getPaths } from '../src/paths.js';

const opts = {
  nodePath: '/Users/me/.nvm/versions/node/v22.0.0/bin/node',
  scriptPath: '/Users/me/Library/Application Support/claude-warmup/app/bin/claude-warmup.js',
  intervalMin: 5,
  pathEnv: '/usr/bin:/bin',
  logDir: '/Users/me/Library/Application Support/claude-warmup/logs',
};

test('launchd plist', () => {
  const xml = buildPlist({ ...opts, scriptPath: '/a & b/<x>.js' });
  assert.match(xml, new RegExp(`<string>${LABEL.replace(/\./g, '\\.')}</string>`));
  assert.match(xml, /<key>StartInterval<\/key>\s*<integer>300<\/integer>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.ok(xml.includes('<string>/a &amp; b/&lt;x&gt;.js</string>'));
  assert.ok(xml.includes('<string>tick</string>'));
});

test('systemd units quote paths with spaces and escape %', () => {
  const svc = buildService({ ...opts, scriptPath: '/home/me/my apps/100%/cw.js' });
  assert.match(svc, /^ExecStart=\/Users\/me\/\.nvm\/versions\/node\/v22\.0\.0\/bin\/node "\/home\/me\/my apps\/100%%\/cw\.js" tick$/m);
  assert.match(svc, /^Type=oneshot$/m);
  const timer = buildTimer({ intervalMin: 5 });
  assert.match(timer, /^OnCalendar=\*:0\/5$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^WantedBy=timers\.target$/m);
});

test('cron line is marked and quoted', () => {
  const line = buildCronLine({ ...opts, scriptPath: "/home/o'neil/cw.js" });
  assert.ok(line.startsWith('*/5 * * * * '));
  assert.ok(line.endsWith(CRON_MARK));
  assert.ok(line.includes(`'/home/o'\\''neil/cw.js'`));
  assert.ok(buildCronLine({ ...opts, intervalMin: 60 }).startsWith('0 * * * * '));
  const crontab = `MAILTO=me\n0 1 * * * backup\n${line}\n`;
  assert.equal(stripCronLines(crontab), 'MAILTO=me\n0 1 * * * backup');
});

test('windows vbs + task xml', () => {
  const vbs = buildVbs({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', scriptPath: 'C:\\Users\\홍길동\\cw.js' });
  assert.ok(vbs.includes('sh.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\홍길동\\cw.js"" tick", 0, True'));
  const xml = buildTaskXml({ vbsPath: 'C:\\Users\\a&b\\run-hidden.vbs', intervalMin: 5, start: new Date(2026, 0, 2, 3, 4) });
  assert.match(xml, /<Interval>PT5M<\/Interval>/);
  assert.match(xml, /<StartBoundary>2026-01-02T03:04:00<\/StartBoundary>/);
  assert.match(xml, /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/);
  assert.ok(xml.includes('<Arguments>//B //Nologo "C:\\Users\\a&amp;b\\run-hidden.vbs"</Arguments>'));
});

test('a custom CLAUDE_WARMUP_HOME follows the service everywhere', () => {
  const extraEnv = { CLAUDE_WARMUP_HOME: '/tmp/cw home' };
  assert.match(buildPlist({ ...opts, extraEnv }), /<key>CLAUDE_WARMUP_HOME<\/key>\s*<string>\/tmp\/cw home<\/string>/);
  assert.match(buildService({ ...opts, extraEnv }), /^Environment="CLAUDE_WARMUP_HOME=\/tmp\/cw home"$/m);
  assert.ok(buildCronLine({ ...opts, extraEnv }).includes("CLAUDE_WARMUP_HOME='/tmp/cw home'"));
  assert.ok(buildVbs({ nodePath: 'n', scriptPath: 's', extraEnv: { CLAUDE_WARMUP_HOME: 'D:\\cw' } })
    .includes('sh.Environment("Process")("CLAUDE_WARMUP_HOME") = "D:\\cw"'));
  assert.ok(!buildPlist(opts).includes('CLAUDE_WARMUP_HOME'));
});

test('buildPathEnv puts node and claude first, no duplicates', () => {
  const p = buildPathEnv({ nodePath: '/opt/node/bin/node', claudeBin: '/usr/local/bin/claude', platform: 'darwin', home: '/Users/me' });
  const parts = p.split(':');
  assert.equal(parts[0], '/opt/node/bin');
  assert.equal(parts[1], '/usr/local/bin');
  assert.equal(parts.filter((x) => x === '/usr/local/bin').length, 1);
  assert.ok(parts.includes('/Users/me/.local/bin'));
  const w = buildPathEnv({ nodePath: 'C:\\node\\node.exe', claudeBin: null, platform: 'win32', env: { PATH: 'C:\\Windows;C:\\node' } });
  assert.equal(w, 'C:\\node;C:\\Windows');
});

test('stableNodePath prefers a PATH symlink to the same node binary', (t) => {
  if (process.platform === 'win32') return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-node-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.symlinkSync(process.execPath, path.join(dir, 'node'));
  assert.equal(stableNodePath(process.execPath, { PATH: `/nonexistent:${dir}` }), path.join(dir, 'node'));
  assert.equal(stableNodePath(process.execPath, { PATH: '/nonexistent' }), process.execPath);
});

test('getBackend', () => {
  assert.equal(getBackend('darwin').name, 'launchd');
  assert.equal(getBackend('linux').name, 'systemd');
  assert.equal(getBackend('win32').name, 'schtasks');
});

test('installAppCopy makes a runnable copy of the app', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-copy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const paths = getPaths({ CLAUDE_WARMUP_HOME: dir });
  const script = installAppCopy(paths);
  assert.ok(fs.existsSync(script));
  assert.ok(fs.existsSync(path.join(paths.appDir, 'src', 'cli.js')));
  assert.ok(fs.existsSync(path.join(paths.appDir, 'package.json')));
  assert.ok(!fs.existsSync(path.join(paths.appDir, 'test')), 'tests are not copied');
  // running it again replaces the copy cleanly
  assert.equal(installAppCopy(paths), script);
});
