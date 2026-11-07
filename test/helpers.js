import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPaths } from '../src/paths.js';
import { DEFAULTS } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function fakeClaudePath() {
  if (process.platform === 'win32') return path.join(here, 'fixtures', 'fake-claude.cmd');
  const p = path.join(here, 'fixtures', 'fake-claude.mjs');
  fs.chmodSync(p, 0o755);
  return p;
}

/** A throwaway app home + config pointing at the fake claude. */
export function sandbox(scenario = 'idle', configOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-test-'));
  const paths = getPaths({ CLAUDE_WARMUP_HOME: dir });
  const callLog = path.join(dir, 'fake-calls.jsonl');
  process.env.FAKE_CLAUDE_SCENARIO = scenario;
  process.env.FAKE_CLAUDE_LOG = callLog;
  const config = { ...DEFAULTS, claudePath: fakeClaudePath(), ...configOverrides };
  return {
    dir,
    paths,
    config,
    calls() {
      try {
        return fs.readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
    pings() {
      return this.calls().filter((a) => a[0] === '-p' && a[1] !== '/usage');
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
