import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { fitBorder } from "./border-helpers.js";
import type { EditorSkinDeps } from "./types.js";
import { withEditorPadding } from "./padding.js";

/**
 * Keep Pi's boxed editor, but replace the top/bottom ─ lines with status labels
 * (working indicator + model/thinking on the bottom left, ctx/cwd/branch on the
 * bottom right). Footer stays owned by pi-hud.
 */
export function createBorderEditorFactory(deps: EditorSkinDeps) {
	return (tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
		const editor = new (class extends CustomEditor {
			constructor(t: TUI, theme: EditorTheme, kb: KeybindingsManager) {
				// Flush against the border so status text sits in the frame.
				super(t, theme, kb, { paddingX: 0 });
			}

			render(width: number): string[] {
				const lines = super.render(width);
				if (!deps.isEnabled() || lines.length < 2) return lines;

				const thm = deps.getFullTheme();
				const topLeft = deps.isWorking() ? thm.fg("accent", " ● ") : "";
				const topRight = "";
				const thinking = deps.getThinkingLevel();
				const thinkingLabel = thinking === "off" ? "off" : thinking;
				const bottomLeft = thm.fg(
					"muted",
					` ${deps.getModelLabel()} · ${thinkingLabel} `,
				);
				const branch = deps.getBranch();
				const bottomRight = thm.fg(
					"muted",
					` ${deps.getContextLabel()} · ${deps.getCwdLabel()}${branch ? ` (${branch})` : ""} `,
				);
				const borderColor = (text: string) => this.borderColor(text);

				// Prefer the true bottom border over trailing autocomplete lines.
				// biome-ignore lint/complexity/useRegexLiterals: ANSI escapes trip noControlCharactersInRegex.
				const sgrPattern = new RegExp("\\u001b\\[[0-9;]*m", "g");
				let bottomBorderIdx = lines.length - 1;
				for (let i = lines.length - 1; i >= 1; i--) {
					const stripped = lines[i].replace(sgrPattern, "").trim();
					if (stripped.startsWith("─") || /↓ \d+ more/.test(stripped)) {
						bottomBorderIdx = i;
						break;
					}
				}

				lines[0] = fitBorder(topLeft, topRight, width, borderColor);
				lines[bottomBorderIdx] = fitBorder(bottomLeft, bottomRight, width, borderColor);
				return withEditorPadding(lines, deps.getPadding());
			}
		})(tui, editorTheme, keybindings);
		return editor;
	};
}
