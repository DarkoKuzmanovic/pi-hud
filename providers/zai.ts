import { fetchWithAuth, FetchError, readZaiAuth } from "./shared.js";
import type {
	ZaiUsageData,
	ZaiFetchResult,
	ProviderUsage,
} from "../types.js";

// Z.ai monitor API (reverse-engineered by the melon-hub/zai-usage-tracker extension;
// Z.ai ships no public docs for these endpoints). Two windows map cleanly onto the
// HUD: the 5-hour token quota (percentage + used/limit) and a 7-day model-usage
// range (raw token count — Z.ai exposes no 7d cap, so the footer shows a count).
const BASE = "https://api.z.ai";
const QUOTA_URL = `${BASE}/api/monitor/usage/quota/limit`;
const MODEL_USAGE_URL = `${BASE}/api/monitor/usage/model-usage`;

interface QuotaLimit {
	type?: string;
	unit?: number;
	number?: number;
	percentage?: number;
	currentValue?: number;
	usage?: number;
	limit?: number;
	nextResetTime?: number;
}

interface QuotaLimitResponse {
	limits?: QuotaLimit[];
}

interface ModelUsageResponse {
	totalUsage?: {
		totalModelCallCount?: number;
		totalTokensUsage?: number;
	};
}

interface MonitorEnvelope<T> {
	data?: T;
}

function unwrapMonitorData<T>(value: unknown): T {
	if (value && typeof value === "object" && "data" in value) {
		const wrapped = value as MonitorEnvelope<T>;
		if (wrapped.data) return wrapped.data;
	}
	return value as T;
}

/** Format a Date as Z.ai's "YYYY-MM-DD HH:MM:SS" local-time query param. */
function fmtDateTime(date: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/**
 * GET a Z.ai monitor endpoint. The monitor API accepts the API key in two forms;
 * try the standard Bearer scheme first and fall back to a bare token on auth
 * rejection, so the footer works regardless of which scheme is enforced.
 */
async function fetchMonitor(url: string, key: string): Promise<unknown> {
	const tryFetch = async (header: string): Promise<string> => {
		const { body } = await fetchWithAuth({
			url,
			headers: { Authorization: header, Accept: "application/json" },
		});
		return body;
	};

	try {
		return JSON.parse(await tryFetch(`Bearer ${key}`));
	} catch (err) {
		if (err instanceof FetchError && err.kind === "auth-needed") {
			return JSON.parse(await tryFetch(key));
		}
		throw err;
	}
}

export function parseZaiUsage(
	quotaValue: unknown,
	usage7dValue?: unknown,
): ZaiUsageData {
	const usage: ZaiUsageData = {};

	// Z.ai wraps monitor responses in { code, msg, data, success }. Older reference
	// code and tests used the inner data object directly, so accept both shapes.
	const quota = unwrapMonitorData<QuotaLimitResponse>(quotaValue ?? {});
	const tokenLimits = quota.limits?.filter((l) => l?.type === "TOKENS_LIMIT") ?? [];
	const fiveHourLimit =
		tokenLimits.find((l) => l.unit === 3 && l.number === 5) ?? tokenLimits[0];
	const weeklyLimit = tokenLimits.find((l) => l.unit === 6 && l.number === 1);

	if (fiveHourLimit) {
		if (typeof fiveHourLimit.percentage === "number") usage.fiveHourPercent = fiveHourLimit.percentage;
		if (typeof fiveHourLimit.currentValue === "number") usage.fiveHourUsedTokens = fiveHourLimit.currentValue;
		const lim = typeof fiveHourLimit.usage === "number" ? fiveHourLimit.usage : fiveHourLimit.limit;
		if (typeof lim === "number") usage.fiveHourLimitTokens = lim;
		if (typeof fiveHourLimit.nextResetTime === "number") usage.fiveHourResetAt = fiveHourLimit.nextResetTime;
	}

	if (weeklyLimit) {
		if (typeof weeklyLimit.percentage === "number") usage.sevenDayPercent = weeklyLimit.percentage;
		if (typeof weeklyLimit.nextResetTime === "number") usage.sevenDayResetAt = weeklyLimit.nextResetTime;
	}

	if (usage7dValue !== undefined) {
		const m = unwrapMonitorData<ModelUsageResponse>(usage7dValue);
		const t = m.totalUsage;
		if (t && typeof t === "object" && typeof t.totalTokensUsage === "number") {
			usage.sevenDayTokens = t.totalTokensUsage;
		}
	}

	return usage;
}

export async function fetchZaiUsage(): Promise<ZaiFetchResult> {
	const cred = readZaiAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	const now = new Date();
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
	const start7d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
	const usage7dUrl =
		`${MODEL_USAGE_URL}` +
		`?startTime=${encodeURIComponent(fmtDateTime(start7d))}` +
		`&endTime=${encodeURIComponent(fmtDateTime(end))}`;

	const [quotaRes, usage7dRes] = await Promise.allSettled([
		fetchMonitor(QUOTA_URL, cred.access),
		fetchMonitor(usage7dUrl, cred.access),
	]);

	// The 5-hour quota endpoint is the primary signal — surface its failure directly.
	if (quotaRes.status === "rejected") {
		const err = quotaRes.reason;
		if (err instanceof FetchError) {
			return {
				usage: null,
				status: err.kind === "auth-needed" ? "auth-needed" : "error",
				message: err.message,
			};
		}
		if (err instanceof SyntaxError) {
			return { usage: null, status: "error", message: "bad json" };
		}
		return { usage: null, status: "error", message: "network" };
	}

	const usage = parseZaiUsage(
		quotaRes.value,
		usage7dRes.status === "fulfilled" ? usage7dRes.value : undefined,
	);

	return { usage, status: "ok" };
}

export function zaiToProvider(
	result: ZaiFetchResult,
	previous?: ProviderUsage,
): ProviderUsage {
	if (result.status !== "ok" || !result.usage) {
		return {
			id: "zai",
			name: "Z.AI",
			icon: "\uee0d",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}

	const u = result.usage;
	const hasLimit =
		typeof u.fiveHourLimitTokens === "number" && u.fiveHourLimitTokens > 0;

	return {
		id: "zai",
		name: "Z.AI",
		icon: "\uee0d",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{
				label: "5h",
				...(typeof u.fiveHourPercent === "number" ? { usedPercent: u.fiveHourPercent } : {}),
				...(typeof u.fiveHourUsedTokens === "number" ? { usedCount: u.fiveHourUsedTokens } : {}),
				...(hasLimit ? { limitCount: u.fiveHourLimitTokens } : {}),
				...(typeof u.fiveHourResetAt === "number" ? { resetAt: u.fiveHourResetAt } : {}),
			},
			{
				label: "week",
				...(typeof u.sevenDayPercent === "number" ? { usedPercent: u.sevenDayPercent } : {}),
				...(typeof u.sevenDayTokens === "number" ? { usedCount: u.sevenDayTokens } : {}),
				...(typeof u.sevenDayResetAt === "number" ? { resetAt: u.sevenDayResetAt } : {}),
			},
		],
	};
}
