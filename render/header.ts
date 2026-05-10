import { VERSION, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "./format.js";
import { basename } from "node:path";
import type { ProviderUsage, ThemeAccess } from "../types.js";
import { compactModelName, compactPath, quotaChip } from "./format.js";
// --- ASCII art + gradient ---

const PI_ART = [
	"██████",
	"██  ██",
	"████  ██",
	"██    ██",
];

const PI_ART_W = Math.max(...PI_ART.map((l) => [...l].length));

const GRADIENT_PALETTES: Record<string, [number, number, number][]> = {
	electric: [[59, 130, 246], [139, 92, 246], [217, 70, 239]],
	sunset:   [[251, 191, 36], [249, 115, 22], [219, 39, 119]],
	ocean:    [[34, 211, 238], [59, 130, 246], [99, 102, 241]],
	aurora:   [[34, 197, 94], [16, 185, 129], [56, 189, 248]],
	inferno:  [[250, 204, 21], [239, 68, 68], [192, 38, 211]],
};

export const PALETTE_NAMES = Object.keys(GRADIENT_PALETTES);
let activePaletteName = "random";
let ACTIVE_PALETTE: [number, number, number][] =
	GRADIENT_PALETTES[PALETTE_NAMES[Math.floor(Math.random() * PALETTE_NAMES.length)]];

export function getActivePalette(): [number, number, number][] {
	return ACTIVE_PALETTE;
}
export function getActivePaletteName(): string {
	return activePaletteName;
}
export function setActivePalette(name: string): void {
	if (name === "random") {
		activePaletteName = "random";
		ACTIVE_PALETTE = GRADIENT_PALETTES[PALETTE_NAMES[Math.floor(Math.random() * PALETTE_NAMES.length)]];
	} else if (GRADIENT_PALETTES[name]) {
		activePaletteName = name;
		ACTIVE_PALETTE = GRADIENT_PALETTES[name];
	}
}

function lerpColor(t: number): [number, number, number] {
	const stops = ACTIVE_PALETTE;
	const seg = t * (stops.length - 1);
	const i = Math.min(Math.floor(seg), stops.length - 2);
	const f = seg - i;
	return [
		Math.round(stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f),
		Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f),
		Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f),
	];
}

function renderGradientArt(): string[] {
	return PI_ART.map((line, row) => {
		const t = row / (PI_ART.length - 1);
		const [r, g, b] = lerpColor(t);
		let result = "";
		let inBlock = false;
		for (const ch of line) {
			if (ch === "\u2588") {
				if (!inBlock) { result += `\x1b[38;2;${r};${g};${b}m`; inBlock = true; }
				result += ch;
			} else {
				if (inBlock) { result += "\x1b[0m"; inBlock = false; }
				result += ch;
			}
		}
		if (inBlock) result += "\x1b[0m";
		return result;
	});
}

function timeGreeting(): string {
	const h = new Date().getHours();
	if (h < 5)  return "Night owl mode \ud83e\udd89";
	if (h < 12) return "Good morning \u2600\ufe0f";
	if (h < 17) return "Good afternoon \ud83c\udf24\ufe0f";
	if (h < 21) return "Good evening \ud83c\udf05";
	return "Late night session \ud83c\udf19";
}

// --- Resource counts ---

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const RESOURCE_CACHE_TTL_MS = 30_000;
let resourceCache: { at: number; cwd: string; skills: number; mcps: number; extensions: number } | null = null;

function countDirEntries(dir: string, predicate: (name: string, isDir: boolean) => boolean): number {
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		let n = 0;
		for (const e of entries) {
			if (predicate(e.name, e.isDirectory())) n++;
		}
		return n;
	} catch {
		return 0;
	}
}

function countSkills(cwd: string): number {
	const dirs = [
		join(homedir(), ".pi", "agent", "skills"),
		join(cwd, ".pi", "skills"),
	];
	let total = 0;
	for (const dir of dirs) {
		total += countDirEntries(dir, (name, isDir) => isDir || name.endsWith(".md"));
	}
	return total;
}

