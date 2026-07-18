import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { withEditorPadding } from "./padding.js";
import type { EditorSkinDeps } from "./types.js";

/**
 * Stock Pi editor chrome with only vertical padding applied. Used when
 * layout.editor is "default" but editorPadding is non-zero (stock
 * setEditorComponent(undefined) cannot add blank lines).
 */
export function createPaddedDefaultEditorFactory(deps: EditorSkinDeps) {
	return (tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
		const editor = new (class extends CustomEditor {
			render(width: number): string[] {
				const lines = super.render(width);
				if (!deps.isEnabled()) return lines;
				return withEditorPadding(lines, deps.getPadding());
			}
		})(tui, editorTheme, keybindings);
		return editor;
	};
}
