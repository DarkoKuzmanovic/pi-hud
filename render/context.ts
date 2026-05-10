import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fmtInt, ICON_CTX } from "./format.js";

export function formatContext(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	if (!usage) return "ctx n/a";
	const pct = usage.contextWindow ? ` ${Math.round((usage.tokens / usage.contextWindow) * 100)}%` : "";
	return `${ICON_CTX()} ${fmtInt(usage.tokens)}${usage.contextWindow ? `/${fmtInt(usage.contextWindow)}` : ""}${pct}`;
}

/** Cached session totals — updated incrementally on message_end instead of recomputed per render tick. */
export interface SessionTotals {
	input: number;
	output: number;
	cost: number;
}

export function initSessionTotals(): SessionTotals {
	return { input: 0, output: 0, cost: 0 };
}

/**
 * Accumulate totals from a finished assistant message.
 * Call this from message_end handlers instead of iterating the full branch.
 */
export function accumulateMessage(msg: any, totals: SessionTotals): void {
	if (msg?.role !== "assistant") return;
	const usage = msg.usage;
	totals.input += usage?.input ?? 0;
	totals.output += usage?.output ?? 0;
	totals.cost += usage?.cost?.total ?? 0;
}
