# claude-warmup

[![CI](https://github.com/jungtaejoon/claude-warmup/actions/workflows/ci.yml/badge.svg)](https://github.com/jungtaejoon/claude-warmup/actions/workflows/ci.yml)

[English](README.md) · **한국어** · [웹사이트](https://jungtaejoon.github.io/claude-warmup/ko/)

Claude(Pro/Max) 의 **5시간 사용 창을 미리 시작해 두는** 작은 도구입니다. 클로드 사용량 한도가 하루 끝이 아니라 한창 일하는 중간에 리셋되도록 맞춰 줍니다.
백그라운드에서 몇 분마다 상태를 확인하고, 활성 세션이 없을 때만 공식 `claude` CLI로 아주 짧은 메시지(haiku, "hi")를 보냅니다.
현재 세션·주간 사용량과 리셋 시각도 보여 줍니다.

```
$ claude-warmup
Claude Warmup v0.1.0

사용량  08:42 확인 · claude /usage
  현재 세션 (5시간)  █████░░░░░░░░░░░░░░░  23%  11:00 리셋 (2시간 17분 후)
  주간 · 전체 모델   ████████░░░░░░░░░░░░  41%  화요일 10:00 리셋
  주간 · Sonnet      █░░░░░░░░░░░░░░░░░░░   7%  화요일 10:00 리셋

자동 워밍업
  상태        ● 켜짐 (launchd, 5분마다 확인)
  스케줄      하루 종일 · 매일
  마지막 핑   06:00 ✓ haiku-5-5 · 11:00까지 세션
  다음 핑     11:00경, 지금 세션이 끝나면 바로
```

## 왜 필요한가요?

Claude 구독의 세션 한도는 **첫 메시지를 보낸 순간부터 5시간** 단위로 돌아갑니다 ([공식 도움말](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)).
그래서 일을 시작하기 전에 창을 미리 열어 두면, 한창 일할 때 한도가 더 빨리 리셋됩니다.

```
워밍업 없이     09:00 ──────────── 작업 ──────────── 14:00 리셋
                (09시에 첫 메시지 → 14시 리셋)

워밍업 06:00    06:00 ── 핑 ── 09:00 ── 작업 ── 11:00 리셋 ── 작업 ── 16:00 리셋
                (09~11시에 한 창 + 11시부터 새 창)
```

- 한도 자체가 늘어나는 건 아닙니다. **리셋 시점을 내 작업 시간에 맞추는** 것뿐이에요.
- 주간 한도는 별도이고 고정된 시각에 리셋됩니다. 핑은 haiku 한 마디라 주간 사용량에 주는 영향은 무시할 수준입니다.

## 동작 방식

1. OS 스케줄러(macOS launchd, Linux systemd/cron, Windows 작업 스케줄러)가 N분(기본 5분)마다 `claude-warmup tick` 을 실행합니다.
2. 알고 있는 세션이 아직 진행 중이면 **아무것도 하지 않고** 끝납니다 (claude 호출 없음).
3. 세션이 끝났거나 모르면 `claude -p /usage` 로 사용량을 확인합니다. 이 명령은 Claude Code 안에서 처리되는 **로컬 명령이라 사용량을 쓰지 않습니다** (토큰 0, 비용 $0).
4. 활성 세션이 없을 때만 워밍업 메시지를 보냅니다.
   `claude -p "hi" --model haiku --tools "" --system-prompt "…" --safe-mode --no-session-persistence`
   도구·MCP·훅·CLAUDE.md 를 모두 끈 최소 요청이고, 세션 기록도 남기지 않습니다.
5. 응답에 실린 `rate_limit_event` 로 새 세션의 리셋 시각을 기록하고, 그때까지 다시 잠듭니다.

그래서 "5시간마다"가 시계 기준이 아니라 **실제 세션이 끝나는 순간** 기준으로 맞춰집니다. 직접 Claude를 써서 세션이 먼저 시작돼도 알아서 따라갑니다.

### 보안

- 이 도구는 **Claude 로그인 정보를 직접 읽지 않습니다.** 인증은 전부 공식 `claude` CLI가 처리합니다.
- `ANTHROPIC_API_KEY` 같은 API 키 환경 변수는 자식 프로세스에서 제거합니다. 그래서 핑은 항상 구독 한도로만 계산되고, API 요금이 나가지 않습니다.
- 의존성이 하나도 없는(zero-dependency) Node.js 코드라서 직접 읽어 보기 쉽습니다.

## 준비물

- Node.js 18 이상
- [Claude Code](https://code.claude.com/docs/ko/setup) CLI. **Pro/Max 구독 계정으로 로그인**되어 있어야 합니다.

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

```bash
claude auth login
```

> Claude 데스크톱 앱만 쓰고 있다면 앱 안에 들어 있는 Claude Code도 자동으로 찾지만, 위처럼 따로 설치하는 편이 업데이트에 더 안정적입니다.

## 설치

```bash
npm install -g github:jungtaejoon/claude-warmup
```

```bash
claude-warmup install
```

설치 없이 바로 실행해도 됩니다. `install` 은 앱을 데이터 폴더로 복사하고 그 복사본으로 서비스를 돌리므로, npx 캐시가 지워져도 계속 동작합니다.

```bash
npx github:jungtaejoon/claude-warmup install
```

## 사용법

| 명령 | 설명 |
| --- | --- |
| `claude-warmup` / `status` | 사용량과 스케줄 보기 (`--json`, `--short`, `--cached`) |
| `claude-warmup install` | 자동 워밍업 켜기 |
| `claude-warmup uninstall` | 끄기 (`--purge` 를 붙이면 설정·기록까지 삭제) |
| `claude-warmup ping` | 지금 바로 핑 보내기 |
| `claude-warmup config` | 설정 보기 / `config <키> <값>` 으로 변경 |
| `claude-warmup logs` | 최근 기록 (`-n 50`) |
| `claude-warmup doctor` | 설치 상태 점검 |

### 설정

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `hours` | `always` | 핑을 보낼 시간대. `06:00-23:00`, 자정을 넘기는 `22:00-02:00` 도 가능 |
| `days` | `everyday` | `weekdays`, `weekends`, `mon,wed,fri`, `월-금` |
| `model` | `haiku` | 핑에 쓸 모델 (`default` = Claude Code 기본 모델) |
| `message` | `hi` | 핑 메시지 |
| `interval` | `5` | 백그라운드 확인 주기(분). 바꾼 뒤 `install` 을 다시 실행하세요 |
| `claudePath` | 자동 | `claude` CLI 경로 |
| `lang` | 자동 | `en` / `ko` |

**추천 설정**: 보통 9시에 일을 시작한다면 6시부터 핑이 나가게 해 두세요. 6시에 시작된 창이 11시에 리셋되고, 그다음부터는 끝날 때마다 바로 이어집니다.

```bash
claude-warmup config hours 06:00-23:00
```

### 메뉴 막대 / tmux

`claude-warmup status --short` 는 `23% · 2시간 17분 남음 · 주간 41%` 같은 한 줄을 출력합니다.
[SwiftBar](https://github.com/swiftbar/SwiftBar)나 tmux 상태줄에 넣어 쓰세요. 자주 새로고침한다면 `--cached` 를 붙이면 claude를 호출하지 않습니다.

## 서버에서 돌리기

claude-warmup은 설치된 컴퓨터가 켜져 있을 때만 핑을 보낼 수 있습니다. 컴퓨터를 하루 종일 켜 둘 수 없다면 항상 켜져 있는 작은 Linux 서버에 설치하세요. 무료 클라우드 서버(Oracle Cloud의 Always Free 등), 저렴한 VPS, 64비트 OS를 쓰는 라즈베리파이 모두 됩니다. 사용 창은 계정 단위라서 어느 기기에서 핑을 보내든 똑같이 동작합니다.

1. Linux 서버를 만들고 SSH로 접속합니다. Ubuntu 22.04/24.04, Debian 12, Oracle Linux 8/9 모두 되고, 메모리는 1GB면 충분합니다.
2. 서버에서 설치 스크립트를 내려받아 실행합니다.

```bash
curl -fsSLO https://raw.githubusercontent.com/jungtaejoon/claude-warmup/main/scripts/server-setup.sh
```

```bash
bash server-setup.sh --timezone Asia/Seoul --lang ko
```

스크립트가 필요한 것(Node.js, Claude Code CLI, claude-warmup)을 `~/.local`에 설치하고, 로그인을 안내한 뒤 systemd 타이머를 켭니다. 나중에 다시 실행하면 최신 버전으로 업데이트됩니다.

- **브라우저 없이 로그인:** 스크립트가 보여 주는 링크를 내 컴퓨터 브라우저에서 열어 승인하고, 화면에 나온 코드를 SSH 창에 붙여 넣으면 됩니다.
- **시간대:** 클라우드 서버는 보통 UTC 시간으로 돌아갑니다. `--timezone`을 주면 서버 시계를 내 시간대로 맞춰서, `hours` 설정과 `status`에 나오는 시각이 내 하루와 맞게 됩니다.
- **다른 옵션:** `--hours 06:00-23:00`(핑을 보낼 시간대), `--lang ko`, `--skip-login`
- **로그아웃한 뒤에도:** 스크립트가 `loginctl enable-linger`를 켜 두므로, SSH 접속을 끊어도 타이머가 계속 돕니다.
- **Oracle Cloud 무료 티어:** Oracle은 일주일 동안 거의 쓰이지 않은 Always Free 서버를 회수할 수 있는데, 워밍업 서버는 대부분의 시간 동안 쉬고 있습니다. 계정을 Pay As You Go로 업그레이드하는 것이 일반적인 해결책이고, 업그레이드해도 Always Free 자원은 계속 무료입니다.
- **내 컴퓨터:** 내 컴퓨터에 설치한 claude-warmup은 그대로 둬도 됩니다. 둘 다 같은 계정 사용량을 보고 판단합니다. 끄려면 `claude-warmup uninstall`을 실행하세요.

## 알아 둘 점

- **컴퓨터가 잠자기 중이면 핑을 보낼 수 없습니다.** 깨어나면 바로 확인합니다. 컴퓨터를 항상 켜 둘 수 없다면 [서버에서 돌리기](#서버에서-돌리기)를 참고하세요. Mac을 출근 전에 자동으로 깨우려면:
  ```bash
  sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00
  ```
- macOS에서 설치하면 "node가 백그라운드 항목을 추가함" 알림이 뜹니다. 시스템 설정 → 일반 → 로그인 항목에서 확인할 수 있습니다.
- Linux에서 로그아웃 상태에도 돌리려면 `loginctl enable-linger $USER` 를 실행하세요. systemd 사용자 세션이 없으면 crontab 으로 자동 대체합니다.
- Windows 지원은 작업 스케줄러 + 창이 뜨지 않는 VBScript 실행기를 씁니다. 테스트는 CI에서 Windows로도 돌지만, 작업 스케줄러 등록 자체는 아직 실제 PC에서 많이 써 보지 않았으니 문제가 있으면 이슈로 알려 주세요.
- `/usage` 구조화 출력(`usage_report`)은 Claude Code에서 실험적 기능입니다. 형식이 바뀌면 텍스트 파싱으로, 그것도 안 되면 핑 응답의 리셋 시각이나 5시간 추정치로 계속 동작합니다.

## FAQ

**한도가 늘어나나요?**
아니요. 같은 한도를 내가 일하는 시간에 더 유리하게 배치할 뿐입니다.

**약관상 괜찮나요?**
본인 계정으로 공식 Claude Code CLI의 `-p`(헤드리스) 모드를 쓰는 아주 작은 요청입니다. 그래도 [Anthropic 이용 약관](https://www.anthropic.com/legal/consumer-terms)과 사용 정책은 각자 확인하고 판단해 주세요.

**제거하려면?**

```bash
claude-warmup uninstall --purge
```

```bash
npm uninstall -g claude-warmup
```

## 개발

```bash
npm test
```

의존성은 없습니다. 테스트는 `test/fixtures/fake-claude.mjs` (Claude Code의 stream-json 출력을 흉내 내는 가짜 CLI)로 돌아가서, 실제 사용량을 쓰지 않습니다.

---

Anthropic과 관계없는 비공식 프로젝트입니다. "Claude"는 Anthropic의 상표입니다. MIT License.
