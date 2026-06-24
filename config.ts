// pi-hud layout config.
//
// The HUD's two surfaces — the status SHELF (rows shown left of the mascot,
// above the input box) and the single-line FOOTER (below the input box) — are
// described declaratively here so the layout can be rearranged by editing a
// file instead of changing code.
//
// File location: ~/.pi/agent/pi-hud.layout.jsonc (created with defaults on first
// run). Reload at runtime with `/hud reload`.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { KNOWN_BLOCKS } from "./render/blocks.js";

// --- Schema ---------------------------------------------------------------

/** A block id, optionally an extension-status key as `ext:<key>`. */
export type BlockId = string;

export type MascotId = "teal-ghost" | "cute-robot";

export interface SpriteConfig {
	enabled: boolean;
	/** "auto" = Kitty image when supported, else ASCII. "ascii" = force ASCII art. "off" = no sprite. */
	mode: "auto" | "ascii" | "off";
	/** Art style for the sprite. */
	mascot: MascotId;
	widthCells: number;
	heightCells: number;
}

export interface ShelfConfig {
	enabled: boolean;
	/** Each inner array is one shelf row; entries are block ids joined by `separator`. */
	rows: BlockId[][];
}

export interface FooterConfig {
	enabled: boolean;
	/** Left-aligned block ids. */
	left: BlockId[];
	/** Right-aligned block ids. */
	right: BlockId[];
	/** Additional full-width rows rendered below the main footer line. */
	extraRows: BlockId[][];
}

export interface HudLayout {
	/** Joins blocks within a shelf row or a footer side. */
	separator: string;
	sprite: SpriteConfig;
	shelf: ShelfConfig;
	footer: FooterConfig;
}

export interface LayoutValidationIssue {
	severity: "warning";
	path: string;
	message: string;
}

export interface ValidateLayoutFileResult {
	path: string;
	issues: LayoutValidationIssue[];
}

// --- Defaults -------------------------------------------------------------

export const DEFAULT_LAYOUT: HudLayout = {
	separator: " · ",
	sprite: { enabled: true, mode: "auto", mascot: "teal-ghost", widthCells: 10, heightCells: 5 },
	shelf: {
		enabled: true,
		rows: [
			["tokens", "cost"],
			["branch", "dirty", "commit", "sync"],
		],
	},
	footer: {
		enabled: true,
		left: ["cwd", "model", "thinking", "context"],
		right: ["quota", "speed"],
		extraRows: [["extStatuses"]],
	},
};

/** The on-disk default template, with comments documenting every knob. */
const DEFAULT_FILE = `// pi-hud layout — edit and run /hud reload (or restart Pi) to apply.
//
// Available blocks:
//   project      pi identity chip            sessionId   session uuid (dim)
//   folder       📂 folder name              quota       provider usage windows
//   model        🤖 active model             speed       tok/s
//   thinking     thinking-level chip         statusDot   provider status dot
//   context      context-window usage        runDuration ⏱ run/idle duration
//   tokens       ↑in ↓out                    cwd         compact working dir
//   cost         $ spend                     extStatuses all other extensions' statuses
//   branch       git branch                  ext:<key>   one extension status by key
//   dirty        git dirty count             commit      last commit (hash subj age)
//   sync         ✓ synced / ahead-behind
//
// Reorder/move blocks freely between shelf rows and footer sides.
{
  // Separator drawn between blocks in a shelf row or footer side.
  "separator": " · ",

  // The mascot sprite, right of the shelf, above the input box.
  "sprite": {
    "enabled": true,
    "mode": "auto",        // "auto" | "ascii" | "off"
    "mascot": "teal-ghost", // "teal-ghost" | "cute-robot"
    "widthCells": 10,
    "heightCells": 5
  },

  // Status shelf: each row is a list of blocks, shown left of the sprite.
  "shelf": {
    "enabled": true,
    "rows": [
      ["tokens", "cost"],
      ["branch", "dirty", "commit", "sync"]
    ]
  },

  // Main footer line below the input box, plus optional full-width rows below it.
  "footer": {
    "enabled": true,
    "left": ["cwd", "model", "thinking", "context"],
    "right": ["quota", "speed"],
    "extraRows": [
      ["extStatuses"]
    ]
  }
}
`;

// --- Loading --------------------------------------------------------------

export function layoutPath(): string {
	return join(homedir(), ".pi", "agent", "pi-hud.layout.jsonc");
}

/**
 * Strip `//` line comments, block comments, and trailing commas from a JSONC
 * string. String-aware: never touches characters inside JSON string literals.
 */
