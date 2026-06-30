// Block registry: maps a config block id to a renderer that produces a styled
// segment string from the shared live HUD data (BlockContext). Both the footer
// and the shelf render through this registry, so a block can be placed in
// either surface by editing the layout config.

import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderUsage, ThemeAccess } from "../types.js";
import type { SessionTotals } from "./context.js";
import type { GitDirtyResult, GitRemoteResult, GitLastCommit } from "../git.js";
import { formatContext } from "./context.js";
import {
	fmtInt,
	fmtDuration,
	compactPath,
	compactModelName,
	chip,
	dimChip,
	thinkingChip,
	renderProviderUsage,
	costStr,
	statusDot,
	truncateToWidth,
	ICON_PROJECT,
	ICON_FOLDER,
	ICON_CWD,
	ICON_MODEL,
	ICON_BRANCH,
} from "./format.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences requires ESC (0x1B)
const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/** Extension-status keys pi-hud never surfaces as a generic chip. */
export const HIDDEN_STATUSES = new Set([
	"ultrathink",
]);

/** All live data a block may need. Shared by footer + shelf renders. */
export interface BlockContext {
	ctx: ExtensionContext;
	theme: ThemeAccess;
	totals: SessionTotals;
	activeUsage: ProviderUsage;
	thinkingLevel: string;
	activeStartedAt: number | null;
	lastRunMs: number | null;
	lastTps: number | null;
	gitDirty: GitDirtyResult;
	gitRemote: GitRemoteResult;
	gitLastCommit: GitLastCommit;
	branch: string;
	extStatuses: ReadonlyMap<string, string>;
	palette?: [number, number, number][];
	separator?: string;
	/**
	 * Block ids the renderer should treat as chip-wrapped. When omitted (e.g. in
	 * tests) every block renders plain. Populated by `buildBlockContext()` from
	 * `layout.chips`. Centralizing the chip decision here means individual block
	 * renderers no longer hardcode chip styling — the choice is driven entirely
	 * by the layout config.
	 */
	chips?: ReadonlySet<string>;
}

function cleanExtStatus(value: string, theme: ThemeAccess): string {
	const visible = value.replace(ANSI_PATTERN, "").replace(/\s+/g, " ").trim();
	const withoutAutoUpdate = visible
		.replace(/\s*(?:[·•|│]\s*)?[↻⏸]?\s*auto-update\b.*$/iu, "")
		.trim();
	const mcp = withoutAutoUpdate.match(/^MCP:\s*(\S+)\s+servers?\b/iu);
	if (mcp) return ` ${theme.fg("dim", mcp[1])}`;
	const packages = withoutAutoUpdate.match(/^(\d+)\s+pkgs?\b/iu);
	if (packages) return ` ${theme.fg("dim", packages[1])}`;
	if (!withoutAutoUpdate) return "";
	return withoutAutoUpdate === visible ? value : withoutAutoUpdate;
}

const RUN_ICON = "\uf017";
const SPEED_ICON = "\udb80\ude41";
const SESSION_ICON = "\u{f0929}";

type BlockFn = (c: BlockContext) => string;

export const KNOWN_BLOCKS = [
	"project",
	"folder",
	"model",
	"thinking",
	"context",
	"statusDot",
	"tokens",
	"cost",
	"runDuration",
	"speed",
	"cwd",
	"branch",
	"dirty",
	"commit",
	"sync",
	"sessionId",
	"sessionName",
	"quota",
	"extStatuses",
] as const;

export type KnownBlockId = (typeof KNOWN_BLOCKS)[number];

