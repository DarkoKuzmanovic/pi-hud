import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

export function readAuth(): Record<string, any> {
	try {
		if (!existsSync(AUTH_PATH)) return {};
		return JSON.parse(readFileSync(AUTH_PATH, "utf8"));
	} catch {
		return {};
	}
}

export function readCodexAuth(): { access: string; accountId: string } | null {
	const cred = readAuth()["openai-codex"];
	if (!cred || cred.type !== "oauth" || typeof cred.access !== "string" || typeof cred.accountId !== "string") return null;
	return { access: cred.access, accountId: cred.accountId };
}

export function readAnthropicAuth(): { access: string } | null {
	const cred = readAuth().anthropic;
	if (!cred || cred.type !== "oauth" || typeof cred.access !== "string") return null;
	return { access: cred.access };
}

export function readWaferAuth(): { access: string } | null {
	const cred = readAuth().wafer;
	if (!cred) return null;
	if (cred.type === "oauth" && typeof cred.access === "string") return { access: cred.access };
	if (cred.type === "api_key" && typeof cred.key === "string") return { access: cred.key };
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
		public readonly kind: "network" | "timeout" | "large" | "auth-needed" | "http-error",
		message: string,
		public readonly statusCode?: number,
	) {
		super(message);
	}
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
			throw new FetchError("auth-needed", "session", statusCode);
		}
		if (authNeededCodes.includes(statusCode)) {
			throw new FetchError("auth-needed", "expired", statusCode);
		}
		if (statusCode < 200 || statusCode >= 300) {
			throw new FetchError("http-error", `http ${statusCode}`, statusCode);
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
				reader.cancel();
				throw new FetchError("large", "large response");
			}
			chunks.push(value);
		}

		const decoder = new TextDecoder();
		const body = chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();

		// Check body patterns for auth-needed pages
		for (const pattern of authNeededBodyPatterns) {
			if (body.includes(pattern)) {
				throw new FetchError("auth-needed", "no session", statusCode);
			}
		}

		return { status: statusCode, body };
	} catch (err) {
		if (err instanceof FetchError) throw err;
		if ((err as any).name === "AbortError") {
			throw new FetchError("timeout", "timeout");
		}
		throw new FetchError("network", "network");
	} finally {
		clearTimeout(timer);
	}
}
