# claude-warmup

**English** · [한국어](README.ko.md)

A tiny tool that **starts your Claude (Pro/Max) 5-hour usage window early**.
A background check runs every few minutes, and only when no session window is active does it send one very short message ("hi", on haiku) through the official `claude` CLI.
It also shows your current session and weekly usage, with reset times.

```
$ claude-warmup
Claude Warmup v0.1.0

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

Claude's session limit runs in **5-hour windows that start with your first message** ([help center](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)).
Open the window before you start working, and your limit resets sooner while you are in the middle of things.

```
No warm-up      09:00 ──────────── work ──────────── 14:00 reset
                (first message at 9 → reset at 14)

Warm-up 06:00   06:00 ── ping ── 09:00 ── work ── 11:00 reset ── work ── 16:00 reset
                (one window for 9–11, then a fresh one at 11)
```

- It does not raise your limits. It only lines the resets up with your working hours.
- The weekly limit is separate and resets at a fixed time. One haiku "hi" barely touches it.

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

**Suggested setup**: if you usually start at 9, let pings start at 6. The 6:00 window resets at 11:00, and from then on each window starts right as the last one ends.

```bash
claude-warmup config hours 06:00-23:00
```

### Menu bar / tmux

`claude-warmup status --short` prints one line such as `23% · 2h 17m left · week 41%`.
Use it in [SwiftBar](https://github.com/swiftbar/SwiftBar) or a tmux status line. Add `--cached` for frequent refreshes: it skips the claude call.

## Good to know

- **Nothing runs while the computer sleeps.** It checks as soon as it wakes up. To wake a Mac before work:
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
