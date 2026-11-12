# claude-warmup

[![CI](https://github.com/jungtaejoon/claude-warmup/actions/workflows/ci.yml/badge.svg)](https://github.com/jungtaejoon/claude-warmup/actions/workflows/ci.yml)

**English** · [한국어](README.ko.md) · [Website](https://jungtaejoon.github.io/claude-warmup/)

A tiny tool that **keeps a Claude (Pro/Max) 5-hour usage window always running**, so your first message never starts a full 5-hour wait for the Claude usage limit to reset.
A background check runs every few minutes, and only when no session window is active does it send one very short message ("hi", on haiku) through the official `claude` CLI.
It also shows your current session and weekly usage, with reset times.

```
$ claude-warmup
Claude Warmup v0.3.0

Usage  checked 08:42 · claude /usage
  Current session (5h)  █████░░░░░░░░░░░░░░░  23%  resets 11:00 (in 2h 17m)
  Weekly · all models   ████████░░░░░░░░░░░░  41%  resets Tue 10:00
  Weekly · Sonnet       █░░░░░░░░░░░░░░░░░░░   7%  resets Tue 10:00

Auto warm-up
  Status      ● on (launchd, checks every 5 min)
  Schedule    all day · every day
  Last ping   06:00 ✓ haiku-5-5 · window until 11:00
  Next ping   ~11:00, right after the current window resets
```

## Why

Claude's session limit runs in **5-hour windows that start with the first message after the last window ended** ([help center](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)).
If nothing is running when you sit down, your own first message starts the full 5 hours. claude-warmup starts a new window the moment the last one ends, so a window is always already running: whenever you start, part of the 5 hours has passed and the next reset is closer.

```
No warm-up      09:00 ──────────── work ──────────── 14:00 reset
                (your first message at 9 starts the full 5 hours)

claude-warmup   06:00 ─ ping ─ 09:00 ─ work ─ 11:00 reset ─ work ─ 16:00 reset ─ 21:00 reset
                (windows run back to back: start at 9 → reset at 11; start at 13 → reset at 16)
```

- It does not raise your limits. You just stop starting from a full 5-hour wait. On average the next reset is about 2.5 hours away instead of 5.
- The weekly limit is separate and resets at a fixed time. One haiku "hi" barely touches it.

## What makes it different

You can also warm up the window with a fixed-time cron job or a hosted CI runner. claude-warmup asks for less trust and less guessing:

| | claude-warmup | Fixed-time cron or CI job |
| --- | --- | --- |
| Where it runs | Your own computer or server | Often a hosted runner, with your Claude token copied into its secrets |
| Your credentials | Never read or copied; the official `claude` CLI keeps them | Token has to be exported and stored elsewhere |
| When it pings | Only when no window is open, checked every 5 minutes | At fixed times, even if a window is already running |
| Cost of a check | 0 tokens (local `/usage`) | Each run is a real message |
| Usage view | Session, weekly and per-model usage with reset times | None |

## How it works

1. The OS scheduler (macOS launchd, Linux systemd or cron, Windows Task Scheduler) runs `claude-warmup tick` every N minutes (default 5).
2. If the last known window is still running, the tick **does nothing** and exits: no claude call.
3. Otherwise it reads usage with `claude -p /usage`. That is a **local Claude Code command: it uses no quota** (0 tokens, $0).
4. Only when no window is active does it send the warm-up:
   `claude -p "hi" --model haiku --tools "" --system-prompt "…" --safe-mode --no-session-persistence`
   It is a minimal request with tools, MCP servers, hooks and CLAUDE.md turned off, and no session is saved.
5. It records the new window's reset time from the reply's `rate_limit_event` and sleeps until then.

So "every 5 hours" follows **the real end of each window**, not a wall clock. If you start a window yourself by using Claude, it adapts.

### Security

- claude-warmup **never reads your Claude credentials**. The official `claude` CLI does all the auth.
- API-key variables such as `ANTHROPIC_API_KEY` are removed from the child process, so pings always count against your subscription and never bill an API key.
- Zero-dependency Node.js, small enough to read in one sitting.

## Requirements

- Node.js 18+
- The [Claude Code](https://code.claude.com/docs/en/setup) CLI, **logged in with a Pro/Max subscription**:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

```bash
claude auth login
```

> If you only use the Claude desktop app, claude-warmup can find the Claude Code copy bundled inside it, but a standalone install is sturdier across updates.

## Install

```bash
npm install -g github:jungtaejoon/claude-warmup
```

```bash
claude-warmup install
```

Or run it straight away without a global install. `install` copies the app into its data folder and the service runs that copy, so it keeps working after the npx cache is cleared.

```bash
npx github:jungtaejoon/claude-warmup install
```

## Usage

| Command | What it does |
| --- | --- |
| `claude-warmup` / `status` | Usage and schedule (`--json`, `--short`, `--cached`) |
| `claude-warmup install` | Turn on auto warm-up |
| `claude-warmup uninstall` | Turn it off (`--purge` also deletes settings and logs) |
| `claude-warmup ping` | Send a warm-up now |
| `claude-warmup config` | Show settings; `config <key> <value>` changes one |
| `claude-warmup logs` | Recent activity (`-n 50`) |
| `claude-warmup doctor` | Check your setup |

### Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `hours` | `always` | When pings may be sent: `06:00-23:00`, or overnight like `22:00-02:00` |
| `days` | `everyday` | `weekdays`, `weekends`, `mon,wed,fri`, `mon-fri` |
| `model` | `haiku` | Model for the ping (`default` = Claude Code's default) |
| `message` | `hi` | Text of the ping |
| `interval` | `5` | Minutes between background checks; run `install` again after changing it |
| `claudePath` | auto | Path to the `claude` CLI |
| `lang` | auto | `en` / `ko` |
| `peak` | off | Your busiest time, e.g. `14:00` or `11:30 weekdays`: windows line up so one resets right then ([peak time](#peak-time)) |
| `gap` | — | With a peak: a time to leave without a window, e.g. `03:00` (required for the peak) |

**Suggested setup**: set the hours you want windows kept running, for example from early morning to late night. Inside those hours each window starts right as the last one ends.

```bash
claude-warmup config hours 06:00-23:00
```

### Peak time

If you keep regular hours, your busiest time is probably the same every day. Set it, and the windows line up so one **resets right at that time**:

```bash
claude-warmup config peak 11:30 weekdays   # or just 14:00 for every day
claude-warmup config gap 03:00             # where to leave the 4 empty hours (required)
```

**Why a gap?** A day is 24 hours and a window is 5, so four windows fill 20 hours and 4 hours are left with no window. Lining windows up with the peak can't hide that, so you choose where the empty hours go: any time inside the gap you want. For a peak at 11:30 the gap can be 11:30–15:30, 16:30–20:30, 21:30–01:30, 02:30–06:30 or 07:30–11:30. `config gap 03:00` picks 02:30–06:30, and windows then run 06:30–11:30–16:30–21:30–02:30. Until a gap is set, the peak is not applied.

- Pings go out only at those window starts (inside your `hours`). Off them it waits rather than open a window that would end at the wrong time. Waiting costs nothing.
- If you start a window yourself at another time, it can't be moved. When it ends, claude-warmup waits for the next aligned time and lines up again.
- Days are optional: `11:30 weekdays`, `mon,wed,fri`, `mon-fri`. Aligning starts within a day of each peak; the rest of the time (say, a weekend) a new window starts as soon as the last one ends.
- `claude-warmup config peak off` turns it off.

### Menu bar / tmux

`claude-warmup status --short` prints one line such as `23% · 2h 17m left · week 41%`.
Use it in [SwiftBar](https://github.com/swiftbar/SwiftBar) or a tmux status line. Add `--cached` for frequent refreshes: it skips the claude call.

## Run it on a server

Pings only go out while the computer running claude-warmup is on. If yours isn't on all day, put claude-warmup on a small always-on Linux machine instead: a free cloud VM (Oracle Cloud's Always Free tier works), a cheap VPS, or a Raspberry Pi with a 64-bit OS. The usage window belongs to your account, so it does not matter which machine sends the ping.

1. Create a Linux server and connect to it with SSH. Ubuntu 22.04/24.04, Debian 12 and Oracle Linux 8/9 all work, and 1 GB of memory is plenty.
2. Download and run the setup script on the server:

```bash
curl -fsSLO https://raw.githubusercontent.com/jungtaejoon/claude-warmup/main/scripts/server-setup.sh
```

```bash
bash server-setup.sh --timezone Asia/Seoul
```

The script installs whatever is missing into `~/.local` (Node.js, the Claude Code CLI, claude-warmup), asks you to log in, and turns on the systemd timer. Run it again later to update.

- **Logging in without a browser:** open the link it prints in a browser on your own computer, approve, and paste the code back into the SSH session.
- **Time zone:** cloud servers usually run on UTC. `--timezone` sets the server's clock to your time zone, so `hours` and the times in `status` match your day.
- **More options:** `--hours 06:00-23:00` (when pings may go out), `--lang ko`, `--skip-login`.
- **After you log out:** the script turns on `loginctl enable-linger`, so the timer keeps running after you disconnect.
- **Oracle Cloud's free tier:** Oracle may reclaim Always Free instances that stay idle for a week, and a warm-up server is idle nearly all the time. Upgrading the account to Pay As You Go is the usual way to avoid that, and Always Free resources stay free of charge.
- **Your own computer:** you can leave claude-warmup installed there too, since both read the same account usage, or turn it off with `claude-warmup uninstall`.

## Good to know

- **Nothing runs while the computer sleeps.** It checks as soon as it wakes up. If your computer isn't on all day, [run it on a server](#run-it-on-a-server). To wake a Mac before work:
  ```bash
  sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00
  ```
- On macOS you will see a "node added items that can run in the background" notification. It is listed in System Settings → General → Login Items.
- On Linux, run `loginctl enable-linger $USER` to keep it running while logged out. Without a systemd user session it falls back to crontab.
- Windows uses Task Scheduler plus a VBScript launcher so no console window flashes. The test suite runs on Windows in CI, but the scheduled task itself has had little real-world use yet, so please open an issue if something is off.
- The structured `/usage` output (`usage_report`) is experimental in Claude Code. If its shape changes, claude-warmup falls back to parsing the text, then to the reset time in the ping reply, then to a 5-hour estimate.

## FAQ

**Does this give me more usage?**
No. The same limits, placed better for your working hours.

**Is this allowed?**
It is a tiny request made with your own account through the official Claude Code CLI in `-p` (headless) mode. Still, read [Anthropic's terms](https://www.anthropic.com/legal/consumer-terms) and usage policy and decide for yourself.

**How do I remove it?**

```bash
claude-warmup uninstall --purge
```

```bash
npm uninstall -g claude-warmup
```

## Development

```bash
npm test
```

No dependencies. Tests run against `test/fixtures/fake-claude.mjs`, a stand-in CLI that mimics Claude Code's stream-json output, so they never use real quota.

---

Unofficial project, not affiliated with Anthropic. "Claude" is a trademark of Anthropic. MIT License.
