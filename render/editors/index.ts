import type { EditorStyle } from "../../config.js";
import { createBorderEditorFactory } from "./border.js";
import {
	createBoxedEditorFactory,
	type BoxedEditorStyle,
} from "./boxed.js";
import { createMarkerEditorFactory } from "./marker.js";
import { createPaddedDefaultEditorFactory } from "./padded-default.js";
import type { EditorSkinDeps } from "./types.js";

export type { EditorSkinDeps } from "./types.js";
export {
	fitBorder,
	formatBorderContext,
	formatBorderCwd,
	formatBorderModel,
} from "./border-helpers.js";
export {
	BOX_CHARSETS,
	fitBoxEdge,
	type BoxCharset,
	type BoxedEditorStyle,
} from "./boxed.js";
export { withEditorPadding } from "./padding.js";

/** Minimal surface of ctx.ui needed to install an editor skin. */
export interface EditorUi {
	setEditorComponent?: (factory: unknown) => void;
}

const BOXED_STYLES = new Set<string>(["bracket", "pill", "double"]);

function isBoxedStyle(style: EditorStyle): style is BoxedEditorStyle {
	return BOXED_STYLES.has(style);
}

function hasPadding(deps: EditorSkinDeps): boolean {
	const p = deps.getPadding();
	return p.top > 0 || p.bottom > 0;
}

/**
 * Install the requested input-box skin. `default` restores Pi's stock editor
 * unless editorPadding is non-zero (then a thin pad-only CustomEditor is used).
 * No-ops when the host UI has no setEditorComponent (RPC/print mocks).
 */
export function applyEditorStyle(
	ui: EditorUi,
	style: EditorStyle,
	deps: EditorSkinDeps,
): void {
	const setEditor = ui.setEditorComponent;
	if (typeof setEditor !== "function") return;

	if (style === "default") {
		if (!hasPadding(deps)) {
			setEditor(undefined);
			return;
		}
		setEditor(createPaddedDefaultEditorFactory(deps));
		return;
	}
	if (style === "border") {
		setEditor(createBorderEditorFactory(deps));
		return;
	}
	if (isBoxedStyle(style)) {
		setEditor(createBoxedEditorFactory(deps, style));
		return;
	}
	// marker (and any unknown fall-through)
	setEditor(createMarkerEditorFactory(deps));
}