export function stripJsonc(input: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	let inLine = false;
	let inBlock = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		const next = input[i + 1];
		if (inLine) {
			if (ch === "\n") {
				inLine = false;
				out += ch;
			}
			continue;
		}
		if (inBlock) {
			if (ch === "*" && next === "/") {
				inBlock = false;
				i++;
			}
			continue;
		}
		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
			continue;
		}
		if (ch === "/" && next === "/") {
			inLine = true;
			i++;
			continue;
		}
		if (ch === "/" && next === "*") {
			inBlock = true;
			i++;
			continue;
		}
		out += ch;
	}
	// Drop trailing commas before } or ].
	return out.replace(/,(\s*[}\]])/g, "$1");
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === "string");
}

const KNOWN_BLOCK_SET = new Set<string>(KNOWN_BLOCKS);
const SPRITE_MODES = new Set(["auto", "ascii", "off"]);
const MASCOTS = new Set(["teal-ghost", "cute-robot"]);

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function warn(
	issues: LayoutValidationIssue[],
	path: string,
	message: string,
): void {
	issues.push({ severity: "warning", path, message });
}

function isValidBlockId(id: string): boolean {
	if (KNOWN_BLOCK_SET.has(id)) return true;
	return id.startsWith("ext:") && id.slice(4).trim().length > 0;
}

function validateBlockId(
	id: unknown,
	path: string,
	issues: LayoutValidationIssue[],
): void {
	if (typeof id !== "string") {
		warn(issues, path, "must be a block id string");
		return;
	}
	if (isValidBlockId(id)) return;
	if (id.startsWith("ext:")) {
		warn(issues, path, `invalid extension status block "${id}"; expected ext:<key>`);
		return;
	}
	warn(issues, path, `unknown block id "${id}"`);
}

function validateBlockList(
	value: unknown,
	path: string,
	issues: LayoutValidationIssue[],
): void {
	if (!Array.isArray(value)) {
		warn(issues, path, "must be an array of block ids");
		return;
	}
	value.forEach((id, index) => {
		validateBlockId(id, `${path}[${index}]`, issues);
	});
}

function validateBlockRows(
	value: unknown,
	path: string,
	issues: LayoutValidationIssue[],
): void {
	if (!Array.isArray(value)) {
		warn(issues, path, "must be an array of block-id rows");
		return;
	}
	value.forEach((row, rowIndex) => {
		if (!Array.isArray(row)) {
			warn(issues, `${path}[${rowIndex}]`, "must be an array of block ids");
			return;
		}
		row.forEach((id, blockIndex) => {
			validateBlockId(id, `${path}[${rowIndex}][${blockIndex}]`, issues);
		});
	});
}

function validatePositiveNumber(
	value: unknown,
	path: string,
	issues: LayoutValidationIssue[],
): void {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		warn(issues, path, "must be a positive number");
	}
}

export function validateLayout(raw: unknown): LayoutValidationIssue[] {
	const issues: LayoutValidationIssue[] = [];
	if (raw === undefined || raw === null) return issues;
	if (!isRecord(raw)) {
		warn(issues, "layout", "must be an object");
		return issues;
	}

	if ("separator" in raw) {
		if (typeof raw.separator !== "string") {
			warn(issues, "separator", "must be a string");
		} else if (raw.separator.length === 0) {
			warn(issues, "separator", "empty separator falls back to the default separator");
		}
	}

	if ("sprite" in raw) {
		if (!isRecord(raw.sprite)) {
			warn(issues, "sprite", "must be an object");
		} else {
			const sprite = raw.sprite;
			if ("enabled" in sprite && typeof sprite.enabled !== "boolean") {
				warn(issues, "sprite.enabled", "must be a boolean");
			}
			if ("mode" in sprite && !SPRITE_MODES.has(String(sprite.mode))) {
				warn(issues, "sprite.mode", "must be one of auto, ascii, off");
			}
			if ("mascot" in sprite && !MASCOTS.has(String(sprite.mascot))) {
				warn(issues, "sprite.mascot", "must be teal-ghost or cute-robot");
			}
			if ("widthCells" in sprite) {
				validatePositiveNumber(sprite.widthCells, "sprite.widthCells", issues);
			}
			if ("heightCells" in sprite) {
				validatePositiveNumber(sprite.heightCells, "sprite.heightCells", issues);
			}
		}
	}

	if ("shelf" in raw) {
		if (!isRecord(raw.shelf)) {
			warn(issues, "shelf", "must be an object");
		} else {
			const shelf = raw.shelf;
			if ("enabled" in shelf && typeof shelf.enabled !== "boolean") {
				warn(issues, "shelf.enabled", "must be a boolean");
			}
			if ("rows" in shelf) validateBlockRows(shelf.rows, "shelf.rows", issues);
		}
	}

	if ("footer" in raw) {
		if (!isRecord(raw.footer)) {
			warn(issues, "footer", "must be an object");
		} else {
			const footer = raw.footer;
			if ("enabled" in footer && typeof footer.enabled !== "boolean") {
				warn(issues, "footer.enabled", "must be a boolean");
			}
			if ("left" in footer) validateBlockList(footer.left, "footer.left", issues);
			if ("right" in footer) validateBlockList(footer.right, "footer.right", issues);
			if ("extraRows" in footer) {
				validateBlockRows(footer.extraRows, "footer.extraRows", issues);
			}
		}
	}

	return issues;
}

