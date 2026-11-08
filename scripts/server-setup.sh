#!/usr/bin/env bash
# claude-warmup server setup for Linux (Ubuntu, Debian, Oracle Linux and similar).
#
# Installs whatever is missing into ~/.local (Node.js, the Claude Code CLI, claude-warmup),
# asks you to log in to Claude, and turns on the background warm-up (a systemd user timer).
# Your Claude login is handled by the official CLI; this script never reads credentials.
# Run it again any time to update claude-warmup.
#
# Usage: bash server-setup.sh [--timezone Asia/Seoul] [--hours 06:00-23:00] [--lang en|ko] [--skip-login]
set -euo pipefail

NODE_MAJOR=24
APP_TARBALL="https://codeload.github.com/jungtaejoon/claude-warmup/tar.gz/refs/heads/main"

TIMEZONE=""
HOURS=""
UI_LANG=""
LANG_GIVEN=0
SKIP_LOGIN=0

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }
need_value() { [ -n "${2:-}" ] || { echo "$1 needs a value (see --help)" >&2; exit 2; }; }

while [ $# -gt 0 ]; do
  case "$1" in
    --timezone) need_value "$1" "${2:-}"; TIMEZONE="$2"; shift 2 ;;
    --timezone=*) TIMEZONE="${1#*=}"; shift ;;
    --hours) need_value "$1" "${2:-}"; HOURS="$2"; shift 2 ;;
    --hours=*) HOURS="${1#*=}"; shift ;;
    --lang) need_value "$1" "${2:-}"; UI_LANG="$2"; LANG_GIVEN=1; shift 2 ;;
    --lang=*) UI_LANG="${1#*=}"; LANG_GIVEN=1; shift ;;
    --skip-login) SKIP_LOGIN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

case "$UI_LANG" in
  en | ko) ;;
  "") case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in ko*) UI_LANG=ko ;; *) UI_LANG=en ;; esac ;;
  *) echo "--lang must be en or ko" >&2; exit 2 ;;
esac

