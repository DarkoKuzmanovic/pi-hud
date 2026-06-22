import { fetchWithAuth, FetchError, readUmansAuth } from "./shared.js";
import type {
	UmansUsageData,
	UmansFetchResult,
	ProviderUsage,
	WindowLabel,
} from "../types.js";

const USAGE_URL = "https://api.code.umans.ai/v1/usage";

interface UmansUsageResponse {
	limits?: {
		requests?: { limit?: number | null; window_seconds?: number | null };
		concurrency?: { limit?: number | null };
	};
	window?: { resets_at?: string; remaining_minutes?: number | null };
	usage?: { requests_in_window?: number | null; concurrent_sessions?: number | null };
}

function isValidUmansResponse(value: unknown): value is UmansUsageResponse {
	return !!value && typeof value === "object";
}

/** Map the rolling-window length (seconds) to the closest HUD window label. */
function windowLabel(windowSeconds: number): WindowLabel {
	if (windowSeconds >= 2_592_000) return "month"; // 30d
	if (windowSeconds >= 604_800) return "week"; // 7d
	if (windowSeconds >= 86_400) return "daily"; // 1d
	return "5h";
}

export async function fetchUmansUsage(): Promise<UmansFetchResult> {
	const cred = readUmansAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	try {
		const { body } = await fetchWithAuth({
			url: USAGE_URL,
			headers: {
				Authorization: `Bearer ${cred.access}`,
				Accept: "application/json",
			},
		});
		const parsed: unknown = JSON.parse(body);
		if (!isValidUmansResponse(parsed)) {
			return { usage: null, status: "error", message: "bad shape" };
		}

		const requestsUsed = parsed.usage?.requests_in_window ?? 0;
		const limit = parsed.limits?.requests?.limit;
		const requestsLimit =
			typeof limit === "number" && limit > 0 ? limit : null;
		const windowSeconds = parsed.limits?.requests?.window_seconds ?? 18_000;
		const concurrencyLimitRaw = parsed.limits?.concurrency?.limit;
		const concurrencyLimit =
			typeof concurrencyLimitRaw === "number" && concurrencyLimitRaw > 0
				? concurrencyLimitRaw
				: null;
		const concurrencyUsed = parsed.usage?.concurrent_sessions ?? 0;

		// Prefer the absolute reset timestamp; fall back to remaining_minutes.
		let resetAt = 0;
		const resetsAt = parsed.window?.resets_at;
		if (resetsAt) {
			const ts = Date.parse(resetsAt);
			if (Number.isFinite(ts)) resetAt = ts;
		}
		if (!resetAt && typeof parsed.window?.remaining_minutes === "number") {
			resetAt = Date.now() + parsed.window.remaining_minutes * 60_000;
		}

		const usage: UmansUsageData = {
			requestsUsed,
			requestsLimit,
			resetAt,
			windowSeconds,
			concurrencyUsed,
			concurrencyLimit,
		};
		return { usage, status: "ok" };
	} catch (err) {
		if (err instanceof SyntaxError) {
			return { usage: null, status: "error", message: "bad json" };
		}
		if (err instanceof FetchError) {
			if (err.kind === "auth-needed") {
				return { usage: null, status: "auth-needed", message: err.message };
			}
			return { usage: null, status: "error", message: err.message };
		}
		return { usage: null, status: "error", message: "network" };
	}
}

export function umansToProvider(
	result: UmansFetchResult,
	previous?: ProviderUsage,
): ProviderUsage {
	if (result.status !== "ok" || !result.usage) {
		return {
			id: "umans",
			name: "Umans",
			icon: "\uee0d",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }],
		};
	}

	const { requestsUsed, requestsLimit, resetAt, windowSeconds, concurrencyUsed, concurrencyLimit } = result.usage;
	const hasLimit = requestsLimit !== null && requestsLimit > 0;

	return {
		id: "umans",
		name: "Umans",
		icon: "\uee0d",
		status: "ok",
		updatedAt: Date.now(),
		concurrency: { used: concurrencyUsed, limit: concurrencyLimit },
		windows: [
			{
				label: windowLabel(windowSeconds),
				usedPercent: hasLimit
					? (requestsUsed / requestsLimit!) * 100
					: undefined,
				usedCount: requestsUsed,
				limitCount: hasLimit ? requestsLimit! : undefined,
				resetAt: resetAt || undefined, // 0 means "unknown" → omit
			},
		],
	};
}
