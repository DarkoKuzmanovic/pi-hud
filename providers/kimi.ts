import { fetchWithAuth, FetchError, readKimiAuth } from "./shared.js";
import type {
	KimiFetchResult,
	KimiUsageData,
	ProviderUsage,
	WindowLabel,
} from "../types.js";

// Kimi Code usage endpoint (same one `kimi-code` CLI and pi-provider-kimi-code
// use). Accepts the plain `Authorization: Bearer <key>` from auth.json —
// verified live 2026-07-17; no X-Msh-* device headers required for /usages.
const USAGE_URL = "https://api.kimi.com/coding/v1/usages";

// All numeric fields arrive as JSON strings (e.g. "100"), so coerce defensively.
function toNum(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

interface KimiQuotaRow {
	limit?: unknown;
	used?: unknown;
	remaining?: unknown;
	resetTime?: unknown;
}

interface KimiUsageResponse {
	/** Weekly rolling window. */
	usage?: KimiQuotaRow;
	/** Short windows, e.g. [{ window: {duration: 300, timeUnit: "TIME_UNIT_MINUTE"}, detail: {...} }]. */
	limits?: Array<{
		window?: { duration?: unknown; timeUnit?: unknown };
		detail?: KimiQuotaRow;
	}>;
	/** Concurrency: active session ids + cap. */
	parallel?: { limit?: unknown; details?: unknown[] };
	user?: { membership?: { level?: unknown } };
}

function isValidKimiResponse(value: unknown): value is KimiUsageResponse {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function windowMinutes(window?: { duration?: unknown; timeUnit?: unknown }): number | null {
	const duration = toNum(window?.duration);
	if (duration === null) return null;
	const unit = String(window?.timeUnit ?? "").toUpperCase();
	if (unit.includes("HOUR")) return duration * 60;
	if (unit.includes("MINUTE")) return duration;
	if (unit.includes("DAY")) return duration * 1440;
	return null;
}

function windowLabelFromMinutes(minutes: number | null): WindowLabel {
	if (minutes === null) return "5h";
	if (minutes >= 43_200) return "month"; // 30d
	if (minutes >= 10_080) return "week"; // 7d
	if (minutes >= 1_440) return "daily"; // 1d
	return "5h";
}

function parseRow(row?: KimiQuotaRow): {
	used: number | null;
	limit: number | null;
	resetAt: number | undefined;
} {
	const limit = toNum(row?.limit);
	const usedDirect = toNum(row?.used);
	const remaining = toNum(row?.remaining);
	const used =
		usedDirect ?? (limit !== null && remaining !== null ? limit - remaining : null);
	let resetAt: number | undefined;
	const reset = row?.resetTime;
	if (typeof reset === "string") {
		const ts = Date.parse(reset);
		if (Number.isFinite(ts)) resetAt = ts;
	}
	return { used, limit, resetAt };
}

export async function fetchKimiUsage(): Promise<KimiFetchResult> {
	const cred = readKimiAuth();
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
		if (!isValidKimiResponse(parsed)) {
			return { usage: null, status: "error", message: "bad shape" };
		}

		const week = parseRow(parsed.usage);
		const shortEntry = parsed.limits?.[0];
		const short = parseRow(shortEntry?.detail);
		const shortLabel = windowLabelFromMinutes(windowMinutes(shortEntry?.window));

		const concurrencyLimit = toNum(parsed.parallel?.limit);
		const concurrencyUsed = Array.isArray(parsed.parallel?.details)
			? parsed.parallel!.details!.length
			: 0;

		const usage: KimiUsageData = {
			shortLabel,
			shortUsed: short.used,
			shortLimit: short.limit,
			shortResetAt: short.resetAt,
			weekUsed: week.used,
			weekLimit: week.limit,
			weekResetAt: week.resetAt,
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

function percent(used: number | null, limit: number | null): number | undefined {
	if (used === null || limit === null || limit <= 0) return undefined;
	return (used / limit) * 100;
}

export function kimiToProvider(
	result: KimiFetchResult,
	previous?: ProviderUsage,
): ProviderUsage {
	if (result.status !== "ok" || !result.usage) {
		return {
			id: "kimi",
			name: "Kimi",
			icon: "\uf186",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}

	const u = result.usage;
	return {
		id: "kimi",
		name: "Kimi",
		icon: "\uf186",
		status: "ok",
		updatedAt: Date.now(),
		concurrency: { used: u.concurrencyUsed, limit: u.concurrencyLimit },
		windows: [
			{
				label: u.shortLabel,
				usedPercent: percent(u.shortUsed, u.shortLimit),
				resetAt: u.shortResetAt,
			},
			{
				label: "week",
				usedPercent: percent(u.weekUsed, u.weekLimit),
				resetAt: u.weekResetAt,
			},
		],
	};
}
