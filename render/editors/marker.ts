import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "../format.js";
import type { EditorSkinDeps } from "./types.js";
import { withEditorPadding } from "./padding.js";

/**
 * Current pi-hud input box: strip stock borders, paint userMessageBg, and draw a
 * left ▌ marker column (replaced by ↑N / ↓N when the editor is scrolled).
 */
export function createMarkerEditorFactory(deps: EditorSkinDeps) {
	return (tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
		const editor = new (class extends CustomEditor {
			render(width: number): string[] {
				if (!deps.isEnabled()) return super.render(width);
				const markerWidth = 3; // Fixed column: "▌  " or "↑3 " or "↓12 "
				const innerWidth = Math.max(1, width - markerWidth);

				// Render at innerWidth so text wraps correctly for the narrower column
				const lines = super.render(innerWidth);
				if (lines.length < 2) return lines;

				const fullTheme = deps.getFullTheme();
				const bgOpen = fullTheme.getBgAnsi("userMessageBg");
				const bgClose = "\u001b[49m";
				const resetAnsi = "\u001b[0m";
				// biome-ignore lint/complexity/useRegexLiterals: regex literals trip noControlCharactersInRegex for ANSI escapes.
				const sgrPattern = new RegExp("\\u001b\\[[0-9;]*m", "g");
				// biome-ignore lint/complexity/useRegexLiterals: regex literals trip noControlCharactersInRegex for ANSI escapes.
				const resetPattern = new RegExp("\\u001b\\[0m", "g");
				const markerRaw = "\u258C"; // ▌ LEFT HALF BLOCK

				// Detect scroll indicators from the original border lines.
				// Top border (lines[0]): when scrolled up contains "↑ N more"
				// Bottom border (lines[last]): when scrolled down contains "↓ N more"
				// Autocomplete lines appear after the bottom border — preserve them.
				const topBorder = lines[0] ?? "";
				const scrollUpMatch = topBorder.match(/↑ (\d+) more/);

				// Find the bottom border: it's the last line that starts with border chars
				// or contains the scroll-down indicator.
				// Autocomplete lines come after it.
				let bottomBorderIdx = -1;
				for (let i = lines.length - 1; i >= 1; i--) {
					const stripped = lines[i].replace(sgrPattern, "").trim();
					if (stripped.startsWith("─") || /↓ \d+ more/.test(stripped)) {
						bottomBorderIdx = i;
						break;
					}
				}

				const scrollDownMatch =
					bottomBorderIdx >= 0 ? lines[bottomBorderIdx].match(/↓ (\d+) more/) : null;

				// Extract content lines (between borders) and autocomplete lines (after bottom border)
				const content =
					bottomBorderIdx >= 0 ? lines.slice(1, bottomBorderIdx) : lines.slice(1, -1);
				const autocompleteLines =
					bottomBorderIdx >= 0 && bottomBorderIdx < lines.length - 1
						? lines.slice(bottomBorderIdx + 1)
						: [];

				// Build the marker column: ▌ in borderColor (thinking level / bash mode),
				// or scroll indicator replaces ▌ on that line. Padded to markerWidth.
				const makeMarker = (indicator?: string): string => {
					const glyph = indicator ?? markerRaw;
					const styled = this.borderColor(glyph);
					const styledVisible = indicator ? indicator.length : 1;
					const pad = " ".repeat(Math.max(0, markerWidth - styledVisible));
					return `${styled}${pad}`;
				};

				const rendered: string[] = [];

				// Top blank line with ▌ (or scroll-up indicator)
				const topMarker = scrollUpMatch
					? makeMarker(`↑${scrollUpMatch[1]}`)
					: makeMarker();
				rendered.push(
					`${bgOpen}${topMarker}${bgOpen}${" ".repeat(Math.max(0, innerWidth))}${bgClose}`,
				);

				// Content lines: ▌ + bg-colored text
				for (const line of content) {
					// Re-anchor background after any \x1b[0m resets inside the line
					// (cursor highlight, color codes, etc.)
					const repaired = line.replace(resetPattern, `${resetAnsi}${bgOpen}`);
					const w = visibleWidth(line);
					const padded = w < innerWidth ? repaired + " ".repeat(innerWidth - w) : repaired;
					rendered.push(`${bgOpen}${makeMarker()}${bgOpen}${padded}${bgClose}`);
				}

				// Bottom blank line with ▌ (or scroll-down indicator)
				const bottomMarker = scrollDownMatch
					? makeMarker(`↓${scrollDownMatch[1]}`)
					: makeMarker();
				rendered.push(
					`${bgOpen}${bottomMarker}${bgOpen}${" ".repeat(innerWidth)}${bgClose}`,
				);

				// Autocomplete lines: rendered at innerWidth by parent, pad to full width
				for (const acLine of autocompleteLines) {
					const w = visibleWidth(acLine);
					const pad = w < width ? " ".repeat(width - w) : "";
					rendered.push(acLine + pad);
				}

				return withEditorPadding(rendered, deps.getPadding());
			}
		})(tui, editorTheme, keybindings);
		return editor;
	};
}