if [ -t 1 ]; then BOLD=$'\033[1m'; RED=$'\033[31m'; RESET=$'\033[0m'; else BOLD=''; RED=''; RESET=''; fi
# m "English" "한국어" prints the message in the chosen language.
m() { if [ "$UI_LANG" = ko ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
note() { printf '    %s\n' "$*"; }
die() { printf '\n%s%s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; elif have sudo; then sudo "$@"; else "$@"; fi; }

[ "$(uname -s)" = Linux ] || die "$(m 'This script is for Linux servers. On macOS or Windows, follow the README instead.' '이 스크립트는 Linux 서버용이에요. macOS나 Windows에서는 README의 설치 방법을 따라 주세요.')"
[ "$(id -u)" -ne 0 ] || die "$(m 'Run this as your normal login user, not as root.' 'root가 아닌 평소 로그인 사용자로 실행해 주세요.')"
have curl || die "$(m 'curl is required. Install it first (for example: sudo apt install curl).' 'curl이 필요해요. 먼저 설치해 주세요 (예: sudo apt install curl).')"
USER_NAME="$(id -un)"

# Everything goes into ~/.local/bin, which must be on PATH now and in future shells.
mkdir -p "$HOME/.local/bin"
PATH_ADDED=0
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH"; PATH_ADDED=1 ;; esac
if ! grep -qs '\.local/bin' "$HOME/.bashrc"; then
  # shellcheck disable=SC2016 # written literally; the shell expands it when .bashrc runs
  printf '\n# Added by claude-warmup server setup\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$HOME/.bashrc"
fi

if [ -n "$TIMEZONE" ]; then
  step "$(m "Setting the server time zone to $TIMEZONE" "서버 시간대를 $TIMEZONE(으)로 설정")"
  if have timedatectl && timedatectl show >/dev/null 2>&1; then
    as_root timedatectl set-timezone "$TIMEZONE" \
      || die "$(m "Could not set the time zone to $TIMEZONE (check the name, e.g. Asia/Seoul)." "시간대를 $TIMEZONE(으)로 바꾸지 못했어요. 이름을 확인해 주세요 (예: Asia/Seoul).")"
    note "$(date)"
  else
    note "$(m 'timedatectl is not available here, so the time zone was left as it is.' 'timedatectl을 쓸 수 없는 환경이라 시간대는 그대로 뒀어요.')"
  fi
fi

node_ok() { have node && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null; }
if node_ok; then
  step "$(m "Node.js $(node --version) is already installed" "Node.js $(node --version) 이미 설치돼 있음")"
else
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "$(m "Unsupported CPU: $(uname -m) (64-bit x86 or ARM is needed)" "지원하지 않는 CPU예요: $(uname -m) (64비트 x86이나 ARM이 필요해요)")" ;;
  esac
  step "$(m "Installing Node.js $NODE_MAJOR into ~/.local/opt" "Node.js $NODE_MAJOR 설치 (~/.local/opt)")"
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file="$(awk -v re="^node-v[0-9.]+-linux-${arch}[.]tar[.]gz$" '$2 ~ re { print $2; exit }' "$tmp/SHASUMS256.txt")"
  [ -n "$file" ] || die "$(m "No Node.js $NODE_MAJOR build found for linux-$arch" "linux-$arch용 Node.js $NODE_MAJOR 파일을 찾지 못했어요")"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && awk -v f="$file" '$2 == f' SHASUMS256.txt | sha256sum -c --status -) \
    || die "$(m 'The Node.js download did not match its checksum.' 'Node.js 다운로드 파일의 체크섬이 맞지 않아요.')"
  mkdir -p "$HOME/.local/opt"
  tar -xzf "$tmp/$file" -C "$HOME/.local/opt"
  node_dir="$HOME/.local/opt/${file%.tar.gz}"
  for b in node npm npx; do ln -sfn "$node_dir/bin/$b" "$HOME/.local/bin/$b"; done
  hash -r
  node_ok || die "$(m 'Node.js did not install correctly.' 'Node.js가 제대로 설치되지 않았어요.')"
  note "Node.js $(node --version)"
fi

if have claude; then
  step "$(m "Claude Code $(claude --version 2>/dev/null) is already installed" "Claude Code $(claude --version 2>/dev/null) 이미 설치돼 있음")"
else
  step "$(m 'Installing the Claude Code CLI (official installer)' 'Claude Code CLI 설치 (공식 설치 스크립트)')"
  curl -fsSL https://claude.ai/install.sh | bash
  hash -r
  have claude || die "$(m "Claude Code was installed, but the 'claude' command is not on PATH." "Claude Code는 설치됐지만 'claude' 명령을 찾지 못했어요.")"
fi

step "$(m 'Installing claude-warmup (latest from GitHub)' 'claude-warmup 설치 (GitHub 최신 버전)')"
npm install -g --prefix "$HOME/.local" --prefer-online --no-audit --no-fund --loglevel=error "$APP_TARBALL"
hash -r
have claude-warmup || die "$(m "claude-warmup was installed, but the command is not on PATH." "claude-warmup은 설치됐지만 명령을 찾지 못했어요.")"
note "claude-warmup $(claude-warmup --version)"
if [ "$LANG_GIVEN" = 1 ]; then claude-warmup config lang "$UI_LANG" >/dev/null; fi
if [ -n "$HOURS" ]; then claude-warmup config hours "$HOURS"; fi

# Without lingering, systemd stops user timers when you log out.
if have loginctl && [ -d /run/systemd/system ]; then
  if ! loginctl show-user "$USER_NAME" --property=Linger 2>/dev/null | grep -q '=yes'; then
    step "$(m 'Keeping the timer running after you log out (loginctl enable-linger)' '로그아웃한 뒤에도 타이머가 돌도록 설정 (loginctl enable-linger)')"
    loginctl enable-linger "$USER_NAME" 2>/dev/null || as_root loginctl enable-linger "$USER_NAME" \
      || note "$(m 'Could not enable lingering. The timer still runs while you are logged in.' 'lingering을 켜지 못했어요. 로그인해 있는 동안에는 타이머가 돌아요.')"
  fi
fi

logged_in() {
  claude auth status --json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { process.exit(JSON.parse(s).loggedIn ? 0 : 1); } catch { process.exit(1); }
    });'
}

if logged_in; then
  step "$(m 'Claude Code is already logged in' 'Claude Code 로그인 확인됨')"
elif [ "$SKIP_LOGIN" = 1 ]; then
  step "$(m 'Skipped the login (--skip-login)' '로그인은 건너뜀 (--skip-login)')"
  note "$(m 'Next: claude auth login, then claude-warmup install' '다음 단계: claude auth login 을 실행한 뒤 claude-warmup install')"
  [ "$PATH_ADDED" = 0 ] || note "$(m 'To use the new commands in this window, run: source ~/.bashrc' '이 창에서 새 명령을 바로 쓰려면 source ~/.bashrc 를 실행하세요.')"
  exit 0
else
  step "$(m 'Log in to Claude with your Pro/Max account' 'Pro/Max 구독 계정으로 Claude 로그인')"
  note "$(m 'Open the link below in a browser on your own computer and approve. Then paste the code it shows back here.' '아래 링크를 내 컴퓨터의 브라우저에서 열고 승인하세요. 그다음 화면에 나온 코드를 여기에 붙여 넣으면 돼요.')"
  claude auth login </dev/tty || true
  logged_in || die "$(m 'Not logged in yet. Run claude auth login, then run this script again.' '아직 로그인되지 않았어요. claude auth login 을 실행한 뒤 이 스크립트를 다시 실행해 주세요.')"
fi

step "$(m 'Turning on the background warm-up' '백그라운드 워밍업 켜기')"
claude-warmup install
echo
claude-warmup status || true
step "$(m 'All set. Check it any time with: claude-warmup status' '모두 끝났어요. 언제든 claude-warmup status 로 확인할 수 있어요.')"
[ "$PATH_ADDED" = 0 ] || note "$(m 'In this window, run source ~/.bashrc first (new logins pick it up on their own).' '이 창에서는 먼저 source ~/.bashrc 를 실행하세요. 새로 접속하면 따로 할 필요 없어요.')"
