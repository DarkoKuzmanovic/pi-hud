import { truncateToWidth, visibleWidth } from "../pi-tui-shim.js";
import { compactModelName, compactPath } from "../format.js";

/**
 * Build a top/bottom border line with optional left/right labels, filling the
 * remaining width with ─. Labels are truncated (right first, then left) when
 * they don't fit.
 */
export function fitBorder(
	left: string,
	right: string,
	width: number,
	border: (text: string) => string,
	fill: (text: string) => string = border,
): string {
	if (width <= 0) return "";
	if (width === 1) return border("─");

	let leftText = left;
	let rightText = right;
	const fixedWidth = 2; // leading + trailing ─
	const minimumGap = 1;

	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(rightText) > 0
	) {
		rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), "");
	}
	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(leftText) > 0
	) {
		leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
	}

	const gapWidth = Math.max(
		0,
		width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText),
	);
	return `${border("─")}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border("─")}`;
}

export function formatBorderModel(
	provider: string | undefined,
	id: string | undefined,
): string {
	if (!provider || !id) return "no model";
	return `${provider}/${compactModelName(id)}`;
}

export interface BorderContextUsage {
	tokens?: number | null;
	contextWindow?: number | null;
	percent?: number | null;
}

export function formatBorderContext(usage: BorderContextUsage | null | undefined): string {
	if (!usage) return "ctx ?";
	const { tokens, contextWindow, percent } = usage;
	const windowLabel =
		contextWindow && Number.isFinite(contextWindow)
			? `/${Math.round(contextWindow / 1000)}k`
			: "";
	if (percent != null && Number.isFinite(percent)) {
		return `ctx ${Math.round(percent)}%${windowLabel}`;
	}
	if (tokens == null || !contextWindow) return "ctx ?";
	const pct = Math.round((tokens / contextWindow) * 100);
	return `ctx ${pct}%${windowLabel}`;
}

export function formatBorderCwd(cwd: string): string {
	return compactPath(cwd);
}