/** Merge a parsed partial layout over the defaults, validating shapes leniently. */
export function mergeLayout(raw: unknown): HudLayout {
	const base: HudLayout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
	if (!raw || typeof raw !== "object") return base;
	const r = raw as Record<string, unknown>;

	if (typeof r.separator === "string" && r.separator.length > 0) base.separator = r.separator;

	const sprite = r.sprite as Record<string, unknown> | undefined;
	if (sprite && typeof sprite === "object") {
		if (typeof sprite.enabled === "boolean") base.sprite.enabled = sprite.enabled;
		if (sprite.mode === "auto" || sprite.mode === "ascii" || sprite.mode === "off") {
			base.sprite.mode = sprite.mode;
		}
		if (sprite.mascot === "teal-ghost" || sprite.mascot === "cute-robot") {
			base.sprite.mascot = sprite.mascot;
		}
		if (typeof sprite.widthCells === "number" && sprite.widthCells > 0) {
			base.sprite.widthCells = Math.floor(sprite.widthCells);
		}
		if (typeof sprite.heightCells === "number" && sprite.heightCells > 0) {
			base.sprite.heightCells = Math.floor(sprite.heightCells);
		}
	}

	const shelf = r.shelf as Record<string, unknown> | undefined;
	if (shelf && typeof shelf === "object") {
		if (typeof shelf.enabled === "boolean") base.shelf.enabled = shelf.enabled;
		if (Array.isArray(shelf.rows) && shelf.rows.every(isStringArray)) {
			base.shelf.rows = shelf.rows as string[][];
		}
	}

	const footer = r.footer as Record<string, unknown> | undefined;
	let hasExplicitFooterExtraRows = false;
	if (footer && typeof footer === "object") {
		if (typeof footer.enabled === "boolean") base.footer.enabled = footer.enabled;
		if (isStringArray(footer.left)) base.footer.left = footer.left;
		if (isStringArray(footer.right)) base.footer.right = footer.right;
		if (Array.isArray(footer.extraRows) && footer.extraRows.every(isStringArray)) {
			base.footer.extraRows = footer.extraRows as string[][];
			hasExplicitFooterExtraRows = true;
		}
	}

	if (shelf && typeof shelf === "object" && Array.isArray(shelf.rows) && !hasExplicitFooterExtraRows) {
		base.footer.extraRows = [];
	}

	return base;
}

export interface LoadResult {
	layout: HudLayout;
	/** Non-fatal problem to surface (e.g. parse error → fell back to defaults). */
	warning?: string;
	warnings?: LayoutValidationIssue[];
}

export function validateLayoutFile(): ValidateLayoutFileResult {
	const path = layoutPath();
	try {
		if (!existsSync(path)) {
			return {
				path,
				issues: [
					{
						severity: "warning",
						path: "file",
						message: "layout file does not exist; defaults will be used",
					},
				],
			};
		}
		const text = readFileSync(path, "utf8");
		const parsed = JSON.parse(stripJsonc(text));
		return { path, issues: validateLayout(parsed) };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			path,
			issues: [
				{
					severity: "warning",
					path: "file",
					message: `layout config invalid (${msg}); defaults will be used`,
				},
			],
		};
	}
}

/**
 * Load the layout from disk, creating the default file if missing. Any parse
 * failure falls back to defaults and returns a warning rather than throwing.
 */
export function loadLayout(): LoadResult {
	const path = layoutPath();
	try {
		if (!existsSync(path)) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, DEFAULT_FILE, "utf8");
			return { layout: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) };
		}
		const text = readFileSync(path, "utf8");
		const parsed = JSON.parse(stripJsonc(text));
		const warnings = validateLayout(parsed);
		return {
			layout: mergeLayout(parsed),
			warnings: warnings.length > 0 ? warnings : undefined,
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			layout: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),
			warning: `pi-hud: layout config invalid (${msg}); using defaults`,
		};
	}
}
