import { readWaferAuth } from "./shared.js";
import type {
	WaferUsageData,
	WaferFetchResult,
	ProviderUsage,
} from "../types.js";

const QUOTA_URL = "https://pass.wafer.ai/v1/inference/quota";

interface QuotaResponse {
	window_end?: string;
	seconds_to_window_end?: number;
	request_count?: number;
	included_request_limit?: number;
	current_period_used_percent?: number;
}

async function fetchQuota(apiKey: string): Promise<QuotaResponse | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10_000);
	try {
		const res = await fetch(QUOTA_URL, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
				"Accept-Encoding": "identity",
			},
			signal: controller.signal,
		});
		if (!res.ok) return null;
		return (await res.json()) as QuotaResponse;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchWaferUsage(): Promise<WaferFetchResult> {
	const waferAuth = readWaferAuth();
	if (!waferAuth)
		return { usage: null, status: "auth-needed", message: "login" };

	const quota = await fetchQuota(waferAuth.access);
	if (!quota) return { usage: null, status: "error", message: "quota" };

	const requestCount = quota.request_count;
	const requestLimit = quota.included_request_limit;

	if (typeof requestCount !== "number" || typeof requestLimit !== "number") {
		return { usage: null, status: "error", message: "parse" };
	}

	const usedPercent =
		typeof quota.current_period_used_percent === "number"
			? quota.current_period_used_percent
			: requestLimit > 0
				? (requestCount / requestLimit) * 100
				: 0;

	// Compute windowResetAt from the API's window_end timestamp
	let windowResetAt = 0;
	if (quota.window_end) {
		const ts = Date.parse(quota.window_end);
		if (Number.isFinite(ts)) windowResetAt = ts;
	}

	return {
		usage: {
			windowPercent: usedPercent,
			windowRequests: requestCount,
			windowRequestLimit: requestLimit,
			windowResetAt,
		},
		status: "ok",
	};
}

export function waferToProvider(
	result: WaferFetchResult,
	previous?: ProviderUsage,
): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "wafer",
			name: "Wafer",
			icon: "🍞",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }],
		};
	}
	return {
		id: "wafer",
		name: "Wafer",
		icon: "🍞",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{
				label: "5h",
				usedPercent: result.usage?.windowPercent,
				usedCount: result.usage?.windowRequests,
				limitCount: result.usage?.windowRequestLimit,
				resetAt: result.usage?.windowResetAt || undefined, // || not ?? — 0 means "unknown", coerce to undefined
			},
		],
	};
}
