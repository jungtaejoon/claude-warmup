// English + Korean output. Logs store codes, not text, so they render in either language.

const en = {
  unknownCommand: 'Unknown command: {cmd}',
  help: `Claude Warmup: start your Claude 5-hour usage window early.

Usage: claude-warmup [command] [options]

Commands
  status            Plan usage and the warm-up schedule (default)
  install           Turn on auto warm-up (background service)
  uninstall         Turn it off (--purge also deletes settings and logs)
  ping              Send a warm-up message now
  config [key] [v]  Show or change settings: hours, days, model, ...
  logs [-n 20]      Recent activity
  doctor            Check your setup
  tick              Run one background check (used by the service)

Options
  --json            Machine-readable output (status, ping, logs, tick)
  --short           One-line status, e.g. for a menu bar or tmux
  --cached          status: use the last saved usage (no claude call)
  --lang en|ko      Output language
  -h, --help        Help
  -v, --version     Version

Examples
  claude-warmup install
  claude-warmup config hours 06:00-23:00
  claude-warmup config days weekdays`,

  usageHeader: 'Usage',
  usageLive: 'checked {time} · claude /usage',
  usageCached: 'saved {when}',
  rowSession: 'Current session (5h)',
  rowWeeklyAll: 'Weekly · all models',
  rowWeeklyScoped: 'Weekly · {name}',
  resetsAt: 'resets {when}',
  sessionIdle: 'no active window: your next message starts a new 5h window',
  usageUnavailable: "Couldn't read usage: {reason}",

  autoHeader: 'Auto warm-up',
  lblStatus: 'Status',
  lblSchedule: 'Schedule',
  lblLastPing: 'Last ping',
  lblNextPing: 'Next ping',
  svcOn: 'on ({backend}, checks every {n} min)',
  svcBroken: 'installed but not running: run claude-warmup install again',
  svcOff: 'off: turn it on with claude-warmup install',
  never: 'never',
  windowUntil: 'window until {when}',
  nextRetry: 'retrying after {when} (last attempt failed)',
  nextBlocked: 'paused until {when} (usage limit reached)',
  nextNever: 'nothing in the next week (check your schedule)',
  nextSoon: 'at the next check (within {n} min)',
  nextAfterWindow: '~{when}, right after the current window resets',
  nextScheduleStart: '~{when}, when your schedule starts',
  hoursAlways: 'all day',
  daysEveryday: 'every day',
  daysWeekdays: 'weekdays',
  daysWeekends: 'weekends',
  dow0: 'Sun', dow1: 'Mon', dow2: 'Tue', dow3: 'Wed', dow4: 'Thu', dow5: 'Fri', dow6: 'Sat',
  today: 'today',
  tomorrow: 'tomorrow',
  yesterday: 'yesterday',
  durD: '{n}d',
  durH: '{n}h',
  durM: '{n}m',
  durS: '{n}s',
  durLessMin: '<1m',
  inDur: 'in {dur}',
  ago: '{dur} ago',
  shortSession: '{pct}% · {left} left',
  shortIdle: 'idle',
  shortWeekly: 'week {pct}%',
  shortUnavailable: 'usage n/a',

  checkingUsage: 'Reading usage via claude /usage...',
  pingSending: 'Sending a warm-up message ({model})...',
  modelDefault: 'default model',
  pingOk: 'Warm-up sent ({model}, {dur})',
  pingWindow: 'Session window {start}–{end} ({left} left)',
  pingWindowEstimate: 'Session window until about {end} (estimated, {left} left)',
  pingModelFallback: 'Model "{model}" was not available, so the default model was used.',
  pingFail: 'Warm-up failed: {reason}',
  lockBusy: 'A background check is running. Try again in a minute.',
  claudeMissing: 'claude CLI not found.',
  claudeMissingHint: 'Install Claude Code (https://code.claude.com/docs/en/setup) and log in, or point to it: claude-warmup config claudePath /path/to/claude',
  hintLogin: 'Log in once with: claude auth login',
  hintRateLimited: 'You are at a usage limit. Warm-up resumes after it resets.',
  hintNetwork: 'Check your internet connection.',
  hintModel: 'Pick another model: claude-warmup config model sonnet',

  installNotLoggedIn: 'The claude CLI is not logged in yet. Run claude auth login; warm-up starts right after.',
  usingDesktopBundled: 'Using the Claude Code copy bundled with the Claude desktop app. A standalone install is sturdier: curl -fsSL https://claude.ai/install.sh | bash',
  installing: 'Installing the background service ({backend})...',
  installFailed: 'Install failed: {error}',
  installed: 'Auto warm-up is on ({backend}, checks every {n} min).',
  installedSchedule: 'It pings whenever no 5-hour window is active · schedule: {schedule}',
  firstCheck: 'First check: {result}',
  tipMacSleep: 'Tip: nothing runs while the Mac sleeps (it catches up on wake). To wake it before work:\n  sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00',
  tipLinger: 'Tip: to keep it running while you are logged out: loginctl enable-linger $USER',
  tipStatus: 'Check anytime: claude-warmup status',
  uninstallFailed: 'Uninstall failed: {error}',
  uninstalled: 'Auto warm-up is off. Settings and logs are kept in {dir} (--purge deletes them).',
  purged: 'Auto warm-up is off and all its data was deleted.',

  tickPinged: 'sent a warm-up; the window runs until {when}',
  tickPingFailed: 'warm-up failed: {reason}',
  tickError: 'error: {reason}',
  tickWindowActive: 'a window is already active until {when}; the next ping goes out right after it',
  tickOutside: 'outside your schedule, nothing to do now',
  tickBackoff: 'waiting after an error, retry after {when}',
  tickBlocked: 'usage limit reached, paused until {when}',
  tickNoSessionLimit: 'your plan reports no 5-hour session limit, nothing to do',
  tickLocked: 'another check is running',

  configHeader: 'Settings ({file})',
  configAuto: '(auto)',
  configUsage: 'Change: claude-warmup config <key> <value>   Reset: claude-warmup config --reset',
  configDesc_hours: 'when pings may be sent: always | HH:MM-HH:MM (overnight OK, e.g. 22:00-02:00)',
  configDesc_days: 'everyday | weekdays | weekends | mon,wed,fri | mon-fri',
  configDesc_model: 'model for the ping (haiku is the lightest; default = Claude Code default)',
  configDesc_message: 'text of the warm-up message',
  configDesc_interval: 'minutes between background checks, 1-60 (run install again to apply)',
  configDesc_claudePath: 'path to the claude CLI (auto = detect)',
  configDesc_lang: 'output language: auto | en | ko',
  configUnknownKey: 'Unknown setting "{key}". Settings: {keys}',
  configInvalid: 'Invalid value for {key}. Expected: {hint}',
  configReset: 'Settings reset to defaults.',
  configScheduleNow: 'Schedule: {schedule}',
  configNextStart: 'Next time inside the schedule: {when}',
  configReinstall: 'Run claude-warmup install again to apply this to the background service.',

  logsEmpty: 'No activity yet.',
  logsFiles: 'Log: {file}\nService output: {dir}',
  logPingOk: 'warm-up sent · {model} · {reason}',
  logPingFail: 'warm-up failed: {reason}',
  logCheckActive: 'check · session {pct}% used, resets {when}',
  logCheckIdle: 'check · no active window',
  logCheckNoUsage: 'check · usage unavailable ({reason})',
  logInstall: 'auto warm-up turned on ({backend})',
  logUninstall: 'auto warm-up turned off',

  doctorTitle: 'Claude Warmup doctor',
  doctorNode: 'Node.js {v}',
  doctorNodeOld: 'Node.js {v} is too old (need 18+)',
  doctorClaude: 'claude CLI {version}: {path}',
  doctorClaudeMissing: 'claude CLI not found',
  doctorClaudePathMissing: 'claudePath is set but not executable: {path}',
  doctorAuth: 'Logged in ({method})',
  doctorAuthNo: 'Not logged in: run claude auth login',
  doctorAuthUnknown: 'Could not read the login status (claude auth status)',
  doctorApiKey: 'Claude Code is using an API key, not a Claude subscription. Warm-up only helps Pro/Max plans.',
  doctorUsage: 'Usage readable via claude /usage (session {pct}%)',
  doctorUsageNo: 'Usage not readable: {reason}. Warm-up still works, with estimated window times.',
  doctorUsageModel: 'This claude version sends /usage to the model, so usage checks are skipped to save quota.',
  doctorOldClaude: 'Older claude CLI without {flags}: warm-ups may cost a bit more. Update with: claude update',
  doctorService: 'Background service: on ({backend})',
  doctorServiceBroken: 'Background service is installed but not running: run claude-warmup install',
  doctorServiceOff: 'Background service: off (claude-warmup install)',
  doctorServiceStale: 'The service points to a file that no longer exists ({path}): run claude-warmup install again',
  doctorLastTick: 'Last background check: {when}',
  doctorLastTickStale: 'Last background check was {when}; the service may not be running',
  doctorNoTick: 'No background check has run yet',
  doctorLastPingFailed: 'Last warm-up failed: {reason}',
  doctorPaths: 'Config: {config}\nData:   {data}',
  doctorAllGood: 'All good.',
  doctorProblems: '{n} problem(s) found.',

  reason_not_logged_in: 'the claude CLI is not logged in',
  reason_claude_not_found: 'claude CLI not found',
  reason_timeout: 'timed out',
  reason_network: 'network error',
  reason_server: 'Claude service error',
  reason_rate_limited: 'usage limit reached',
  reason_model_unavailable: 'model not available',
  reason_no_plan_data: 'no plan usage data (API key or setup-token login?)',
  reason_usage_fetch_failed: 'Claude could not fetch usage right now',
  reason_usage_unsupported: 'this claude version cannot report usage in print mode (try: claude update)',
  reason_unknown: 'unknown error',
  reason_no_active_window: 'no active window',
  reason_usage_unavailable: 'usage unknown',
  reason_manual: 'manual',
};

