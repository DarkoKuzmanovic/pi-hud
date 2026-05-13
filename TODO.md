# pi-hud — TODO

Tracking inspirations, refactors, and known gaps.

---

## Inspirations from other extensions

Ideas worth lifting, ranked by leverage. Sourced from a 2026-05-13 comparison
with [`@heyhuynhgiabuu/pi-pretty`](https://pi.dev/packages/@heyhuynhgiabuu/pi-pretty)
(different problem domain — tool output rendering — but several stylistic moves
transfer cleanly to a status HUD).

### 1. Env-var config layered with `settings.json`

pi-pretty exposes `PRETTY_THEME`, `PRETTY_MAX_HL_CHARS`, `PRETTY_MAX_PREVIEW_LINES`,
`PRETTY_CACHE_LIMIT`, `PRETTY_ICONS`, with documented precedence
(env → `settings.json` → built-in default).

pi-hud equivalents to add:

- `HUD_REFRESH_SEC` — footer redraw interval (currently hardcoded ~1s)
- `HUD_GIT_POLL_SEC` — git poll interval (currently hardcoded 5s)
- `HUD_PROVIDERS` — comma-separated allowlist (e.g. `anthropic,codex` to skip
  cookie-based providers entirely)
- `HUD_DISABLE_PALIMPSEST` — skip event-bus integration when Palimpsest isn't installed
- `HUD_ICONS=none` — degrade emoji glyphs for terminals with poor font coverage

### 2. `/hud doctor` diagnostic command

pi-pretty has `/fff-health` for indexing diagnostics. pi-hud's `/hud status`
shows quotas — but when a row blanks out, there's no signal as to *why*.

A `/hud doctor` command should print:

- `auth.json` present + providers detected
- `sqlite3` binary present + version
- Firefox cookies DB path + readable + last-modified
- Per-provider: last fetch timestamp, last error, in-flight dedup state
- `ctx.hasUI` true/false
- Palimpsest event bus subscribed yes/no
- Footer/header renderer registered yes/no

Single biggest UX improvement for a multi-provider quota tool.

### 3. Namespaced cache directory: `~/.pi/agent/pi-hud/`

pi-pretty stores FFF data under `~/.pi/agent/pi-pretty/fff/` with the explicit
rationale that it belongs to the extension, not Pi core.

pi-hud currently temp-copies `cookies.sqlite` on every fetch and keeps dedup
state in-process only. A persistent `~/.pi/agent/pi-hud/cache/` enables:

- Quota responses with TTL (survives `/reload` and restarts)
- **Last-known-good fallback** when a provider 5xx's or the network's down
- Throughput history → sparkline of tokens/sec over the session
- Move temp `cookies.sqlite` copies here instead of `/tmp` for easier cleanup

### 4. Loud README warning about footer-ownership conflicts

pi-pretty's README explicitly states:

> Do not also load `pi-fff` at the same time, because Pi extensions do not
> compositionally share ownership of the same built-in tool names.

pi-hud has the same risk on `ctx.ui.setFooter` — any other footer extension
silently clobbers it (last loader wins). Action:

- Add a "Known conflicts" section to README
- Log a one-time warning on startup: `pi-hud: footer registered; only one
  extension can own setFooter at a time`
- Optionally detect known competing extensions and log specifically

### 5. Companion-extension model (longer-term)

pi-pretty splits cleanly: `pi-pretty` (read/bash/ls/find/grep) +
`pi-diff` (write/edit). pi-hud currently bundles 6 providers + git + Palimpsest
+ Kitty gitui hotkey in one extension.

Possible future split:

- `pi-hud-core` — footer/header framework, model/context/tokens
- `pi-hud-providers` — quota fetchers (so users can skip the Firefox + sqlite3
  dependency entirely)
- `pi-hud-git` — git status panel
- `pi-hud-palimpsest` — quest/instinct integration

Not a near-term refactor. Useful framing if pi-hud ever ships externally to
users who don't run Firefox + Palimpsest.

---

## Considered and rejected

Patterns from pi-pretty that don't translate:

- **Frecency / FFF bundling** — irrelevant to a status HUD.
- **Inline images via Kitty graphics protocol** — over-engineering for a footer.
  (Transferable *if* a quota sparkline ever needs PNG rendering instead of
  unicode bars; keep on the shelf.)
- **Nerd Font icons everywhere** — pi-hud's emoji set (📂🤖) is already
  legible without a Nerd Font install. Switching narrows compatibility.

---

## Other backlog items

_(add new items here)_
