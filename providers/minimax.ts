import { fetchWithAuth, FetchError, readMinimaxAuth } from "./shared.js";
import type { MinimaxFetchResult, MinimaxTokenPlanResponse, MinimaxTokenPlanRemain, ProviderUsage } from "../types.js";

const TOKEN_PLAN_REMAINS_URL = "https://www.minimax.io/v1/token_plan/remains";

function isRemain(value: unknown): value is MinimaxTokenPlanRemain {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.current_interval_total_count === "number" &&
		typeof record.current_interval_usage_count === "number" &&
		typeof record.current_weekly_total_count === "number" &&
		typeof record.current_weekly_usage_count === "number"
	);
}

function isValidMinimaxResponse(value: unknown): value is MinimaxTokenPlanResponse {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		(record.category_remains === undefined || Array.isArray(record.category_remains)) &&
		(record.model_remains === undefined || Array.isArray(record.model_remains))
	);
}

function textGenerationRemain(usage: MinimaxTokenPlanResponse | null): MinimaxTokenPlanRemain | undefined {
	const categoryRemain = usage?.category_remains?.find((remain) => remain.category === "text_generation" && isRemain(remain));
	if (categoryRemain) return categoryRemain;

	const unifiedCreditRemain = usage?.model_remains?.find((remain) => remain.model_name === "general" && isRemain(remain));
	if (unifiedCreditRemain) return unifiedCreditRemain;

	return usage?.model_remains?.find((remain) => remain.model_name?.startsWith("MiniMax-M") && isRemain(remain));
}

function percent(used: number, limit: number): number | undefined {
	if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return undefined;
	return (used / limit) * 100;
}

function usedPercent(used: number, limit: number, remainingPercent?: number): number | undefined {
	const countPercent = percent(used, limit);
	if (countPercent !== undefined) return countPercent;
	if (!Number.isFinite(remainingPercent)) return undefined;
	const usedFromRemaining = 100 - remainingPercent;
	return Math.max(0, Math.min(100, usedFromRemaining));
}

function countFields(used: number, limit: number): Pick<ProviderUsage["windows"][number], "usedCount" | "limitCount"> | Record<string, never> {
	if (percent(used, limit) === undefined) return {};
	return { usedCount: used, limitCount: limit };
}

export async function fetchMinimaxUsage(): Promise<MinimaxFetchResult> {
	const cred = readMinimaxAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	try {
		const { body } = await fetchWithAuth({
			url: TOKEN_PLAN_REMAINS_URL,
			headers: {
				Authorization: `Bearer ${cred.access}`,
				"Content-Type": "application/json",
			},
		});
		const parsed: unknown = JSON.parse(body);
		if (!isValidMinimaxResponse(parsed)) return { usage: null, status: "error", message: "bad shape" };
		return { usage: parsed, status: "ok" };
	} catch (err) {
		if (err instanceof SyntaxError) return { usage: null, status: "error", message: "bad json" };
		if (err instanceof FetchError) {
			if (err.kind === "auth-needed") return { usage: null, status: "auth-needed", message: err.message };
			return { usage: null, status: "error", message: err.message };
		}
		return { usage: null, status: "error", message: "network" };
	}
}

export function minimaxToProvider(result: MinimaxFetchResult, previous?: ProviderUsage): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "minimax",
			name: "MiniMax",
			icon: "\udb81\udc07",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}

	const remain = textGenerationRemain(result.usage);
	if (!remain) {
		return {
			id: "minimax",
			name: "MiniMax",
			icon: "\udb81\udc07",
			status: "error",
			message: "no text quota",
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}

	return {
		id: "minimax",
		name: "MiniMax",
		icon: "\udb81\udc07",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{
				label: "5h",
				usedPercent: usedPercent(
					remain.current_interval_usage_count,
					remain.current_interval_total_count,
					remain.current_interval_remaining_percent,
				),
				...countFields(remain.current_interval_usage_count, remain.current_interval_total_count),
				resetAt: remain.end_time,
			},
			{
				label: "week",
				usedPercent: usedPercent(
					remain.current_weekly_usage_count,
					remain.current_weekly_total_count,
					remain.current_weekly_remaining_percent,
				),
				...countFields(remain.current_weekly_usage_count, remain.current_weekly_total_count),
				resetAt: remain.weekly_end_time,
			},
		],
	};
}
