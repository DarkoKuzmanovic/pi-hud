// Shelf widget: the region shown above the input box (via ctx.ui.setWidget,
// placement "aboveEditor"). Composes config-driven status rows on the LEFT with
// the mood sprite on the RIGHT.
//
// The sprite is a Kitty graphics image when the terminal supports it, else an
// ASCII face. On Kitty, the image occupies its own cell columns on the right;
// the shelf text fills the columns to its left (see the multi-row layout notes
// inline below).

import {
	getCapabilities,
	getCellDimensions,
	getImageDimensions,
	encodeKitty,
	allocateImageId,
} from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, padBetween } from "./format.js";
import type { HudLayout } from "../config.js";
import type { BlockContext } from "./blocks.js";
import { renderGroup } from "./blocks.js";
import {
	asciiFace,
	asciiFaceWidth,
	moodPng,
	MOOD_ANSI,
	type MascotId,
	type Mood,
} from "../sprite.js";

// Per-mood/size caches: regenerate the PNG only when the terminal cell box or
// configured sprite size changes. Keep a stable Kitty image id per cache entry so
// unchanged sprite lines do not re-transmit/flicker.
const pngCache = new Map<string, string>();
const idCache = new Map<string, number>();

function padToWidth(content: string, width: number): string {
	const safe = truncateToWidth(content, Math.max(0, width), "");
	return `${safe}${" ".repeat(Math.max(0, width - visibleWidth(safe)))}`;
}

function tint(line: string, mood: Mood): string {
	return `\x1b[38;5;${MOOD_ANSI[mood]}m${line}\x1b[0m`;
}

interface KittySprite {
	sequence: string;
	cols: number;
	rows: number;
}

function buildKittySprite(mood: Mood, mascot: MascotId, maxW: number, maxH: number): KittySprite | null {
	try {
		if (getCapabilities().images !== "kitty") return null;
		const cell = getCellDimensions();
		const cellW = Math.max(1, cell.widthPx);
		const cellH = Math.max(1, cell.heightPx);
		const targetPx = Math.max(54, Math.floor(Math.min(maxW * cellW, maxH * cellH)));
		const cacheKey = `${mascot}:${mood}:${targetPx}`;
		let png = pngCache.get(cacheKey);
		if (!png) {
			png = moodPng(mood, targetPx, mascot);
			pngCache.set(cacheKey, png);
		}
		const dims = getImageDimensions(png, "image/png");
		if (!dims) return null;
		// calculateImageCellSize is not re-exported from the pi-tui root, so derive
		// the cell box ourselves: fit within maxW × maxH cells, preserving aspect
		// ratio.
		const natCols = dims.widthPx / cellW;
		const natRows = dims.heightPx / cellH;
		const scale = Math.min(maxW / natCols, maxH / natRows, 1);
		// Use ceil rather than floor: a 54px image in 19px cells is 2.84 rows,
		// and flooring to 2 visibly wastes the configured 3-row shelf height.
		const columns = Math.max(1, Math.min(maxW, Math.ceil(natCols * scale)));
		const rows = Math.max(1, Math.min(maxH, Math.ceil(natRows * scale)));
		const cachedId = idCache.get(cacheKey);
		const id = cachedId ?? allocateImageId();
		if (cachedId === undefined) idCache.set(cacheKey, id);
		const sequence = encodeKitty(png, {
			columns,
			rows,
			imageId: id,
			moveCursor: false,
		});
		return { sequence, cols: columns, rows };
	} catch {
		// Any image-API drift degrades to the ASCII face, never a blank shelf.
		return null;
	}
}

export interface ShelfInput {
	layout: HudLayout;
	mood: Mood;
	block: BlockContext;
}

/** Returns a render fn (width) => lines for the above-editor shelf widget. */
export function renderShelf(input: ShelfInput): (width: number) => string[] {
	return (width: number): string[] => {
		const { layout, mood, block } = input;
		const sep = layout.separator;

		const shelfLines = layout.shelf.enabled
			? layout.shelf.rows.map((row) => renderGroup(row, block, sep))
			: [];

		const shelfOnly = (): string[] =>
			shelfLines
				.map((l) => truncateToWidth(l, width, "…"))
				.filter((l) => l.length > 0);

		const mode = layout.sprite.enabled ? layout.sprite.mode : "off";
		if (mode === "off") return shelfOnly();

		// Kitty image sprite -------------------------------------------------
		const kitty =
			mode === "auto"
				? buildKittySprite(mood, layout.sprite.mascot, layout.sprite.widthCells, layout.sprite.heightCells)
				: null;

		if (kitty) {
			if (width < kitty.cols + 8) return shelfOnly();
			const startCol = width - kitty.cols;
			// Render only rows that carry text (plus row 0 for the image). Kitty still
			// knows the image's cell height; this tests whether the graphics plane can
			// extend over the shelf without forcing blank spacer rows on the left.
			const total = Math.max(1, shelfLines.length);
			const out: string[] = [];
			for (let i = 0; i < total; i++) {
				const left = shelfLines[i] ?? "";
				if (i === 0) {
					// Row 0 carries the escape: left text padded to the image's start
					// column, then the sequence. isImageLine → emitted verbatim.
					out.push(padToWidth(left, startCol) + kitty.sequence);
				} else if (i < kitty.rows) {
					// Rows with left text stay out of the image columns; absent rows are
					// not emitted, so the shelf can collapse instead of showing blanks.
					out.push(padToWidth(left, startCol));
				} else {
					// Shelf taller than image: plain full-width rows.
					out.push(truncateToWidth(left, width, "…"));
				}
			}
			return out;
		}

		// ASCII fallback sprite ----------------------------------------------
		const faceW = asciiFaceWidth();
		if (width < faceW + 8) return shelfOnly();
		const face = asciiFace(mood).map((l) => tint(l, mood));
		const total = Math.max(face.length, shelfLines.length);
		const out: string[] = [];
		for (let i = 0; i < total; i++) {
			const left = shelfLines[i] ?? "";
			const f = face[i] ?? "";
			out.push(f ? padBetween(left, f, width) : truncateToWidth(left, width, "…"));
		}
		return out;
	};
}
