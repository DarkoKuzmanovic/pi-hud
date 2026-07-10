// Openference usage provider.
//
// TRUST-MODEL WARNING: unlike every other provider in this directory (which read
// Pi's own credentials from ~/.pi/agent/auth.json), this provider reads a live
// session token out of Firefox's browser storage. Openference's dashboard API
// (openference.com/api/user/billing/overview) is gated on a session token the
// SPA keeps in localStorage after an interactive email/password login — the
// long-lived Openference API key Pi normally uses for /v1/* inference calls is
// explicitly rejected there ("Session login required for billing"). There is no
// API-key-scoped usage endpoint as of this writing (checked /v1/usage, /v1/quota
// on api.openference.com — both 404).
//
// This reads Firefox's LSNG localStorage SQLite store read-only (via a temp copy,
// since Firefox holds a live lock/WAL on the original), decodes the "user_session"
// value, uses it in-memory for exactly one request, and never logs, persists, or
// returns the token itself. Any failure (no Firefox, no logged-in session, no
// sqlite3 binary, unsupported storage encoding) degrades to a friendly status
// rather than throwing.
//
// Data-shape caveat: the endpoint's usage.todayRequests is a CALENDAR-DAY counter,
// not the plan's actual rolling 5h billing window (Openference plans are metered
// "N requests per 5 hours" per /api/public/plans). We surface it honestly as a
// "daily" window (a label Pi's HUD already supports) rather than mislabeling it
// as "5h" — it will not track 1:1 with the real rolling-window quota, but trends
// in the same direction across a session.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fetchWithAuth, FetchError } from "./shared.js";
import type { OpenferenceFetchResult, OpenferenceUsageData, ProviderUsage } from "../types.js";

const BILLING_URL = "https://openference.com/api/user/billing/overview";
const OPENFERENCE_ICON = "\udb80\udfbd";
const SQLITE_TIMEOUT_MS = 5_000;

interface OpenferenceBillingResponse {
	plan?: { name?: string; maxRpm?: number; maxRpd?: number };
	usage: { todayRequests: number; totalTokens?: number; totalCost?: number };
}

function isValidBillingResponse(value: unknown): value is OpenferenceBillingResponse {
	if (!value || typeof value !== "object") return false;
	const usage = (value as Record<string, unknown>).usage;
	return (
		!!usage &&
		typeof usage === "object" &&
		typeof (usage as Record<string, unknown>).todayRequests === "number"
	);
}

/** Best-effort: "today" is assumed to reset at UTC midnight. Not confirmed by the API (no reset timestamp is returned) — an assumption, not an observed fact. */
function nextUtcMidnight(): number {
	const now = new Date();
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
}

/** Firefox LSNG stores localStorage strings as raw bytes; try the encodings Gecko commonly uses and keep whichever decodes to a plausible printable token. */
function decodeLocalStorageString(buf: Buffer): string | null {
	const looksLikeToken = (s: string) => /^[\x20-\x7E]+$/.test(s) && s.length >= 10 && s.length <= 500;
	for (const encoding of ["utf16le", "utf8", "latin1"] as const) {
		const candidate = buf.toString(encoding);
		if (looksLikeToken(candidate)) return candidate;
	}
	return null;
}

