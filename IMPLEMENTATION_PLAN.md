# pi-hud — Implementation Notes

Current project notes for completed hardening work and remaining backlog. User-facing setup and command documentation lives in `README.md`.

---

## Completed work

### Render/lifecycle hardening

- `/hud refresh` and `/hud ascii` reuse existing registered UI surfaces instead of re-running `install()`.
- Defensive timer cleanup prevents duplicate 30s wall-clock timers if registration is re-entered.
- Quota refresh compares visible provider state without `updatedAt` churn before re-rendering.
- Quota changes now request both footer and shelf renders via `requestRenderAll()`.
- `HUD_ICONS=none` starts the formatter in ASCII icon mode.
- Empty layout separators fall back to the default separator.
- `padBetween()` truncates ANSI-styled output to terminal width.

### Diagnostics and discoverability

- `/hud blocks` lists the block registry from `render/blocks.ts`.
- `/hud validate` re-reads `~/.pi/agent/pi-hud.layout.jsonc`, reports warning-only issues, and never mutates the file.
- `/hud reload` surfaces non-fatal layout validation warnings after applying the merged layout.
- `/hud doctor` reports local diagnostics for UI handles, layout status, provider cached state, in-flight refreshes, auth presence, `sqlite3`, Firefox profile/cookies DB presence, and robot spritesheet packaging.
- `diagnostics.ts` keeps probes command-path-only: bounded local filesystem checks plus `sqlite3 --version`, no network, no provider refresh.

### Layout and status protocol

- The default footer shows `cwd`, `model`, `thinking`, and `context` on the left, with `quota` and `speed` on the right.
- `footer.extraRows` supports full-width rows below the main footer; the default extra row renders `extStatuses`.
- `extStatuses` now includes pi-pulse's `tps` status instead of filtering it out.
- Config supports `ext:<key>` for one specific extension status.

### Mascot system

- Shelf mascot rendering supports Kitty image mode, ASCII fallback, and `off` mode.
- Sprite size defaults to `10×5` cells.
- Mascot styles are configurable with `sprite.mascot`: `teal-ghost` or `cute-robot`.
- `cute-robot` renders from packaged `assets/robot-spritesheet.png`.
- Kitty image rendering intentionally allows overlap without forcing blank spacer rows in the shelf.

---

## Remaining backlog

### 1. `speedSpark` visual block

Add a compact TPS sparkline block backed by the existing token-speed sliding window. Constraints:

- No new render loop.
- Reuse the existing 250ms TPS throttle.
- Land only after `/hud blocks` exists, so the optional block is discoverable.

### 2. Provider quota cache

Defer until `/hud doctor` shows real-world failure rates. If implemented, prefer a small `~/.pi/agent/pi-hud/cache/` namespace with:

- TTL metadata per provider.
- Last-known-good fallback.
- Redacted diagnostic status in `/hud doctor`.
- No render-path I/O.

Anthropic already has a targeted disk cache; do not generalize blindly without data.

### 3. Generated default layout comments

`config.ts` now has `BLOCK_DESCRIPTIONS`, but the JSONC default template still has a hand-maintained block comment. Consider generating that comment from the registry if block churn increases.

### 4. Async `/hud doctor` probe

The current `sqlite3 --version` check is synchronous but bounded to 1s and only runs on explicit `/hud doctor`. If the command ever feels sluggish, switch the probe to async `execFile` without changing the report shape.

### 5. Provider message redaction guard

`/hud doctor` prints provider `message` strings. Current providers use short status messages such as `loading`, `login`, `unsupported`, or `throttled`. If future providers surface raw HTTP bodies or exception text, sanitize before including messages in the doctor report.

### 6. Footer ownership warning

Only one extension can own `ctx.ui.setFooter()`. README documents this, but there is no runtime warning. A one-time startup notice may be useful if footer conflicts become common.

---

## Explicit non-goals for now

- Animated mascot or mood-blending loops.
- Provider registry refactor.
- Full env-var configuration layer beyond `HUD_ICONS=none`.
- Powerline separator theming.
- Footer ownership recovery or composition.
- Dynamic header redesign.
