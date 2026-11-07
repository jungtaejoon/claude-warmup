import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'claude-warmup';

/**
 * Where config, state and logs live. CLAUDE_WARMUP_HOME puts everything in one
 * folder (handy for tests and portable setups).
 */
export function getPaths(env = process.env, platform = process.platform, home = os.homedir()) {
  let configDir;
  let dataDir;
  if (env.CLAUDE_WARMUP_HOME) {
    configDir = dataDir = path.resolve(env.CLAUDE_WARMUP_HOME);
  } else if (platform === 'darwin') {
    configDir = dataDir = path.join(home, 'Library', 'Application Support', APP_NAME);
  } else if (platform === 'win32') {
    configDir = path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_NAME);
    dataDir = path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), APP_NAME);
  } else {
    configDir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), APP_NAME);
    dataDir = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), APP_NAME);
  }
  return {
    configDir,
    dataDir,
    configFile: path.join(configDir, 'config.json'),
    stateFile: path.join(dataDir, 'state.json'),
    logFile: path.join(dataDir, 'activity.log'),
    lockFile: path.join(dataDir, 'tick.lock'),
    // claude runs here, so no project CLAUDE.md or settings get picked up
    workDir: path.join(dataDir, 'workdir'),
    // stable copy of this app that the background service runs
    appDir: path.join(dataDir, 'app'),
    serviceLogDir: path.join(dataDir, 'logs'),
  };
}
