# pi-hud

A configurable terminal HUD for [Pi](https://github.com/earendil-works/pi-coding-agent). It shows provider quota, session stats, git state, extension statuses, and model/context info in Pi's TUI.

## Contents

- [What it shows](#what-it-shows)
  - [Header](#header)
  - [Footer](#footer)
- [Supported providers](#supported-providers)
- [Install](#install)
- [Configuration](#configuration)
  - [Layout file](#layout-file)
    - [Chip styling](#chip-styling)
    - [Input-box skins](#input-box-skins)
  - [Blocks](#blocks)
- [Usage](#usage)
  - [Slash commands](#slash-commands)
- [How it works](#how-it-works)
- [Known conflicts](#known-conflicts)
- [Requirements](#requirements)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## What it shows

pi-hud renders two UI surfaces:

### Header

A session-start header with gradient Pi ASCII art, greeting text, quota summary, session details, and shortcut hints.

### Footer

A persistent footer (`ctx.ui.setFooter`) below the editor. The default main line is:

| Left | Right |
| --- | --- |
| `cwd`, `model`, `thinking`, `ext:model-prompts`, `context` | `quota`, `speed` |

Additional full-width rows can be configured with `footer.extraRows`. By default pi-hud renders three: `tokens`/`cost`, `branch`/`dirty`/`commit`/`sync`, and `extStatuses` — so native extension statuses such as pi-pulse's `tps` status can appear below the main footer without another extension taking footer ownership.

Each entry in `extraRows` is either a flat array of block ids (left-only, full-width) or an object `{"left": [...], "right": [...]}` to split the row into left/right halves like the main footer line — useful for, say, anchoring `branch` to the left and `cwd` to the right of the same row.

## Supported providers

| Provider | Auth method | Quota windows |
| --- | --- | --- |
| **Codex** (OpenAI) | OAuth in `~/.pi/agent/auth.json` | 5h, week |
| **Anthropic** (Claude) | OAuth in `~/.pi/agent/auth.json` | 5h, week |
| **MiniMax** | API key in `~/.pi/agent/auth.json` or `MINIMAX_API_KEY` | 5h, week |
| **Umans** | OAuth/API key in `~/.pi/agent/auth.json` or `UMANS_API_KEY` | Rolling |

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
  "machineName": {
    "source": "hostname"
    // "label": "darko-laptop"
  },
  "footer": {
    "enabled": true,
    "left": ["cwd", "model", "thinking", "ext:model-prompts", "context"],
    "right": ["quota", "speed"],
    "extraRows": [
      ["tokens", "cost"],
      ["branch", "dirty", "commit", "sync"],
      ["extStatuses"]
    ]
  },
  "chips": ["project", "folder", "model", "thinking", "context", "ext:model-prompts", "quota"],
  // Input-box skin: "default" | "marker" | "border" | "bracket" | "pill" | "double"
  "editor": "marker",
  "editorPadding": { "top": 0, "bottom": 0 }
}
```


`machineName.source` selects the label shown by the `project` block: `"hostname"` uses Node's local OS hostname, while `"tailscale"` reads `Self.HostName` from `tailscale status --json`. Tailscale lookup failures fall back to the OS hostname. Set a non-empty `machineName.label` to override either source. Machine-name resolution is cached outside the footer render path and refreshed by `/hud reload`.

`/hud reload` surfaces warning-only validation issues such as unknown block ids, malformed rows, and empty separators. `/hud validate` checks the JSONC file without reloading, `/hud blocks` lists block descriptions, and validation never rewrites the file.

> **Upgrading from an older layout file?** Versions of pi-hud before this release rendered an above-editor shelf (with an optional mascot) via a separate `shelf`/`sprite` config block. That widget has been removed — `footer.extraRows` is now the only row-based surface. If your on-disk layout file still has a `shelf` key, pi-hud automatically folds those rows into `footer.extraRows` at load time (so you won't lose previously-visible rows), and `/hud validate`/`/hud reload` will flag the legacy `shelf`/`sprite` keys as deprecated. Edit the file to remove them once you're happy with the result — pi-hud never rewrites the file for you.

#### Chip styling

The top-level `chips` array controls which blocks render with chip-style brackets (Powerline brackets + inverse background) in the footer.

| Value | Behavior |
| --- | --- |
| omitted / not present | Default chip set: `["project", "folder", "model", "thinking", "context", "quota"]` |
| `[]` | Disable chip styling entirely — every block renders plain. |
| explicit list | Replace the default set; only the listed ids render as chips. |

Examples:

```jsonc
// Opt a few plain blocks into chip styling:
"chips": ["tokens", "cost", "branch", "dirty", "speed"]

// Mix defaults with a specific extension status:
"chips": ["model", "context", "ext:tps"]
```

`ext:<key>` is accepted whenever the referenced extension status is registered. `/hud validate` reports unknown ids in `chips` the same way it does for footer rows.

#### Input-box skins

The top-level `editor` key selects how the prompt input box is drawn:

| Value | Look |
| --- | --- |
| `default` | Stock Pi editor (no custom component) |
| `marker` | Left `▌` gutter + `userMessageBg` (pi-hud default) |
| `border` | Keep the `─` box; put model/thinking/ctx/cwd into the frame |
| `bracket` | Sharp box-drawing frame (`┌─┐` / `│` / `└─┘`) |
| `pill` | Rounded box-drawing frame (`╭─╮` / `│` / `╰─╯`) |
| `double` | Heavy double-line frame (`╔═╗` / `║` / `╚═╝`) |

Change it in the layout file and `/hud reload`, or live with `/hud editor <name>` (also persists to the layout file).

`editorPadding` adds blank lines above and/or below the input box (integers `0..8`, default `{ "top": 0, "bottom": 0 }`). A single number sets both sides (`"editorPadding": 1`).



### Blocks

Run `/hud blocks` for the authoritative block list. Current block ids:

```text
project, folder, model, thinking, context, statusDot, tokens, cost,
runDuration, speed, cwd, branch, dirty, commit, sync, sessionId, sessionName,
quota, extStatuses, ext:<key>
```

`ext:<key>` renders one specific `ctx.ui.setStatus()` entry, for example `ext:tps`.

`sessionName` renders the current Pi session display name set by `/name` or `pi --name`; it renders nothing when the session is unnamed.

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
/hud editor      List input-box skins (* marks active)
/hud editor NAME Switch skin and save to layout
/hud theme       List themes
/hud theme NAME  Set the next-session theme
/hud ascii       Toggle ASCII icon mode
```

`HUD_ICONS=none` starts pi-hud in ASCII icon mode for terminals with weak icon/font coverage.

## How it works

- Registers a footer renderer with `ctx.ui.setFooter()`.
- Registers a session-start header with `ctx.ui.setHeader()`.
- Optionally replaces the input editor via `ctx.ui.setEditorComponent()` (`editor` layout key: default/marker/border/bracket/pill/double).
- Uses a declarative block registry (`render/blocks.ts`) so footer layout can be rearranged without code changes.
- Fetches provider quota asynchronously with one in-flight request per provider.
- Refreshes quota only when cached provider data is stale, and re-renders only when visible data changes.
- Refreshes git status asynchronously and only re-renders when git state changes.
- Tracks live token throughput from assistant stream deltas, throttled to avoid excessive TUI redraws.
- Reads Pi auth from `~/.pi/agent/auth.json` and provider API-key environment variables.

## Known conflicts

Only one extension can own Pi's built-in footer at a time. If another extension calls `ctx.ui.setFooter()`, whichever extension loads last wins.

For extension presence/status display, prefer `ctx.ui.setStatus("key", "text")`; pi-hud can surface those statuses through `extStatuses` or `ext:<key>` blocks without creating a footer-ownership conflict.

## Requirements

- Pi with TUI support (`ctx.hasUI`).

## Troubleshooting

- Run `/hud validate` before `/hud reload` if a layout edit did not render as expected.
- Run `/hud blocks` when adding or moving layout blocks.
- Restart Pi after changing extension code or packaged assets.
- Use `/hud reload` for layout-only changes.

## License

MIT
