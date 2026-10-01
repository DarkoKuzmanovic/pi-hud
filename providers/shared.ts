import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

export function readAuth(): Record<string, unknown> {
	try {
		if (!existsSync(AUTH_PATH)) return {};
		return JSON.parse(readFileSync(AUTH_PATH, "utf8"));
	} catch {
		return {};
	}
}

/** A single auth.json entry, narrowed from `unknown` for safe field access. */
interface AuthEntry {
	type?: unknown;
	access?: unknown;
	accountId?: unknown;
	refresh?: unknown;
	expires?: unknown;
	key?: unknown;
}

function isAuthEntry(value: unknown): value is AuthEntry {
	return typeof value === "object" && value !== null;
}

export interface CodexAuth {
	access: string;
	accountId: string;
	refresh?: string;
	expires?: number;
	/** "pi" = legacy openai-codex login in Pi's auth.json; "codex-cli" = Codex CLI's auth.json (read-only). */
	source: "pi" | "codex-cli";
}

/**
 * Credential for the ChatGPT Codex usage endpoint.
 *
 * Pi's current openai subscription login issues an api.openai.com token without a
 * ChatGPT account id, which the usage endpoint rejects. Prefer the legacy Pi
 * openai-codex login when present, then fall back to the Codex CLI login.
 */
export function readCodexAuth(): CodexAuth | null {
	const cred = readAuth()["openai-codex"];
	if (
		isAuthEntry(cred) &&
		cred.type === "oauth" &&
		typeof cred.access === "string" &&
		typeof cred.accountId === "string"
	) {
		return {
			access: cred.access,
			accountId: cred.accountId,
			refresh: typeof cred.refresh === "string" ? cred.refresh : undefined,
			expires: typeof cred.expires === "number" ? cred.expires : undefined,
			source: "pi",
		};
	}
	return readCodexCliAuth();
}

function readCodexCliAuth(): CodexAuth | null {
	const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
	const path = join(codexHome, "auth.json");
	try {
		if (!existsSync(path)) return null;
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isAuthEntry(parsed)) return null;
		const tokens = (parsed as Record<string, unknown>).tokens;
		if (!isAuthEntry(tokens)) return null;
		const { access_token: access, account_id: accountId } = tokens as Record<string, unknown>;
		if (typeof access !== "string" || typeof accountId !== "string") return null;
		// No refresh token on purpose: refresh tokens rotate, and refreshing here would
		// invalidate the Codex CLI's stored login. The CLI refreshes its own tokens.
		return { access, accountId, source: "codex-cli" };
	} catch {
		return null;
	}
}

export function readAnthropicAuth(): { access: string } | null {
	const cred = readAuth().anthropic;
	if (!isAuthEntry(cred) || cred.type !== "oauth" || typeof cred.access !== "string")
		return null;
	return { access: cred.access };
}

export function readMinimaxAuth(): { access: string } | null {
	const cred = readAuth().minimax;
	if (isAuthEntry(cred) && cred.type === "api_key" && typeof cred.key === "string") {
		return { access: cred.key };
	}
	const env = process.env.MINIMAX_API_KEY;
	if (env) return { access: env };
	return null;
}

export function readUmansAuth(): { access: string } | null {
	const cred = readAuth().umans;
	if (isAuthEntry(cred)) {
		if (cred.type === "oauth" && typeof cred.access === "string")
			return { access: cred.access };
		if (cred.type === "api_key" && typeof cred.key === "string")
			return { access: cred.key };
	}
	const env = process.env.UMANS_API_KEY;
	if (env) return { access: env };
	return null;
}

export function readKimiAuth(): { access: string } | null {
	const cred = readAuth()["kimi-coding"];
	if (isAuthEntry(cred)) {
		if (cred.type === "oauth" && typeof cred.access === "string")
			return { access: cred.access };
		if (cred.type === "api_key" && typeof cred.key === "string")
			return { access: cred.key };
	}
	const env = process.env.KIMI_API_KEY;
	if (env) return { access: env };
	return null;
}


