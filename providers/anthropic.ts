import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readAnthropicAuth } from "./shared.js";
import { fetchWithAuth, FetchError } from "./shared.js";
import type { AnthropicUsageResponse, AnthropicFetchResult, ProviderUsage } from "../types.js";

const CACHE_DIR = join(homedir(), ".pi", "agent", "cache", "pi-hud");
const CACHE_PATH = join(CACHE_DIR, "anthropic.json");
const MIN_BACKOFF_MS = 5 * 60_000;

interface AnthropicCacheEntry {
	usage: AnthropicUsageResponse;
	fetchedAt: number;
}

/** Module state — earliest UTC ms at which a fresh fetch is allowed. Throttled by 429/Retry-After. */
let nextAllowedAt = 0;

function isValidAnthropicResponse(value: unknown): value is AnthropicUsageResponse {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	const validWindow = (window: unknown) => window == null || (typeof window === "object" && typeof (window as Record<string, unknown>).utilization === "number");
	return validWindow(record.five_hour) && validWindow(record.seven_day);
}

function readCacheFile(): AnthropicCacheEntry | null {
	try {
		if (!existsSync(CACHE_PATH)) return null;
		const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as AnthropicCacheEntry;
		if (!parsed || typeof parsed.fetchedAt !== "number" || !isValidAnthropicResponse(parsed.usage)) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function writeCacheFile(usage: AnthropicUsageResponse): void {
	try {
		mkdirSync(CACHE_DIR, { recursive: true });
		const entry: AnthropicCacheEntry = { usage, fetchedAt: Date.now() };
		writeFileSync(CACHE_PATH, JSON.stringify(entry));
	} catch {
		// Cache failure is non-fatal — usage continues to work in memory.
	}
}

/** Synchronously load the last known-good usage from disk. Returns null when no cache exists. */
export function loadCachedAnthropicUsage(): AnthropicFetchResult | null {
	const cached = readCacheFile();
	if (!cached) return null;
	return { usage: cached.usage, status: "ok", fetchedAt: cached.fetchedAt };
}

export async function fetchAnthropicUsage(): Promise<AnthropicFetchResult> {
	const cred = readAnthropicAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	// Respect active 429 backoff window — return an unknown-status result so the caller
	// can keep showing cached values instead of replacing them with an error.
	if (Date.now() < nextAllowedAt) {
		const waitMs = nextAllowedAt - Date.now();
		const waitMin = Math.max(1, Math.ceil(waitMs / 60_000));
		return { usage: null, status: "unknown", message: `throttled ${waitMin}m` };
	}

	try {
		const { body } = await fetchWithAuth({
			url: "https://api.anthropic.com/api/oauth/usage",
			headers: {
				Accept: "application/json, text/plain, */*",
				"Content-Type": "application/json",
				"User-Agent": "claude-code/2.0.31",
				Authorization: `Bearer ${cred.access}`,
				"anthropic-beta": "oauth-2025-04-20",
			},
		});

		try {
			const parsed: unknown = JSON.parse(body);
			if (!isValidAnthropicResponse(parsed)) return { usage: null, status: "error", message: "bad shape" };
			writeCacheFile(parsed);
			return { usage: parsed, status: "ok" };
		} catch {
			return { usage: null, status: "error", message: "bad json" };
		}
	} catch (err) {
		if (err instanceof FetchError) {
			if (err.statusCode === 429) {
				const backoffMs = Math.max(MIN_BACKOFF_MS, err.retryAfterMs ?? 0);
				nextAllowedAt = Date.now() + backoffMs;
			}
			if (err.kind === "auth-needed") return { usage: null, status: "auth-needed", message: err.message };
			return { usage: null, status: "error", message: err.message };
		}
		return { usage: null, status: "error", message: "network" };
	}
}

function hasCachedValues(previous: ProviderUsage | undefined): boolean {
	if (!previous) return false;
	return previous.windows.some((w) => typeof w.usedPercent === "number" && Number.isFinite(w.usedPercent));
}

function formatStaleAge(updatedAt: number | undefined): string {
	if (!updatedAt) return "stale";
	const ageMs = Date.now() - updatedAt;
	if (ageMs < 60_000) return "stale <1m";
	const ageMin = Math.floor(ageMs / 60_000);
	if (ageMin < 60) return `stale ${ageMin}m`;
	const ageHr = Math.floor(ageMin / 60);
	if (ageHr < 24) return `stale ${ageHr}h`;
	const ageDay = Math.floor(ageHr / 24);
	return `stale ${ageDay}d`;
}

export function anthropicToProvider(result: AnthropicFetchResult, previous?: ProviderUsage): ProviderUsage {
	if (result.status !== "ok") {
		// When we have cached usedPercent values from a prior success, keep showing them
		// and replace the alarming error message with a calm "stale Nm" indicator.
		if (hasCachedValues(previous)) {
			return {
				...previous!,
				status: "unknown",
				message: result.status === "auth-needed" ? result.message : formatStaleAge(previous!.updatedAt),
				// Preserve previous.updatedAt so staleness keeps counting up — do NOT reset to now.
			};
		}
		return {
			id: "anthropic",
			name: "Claude",
			icon: "\udb80\udc8b",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}
	return {
		id: "anthropic",
		name: "Claude",
		icon: "\udb80\udc8b",
		status: "ok",
		updatedAt: result.fetchedAt ?? Date.now(),
		windows: [
			{ label: "5h", usedPercent: result.usage?.five_hour?.utilization, resetAt: result.usage?.five_hour?.resets_at ? Date.parse(result.usage.five_hour.resets_at) : undefined },
			{ label: "week", usedPercent: result.usage?.seven_day?.utilization, resetAt: result.usage?.seven_day?.resets_at ? Date.parse(result.usage.seven_day.resets_at) : undefined },
		],
	};
}
