import { readCrofaiAuth } from "./shared.js";
import type { CrofAIFetchResult, ProviderUsage } from "../types.js";

const QUOTA_URL = "https://crof.ai/usage_api/";

// Hardcoded daily reset time — 17:10 UTC (= 19:10 CEST / Europe/Belgrade).
// Adjust if your account resets at a different time.
const RESET_HOUR_UTC = 17;
const RESET_MIN_UTC = 10;

interface QuotaResponse {
	credits?: number;
	requests_plan?: number;
	usable_requests?: number;
}

/** Compute the next reset timestamp (recurring daily at RESET_HOUR_UTC:RESET_MIN_UTC). */
function nextResetAt(): number {
	const now = Date.now();
	const target = new Date(now);
	target.setUTCHours(RESET_HOUR_UTC, RESET_MIN_UTC, 0, 0);
	// If today's reset has already passed, the next one is tomorrow
	if (target.getTime() <= now) {
		target.setUTCDate(target.getUTCDate() + 1);
	}
	return target.getTime();
}

async function fetchQuota(apiKey: string): Promise<QuotaResponse | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10_000);
	try {
		const res = await fetch(QUOTA_URL, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
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

export async function fetchCrofaiUsage(): Promise<CrofAIFetchResult> {
	const auth = readCrofaiAuth();
	if (!auth) return { usage: null, status: "auth-needed", message: "login" };

	const quota = await fetchQuota(auth.access);
	if (!quota) return { usage: null, status: "error", message: "quota" };

	const usable = quota.usable_requests;
	const plan = quota.requests_plan;

	if (typeof usable !== "number" || typeof plan !== "number") {
		return { usage: null, status: "error", message: "parse" };
	}

	const used = plan - usable;
	// usedPercent is computed inline in crofaiToProvider

	return {
		usage: {
			windowRequests: used,
			windowRequestLimit: plan,
			credits: typeof quota.credits === "number" ? quota.credits : 0,
			windowResetAt: nextResetAt(),
		},
		status: "ok",
	};
}

export function crofaiToProvider(
	result: CrofAIFetchResult,
	previous?: ProviderUsage,
): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "crofai",
			name: "CrofAI",
			icon: "🥖",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "daily" }],
		};
	}

	const credits = result.usage?.credits;
	const creditsText =
		typeof credits === "number" && credits > 0
			? ` $${credits < 10 ? credits.toFixed(2) : Math.round(credits)}`
			: "";

	return {
		id: "crofai",
		name: "CrofAI",
		icon: "🥖",
		status: "ok",
		message: creditsText || undefined,
		updatedAt: Date.now(),
		windows: [
			{
				label: "daily",
				usedPercent: result.usage
					? result.usage.windowRequestLimit > 0
						? (result.usage.windowRequests / result.usage.windowRequestLimit) *
							100
						: 0
					: undefined,
				usedCount: result.usage?.windowRequests,
				limitCount: result.usage?.windowRequestLimit,
				resetAt: result.usage?.windowResetAt || undefined,
			},
		],
	};
}