export const BLOCK_DESCRIPTIONS: Record<KnownBlockId | "ext:<key>", string> = {
	project: "Pi identity chip for the active HUD instance.",
	folder: "Current working directory basename as a compact folder chip.",
	model: "Active model id, shortened for footer display.",
	thinking: "Current thinking-level chip from Pi.",
	context: "Current context-window token usage.",
	statusDot: "Provider status indicator shown only when provider is not ok.",
	tokens: "Cumulative session input/output token counts.",
	cost: "Cumulative session cost when available.",
	runDuration: "Current or most recent assistant run duration.",
	speed: "Most recent token-per-second streaming speed.",
	cwd: "Compact full working directory path.",
	branch: "Current git branch name.",
	dirty: "Git dirty/clean status summary.",
	commit: "Last commit hash, subject, and age.",
	sync: "Git remote sync status, including ahead/behind counts.",
	sessionId: "Current Pi session id.",
	sessionName: "Current Pi session display name, when set with /name or --name.",
	quota: "Active provider quota and usage windows.",
	extStatuses: "All visible extension statuses collected from Pi.",
	"ext:<key>": "One specific extension status by key, for example ext:tps.",
};

/**
 * Per-block render spec. `plain` is the always-rendered base text; `chip` is
 * the chip-styled variant used when the block id is in `c.chips`. When `chip`
 * is null, the central renderer falls back to `dimChip(plain(...), theme)` so
 * opt-in chip wrapping still works for blocks that have no bespoke style.
 */
interface BlockSpec {
	plain: BlockFn;
	/** When null, the central renderer wraps the plain output in `dimChip`. */
	chip: BlockFn | null;
}

const BLOCKS: Record<KnownBlockId, BlockSpec> = {
	project: {
		plain: (c) => `${ICON_PROJECT()} `,
		chip: (c) => chip(`${ICON_PROJECT()} `, c.theme),
	},
	folder: {
		plain: (c) => `${ICON_FOLDER()} ${basename(c.ctx.cwd) || c.ctx.cwd}`,
		chip: (c) => dimChip(`${ICON_FOLDER()} ${basename(c.ctx.cwd) || c.ctx.cwd}`, c.theme),
	},
	model: {
		plain: (c) =>
			`${ICON_MODEL()} ${c.ctx.model ? compactModelName(c.ctx.model.id) : "no model"}`,
		chip: (c) =>
			dimChip(
				`${ICON_MODEL()} ${c.ctx.model ? compactModelName(c.ctx.model.id) : "no model"}`,
				c.theme,
			),
	},
	thinking: {
		plain: (c) => c.thinkingLevel,
		chip: (c) => thinkingChip(c.thinkingLevel, c.theme),
	},
	context: {
		plain: (c) => formatContext(c.ctx),
		chip: (c) => dimChip(formatContext(c.ctx), c.theme),
	},
	statusDot: {
		plain: (c) => statusDot(c.activeUsage.status, c.theme),
		chip: null,
	},

	tokens: {
		plain: (c) =>
			c.totals.input > 0 || c.totals.output > 0
				? `↑${fmtInt(c.totals.input)} ↓${fmtInt(c.totals.output)}`
				: "",
		chip: null,
	},
	cost: {
		plain: (c) => costStr(c.totals.cost),
		chip: null,
	},

	runDuration: {
		plain: (c) =>
			c.activeStartedAt
				? `${RUN_ICON} ${fmtDuration(Date.now() - c.activeStartedAt)}`
				: c.lastRunMs
					? `${RUN_ICON} ${fmtDuration(c.lastRunMs)}`
					: `${RUN_ICON} idle`,
		chip: null,
	},
	speed: {
		plain: (c) => (c.lastTps ? `${SPEED_ICON} ${c.lastTps.toFixed(1)} tok/s` : ""),
		chip: null,
	},

	cwd: {
		plain: (c) => `${ICON_CWD()} ${c.theme.fg("dim", compactPath(c.ctx.cwd))}`,
		chip: null,
	},
	branch: {
		plain: (c) =>
			c.branch ? `${c.theme.fg("muted", ICON_BRANCH())} ${c.branch}` : "",
		chip: null,
	},
	dirty: {
		plain: (c) =>
			c.gitDirty.text
				? c.theme.fg(c.gitDirty.isClean ? "success" : "warning", c.gitDirty.text)
				: "",
		chip: null,
	},
	commit: {
		plain: (c) =>
			c.gitLastCommit.hash
				? `${c.theme.fg("muted", c.gitLastCommit.hash)} ${truncateToWidth(c.gitLastCommit.subject, 36, "…")} ${c.theme.fg("dim", c.gitLastCommit.age)}`
				: "",
		chip: null,
	},
	sync: {
		plain: (c) => {
			if (!c.gitRemote.hasRemote) return "";
			if (c.gitRemote.ahead === 0 && c.gitRemote.behind === 0) {
				return c.theme.fg("success", "✓ synced");
			}
			const parts: string[] = [];
			if (c.gitRemote.ahead > 0) parts.push(c.theme.fg("warning", `↑${c.gitRemote.ahead}`));
			if (c.gitRemote.behind > 0) parts.push(c.theme.fg("error", `↓${c.gitRemote.behind}`));
			return parts.join(" ");
		},
		chip: null,
	},

	sessionId: {
		plain: (c) => {
			const id = c.ctx.sessionManager.getSessionId();
			return id ? c.theme.fg("muted", `${SESSION_ICON} ${id}`) : "";
		},
		chip: null,
	},
	sessionName: {
		plain: (c) => {
			const name = c.ctx.sessionManager.getSessionName?.() ?? "";
			const trimmed = name.trim();
			return trimmed
				? c.theme.fg("muted", `${SESSION_ICON} ${truncateToWidth(trimmed, 36, "…")}`)
				: "";
		},
		chip: null,
	},

	quota: {
		plain: (c) =>
			c.activeUsage.id === "unsupported"
				? ""
				: renderProviderUsage(c.activeUsage, c.theme, c.palette, { plainProviderBadge: true }),
		chip: (c) =>
			c.activeUsage.id === "unsupported"
				? ""
				: renderProviderUsage(c.activeUsage, c.theme, c.palette),
	},

	extStatuses: {
		plain: (c) => {
			const rawSep = c.separator ?? " · ";
			const sep = c.theme.fg("dim", rawSep);
			const inline = c.theme.fg("dim", rawSep.trim() || "·");
			return [...c.extStatuses.entries()]
				.filter(([key, val]) => !HIDDEN_STATUSES.has(key) && Boolean(val))
				.map(([, val]) => cleanExtStatus(val, c.theme))
				.filter(Boolean)
				.map((s) => s.replace(/\u00b7/g, inline).replace(/\u2022/g, inline))
				.join(sep);
		},
		chip: null,
	},
};