export function readXaiAuth(): { access: string } | null {
	// Prefer the entry pi's built-in xai provider refreshes; fall back to
	// alternates so a grok-cli/pi-grok-cli login also works.
	const auth = readAuth();
	for (const key of ["xai", "xai-auth", "grok-cli"]) {
		const cred = auth[key];
		if (isAuthEntry(cred) && cred.type === "oauth" && typeof cred.access === "string")
			return { access: cred.access };
	}
	const env = process.env.GROK_CLI_OAUTH_TOKEN;
	if (env) return { access: env };
	return null;
}

// --- Shared fetch helper ---

export interface FetchOptions {
	url: string;
	headers?: Record<string, string>;
	maxBytes?: number;
	timeoutMs?: number;
	/** HTTP status codes that indicate auth is needed (default: [401, 403]) */
	authNeededCodes?: number[];
	/** HTTP status codes that indicate session expired via redirect (default: [302, 303, 307]) */
	redirectCodes?: number[];
	/** Substrings in response body that indicate unauthenticated page */
	authNeededBodyPatterns?: string[];
}

export interface FetchResult {
	status: number;
	body: string;
}

export class FetchError extends Error {
	constructor(
		public readonly kind:
			| "network"
			| "timeout"
			| "large"
			| "auth-needed"
			| "http-error",
		message: string,
		public readonly statusCode?: number,
		/** Milliseconds until the caller may safely retry, parsed from Retry-After when present. */
		public readonly retryAfterMs?: number,
	) {
		super(message);
	}
}

function parseRetryAfterMs(headerValue: string | null): number | undefined {
	if (!headerValue) return undefined;
	const trimmed = headerValue.trim();
	if (!trimmed) return undefined;
	const seconds = Number.parseInt(trimmed, 10);
	if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
	const dateMs = Date.parse(trimmed);
	if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
	return undefined;
}

/**
 * Generic HTTP GET with timeout, size limit, and auth-needed detection.
 * Standardized replacement for the per-provider httpsRequest boilerplate.
 */
export async function fetchWithAuth(opts: FetchOptions): Promise<FetchResult> {
	const {
		url,
		headers = {},
		maxBytes = 64 * 1024,
		timeoutMs = 15_000,
		authNeededCodes = [401, 403],
		redirectCodes = [302, 303, 307],
		authNeededBodyPatterns = [],
	} = opts;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				"User-Agent": "pi-usage-footer",
				...headers,
			},
			redirect: "manual", // Don't follow redirects — they often mean "go login"
			signal: controller.signal,
		});

		const statusCode = response.status;

		if (redirectCodes.includes(statusCode)) {
			await response.body?.cancel().catch(() => {});
			throw new FetchError("auth-needed", "session", statusCode);
		}
		if (authNeededCodes.includes(statusCode)) {
			await response.body?.cancel().catch(() => {});
			throw new FetchError("auth-needed", "expired", statusCode);
		}
		if (statusCode < 200 || statusCode >= 300) {
			const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
			await response.body?.cancel().catch(() => {});
			throw new FetchError("http-error", `http ${statusCode}`, statusCode, retryAfterMs);
		}

		// Stream the body with a size limit
		const reader = response.body?.getReader();
		if (!reader) throw new FetchError("network", "no body");

		const chunks: Uint8Array[] = [];
		let totalBytes = 0;

		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				void reader.cancel().catch(() => {});
				throw new FetchError("large", "large response");
			}
			chunks.push(value);
		}

		const decoder = new TextDecoder();
		const body =
			chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
			decoder.decode();

		// Check body patterns for auth-needed pages
		for (const pattern of authNeededBodyPatterns) {
			if (body.includes(pattern)) {
				throw new FetchError("auth-needed", "no session", statusCode);
			}
		}

		return { status: statusCode, body };
	} catch (err) {
		if (err instanceof FetchError) throw err;
		if (err instanceof Error && err.name === "AbortError") {
			throw new FetchError("timeout", "timeout");
		}
		throw new FetchError("network", "network");
	} finally {
		clearTimeout(timer);
	}
}
