// pi-hud layout config.
//
// The HUD's single configurable surface — the FOOTER below the input box,
// a main line plus optional full-width extra rows — is described
// declaratively here so the layout can be rearranged by editing a file
// instead of changing code.
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

/**
 * One extra footer row: either a flat (left-only) list of block ids, or an
 * object splitting the row into left/right-aligned sides like the main line.
 */
export type FooterRow = BlockId[] | { left: BlockId[]; right?: BlockId[] };

export interface FooterConfig {
	enabled: boolean;
	/** Left-aligned block ids. */
	left: BlockId[];
	/** Right-aligned block ids. */
	right: BlockId[];
	/** Additional full-width rows rendered below the main footer line. Each row is either a flat (left-only) list or a {left,right} object. */
	extraRows: FooterRow[];
}

export interface HudLayout {
	/** Joins blocks within a footer side or extra row. */
	separator: string;
	footer: FooterConfig;
	/** Block ids rendered with chip-style brackets at render time. Defaults to `DEFAULT_CHIPS`. */
	chips: BlockId[];
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

/**
 * Block ids rendered with chip-style formatting by default. Mirrors the set of
 * blocks that have historically been pre-styled with chip brackets.
 */
export const DEFAULT_CHIPS: BlockId[] = [
	"project",
	"folder",
	"model",
	"thinking",
"context",
	"ext:model-prompts",
	"quota",
];

export const DEFAULT_LAYOUT: HudLayout = {
	separator: " · ",
	footer: {
		enabled: true,
left: ["cwd", "model", "thinking", "ext:model-prompts", "context"],
		right: ["quota", "speed"],
		extraRows: [
			["tokens", "cost"],
			["branch", "dirty", "commit", "sync"],
			["extStatuses"],
		],
	},
	chips: [...DEFAULT_CHIPS],
};

/** The on-disk default template, with comments documenting every knob. */
const DEFAULT_FILE = `// pi-hud layout — edit and run /hud reload (or restart Pi) to apply.
// Run /hud blocks for descriptions, /hud validate to check, and /hud layout to show this path.
//
// Available blocks:
//   project      pi identity chip            sessionId   session uuid (dim)
//   sessionName  /name display name          quota       provider usage windows
//   folder       📂 folder name              speed       tok/s
//   model        🤖 active model             statusDot   provider status dot
//   thinking     thinking-level chip         runDuration ⏱ run/idle duration
//   context      context-window usage        cwd         compact working dir
//   tokens       ↑in ↓out                    extStatuses all other extensions' statuses
//   cost         $ spend                     ext:<key>   one extension status by key
//   branch       git branch                  commit      last commit (hash subj age)
//   dirty        git dirty count             sync        ✓ synced / ahead-behind
//
// Reorder/move blocks freely within footer.left, footer.right, or footer.extraRows.
// Each extraRows entry is either a flat array (left-only, full-width) or an
// object like {"left": [...], "right": [...]} for a left/right split row.
{
  // Separator drawn between blocks in a footer side or extra row.
  "separator": " · ",

  // Main footer line below the input box, plus optional full-width rows below it.
  "footer": {
    "enabled": true,
"left": ["cwd", "model", "thinking", "ext:model-prompts", "context"],
    "right": ["quota", "speed"],
    "extraRows": [
      ["tokens", "cost"],
      ["branch", "dirty", "commit", "sync"],
      ["extStatuses"]
    ]
  },

  // Block ids rendered with chip-style brackets (Powerline brackets + inverse
  // background). Omit this field to keep the default chip set
  // (project, folder, model, thinking, context, quota); set to [] to disable
  // chip styling entirely; any explicit list replaces the defaults. Each entry
  // is a block id — \`ext:<key>\` is also accepted as long as the referenced
  // extension status is registered. Example for chipping plain blocks:
  //   "chips": ["tokens", "cost", "branch", "dirty", "speed"]
"chips": ["project", "folder", "model", "thinking", "context", "ext:model-prompts", "quota"]
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

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFooterRowShape(v: unknown): v is FooterRow {
	if (isStringArray(v)) return true;
	if (isRecord(v)) {
		if (!isStringArray(v.left)) return false;
		if ("right" in v && !isStringArray(v.right)) return false;
		return true;
	}
	return false;
}

function normalizeFooterRow(v: FooterRow): FooterRow {
	if (Array.isArray(v)) return [...v];
	return { left: [...v.left], right: v.right ? [...v.right] : [] };
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
		const rowPath = `${path}[${rowIndex}]`;
		if (Array.isArray(row)) {
			row.forEach((id, blockIndex) => {
				validateBlockId(id, `${rowPath}[${blockIndex}]`, issues);
			});
			return;
		}
		if (isRecord(row)) {
			if ("left" in row) {
				validateBlockList(row.left, `${rowPath}.left`, issues);
			} else {
				warn(issues, rowPath, "object row must have a 'left' array");
			}
			if ("right" in row) {
				validateBlockList(row.right, `${rowPath}.right`, issues);
			}
			return;
		}
		warn(issues, rowPath, "must be an array of block ids or a {left,right} object");
	});
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

	// Legacy keys from the mascot/shelf-widget era (removed). Still tolerated
	// at load time — mergeLayout() folds "shelf.rows" into footer.extraRows so
	// upgrading doesn't silently drop previously-visible rows — but flagged
	// here so /hud validate and /hud reload point at the file to clean up.
	if ("sprite" in raw) {
		warn(
			issues,
			"sprite",
			"the mascot/sprite has been removed; this key is ignored and can be deleted",
		);
	}
	if ("shelf" in raw) {
		warn(
			issues,
			"shelf",
			"the above-editor shelf has been removed; shelf.rows are now folded into footer.extraRows automatically. Move them there manually and delete this key",
		);
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

	if ("chips" in raw) {
		validateBlockList(raw.chips, "chips", issues);
	}

	return issues;
}

/** Merge a parsed partial layout over the defaults, validating shapes leniently. */
export function mergeLayout(raw: unknown): HudLayout {
	const base: HudLayout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
	if (!raw || typeof raw !== "object") return base;
	const r = raw as Record<string, unknown>;

	if (typeof r.separator === "string" && r.separator.length > 0) base.separator = r.separator;

	const footer = r.footer as Record<string, unknown> | undefined;
	let explicitExtraRows: FooterRow[] | null = null;
	if (footer && typeof footer === "object") {
		if (typeof footer.enabled === "boolean") base.footer.enabled = footer.enabled;
		if (isStringArray(footer.left)) base.footer.left = footer.left;
		if (isStringArray(footer.right)) base.footer.right = footer.right;
		if (Array.isArray(footer.extraRows) && footer.extraRows.every(isFooterRowShape)) {
			explicitExtraRows = (footer.extraRows as FooterRow[]).map(normalizeFooterRow);
		}
	}

	// Legacy migration: pre-rework configs may still have a "shelf.rows" array
	// (the above-editor shelf has been removed). Fold those rows in front of
	// whatever footer.extraRows resolves to, so upgrading an old file doesn't
	// silently drop previously-visible rows. Runtime-only — never rewrites the
	// file; validateLayout() surfaces a warning pointing at the key to delete.
	const legacyShelf = r.shelf as Record<string, unknown> | undefined;
	const legacyShelfRows =
		legacyShelf &&
		typeof legacyShelf === "object" &&
		Array.isArray(legacyShelf.rows) &&
		legacyShelf.rows.every(isStringArray)
			? (legacyShelf.rows as string[][])
			: null;

	if (legacyShelfRows && legacyShelfRows.length > 0) {
		// Tail is the explicit override if present, else the pre-shelf default
		// (just extStatuses) — never the new post-removal default, which would
		// duplicate the rows the legacy shelf already represents.
		const tail = explicitExtraRows ?? [["extStatuses"]];
		base.footer.extraRows = [...legacyShelfRows, ...tail];
	} else if (explicitExtraRows) {
		base.footer.extraRows = explicitExtraRows;
	}
	// else: base.footer.extraRows already holds DEFAULT_LAYOUT's default rows.

	if (isStringArray(r.chips)) {
		base.chips = [...r.chips];
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
