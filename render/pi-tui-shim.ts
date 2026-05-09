/**
 * Re-export pi-tui's canonical width helpers.
 *
 * Earlier versions of this file shipped a hand-rolled `visibleWidth` /
 * `truncateToWidth` to dodge a suspected jiti ESM interop bug. That was
 * unnecessary — pi-coding-agent's extension loader explicitly resolves
 * `@earendil-works/pi-tui` for extensions (alias in dev, virtualModules in
 * the Bun binary), so direct imports work in subdirectory extensions just
 * like in single-file ones.
 *
 * The reimplementation also undercounted any codepoint outside its narrow
 * `isWide` table — notably default-emoji-presentation symbols like
 * `⚡` (U+26A1) used in the footer's `⚡ 114.0 tok/s`. pi-tui measured those
 * as width 2 (matching the terminal); the shim said 1. Result: lines that
 * passed our truncation check overflowed pi-tui's render-time width check
 * by exactly the count of mismeasured glyphs and crashed the TUI.
 *
 * Source the same module pi-tui uses internally so widths are guaranteed
 * to agree.
 */

export { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
