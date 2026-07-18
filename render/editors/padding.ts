import type { EditorPadding } from "../../config.js";
import { EDITOR_PADDING_MAX } from "../../config.js";

/**
 * Prepend/append blank lines around an editor render. Used by every custom
 * skin so vertical spacing is driven by layout.editorPadding, not per-skin
 * hardcoding. Counts are clamped to [0, EDITOR_PADDING_MAX].
 */
export function withEditorPadding(
	lines: string[],
	padding: EditorPadding,
): string[] {
	const top = clamp(padding.top);
	const bottom = clamp(padding.bottom);
	if (top === 0 && bottom === 0) return lines;
	const out: string[] = [];
	for (let i = 0; i < top; i++) out.push("");
	out.push(...lines);
	for (let i = 0; i < bottom; i++) out.push("");
	return out;
}

function clamp(n: number): number {
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.min(Math.floor(n), EDITOR_PADDING_MAX);
}