/** Render a single block id (supports `ext:<key>`). Returns "" for unknown/empty. */
export function renderBlock(id: string, c: BlockContext): string {
	if (id.startsWith("ext:")) {
		const key = id.slice(4);
		const val = c.extStatuses?.get(key);
		return val ? cleanExtStatus(val, c.theme) : "";
	}
	const spec = BLOCKS[id];
	if (!spec) return "";
	const wantChip = c.chips instanceof Set && c.chips.has(id);
	const fn = wantChip && spec.chip ? spec.chip : spec.plain;
	let result: string;
	try {
		result = fn(c);
	} catch {
		return "";
	}
	const visibleResult = result.replace(ANSI_PATTERN, "");
	// Empty/whitespace output: never emit chip brackets around nothing.
	if (!visibleResult?.trim()) return "";
	// Default chip wrap for blocks without a bespoke chip variant. Strip nested
	// ANSI styling first: foreground colors inside inverse chips change the
	// apparent chip background, producing split-color chip bodies.
	if (wantChip && !spec.chip) {
		return dimChip(visibleResult, c.theme);
	}
	return result;
}


/** Render a list of block ids, dropping empties, joined by `separator`. */
export function renderGroup(ids: string[], c: BlockContext, separator: string): string {
	return ids
		.map((id) => renderBlock(id, c))
		.filter((s) => s.length > 0)
		.join(c.theme.fg("dim", separator));
}
