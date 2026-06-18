# pi-hud

A status HUD for [Pi](https://github.com/earendil-works/pi-coding-agent) that displays provider quota, session stats, git status, and model info in the terminal footer and header.

## What it shows

### Footer (always visible)

| Left side | Right side |
|---|---|
| 📂 Project name + path | Context window usage |
| Git branch + dirty state | Token counts (↑in ↓out) |
| 🤖 Active model | Run duration + tok/s speed |
| Thinking level chip | Provider quota bar |

A second line shows git sync status (ahead/behind), last commit, and extension statuses.

### Header (on session start)

Gradient Pi ASCII art alongside a greeting, quota breakdown, session details, and keyboard shortcut hints.

## Supported providers

| Provider | Auth method | Quota windows |
|---|---|---|
| **Codex** (OpenAI) | OAuth (`~/.pi/agent/auth.json`) | 5h, 7d |
| **Anthropic** (Claude) | OAuth (`~/.pi/agent/auth.json`) | 5h, 7d |
| **Ollama Cloud** | Firefox session cookies | Session, Weekly |
| **OpenCode** | Firefox session cookies | Rolling, Weekly, Monthly |
| **MiniMax** | API key (`~/.pi/agent/auth.json` or `MINIMAX_API_KEY`) | 5h, 7d |
| **Umans** | API key (`~/.pi/agent/auth.json` or `UMANS_API_KEY`) | Rolling (5h) |
| **Z.AI** | API key (`~/.pi/agent/auth.json` or `ZAI_API_KEY`) | 5h, 7d |

## Install

```shell
pi install git:github.com/DarkoKuzmanovic/pi-hud
```

Then restart Pi.

## Usage

### Slash commands

```
/hud status    — show provider auth/quota status
/hud on        — enable HUD
/hud off       — disable HUD
/hud refresh   — force-refresh quota data
```

### Keyboard shortcut

- **Ctrl+`** — opens [gitui](https://github.com/extrawurst/gitui) in a Kitty overlay (requires `allow_remote_control yes` in `kitty.conf`)

## How it works

- Registers a **footer** renderer via `ctx.ui.setFooter()` that redraws every second
- Registers a **header** renderer via `ctx.ui.setHeader()` shown on session start
- Fetches provider quota asynchronously with deduplication (one in-flight request per provider)
- Reads Firefox cookies via `sqlite3` on a temp copy of `cookies.sqlite` (Firefox locks the live DB)
- Reads Pi auth from `~/.pi/agent/auth.json` for OAuth-based providers (Codex, Anthropic) and API-key providers (MiniMax, Umans, Z.AI)
- Polls git status (`git status --porcelain`, `git rev-list`, `git log`) every 5 seconds
- Tracks token throughput live from assistant stream deltas and final usage metadata
- Optionally integrates with Palimpsest (quest/instinct progress via event bus)

## Requirements

- Pi with TUI support (`ctx.hasUI`)
- `sqlite3` CLI — for reading Firefox cookies (Ollama, OpenCode)
- Firefox — for cookie-based providers (optional, OAuth providers work without it)
- [Kitty](https://sw.kovidgoyal.net/kitty/) terminal — for Ctrl+` gitui overlay (optional)

## License

MIT
