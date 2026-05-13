import { basename } from "node:path";
import { homedir } from "node:os";
import { truncateToWidth, visibleWidth } from "./pi-tui-shim.js";
import type { UsageWindow, ProviderUsage, ThemeAccess } from "../types.js";

// --- Number formatting ---

export function fmtInt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${Math.round(n)}`;
}

export function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "now";
	const totalMinutes = Math.ceil(ms / 60_000);
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d${hours ? `${hours}h` : ""}`;
	if (hours > 0) return `${hours}h${minutes ? `${minutes}m` : ""}`;
	return `${minutes}m`;
}

export function compactPath(cwd: string): string {
	const home = homedir();
	const next =
		cwd === home
			? "~"
			: cwd.startsWith(`${home}/`)
				? `~/${cwd.slice(home.length + 1)}`
				: cwd;
	const parts = next.split("/").filter(Boolean);
	if (parts.length <= 3) return next;
	return `${parts[0] === "~" ? "~/" : "/"}${parts.slice(-3).join("/")}`;
}

export function compactModelName(id: string): string {
	return id
		.replace(/^.*\//, "")
		.replace(/^claude-/, "")
		.replace(/-20\d{6}$/, "")
		.replace(/-/g, " ");
}

// --- Color helpers ---

export function usageColor(
	percent: number | undefined,
): "success" | "warning" | "error" | "muted" {
	if (percent === undefined || !Number.isFinite(percent)) return "muted";
	if (percent >= 90) return "error";
	if (percent >= 75) return "warning";
	return "success";
}

export function formatPercent(percent: number, precise = false): string {
	return `${precise ? percent.toFixed(1) : Math.round(percent)}%`;
}

export function formatCount(count: number): string {
	return `${Math.round(count)}`;
}

// --- ASCII fallback mode ---

let asciiMode = false;
export function setAsciiMode(v: boolean): void {
	asciiMode = v;
}
export function isAsciiMode(): boolean {
	return asciiMode;
}

// Separator glyphs — powerline in normal mode, plain brackets in ASCII mode
export const SEP_L = () => (asciiMode ? "[" : "\ue0b6");
export const SEP_R = () => (asciiMode ? "]" : "\ue0b4");

// Icon fallbacks: Nerd Font PUA codepoints → readable alternatives
export const ICON_PROJECT = () => (asciiMode ? "\u03c0" : "\ue22c"); // π vs Nerd Font pi
export const ICON_FOLDER = () => (asciiMode ? "\ud83d\udcc1" : "\udb80\udc5c"); // 📁 vs Nerd Font folder
export const ICON_MODEL = () => (asciiMode ? "\ud83e\udd16" : "\udb80\ude29"); // 🤖 vs Nerd Font robot
export const ICON_BRANCH = () => (asciiMode ? "\u2387" : "\udb80\udc65"); // ⎇ vs Nerd Font git-branch
export const ICON_CTX = () => (asciiMode ? "\u229e" : "\udb80\udd1c"); // ⊞ vs Nerd Font context
// --- Chip renderers ---

export function chip(text: string, theme: ThemeAccess): string {
	return `${theme.fg("accent", SEP_L())}${theme.inverse(` ${text} `)}${theme.fg("accent", SEP_R())}`;
}

export function dimChip(text: string, theme: ThemeAccess): string {
	return `${theme.fg("muted", SEP_L())}${theme.inverse(` ${text} `)}${theme.fg("muted", SEP_R())}`;
}

export function quotaChip(window: UsageWindow, theme: ThemeAccess): string {
	const pct = window.usedPercent;
	const color =
		pct === undefined || !Number.isFinite(pct) ? "muted" : usageColor(pct);
	const label =
		window.label === "week"
			? "7d"
			: window.label === "month"
				? "30d"
				: window.label;
	const pctText =
		pct === undefined || !Number.isFinite(pct) ? "n/a" : formatPercent(pct);
	const reset = window.resetAt
		? ` (${fmtDuration(window.resetAt - Date.now())})`
		: "";
	const text = ` ${label} ${pctText}${reset} `;
	return `${theme.fg(color, SEP_L())}${theme.fg(color, theme.inverse(text))}${theme.fg(color, SEP_R())}`;
}

export function thinkingChip(level: string, theme: ThemeAccess): string {
	const color =
		level === "xhigh"
			? "thinkingXhigh"
			: level === "high"
				? "thinkingHigh"
				: level === "medium"
					? "thinkingMedium"
					: level === "low"
						? "thinkingLow"
						: level === "minimal"
							? "thinkingMinimal"
							: "muted";
	return `${theme.fg(color, SEP_L())}${theme.fg(color, theme.inverse(` \u25c7 ${level} `))}${theme.fg(color, SEP_R())}`;
}
// --- Cost + status helpers ---

export function costStr(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "";
	return `$${cost.toFixed(2)}`;
}

export function statusDot(status: string, theme: ThemeAccess): string {
	const color =
		status === "error" || status === "auth-needed"
			? "error"
			: status === "unknown"
				? "warning"
				: "muted";
	const dot = asciiMode ? "\u25cf" : "\u25cf"; // ● works in both modes
	return status === "ok" ? "" : theme.fg(color, ` ${dot}`);
}

export function paletteChip(
	text: string,
	rgb: [number, number, number],
	theme: ThemeAccess,
): string {
	const [r, g, b] = rgb;
	const fgOpen = `\x1b[38;2;${r};${g};${b}m`;
	return `${fgOpen}${SEP_L()}\x1b[39m${theme.inverse(` ${text} `)}${fgOpen}${SEP_R()}\x1b[39m`;
}

// --- Usage rendering ---

export function renderWindow(window: UsageWindow, theme: ThemeAccess): string {
	const pct = window.usedPercent;
	const hasCount =
		window.usedCount !== undefined && window.limitCount !== undefined;
	const pctText =
		pct === undefined || !Number.isFinite(pct)
			? "n/a"
			: formatPercent(pct, hasCount);
	const countText = hasCount
		? ` (${formatCount(window.usedCount!)}/${formatCount(window.limitCount!)})`
		: "";
	const reset = window.resetAt
		? ` (${fmtDuration(window.resetAt - Date.now())})`
		: "";
	const label =
		window.label === "week"
			? "7d"
			: window.label === "month"
				? "30d"
				: window.label === "daily"
					? "1d"
					: window.label;
	return `${theme.fg("muted", `${label}:`)} ${theme.fg(usageColor(pct), pctText)}${theme.fg("dim", countText + reset)}`;
}

export function renderProviderUsage(
	provider: ProviderUsage,
	theme: ThemeAccess,
	palette?: [number, number, number][],
): string {
	const providerChip = palette
		? paletteChip(`${provider.icon} ${provider.name}`, palette[0], theme)
		: chip(`${provider.icon} ${provider.name}`, theme);
	const windows = provider.windows
		.map((w) => renderWindow(w, theme))
		.join(theme.fg("dim", "  "));
	const suffix = provider.message
		? ` ${theme.fg(provider.status === "error" ? "error" : "dim", provider.message)}`
		: provider.status !== "ok"
			? ` ${theme.fg("dim", provider.status)}`
			: "";
	return `${providerChip}  ${windows}${suffix}`;
}

// --- Layout ---

export function padBetween(left: string, right: string, width: number): string {
	if (!right) return truncateToWidth(left, width, "…");
	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) return truncateToWidth(right, width, "…");
	const leftWidth = width - rightWidth - 1;
	const fittedLeft =
		visibleWidth(left) > leftWidth
			? truncateToWidth(left, leftWidth, "…")
			: left;
	const space = Math.max(1, width - visibleWidth(fittedLeft) - rightWidth);
	const raw = fittedLeft + " ".repeat(space) + right;
	return visibleWidth(raw) > width ? truncateToWidth(raw, width, "…") : raw;
}

// Re-export shim functions for sibling modules
export { truncateToWidth, visibleWidth } from "./pi-tui-shim.js";
