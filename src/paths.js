import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'claude-warmup';

/**
 * Where config, state and logs live. CLAUDE_WARMUP_HOME puts everything in one
 * folder (handy for tests and portable setups).
 */
export function getPaths(env = process.env, platform = process.platform, home = os.homedir()) {
  // Join with the target platform's rules, so the layout is right whichever OS computes it.
  const p = platform === 'win32' ? path.win32 : path.posix;
  let configDir;
  let dataDir;
  if (env.CLAUDE_WARMUP_HOME) {
    configDir = dataDir = path.resolve(env.CLAUDE_WARMUP_HOME);
  } else if (platform === 'darwin') {
    configDir = dataDir = p.join(home, 'Library', 'Application Support', APP_NAME);
  } else if (platform === 'win32') {
    configDir = p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), APP_NAME);
    dataDir = p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), APP_NAME);
  } else {
    configDir = p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), APP_NAME);
    dataDir = p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), APP_NAME);
  }
  return {
    configDir,
    dataDir,
    configFile: p.join(configDir, 'config.json'),
    stateFile: p.join(dataDir, 'state.json'),
    logFile: p.join(dataDir, 'activity.log'),
    lockFile: p.join(dataDir, 'tick.lock'),
    // claude runs here, so no project CLAUDE.md or settings get picked up
    workDir: p.join(dataDir, 'workdir'),
    // stable copy of this app that the background service runs
    appDir: p.join(dataDir, 'app'),
    serviceLogDir: p.join(dataDir, 'logs'),
  };
}
