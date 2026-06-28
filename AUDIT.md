# pi-hud — Trim Audit

_Audited: 2026-06-28 · commit 90ad1b7 · branch claude/pi-hud-jsonc-setup-nu53q8_

## Summary

pi-hud is a configurable terminal HUD for Pi: it owns Pi's footer, header,
above-editor shelf, and (notably) replaces the editor input box itself, plus
tracks quota for 7 providers, git state, and token throughput, and draws a
mascot. Total source is ~4,965 lines across 24 `.ts` files. The bulk of the
weight is decorative or multi-provider breadth: the mascot sprite (552 lines),
the custom editor component (~105 lines of fragile ANSI parsing), and 6 of the
7 provider integrations you likely don't all use. The genuine core — footer +
shelf rendering, the layout/block system, one provider's quota, git, and token
totals — is small.

## Responsibility inventory

1. **UI surface ownership** — claims four Pi TUI surfaces:
   - Footer: `ctx.ui.setFooter()` (`index.ts:420`)
   - Session-start header banner: `ctx.ui.setHeader()` (`index.ts:621`)
   - Above-editor shelf + mascot: `ctx.ui.setWidget("hud-shelf", …)` (`index.ts:647`)
   - **Custom editor component** that replaces Pi's input box with a marker
     column (`▌`), background repaint, and reimplemented scroll/autocomplete
     indicators: `ctx.ui.setEditorComponent()` (`index.ts:515-619`)

2. **Provider quota tracking** — 7 providers (`providers/*.ts`, ~1,045 lines):
   Codex, Anthropic, Ollama Cloud, OpenCode, MiniMax, Umans, Z.AI. In-flight
   dedup, 60s refresh, change-detection (`stableUsageKey`, `index.ts:83`),
   active provider resolved via `provider-routing.ts`. Anthropic usage seeded
   from disk on start (`index.ts:491-495`). Auth via `~/.pi/agent/auth.json`,
   env vars, or Firefox cookies.

3. **Firefox cookie reading** — `cookies.ts` (144 lines): temp-copies
   `cookies.sqlite` (live DB is locked), shells out to the `sqlite3` CLI.
   Used **only** by Ollama Cloud + OpenCode.

4. **Git state** — `git.ts` (72 lines): async, 5s cadence, change-gated. Dirty
   count, remote ahead/behind, last commit. Branch comes from Pi's
   `footerData.onBranchChange`/`getGitBranch()` (`index.ts:422,476`).

5. **Session token accounting** —
   - Cumulative totals: `render/context.ts`, O(1) incremental, re-synced by
     replaying the session branch on start/resume/fork (`index.ts:499-513`).
   - Live tok/s: `token-speed.ts` (137 lines), throttled to 250ms redraws
     (`index.ts:715-758`).

6. **Mascot sprite** — `sprite.ts` (552 lines, largest file): mood-driven
   (idle/working/tool/success/error) from agent/tool events (`index.ts:692-713`).
   Kitty graphics or ASCII fallback; `teal-ghost` (procedural) and `cute-robot`
   (needs `assets/robot-spritesheet.png`).

7. **Layout config system** — `config.ts` (473 lines): JSONC load/create-default,
   `stripJsonc` parser, lenient validation, merge-over-defaults. Plus the block
   registry and renderers: `render/blocks.ts`, `shelf.ts`, `footer.ts`,
   `header.ts`, `format.ts`, `context.ts`.

8. **Diagnostics** — `diagnostics.ts` (262 lines): `/hud doctor` bounded local
   checks (auth, sqlite3, Firefox profile, surfaces, layout, provider state,
   sprite asset). No network.

9. **Commands, shortcuts & event wiring** —
   - `/hud` with 11 subcommands: on/off/refresh/reload/layout/blocks/validate/
     doctor/status/theme [name]/ascii (`index.ts:806`)
   - Theme palettes (`render/header.ts`), ASCII icon mode (`HUD_ICONS=none`)
   - **Ctrl+`** opens `gitui` in a Kitty overlay via `kitty @ launch`
     (`index.ts:779`) — external deps: gitui + `allow_remote_control`
   - Lifecycle hooks: session_start/shutdown, model_select, agent_start/end,
     tool_execution_start/end, message_start/update/end, turn_end
   - 30s wall-clock `setInterval` driving refresh checks + live duration
     (`index.ts:434-460`)

## Trim candidates

| Candidate | Approx. lines saved | Risk | Notes |
| --- | --- | --- | --- |
| Mascot sprite + PNG asset | ~552 + asset | Cosmetic only | Largest single removable unit; remove `sprite.ts`, sprite block, mood wiring |
| Custom editor component | ~105 (`index.ts`) | Cosmetic only | Most brittle code (ANSI/border parsing); only draws the `▌` marker stripe |
| Unused providers (each) | ~130–240 each | Low, mechanical | Removes the file + state var + refresh fn + in-flight var + switch arms + `/hud status` line |
| Firefox cookies + sqlite3 dep | ~144 + ext dep | Only if dropping Ollama + OpenCode | Whole subsystem exists solely for those two |
| `/hud doctor` diagnostics | ~262 | Lose self-diagnostics | Keep if you rely on it for setup debugging |
| Ctrl+` gitui overlay | ~25 + ext deps | Niche | Needs Kitty + gitui + remote control |

## Load-bearing core

What must stay — the actual reason pi-hud exists:

- Footer + shelf rendering and the declarative **block/layout system**
  (`config.ts`, `render/blocks.ts`, `render/shelf.ts`, `render/footer.ts`,
  `render/format.ts`)
- **Quota** for the one or two providers you actually use
- **Git** state (`git.ts`)
- **Token totals** (`render/context.ts`) and, optionally, live tok/s
- Core event wiring + `/hud` command surface

## Recommended next steps

Smallest-risk first:

1. Trim the provider set to the 1–2 you actually run; delete the rest and their
   switch arms. If neither remaining one is Ollama/OpenCode, also delete
   `cookies.ts` and drop the `sqlite3` requirement.
2. If you don't need the mascot, remove `sprite.ts` + the sprite block + mood
   wiring + the PNG asset.
3. If you don't need the `▌` marker stripe, drop the custom editor component
   and let Pi render its native input box.
4. Decide whether `/hud doctor` and the Ctrl+` overlay earn their keep; remove
   if not.
5. Re-run `/trim-audit` after each cut to confirm nothing load-bearing went
   with it.
