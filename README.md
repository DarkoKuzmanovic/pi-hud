# pi-hud

A configurable terminal HUD for [Pi](https://github.com/earendil-works/pi-coding-agent). It shows provider quota, session stats, git state, extension statuses, model/context info, and an optional mascot in Pi's TUI.

## Contents

- [What it shows](#what-it-shows)
  - [Header](#header)
  - [Shelf and mascot](#shelf-and-mascot)
  - [Footer](#footer)
- [Supported providers](#supported-providers)
- [Install](#install)
- [Configuration](#configuration)
  - [Layout file](#layout-file)
  - [Blocks](#blocks)
  - [Mascots](#mascots)
- [Usage](#usage)
  - [Slash commands](#slash-commands)
  - [Keyboard shortcut](#keyboard-shortcut)
- [How it works](#how-it-works)
- [Known conflicts](#known-conflicts)
- [Requirements](#requirements)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## What it shows

pi-hud renders three UI surfaces:

### Header

A session-start header with gradient Pi ASCII art, greeting text, quota summary, session details, and shortcut hints.

### Shelf and mascot

An above-editor shelf (`ctx.ui.setWidget("hud-shelf", ...)`) with configurable rows on the left and an optional mascot on the right.

Default shelf rows:

| Row | Blocks |
| --- | --- |
| 1 | `tokens`, `cost` |
| 2 | `branch`, `dirty`, `commit`, `sync` |

The mascot uses Kitty graphics when available, falls back to ASCII, and can be disabled. The shipped mascot styles are `teal-ghost` and `cute-robot`; the robot uses `assets/robot-spritesheet.png`.

### Footer

A persistent footer (`ctx.ui.setFooter`) below the editor. The default main line is:

| Left | Right |
| --- | --- |
| `cwd`, `model`, `thinking`, `context` | `quota`, `speed` |

Additional full-width rows can be configured with `footer.extraRows`. By default pi-hud renders `extStatuses` there, so native extension statuses such as pi-pulse's `tps` status can appear below the main footer without another extension taking footer ownership.

## Supported providers

| Provider | Auth method | Quota windows |
| --- | --- | --- |
| **Codex** (OpenAI) | OAuth in `~/.pi/agent/auth.json` | 5h, week |
| **Anthropic** (Claude) | OAuth in `~/.pi/agent/auth.json` | 5h, week |
| **Ollama Cloud** | Firefox session cookies | Session, weekly |
| **OpenCode** | Firefox session cookies | Rolling, weekly, monthly |
| **MiniMax** | API key in `~/.pi/agent/auth.json` or `MINIMAX_API_KEY` | 5h, week |
| **Umans** | OAuth/API key in `~/.pi/agent/auth.json` or `UMANS_API_KEY` | Rolling |
| **Z.AI** | OAuth/API key in `~/.pi/agent/auth.json` or `ZAI_API_KEY` | 5h, week |

Unsupported providers degrade to a quiet unsupported-provider state instead of throwing.

## Install

```shell
pi install git:github.com/DarkoKuzmanovic/pi-hud
```

Then restart Pi.

## Configuration

### Layout file

On first run, pi-hud creates a JSONC layout file at:

```text
~/.pi/agent/pi-hud.layout.jsonc
```

Edit it, then run `/hud reload` to apply layout changes. Code or asset changes still require a Pi restart.

Current default layout:

```jsonc
{
  "separator": " · ",
  "sprite": {
    "enabled": true,
    "mode": "auto",        // "auto" | "ascii" | "off"
    "mascot": "teal-ghost", // "teal-ghost" | "cute-robot"
    "widthCells": 10,
    "heightCells": 5
  },
  "shelf": {
    "enabled": true,
    "rows": [
      ["tokens", "cost"],
      ["branch", "dirty", "commit", "sync"]
    ]
  },
  "footer": {
    "enabled": true,
    "left": ["cwd", "model", "thinking", "context"],
    "right": ["quota", "speed"],
    "extraRows": [["extStatuses"]]
  }
}
```

`/hud reload` now surfaces warning-only validation issues such as unknown block ids, malformed rows, empty separators, and invalid sprite settings. Validation never rewrites the file.

### Blocks

Run `/hud blocks` for the authoritative block list. Current block ids:

```text
project, folder, model, thinking, context, statusDot, tokens, cost,
runDuration, speed, cwd, branch, dirty, commit, sync, sessionId,
quota, extStatuses, ext:<key>
```

`ext:<key>` renders one specific `ctx.ui.setStatus()` entry, for example `ext:tps`.

### Mascots

`config.sprite.mode` controls rendering:

| Mode | Behavior |
| --- | --- |
| `auto` | Kitty image when supported, ASCII fallback otherwise |
| `ascii` | Force ASCII fallback |
| `off` | Hide the mascot |

`config.sprite.mascot` supports:

| Mascot | Notes |
| --- | --- |
| `teal-ghost` | Procedural terminal ghost fallback/default |
| `cute-robot` | Spritesheet-backed robot from `assets/robot-spritesheet.png` |

## Usage

### Slash commands

```text
/hud status      Show cached provider auth/quota status
/hud on          Enable HUD rendering
/hud off         Disable HUD rendering
/hud refresh     Force-refresh active provider quota data
/hud reload      Re-read ~/.pi/agent/pi-hud.layout.jsonc
/hud layout      Show the layout file path
/hud blocks      List supported layout blocks
/hud validate    Validate the on-disk layout without mutating it
/hud doctor      Show local diagnostics for auth, sqlite3, Firefox cookies, UI handles, layout, providers, and sprite asset
/hud theme       List themes
/hud theme NAME  Set the next-session theme
/hud ascii       Toggle ASCII icon mode
```

`HUD_ICONS=none` starts pi-hud in ASCII icon mode for terminals with weak icon/font coverage.

### Keyboard shortcut

- **Ctrl+`** — opens [gitui](https://github.com/extrawurst/gitui) in a Kitty overlay. Requires `allow_remote_control yes` in `kitty.conf`.

## How it works

- Registers a footer renderer with `ctx.ui.setFooter()`.
- Registers a session-start header with `ctx.ui.setHeader()`.
- Registers an above-editor shelf with `ctx.ui.setWidget("hud-shelf", ...)`.
- Uses a declarative block registry (`render/blocks.ts`) so shelf/footer layout can be rearranged without code changes.
- Fetches provider quota asynchronously with one in-flight request per provider.
- Refreshes quota only when cached provider data is stale, and re-renders only when visible data changes.
- Refreshes git status asynchronously and only re-renders when git state changes.
- Tracks live token throughput from assistant stream deltas, throttled to avoid excessive TUI redraws.
- Reads Firefox cookies from a temp copy of `cookies.sqlite` because Firefox locks the live DB.
- Reads Pi auth from `~/.pi/agent/auth.json` and provider API-key environment variables.
- `/hud doctor` is command-path-only: it performs bounded local checks and does not refresh providers or make network calls.

## Known conflicts

Only one extension can own Pi's built-in footer at a time. If another extension calls `ctx.ui.setFooter()`, whichever extension loads last wins.

For extension presence/status display, prefer `ctx.ui.setStatus("key", "text")`; pi-hud can surface those statuses through `extStatuses` or `ext:<key>` blocks without creating a footer-ownership conflict.

## Requirements

- Pi with TUI support (`ctx.hasUI`).
- `sqlite3` CLI for Firefox-cookie providers (Ollama Cloud, OpenCode).
- Firefox profile with cookies for cookie-based providers.
- Kitty terminal for image mascots and the Ctrl+` gitui overlay. Non-Kitty terminals use ASCII mascot fallback.

## Troubleshooting

- Run `/hud doctor` for local diagnostics: auth presence, `sqlite3`, Firefox profile detection, registered surfaces, layout status, provider cached state, and robot sprite asset presence.
- Run `/hud validate` before `/hud reload` if a layout edit did not render as expected.
- Run `/hud blocks` when adding or moving layout blocks.
- Restart Pi after changing extension code or packaged assets.
- Use `/hud reload` for layout-only changes.

## License

MIT
