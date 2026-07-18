import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "../pi-tui-shim.js";
import type { EditorSkinDeps } from "./types.js";
import { withEditorPadding } from "./padding.js";

/** Box-drawing character set for a framed input skin. */
export interface BoxCharset {
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
	horizontal: string;
	vertical: string;
}

export const BOX_CHARSETS = {
	bracket: {
		topLeft: "┌",
		topRight: "┐",
		bottomLeft: "└",
		bottomRight: "┘",
		horizontal: "─",
		vertical: "│",
	},
	pill: {
		topLeft: "╭",
		topRight: "╮",
		bottomLeft: "╰",
		bottomRight: "╯",
		horizontal: "─",
		vertical: "│",
	},
	double: {
		topLeft: "╔",
		topRight: "╗",
		bottomLeft: "╚",
		bottomRight: "╝",
		horizontal: "═",
		vertical: "║",
	},
} as const satisfies Record<string, BoxCharset>;

export type BoxedEditorStyle = keyof typeof BOX_CHARSETS;

/**
 * Build a top/bottom frame line: corner + optional label + fill + corner.
 * Label is truncated when it doesn't fit; width is exact visible columns.
 */
export function fitBoxEdge(
	left: string,
	right: string,
	width: number,
	chars: Pick<BoxCharset, "topLeft" | "topRight" | "horizontal">,
	style: (text: string) => string,
): string {
	if (width <= 0) return "";
	if (width === 1) return style(chars.horizontal);
	if (width === 2) return `${style(chars.topLeft)}${style(chars.topRight)}`;

	const corners = 2;
	const minGap = 1;
	let leftText = left;
	let rightText = right;

	while (
		corners + visibleWidth(leftText) + visibleWidth(rightText) + minGap > width &&
		visibleWidth(rightText) > 0
	) {
		rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), "");
	}
	while (
		corners + visibleWidth(leftText) + visibleWidth(rightText) + minGap > width &&
		visibleWidth(leftText) > 0
	) {
		leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
	}

	const gap = Math.max(
		0,
		width - corners - visibleWidth(leftText) - visibleWidth(rightText),
	);
	return (
		`${style(chars.topLeft)}` +
		leftText +
		`${style(chars.horizontal.repeat(gap))}` +
		rightText +
		`${style(chars.topRight)}`
	);
}

/**
 * Framed input skins (bracket / pill / double). Strip stock ─ borders, re-draw
 * with the chosen charset, and put verticals on content lines. Scroll cues land
 * in the top/bottom edges (↑N / ↓N).
 */
export function createBoxedEditorFactory(
	deps: EditorSkinDeps,
	styleName: BoxedEditorStyle,
) {
	const chars = BOX_CHARSETS[styleName];

	return (tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
		const editor = new (class extends CustomEditor {
			constructor(t: TUI, theme: EditorTheme, kb: KeybindingsManager) {
				// Flush content against the frame so side glyphs sit next to text.
				super(t, theme, kb, { paddingX: 0 });
			}

			render(width: number): string[] {
				if (!deps.isEnabled()) return super.render(width);
				if (width <= 0) return [];

				// Full frame needs left + right verticals; content lives inside.
				const frameOverhead = 2;
				const innerWidth = Math.max(1, width - frameOverhead);
				const lines = super.render(innerWidth);
				if (lines.length < 2) {
					return withEditorPadding(lines, deps.getPadding());
				}

				// biome-ignore lint/complexity/useRegexLiterals: ANSI escapes trip noControlCharactersInRegex.
				const sgrPattern = new RegExp("\\u001b\\[[0-9;]*m", "g");
				const topBorder = lines[0] ?? "";
				const scrollUpMatch = topBorder.match(/↑ (\d+) more/);

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

				const content =
					bottomBorderIdx >= 0 ? lines.slice(1, bottomBorderIdx) : lines.slice(1, -1);
				const autocompleteLines =
					bottomBorderIdx >= 0 && bottomBorderIdx < lines.length - 1
						? lines.slice(bottomBorderIdx + 1)
						: [];

				const borderColor = (text: string) => this.borderColor(text);
				// fitBoxEdge uses topLeft/topRight fields for both edges; bottom
				// callers pass a charset alias with bottom corners swapped in.
				const topChars = {
					topLeft: chars.topLeft,
					topRight: chars.topRight,
					horizontal: chars.horizontal,
				};
				const bottomChars = {
					topLeft: chars.bottomLeft,
					topRight: chars.bottomRight,
					horizontal: chars.horizontal,
				};

				const topLabel = scrollUpMatch ? ` ↑${scrollUpMatch[1]} ` : "";
				const bottomLabel = scrollDownMatch ? ` ↓${scrollDownMatch[1]} ` : "";

				const rendered: string[] = [];
				rendered.push(fitBoxEdge(topLabel, "", width, topChars, borderColor));

				for (const line of content) {
					const w = visibleWidth(line);
					const padded =
						w < innerWidth ? line + " ".repeat(innerWidth - w) : line;
					// Truncate if a content line somehow exceeds the inner budget.
					const safe =
						visibleWidth(padded) > innerWidth
							? truncateToWidth(padded, innerWidth, "")
							: padded;
					const pad =
						visibleWidth(safe) < innerWidth
							? " ".repeat(innerWidth - visibleWidth(safe))
							: "";
					rendered.push(
						`${borderColor(chars.vertical)}${safe}${pad}${borderColor(chars.vertical)}`,
					);
				}

				// Empty box still needs at least one content row so the frame
				// doesn't collapse top onto bottom (matches stock editor feel).
				if (content.length === 0) {
					rendered.push(
						`${borderColor(chars.vertical)}${" ".repeat(innerWidth)}${borderColor(chars.vertical)}`,
					);
				}

				rendered.push(fitBoxEdge(bottomLabel, "", width, bottomChars, borderColor));

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