function countMcps(): number {
	const path = join(homedir(), ".pi", "agent", "mcp.json");
	try {
		const cfg = JSON.parse(readFileSync(path, "utf8"));
		return Object.keys(cfg.mcpServers ?? {}).length;
	} catch {
		return 0;
	}
}

function countExtensions(): number {
	const dir = join(homedir(), ".pi", "agent", "extensions");
	return countDirEntries(dir, (name, isDir) => isDir || /\.(ts|js)$/.test(name));
}

function getResourceCounts(cwd: string): { skills: number; mcps: number; extensions: number } {
	const now = Date.now();
	if (resourceCache && resourceCache.cwd === cwd && now - resourceCache.at < RESOURCE_CACHE_TTL_MS) {
		return resourceCache;
	}
	const counts = { skills: countSkills(cwd), mcps: countMcps(), extensions: countExtensions() };
	resourceCache = { at: now, cwd, ...counts };
	return counts;
}

// --- Header render ---

export interface HeaderDeps {
	ctx: ExtensionContext;
	activeUsage: ProviderUsage;
	thinkingLevel: string;
}

export function renderHeader(deps: HeaderDeps, theme: ThemeAccess): (width: number) => string[] {
	return (width: number) => {
		try {
			const { ctx, activeUsage, thinkingLevel } = deps;
			const artLines = renderGradientArt();
			const artW = PI_ART_W;
			const gap = 4;
			const rw = Math.max(20, width - artW - gap);
			const sp = " ".repeat(gap);
			const dot = theme.fg("dim", "  \u00b7  ");

			const modelShort = ctx.model ? compactModelName(ctx.model.id) : "no model";
			const projectName = basename(ctx.cwd) || "~";
			const cwdShort = compactPath(ctx.cwd);

			const right = [
				`${theme.fg("dim", `pi v${VERSION}`)}${dot}${theme.fg("accent", timeGreeting())}`,
				`${theme.fg("muted", modelShort)}${thinkingLevel !== "off" ? `${dot}${theme.fg("dim", `\u25c7 ${thinkingLevel}`)}` : ""}`,
				`${theme.fg("muted", projectName)}${dot}${theme.fg("dim", cwdShort)}`,
				theme.fg("muted", "/ cmds \u00b7 ! bash \u00b7 Ctrl+O more \u00b7 Esc interrupt \u00b7 Ctrl+P models"),
			];

			const lines: string[] = [];
			lines.push("");
			const rows = Math.max(artLines.length, right.length);
			for (let i = 0; i < rows; i++) {
				const a = i < artLines.length ? artLines[i] + " ".repeat(artW - visibleWidth(artLines[i])) : " ".repeat(artW);
				const r = i < right.length ? right[i] : "";
				lines.push(`${a}${sp}${truncateToWidth(r, rw, "\u2026")}`);
			}

			lines.push("");
			const quotaLine = activeUsage.status === "ok"
				? activeUsage.windows.map((w) => quotaChip(w, theme)).join("  ")
				: theme.fg("dim", `${activeUsage.icon} ${activeUsage.name}: ${activeUsage.message ?? activeUsage.status}`);
			lines.push(quotaLine);

			lines.push("");
			const { skills: skillN, mcps: mcpN, extensions: extN } = getResourceCounts(ctx.cwd);
			const resourcesLine = [
				`${theme.fg("muted", String(skillN))} ${theme.fg("dim", "skills")}`,
				`${theme.fg("muted", String(mcpN))} ${theme.fg("dim", "mcps")}`,
				`${theme.fg("muted", String(extN))} ${theme.fg("dim", "extensions")}`,
			].join(theme.fg("dim", "  \u00b7  "));
			lines.push(resourcesLine);
			lines.push("");

			return lines.map((line) => truncateToWidth(line, width, "\u2026"));
		} catch {
			return [theme.fg("muted", "pi-hud")];
		}
	};
}
