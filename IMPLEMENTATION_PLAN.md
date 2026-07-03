# pi-hud — Implementation Notes

Current project notes for completed hardening work and remaining backlog. User-facing setup and command documentation lives in `README.md`.

---

## Completed work

### Render/lifecycle hardening

- `/hud refresh` and `/hud ascii` reuse existing registered UI surfaces instead of re-running `install()`.
- Defensive timer cleanup prevents duplicate 30s wall-clock timers if registration is re-entered.
- Quota refresh compares visible provider state without `updatedAt` churn before re-rendering.
- Quota changes now request a footer re-render via `requestRenderAll()` (originally also drove the shelf; the shelf was removed 2026-06-30).
- `HUD_ICONS=none` starts the formatter in ASCII icon mode.
- Empty layout separators fall back to the default separator.
- `padBetween()` truncates ANSI-styled output to terminal width.

### Diagnostics and discoverability

- `/hud blocks` lists the block registry from `render/blocks.ts`.
- `/hud validate` re-reads `~/.pi/agent/pi-hud.layout.jsonc`, reports warning-only issues, and never mutates the file.
- `/hud reload` surfaces non-fatal layout validation warnings after applying the merged layout.
- `/hud doctor` and `diagnostics.ts` have been removed (2026-06-30); no replacement self-diagnostics command currently exists.

### Layout and status protocol

- The default footer shows `cwd`, `model`, `thinking`, `ext:model-prompts`, and `context` on the left, with `quota` and `speed` on the right.
- `extStatuses` now includes pi-pulse's `tps` status instead of filtering it out.
- Config supports `ext:<key>` for one specific extension status.

### Mascot system — removed (2026-06-30)

The above-editor shelf widget and mascot sprite (Kitty image mode, ASCII
fallback, `teal-ghost`/`cute-robot` styles, `assets/robot-spritesheet.png`)
have been removed entirely. `sprite.ts`, `render/shelf.ts`, the PNG asset, and
the `sprite`/`shelf` layout config keys are gone. Shelf rows now live in
`footer.extraRows`; `loadLayout()`/`mergeLayout()` auto-fold any legacy
`shelf.rows` found in an old on-disk config into `footer.extraRows`, and
`validateLayout()` flags lingering `sprite`/`shelf` keys as deprecated.

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

> Note: this backlog item references `/hud doctor`, which has since been removed (2026-06-30). Revisit this item's premise before picking it up.

### 3. Generated default layout comments

`config.ts` now has `BLOCK_DESCRIPTIONS`, but the JSONC default template still has a hand-maintained block comment. Consider generating that comment from the registry if block churn increases.

### 4. Async `/hud doctor` probe — obsolete

`/hud doctor` has been removed (2026-06-30). This item no longer applies.

### 5. Provider message redaction guard — obsolete

`/hud doctor` has been removed (2026-06-30). This item no longer applies.

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
