import { fetchWithAuth, FetchError, readOpenAdapterAuth } from "./shared.js";
import type {
	OpenAdapterFetchResult,
	OpenAdapterUsageData,
	ProviderUsage,
	UsageWindow,
} from "../types.js";

// OpenAdapter gateway usage. Deliberately NOT under /v1: the OpenAI-compatible
// surface (`https://api.openadapter.in/v1`) 404s on every usage-ish path, and
// `/api/v1/usage`, `/api/user`, `/api/keys` all return 403 "Admin access
// required". `/api/usage` is the only endpoint scoped to a plain API key —
// verified live 2026-07-30. Auth is the same `Authorization: Bearer <key>`
// used for completions; unauthenticated requests return 401 "Missing auth token".
const USAGE_URL = "https://api.openadapter.in/api/usage";

interface OpenAdapterWindow {
	percent?: unknown;
	resets_at?: unknown;
}

interface OpenAdapterUsageResponse {
	plan?: unknown;
	plan_name?: unknown;
	limits?: Record<string, OpenAdapterWindow | undefined>;
	usage_percent?: unknown;
	requests_today?: unknown;
	tokens_today?: unknown;
}

function toNum(value: unknown): number | undefined {
	if (value === null || value === undefined || value === "") return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

/**
 * Guard a window utilization to the API's 0-100 contract at the point it
 * reaches the renderer. A non-numeric or non-finite value is dropped (renders
 * "n/a" rather than a bogus percent/color), and an out-of-range value is pinned
 * into range — clamping high reads as "at limit", the safe interpretation of a
 * malformed overage. Applied in the mapper, not the fetcher, so every path that
 * builds an OpenAdapterUsageData is covered.
 */
function toPercent(value: unknown): number | undefined {
	const n = toNum(value);
	if (n === undefined) return undefined;
	return Math.min(100, Math.max(0, n));
}

function toEpochMs(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const ts = Date.parse(value);
	return Number.isFinite(ts) ? ts : undefined;
}

function hasWindowPercent(row: OpenAdapterWindow | undefined): boolean {
	return toNum(row?.percent) !== undefined;
}

function isValidOpenAdapterResponse(
	value: unknown,
): value is OpenAdapterUsageResponse {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const r = value as OpenAdapterUsageResponse;
	if (toNum(r.usage_percent) !== undefined) return true;
	const limits = r.limits;
	if (!limits || typeof limits !== "object") return false;
	return Object.values(limits).some(hasWindowPercent);
}

export async function fetchOpenAdapterUsage(): Promise<OpenAdapterFetchResult> {
	const cred = readOpenAdapterAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "no key" };

	try {
		const { body } = await fetchWithAuth({
			url: USAGE_URL,
			headers: {
				Authorization: `Bearer ${cred.access}`,
				Accept: "application/json",
			},
			// The payload carries `recent` (last 50 calls) and `hourly` alongside the
			// windows, so it runs ~7KB and grows with activity. 128KB keeps a busy
			// account from tripping the default 64KB ceiling and losing the quota.
			maxBytes: 128 * 1024,
		});
		const parsed: unknown = JSON.parse(body);
		if (!isValidOpenAdapterResponse(parsed)) {
			return { usage: null, status: "error", message: "bad shape" };
		}

		const limits = parsed.limits ?? {};
		const short = limits["5h"];
		const daily = limits.day;
		const week = limits.week;
		const month = limits.month;

		const usage: OpenAdapterUsageData = {
			shortPercent: toNum(short?.percent),
			shortResetAt: toEpochMs(short?.resets_at),
			dailyPercent: toNum(daily?.percent),
			dailyResetAt: toEpochMs(daily?.resets_at),
			weekPercent: toNum(week?.percent),
			weekResetAt: toEpochMs(week?.resets_at),
			monthPercent: toNum(month?.percent),
			monthResetAt: toEpochMs(month?.resets_at),
			planName:
				typeof parsed.plan_name === "string"
					? parsed.plan_name
					: typeof parsed.plan === "string"
						? parsed.plan
						: undefined,
			requestsToday: toNum(parsed.requests_today),
			tokensToday: toNum(parsed.tokens_today),
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

const ID = "openadapter" as const;
const NAME = "OpenAdapter";
const ICON = "\udb80\udd8f"; // nf-md-transit_connection_variant

/**
 * The API reports 5h/day/week/month, but the footer joins windows on one line,
 * so only two are rendered — 5h + week, matching Codex/Claude/Kimi. The other
 * two stay in OpenAdapterUsageData: swap the entries below to surface them.
 */
export function openadapterToProvider(
	result: OpenAdapterFetchResult,
	previous?: ProviderUsage,
): ProviderUsage {
	if (result.status !== "ok" || !result.usage) {
		return {
			id: ID,
			name: NAME,
			icon: ICON,
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}

	const u = result.usage;
	const windows: UsageWindow[] = [
		{ label: "5h", usedPercent: toPercent(u.shortPercent), resetAt: u.shortResetAt },
		{ label: "week", usedPercent: toPercent(u.weekPercent), resetAt: u.weekResetAt },
	];

	return {
		id: ID,
		name: NAME,
		icon: ICON,
		status: "ok",
		updatedAt: Date.now(),
		windows,
	};
}
