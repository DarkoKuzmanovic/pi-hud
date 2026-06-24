// Footer: a single config-driven line below the input box. Left/right block
// lists come from the layout config and render through the shared block
// registry, so the footer and the shelf draw from the same vocabulary.

import { padBetween, truncateToWidth } from "./format.js";
import type { HudLayout } from "../config.js";
import type { BlockContext } from "./blocks.js";
import { renderGroup } from "./blocks.js";

/** Returns a render fn (width) => footer lines. */
export function renderFooterLine(
	block: BlockContext,
	layout: HudLayout,
): (width: number) => string[] {
	return (width: number): string[] => {
		if (!layout.footer.enabled) return [];
		const lines: string[] = [];
		const left = renderGroup(layout.footer.left, block, layout.separator);
		const right = renderGroup(layout.footer.right, block, layout.separator);
		if (left || right) lines.push(padBetween(left, right, width));

		for (const row of layout.footer.extraRows) {
			const line = renderGroup(row, block, layout.separator);
			if (line) lines.push(truncateToWidth(line, width, "…"));
		}

		return lines;
	};
}