const ko = {
  unknownCommand: '알 수 없는 명령: {cmd}',
  help: `Claude Warmup: Claude 5시간 사용 창을 미리 시작해 두는 도구

사용법: claude-warmup [명령] [옵션]

명령
  status            사용량과 워밍업 스케줄 보기 (기본)
  install           자동 워밍업 켜기 (백그라운드 서비스)
  uninstall         끄기 (--purge: 설정·기록까지 삭제)
  ping              지금 바로 워밍업 메시지 보내기
  config [키] [값]  설정 보기/변경: hours, days, model, ...
  logs [-n 20]      최근 기록
  doctor            설치 상태 점검
  tick              백그라운드 확인 1회 실행 (서비스가 사용)

옵션
  --json            기계가 읽는 출력 (status, ping, logs, tick)
  --short           한 줄 상태 (메뉴 막대, tmux 등에 쓰기 좋음)
  --cached          status: 마지막으로 저장된 사용량 사용 (claude 호출 없음)
  --lang en|ko      출력 언어
  -h, --help        도움말
  -v, --version     버전

예시
  claude-warmup install
  claude-warmup config hours 06:00-23:00
  claude-warmup config days weekdays`,

  usageHeader: '사용량',
  usageLive: '{time} 확인 · claude /usage',
  usageCached: '{when} 저장본',
  rowSession: '현재 세션 (5시간)',
  rowWeeklyAll: '주간 · 전체 모델',
  rowWeeklyScoped: '주간 · {name}',
  resetsAt: '{when} 리셋',
  sessionIdle: '활성 세션 없음: 다음 메시지부터 새 5시간이 시작돼요',
  usageUnavailable: '사용량을 읽지 못했어요: {reason}',

  autoHeader: '자동 워밍업',
  lblStatus: '상태',
  lblSchedule: '스케줄',
  lblLastPing: '마지막 핑',
  lblNextPing: '다음 핑',
  svcOn: '켜짐 ({backend}, {n}분마다 확인)',
  svcBroken: '설치됐지만 실행 중이 아니에요: claude-warmup install 을 다시 실행하세요',
  svcOff: '꺼짐: claude-warmup install 로 켜세요',
  never: '아직 없음',
  windowUntil: '{when}까지 세션',
  nextRetry: '{when} 이후 재시도 (직전 시도 실패)',
  nextBlocked: '{when}까지 대기 (사용 한도 도달)',
  nextNever: '일주일 안에 스케줄 시간이 없어요 (스케줄을 확인하세요)',
  nextSoon: '다음 확인 때 ({n}분 이내)',
  nextAfterWindow: '{when}경, 지금 세션이 끝나면 바로',
  nextScheduleStart: '{when}경, 스케줄이 시작될 때',
  hoursAlways: '하루 종일',
  daysEveryday: '매일',
  daysWeekdays: '평일',
  daysWeekends: '주말',
  dow0: '일요일', dow1: '월요일', dow2: '화요일', dow3: '수요일', dow4: '목요일', dow5: '금요일', dow6: '토요일',
  today: '오늘',
  tomorrow: '내일',
  yesterday: '어제',
  durD: '{n}일',
  durH: '{n}시간',
  durM: '{n}분',
  durS: '{n}초',
  durLessMin: '1분 미만',
  inDur: '{dur} 후',
  ago: '{dur} 전',
  shortSession: '{pct}% · {left} 남음',
  shortIdle: '대기',
  shortWeekly: '주간 {pct}%',
  shortUnavailable: '사용량 확인 불가',

  checkingUsage: 'claude /usage 로 사용량 확인 중...',
  pingSending: '워밍업 메시지 보내는 중 ({model})...',
  modelDefault: '기본 모델',
  pingOk: '워밍업 전송 완료 ({model}, {dur})',
  pingWindow: '세션 {start}–{end} ({left} 남음)',
  pingWindowEstimate: '세션 약 {end}까지 (추정, {left} 남음)',
  pingModelFallback: '"{model}" 모델을 쓸 수 없어서 기본 모델로 보냈어요.',
  pingFail: '워밍업 실패: {reason}',
  lockBusy: '백그라운드 확인이 진행 중이에요. 잠시 후 다시 시도하세요.',
  claudeMissing: 'claude CLI를 찾을 수 없어요.',
  claudeMissingHint: 'Claude Code를 설치하고 로그인하세요 (https://code.claude.com/docs/ko/setup). 다른 위치에 있다면: claude-warmup config claudePath /경로/claude',
  hintLogin: '한 번만 로그인하세요: claude auth login',
  hintRateLimited: '사용 한도에 도달했어요. 리셋되면 워밍업이 다시 동작해요.',
  hintNetwork: '인터넷 연결을 확인하세요.',
  hintModel: '다른 모델로 바꾸세요: claude-warmup config model sonnet',

  installNotLoggedIn: 'claude CLI에 아직 로그인되어 있지 않아요. claude auth login 을 실행하면 바로 동작해요.',
  usingDesktopBundled: 'Claude 데스크톱 앱에 들어 있는 Claude Code를 쓰고 있어요. 따로 설치하면 더 안정적이에요: curl -fsSL https://claude.ai/install.sh | bash',
  installing: '백그라운드 서비스 설치 중 ({backend})...',
  installFailed: '설치 실패: {error}',
  installed: '자동 워밍업이 켜졌어요 ({backend}, {n}분마다 확인).',
  installedSchedule: '활성 5시간 세션이 없으면 바로 핑을 보내요 · 스케줄: {schedule}',
  firstCheck: '첫 확인: {result}',
  tipMacSleep: '팁: Mac이 잠자기 중이면 실행되지 않아요 (깨어나면 바로 확인해요). 출근 전에 깨우려면:\n  sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00',
  tipLinger: '팁: 로그아웃 상태에서도 돌리려면: loginctl enable-linger $USER',
  tipStatus: '상태 확인: claude-warmup status',
  uninstallFailed: '제거 실패: {error}',
  uninstalled: '자동 워밍업을 껐어요. 설정과 기록은 {dir}에 남아 있어요 (--purge 로 삭제).',
  purged: '자동 워밍업을 끄고 데이터를 모두 삭제했어요.',

  tickPinged: '워밍업을 보냈어요. {when}까지 세션이 유지돼요',
  tickPingFailed: '워밍업 실패: {reason}',
  tickError: '오류: {reason}',
  tickWindowActive: '이미 {when}까지 활성 세션이 있어요. 끝나면 바로 핑을 보내요',
  tickOutside: '스케줄 시간이 아니라서 지금은 할 일이 없어요',
  tickBackoff: '오류 후 대기 중, {when} 이후 재시도',
  tickBlocked: '사용 한도 도달, {when}까지 대기',
  tickNoSessionLimit: '요금제에 5시간 세션 한도가 없어서 할 일이 없어요',
  tickLocked: '다른 확인이 진행 중이에요',

  configHeader: '설정 ({file})',
  configAuto: '(자동)',
  configUsage: '변경: claude-warmup config <키> <값>   초기화: claude-warmup config --reset',
  configDesc_hours: '핑을 보낼 시간대: always | HH:MM-HH:MM (자정 넘김 가능, 예: 22:00-02:00)',
  configDesc_days: 'everyday | weekdays | weekends | mon,wed,fri | 월-금',
  configDesc_model: '핑에 쓸 모델 (haiku가 가장 가벼움, default = Claude Code 기본값)',
  configDesc_message: '워밍업 메시지 내용',
  configDesc_interval: '백그라운드 확인 주기(분), 1-60 (적용하려면 install 다시 실행)',
  configDesc_claudePath: 'claude CLI 경로 (auto = 자동 탐지)',
  configDesc_lang: '출력 언어: auto | en | ko',
  configUnknownKey: '알 수 없는 설정 "{key}". 가능한 설정: {keys}',
  configInvalid: '{key} 값이 올바르지 않아요. 형식: {hint}',
  configReset: '설정을 기본값으로 되돌렸어요.',
  configScheduleNow: '스케줄: {schedule}',
  configNextStart: '다음 스케줄 시작: {when}',
  configReinstall: '백그라운드 서비스에 적용하려면 claude-warmup install 을 다시 실행하세요.',

  logsEmpty: '아직 기록이 없어요.',
  logsFiles: '기록 파일: {file}\n서비스 출력: {dir}',
  logPingOk: '워밍업 전송 · {model} · {reason}',
  logPingFail: '워밍업 실패: {reason}',
  logCheckActive: '확인 · 세션 {pct}% 사용, {when} 리셋',
  logCheckIdle: '확인 · 활성 세션 없음',
  logCheckNoUsage: '확인 · 사용량 확인 불가 ({reason})',
  logInstall: '자동 워밍업 켬 ({backend})',
  logUninstall: '자동 워밍업 끔',

  doctorTitle: 'Claude Warmup 점검',
  doctorNode: 'Node.js {v}',
  doctorNodeOld: 'Node.js {v}는 너무 오래됐어요 (18 이상 필요)',
  doctorClaude: 'claude CLI {version}: {path}',
  doctorClaudeMissing: 'claude CLI를 찾을 수 없어요',
  doctorClaudePathMissing: 'claudePath 경로에 실행 파일이 없어요: {path}',
  doctorAuth: '로그인됨 ({method})',
  doctorAuthNo: '로그인 안 됨: claude auth login 을 실행하세요',
  doctorAuthUnknown: '로그인 상태를 확인하지 못했어요 (claude auth status)',
  doctorApiKey: 'Claude Code가 구독이 아니라 API 키로 로그인돼 있어요. 워밍업은 Pro/Max 구독에서만 의미가 있어요.',
  doctorUsage: 'claude /usage 로 사용량 조회 가능 (세션 {pct}%)',
  doctorUsageNo: '사용량 조회 불가: {reason}. 워밍업은 동작하지만 세션 시간은 추정치로 계산해요.',
  doctorUsageModel: '이 claude 버전은 /usage를 모델로 보내서, 사용량을 아끼려고 사용량 조회를 건너뛰어요.',
  doctorOldClaude: '구버전 claude CLI라 {flags} 옵션이 없어요. 워밍업 비용이 조금 늘 수 있어요. 업데이트: claude update',
  doctorService: '백그라운드 서비스: 켜짐 ({backend})',
  doctorServiceBroken: '백그라운드 서비스가 설치됐지만 실행 중이 아니에요: claude-warmup install',
  doctorServiceOff: '백그라운드 서비스: 꺼짐 (claude-warmup install)',
  doctorServiceStale: '서비스가 가리키는 파일이 없어졌어요 ({path}): claude-warmup install 을 다시 실행하세요',
  doctorLastTick: '마지막 백그라운드 확인: {when}',
  doctorLastTickStale: '마지막 백그라운드 확인이 {when}이에요. 서비스가 멈췄을 수 있어요',
  doctorNoTick: '아직 백그라운드 확인 기록이 없어요',
  doctorLastPingFailed: '마지막 워밍업 실패: {reason}',
  doctorPaths: '설정: {config}\n데이터: {data}',
  doctorAllGood: '모두 정상이에요.',
  doctorProblems: '문제 {n}개를 찾았어요.',

  reason_not_logged_in: 'claude CLI에 로그인되어 있지 않아요',
  reason_claude_not_found: 'claude CLI를 찾을 수 없어요',
  reason_timeout: '시간 초과',
  reason_network: '네트워크 오류',
  reason_server: 'Claude 서비스 오류',
  reason_rate_limited: '사용 한도 도달',
  reason_model_unavailable: '모델을 쓸 수 없음',
  reason_no_plan_data: '요금제 사용량 정보 없음 (API 키나 setup-token 로그인?)',
  reason_usage_fetch_failed: 'Claude가 지금 사용량을 가져오지 못했어요',
  reason_usage_unsupported: '이 claude 버전은 출력 모드에서 사용량을 알려주지 않아요 (claude update 를 해보세요)',
  reason_unknown: '알 수 없는 오류',
  reason_no_active_window: '활성 세션 없음',
  reason_usage_unavailable: '사용량 확인 불가',
  reason_manual: '수동',
};

export const MESSAGES = { en, ko };
let current = 'en';

/** Explicit setting > LC_ALL/LC_MESSAGES/LANG/LANGUAGE > system locale. */
export function detectLang(env = process.env, preferred = '') {
  const norm = (v) => {
    const s = String(v || '').toLowerCase();
    if (s.startsWith('ko')) return 'ko';
    if (s.startsWith('en')) return 'en';
    return null;
  };
  if (preferred && preferred !== 'auto') return norm(preferred) || 'en';
  for (const k of ['LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE']) {
    const v = env[k];
    if (v && !/^(c|posix)([._@]|$)/i.test(v)) {
      const n = norm(v);
      if (n) return n;
    }
  }
  try {
    return norm(Intl.DateTimeFormat().resolvedOptions().locale) || 'en';
  } catch {
    return 'en';
  }
}

export function setLang(lang) {
  current = MESSAGES[lang] ? lang : 'en';
}

export function getLang() {
  return current;
}

export function has(key) {
  return key in en;
}

export function t(key, vars = {}) {
  const s = MESSAGES[current][key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}
