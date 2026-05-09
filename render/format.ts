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
	const next = cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
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

export function usageColor(percent: number | undefined): "success" | "warning" | "error" | "muted" {
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

// --- Chip renderers ---

export function chip(text: string, theme: ThemeAccess): string {
	return `${theme.fg("accent", "\ue0b6")}${theme.inverse(` ${text} `)}${theme.fg("accent", "\ue0b4")}`;
}

export function dimChip(text: string, theme: ThemeAccess): string {
	return `${theme.fg("muted", "\ue0b6")}${theme.inverse(` ${text} `)}${theme.fg("muted", "\ue0b4")}`;
}

export function quotaChip(window: UsageWindow, theme: ThemeAccess): string {
	const pct = window.usedPercent;
	const color = pct === undefined || !Number.isFinite(pct) ? "muted" : usageColor(pct);
	const label = window.label === "week" ? "7d" : window.label === "month" ? "30d" : window.label;
	const pctText = pct === undefined || !Number.isFinite(pct) ? "n/a" : formatPercent(pct);
	const reset = window.resetAt ? ` (${fmtDuration(window.resetAt - Date.now())})` : "";
	const text = ` ${label} ${pctText}${reset} `;
	return `${theme.fg(color, "\ue0b6")}${theme.fg(color, theme.inverse(text))}${theme.fg(color, "\ue0b4")}`;
}

export function thinkingChip(level: string, theme: ThemeAccess): string {
	const color =
		level === "xhigh" ? "thinkingXhigh" :
		level === "high" ? "thinkingHigh" :
		level === "medium" ? "thinkingMedium" :
		level === "low" ? "thinkingLow" :
		level === "minimal" ? "thinkingMinimal" :
		"muted";
	return `${theme.fg(color, "\ue0b6")}${theme.fg(color, theme.inverse(` \u25c7 ${level} `))}${theme.fg(color, "\ue0b4")}`;
}

// --- Usage rendering ---

export function renderWindow(window: UsageWindow, theme: ThemeAccess): string {
	const pct = window.usedPercent;
	const hasCount = window.usedCount !== undefined && window.limitCount !== undefined;
	const pctText = pct === undefined || !Number.isFinite(pct) ? "n/a" : formatPercent(pct, hasCount);
	const countText = hasCount ? ` (${formatCount(window.usedCount!)}/${formatCount(window.limitCount!)})` : "";
	const reset = window.resetAt ? ` (${fmtDuration(window.resetAt - Date.now())})` : "";
	const label = window.label === "week" ? "7d" : window.label === "month" ? "30d" : window.label;
	return `${theme.fg("muted", `${label}:`)} ${theme.fg(usageColor(pct), pctText)}${theme.fg("dim", countText + reset)}`;
}

export function renderProviderUsage(provider: ProviderUsage, theme: ThemeAccess): string {
	const windows = provider.windows.map((w) => renderWindow(w, theme)).join(theme.fg("dim", "  "));
	const suffix = provider.status === "ok" ? "" : ` ${theme.fg(provider.status === "error" ? "error" : "dim", provider.message ?? provider.status)}`;
	return `${chip(`${provider.icon} ${provider.name}`, theme)}  ${windows}${suffix}`;
}

// --- Layout ---

export function padBetween(left: string, right: string, width: number): string {
	if (!right) return truncateToWidth(left, width, "…");
	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) return truncateToWidth(right, width, "…");
	const leftWidth = width - rightWidth - 1;
	const fittedLeft = visibleWidth(left) > leftWidth ? truncateToWidth(left, leftWidth, "…") : left;
	const space = Math.max(1, width - visibleWidth(fittedLeft) - rightWidth);
	const raw = fittedLeft + " ".repeat(space) + right;
	return visibleWidth(raw) > width ? truncateToWidth(raw, width, "…") : raw;
}

// Re-export shim functions for sibling modules
export { truncateToWidth, visibleWidth } from "./pi-tui-shim.js";
