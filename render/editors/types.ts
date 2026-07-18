import type { EditorPadding } from "../../config.js";
import type { ThemeAccess } from "../../types.js";

/** Live data an editor skin may pull at render time. All fields are getters so skins never cache stale state. */
export interface EditorSkinDeps {
	/** When false, skins should fall through to stock `super.render(width)`. */
	isEnabled: () => boolean;
	/** Full app theme (for userMessageBg etc.). */
	getFullTheme: () => ThemeAccess;
	getModelLabel: () => string;
	getThinkingLevel: () => string;
	getContextLabel: () => string;
	getCwdLabel: () => string;
	getBranch: () => string | undefined;
	isWorking: () => boolean;
	/** Blank lines above/below the rendered box (from layout.editorPadding). */
	getPadding: () => EditorPadding;
}