/** Scan all Firefox profiles for an openference.com LSNG storage DB; pick the most recently modified as the "likely active" profile. Never hardcodes a profile name. */
function findSessionDbPath(): string | null {
	const ffRoot = join(homedir(), ".mozilla", "firefox");
	let entries: string[];
	try {
		entries = readdirSync(ffRoot, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		return null;
	}

	let best: { path: string; mtimeMs: number } | null = null;
	for (const profile of entries) {
		const candidate = join(ffRoot, profile, "storage", "default", "https+++openference.com", "ls", "data.sqlite");
		try {
			const stat = statSync(candidate);
			if (!best || stat.mtimeMs > best.mtimeMs) best = { path: candidate, mtimeMs: stat.mtimeMs };
		} catch {
			// candidate doesn't exist for this profile — skip
		}
	}
	return best?.path ?? null;
}

/**
 * Copy the LSNG DB (+ WAL/SHM sidecars, if present) to a throwaway temp dir,
 * read the user_session value read-only, then delete the copy unconditionally.
 * Returns null (not an error) when no session is present — that's a normal,
 * expected "not logged in" state, not a failure.
 */
function extractSessionToken(): { token: string } | { error: string } | null {
	const dbPath = findSessionDbPath();
	if (!dbPath) return null;

	let tempDir: string | null = null;
	try {
		tempDir = mkdtempSync(join(tmpdir(), "pi-hud-ff-"));
		const destDb = join(tempDir, "data.sqlite");
		copyFileSync(dbPath, destDb);
		for (const suffix of ["-wal", "-shm"]) {
			const src = dbPath + suffix;
			if (existsSync(src)) {
				try {
					copyFileSync(src, destDb + suffix);
				} catch {
					// best-effort — a missing/unreadable sidecar just risks a slightly stale read
				}
			}
		}

		let raw: string;
		try {
			raw = execFileSync(
				"sqlite3",
				[destDb, "SELECT hex(value) || '|' || compression_type FROM data WHERE key='user_session';"],
				{ encoding: "utf8", timeout: SQLITE_TIMEOUT_MS },
			).trim();
		} catch {
			return { error: "sqlite3 unavailable" };
		}

		if (!raw) return null; // no user_session row — not logged in, not an error

		const sep = raw.lastIndexOf("|");
		const hex = raw.slice(0, sep);
		const compressionType = raw.slice(sep + 1);
		// compression_type != 0 means Firefox Snappy-compressed the value; we have no
		// decompressor for that here, so decline rather than return garbage bytes.
		if (compressionType !== "0") return { error: "unsupported encoding" };

		const token = decodeLocalStorageString(Buffer.from(hex, "hex"));
		if (!token) return { error: "decode failed" };
		return { token };
	} catch {
		return { error: "extraction failed" };
	} finally {
		if (tempDir) {
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup — temp dir is in os.tmpdir(), not fatal if this fails
			}
		}
	}
}

export async function fetchOpenferenceUsage(): Promise<OpenferenceFetchResult> {
	const extracted = extractSessionToken();
	if (extracted === null) {
		return { usage: null, status: "auth-needed", message: "no browser session" };
	}
	if ("error" in extracted) {
		return { usage: null, status: "error", message: extracted.error };
	}

	let token: string | null = extracted.token;
	try {
		const { body } = await fetchWithAuth({
			url: BILLING_URL,
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
		});
		token = null; // drop the reference immediately after use

		const parsed: unknown = JSON.parse(body);
		if (!isValidBillingResponse(parsed)) {
			return { usage: null, status: "error", message: "bad shape" };
		}

		const usage: OpenferenceUsageData = {
			requestsToday: parsed.usage.todayRequests,
			planName: parsed.plan?.name,
			maxRpm: parsed.plan?.maxRpm,
			totalTokensToday: parsed.usage.totalTokens,
			totalCostTodayUsd: parsed.usage.totalCost,
		};
		return { usage, status: "ok" };
	} catch (err) {
		token = null;
		if (err instanceof SyntaxError) return { usage: null, status: "error", message: "bad json" };
		if (err instanceof FetchError) {
			if (err.kind === "auth-needed") {
				return { usage: null, status: "auth-needed", message: "session expired" };
			}
			return { usage: null, status: "error", message: err.message };
		}
		return { usage: null, status: "error", message: "network" };
	}
}

export function openferenceToProvider(
	result: OpenferenceFetchResult,
	previous?: ProviderUsage,
): ProviderUsage {
	if (result.status !== "ok" || !result.usage) {
		return {
			id: "openference",
			name: "Openference",
			icon: OPENFERENCE_ICON,
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "daily" }],
		};
	}

	const { requestsToday } = result.usage;
	return {
		id: "openference",
		name: "Openference",
		icon: OPENFERENCE_ICON,
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{
				label: "daily",
				usedCount: requestsToday,
				// No reliable per-window limit is exposed here (plan.maxRpd was 0/unset on the
				// observed plan) — show the raw count only, no percentage bar, rather than fabricate one.
				resetAt: nextUtcMidnight(),
			},
		],
	};
}
