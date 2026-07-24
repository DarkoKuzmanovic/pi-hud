// Snapshot reader — the "snapshot" usage source.
//
// Reads the shared usage snapshot written by the `usaged` daemon
// (`$XDG_STATE_HOME/usage/current.json`, fallback `~/.local/state`) and maps a
// provider record into pi-hud's ProviderUsage. This couples ONLY to the
// documented JSON contract (docs/snapshot-schema.md in usage-core) — pi-hud has
// no code dependency on usage-core. When the file is missing, malformed, an
// unsupported schema version, or stale, the reader returns null so the caller
// falls back to a native fetch.

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { ProviderId, ProviderStatus, ProviderUsage, UsageWindow, WindowLabel } from "./types.js";

/** Contract subset we consume. Mirrors usage-core's snapshot-types.ts (kept local, no dep). */
interface SnapshotWindow {
	id: string;
	label: string;
	usedPercent?: number;
	used?: number;
	limit?: number;
	resetAt?: string;
}
interface SnapshotProvider {
	id: string;
	name: string;
	state: string;
	status?: string;
	lastSuccessAt?: string;
	updatedAt?: string;
	windows: SnapshotWindow[];
	concurrency?: { used: number; limit: number | null };
}
interface SnapshotFile {
	schemaVersion: number;
	collectionFinishedAt: string;
	providers: SnapshotProvider[];
}

/** Schema version this reader understands. A daemon writing a newer version is ignored (native fallback). */
const SUPPORTED_SCHEMA_VERSION = 1;
/** Default staleness ceiling: 2× the daemon's 5-minute poll. */
const DEFAULT_MAX_STALE_MS = 10 * 60_000;
/** Reuse a parse for this long so refreshing several providers in one tick reads the file once. */
const CACHE_TTL_MS = 1_000;

function currentJsonPath(): string {
	const xdg = process.env.XDG_STATE_HOME?.trim();
	const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "state");
	return join(base, "usage", "current.json");
}

let cache: { at: number; snapshot: SnapshotFile | null } | null = null;

/** Parse current.json (or null if unreadable/malformed/unsupported), memoized for CACHE_TTL_MS. */
function loadSnapshot(now: number): SnapshotFile | null {
	if (cache && now - cache.at < CACHE_TTL_MS) return cache.snapshot;

	let parsed: SnapshotFile | null = null;
	try {
		const raw = readFileSync(currentJsonPath(), "utf8");
		const obj = JSON.parse(raw) as unknown;
		if (
			obj &&
			typeof obj === "object" &&
			(obj as SnapshotFile).schemaVersion === SUPPORTED_SCHEMA_VERSION &&
			typeof (obj as SnapshotFile).collectionFinishedAt === "string" &&
			Array.isArray((obj as SnapshotFile).providers)
		) {
			parsed = obj as SnapshotFile;
		}
	} catch {
		parsed = null; // missing or malformed
	}
	cache = { at: now, snapshot: parsed };
	return parsed;
}

const STATE_TO_STATUS: Record<string, ProviderStatus> = {
	ok: "ok",
	stale: "unknown", // pi-hud has no "stale"; "unknown" = present-but-not-fresh
	"auth-needed": "auth-needed",
	error: "error",
};

const WINDOW_ID_TO_LABEL: Record<string, WindowLabel> = {
	"5h": "5h",
	rolling: "5h",
	"7d": "week",
	week: "week",
	weekly: "week",
	monthly: "month",
	month: "month",
	daily: "daily",
};

function mapWindow(w: SnapshotWindow): UsageWindow | null {
	const label = WINDOW_ID_TO_LABEL[w.id];
	if (!label) return null; // unknown window id — drop rather than guess
	const out: UsageWindow = { label };
	if (typeof w.usedPercent === "number" && Number.isFinite(w.usedPercent)) out.usedPercent = w.usedPercent;
	if (typeof w.used === "number") out.usedCount = w.used;
	if (typeof w.limit === "number") out.limitCount = w.limit;
	if (w.resetAt) {
		const t = Date.parse(w.resetAt);
		if (Number.isFinite(t)) out.resetAt = t;
	}
	return out;
}

/**
 * Map one snapshot provider record onto `prev` (which supplies pi-hud's icon,
 * name, and id — display identity the contract does not carry).
 */
function mapProvider(p: SnapshotProvider, prev: ProviderUsage, finishedMs: number): ProviderUsage {
	const windows = p.windows.map(mapWindow).filter((w): w is UsageWindow => w !== null);
	const mappedStatus = STATE_TO_STATUS[p.state] ?? "unknown";
	const updated = p.updatedAt ? Date.parse(p.updatedAt) : finishedMs;
	return {
		...prev,
		status: mappedStatus,
		message: p.status ?? (mappedStatus === "ok" ? undefined : prev.message),
		updatedAt: Number.isFinite(updated) ? updated : finishedMs,
		windows: windows.length > 0 ? windows : prev.windows,
		concurrency: p.concurrency
			? { used: p.concurrency.used, limit: p.concurrency.limit }
			: prev.concurrency,
	};
}

export interface ReadSnapshotOptions {
	now?: number;
	maxStaleMs?: number;
}

/**
 * Read a single provider's usage from the shared snapshot, or null to signal
 * the caller should fall back to a native fetch (file missing, malformed,
 * unsupported version, stale, or the provider absent this tick).
 */
export function readSnapshotProvider(
	id: ProviderId,
	prev: ProviderUsage,
	options: ReadSnapshotOptions = {},
): ProviderUsage | null {
	const now = options.now ?? Date.now();
	const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;

	const snap = loadSnapshot(now);
	if (!snap) return null;

	const finishedMs = Date.parse(snap.collectionFinishedAt);
	if (!Number.isFinite(finishedMs) || now - finishedMs > maxStaleMs) return null; // stale

	const record = snap.providers.find((p) => p.id === id);
	if (!record) return null; // provider not in this snapshot

	return mapProvider(record, prev, finishedMs);
}
