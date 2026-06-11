import { readCodexAuth, readAuth, writeAuth } from "./shared.js";
import { fetchWithAuth, FetchError } from "./shared.js";
import type { CodexUsageResponse, CodexFetchResult, ProviderUsage } from "../types.js";
import { spawn } from "node:child_process";

function isValidCodexResponse(value: unknown): value is CodexUsageResponse {
	if (!value || typeof value !== "object") return false;
	const rateLimit = (value as Record<string, unknown>).rate_limit;
	return rateLimit === undefined || (typeof rateLimit === "object" && rateLimit !== null);
}

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/codex/usage";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const BROWSER_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

interface RefreshedCodexAuth {
	access: string;
	refresh?: string;
	expires?: number;
}

interface CurlResponse {
	statusCode: number;
	body: string;
}

function codexHeaders(access: string, accountId: string): Record<string, string> {
	return {
		Authorization: `Bearer ${access}`,
		"chatgpt-account-id": accountId,
		"OpenAI-Beta": "responses=experimental",
		"User-Agent": BROWSER_USER_AGENT,
	};
}

function parseCodexUsageBody(body: string): CodexFetchResult {
	const parsed: unknown = JSON.parse(body);
	if (!isValidCodexResponse(parsed)) return { usage: null, status: "error", message: "bad shape" };
	return { usage: parsed, status: "ok" };
}

function escapeCurlConfigValue(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
}

async function fetchCodexUsageViaCurl(access: string, accountId: string): Promise<CodexFetchResult> {
	const response = await runCurlConfig([
		"silent",
		"show-error",
		"location",
		"max-time = 15",
		'write-out = "\\nHTTP_STATUS:%{http_code}"',
		`url = "${CODEX_USAGE_URL}"`,
		`header = "Authorization: Bearer ${escapeCurlConfigValue(access)}"`,
		`header = "chatgpt-account-id: ${escapeCurlConfigValue(accountId)}"`,
		'header = "OpenAI-Beta: responses=experimental"',
		`header = "User-Agent: ${BROWSER_USER_AGENT}"`,
	]);
	if (response.statusCode === 401 || response.statusCode === 403) {
		throw new FetchError("auth-needed", "expired", response.statusCode);
	}
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new FetchError("http-error", `http ${response.statusCode}`, response.statusCode);
	}
	return parseCodexUsageBody(response.body);
}

async function runCurlConfig(configLines: string[]): Promise<CurlResponse> {
	return new Promise((resolve, reject) => {
		const child = spawn("curl", ["--config", "-"], { stdio: ["pipe", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		const maxBytes = 128 * 1024;
		const timer = setTimeout(() => {
			child.kill();
			reject(new FetchError("timeout", "timeout"));
		}, 15_000);

		child.stdout.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.byteLength;
			if (stdoutBytes > maxBytes) {
				child.kill();
				reject(new FetchError("large", "large response"));
				return;
			}
			stdoutChunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrBytes += chunk.byteLength;
			if (stderrBytes <= 4096) stderrChunks.push(chunk);
		});
		child.on("error", () => {
			clearTimeout(timer);
			reject(new FetchError("network", "curl unavailable"));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
				reject(new FetchError("network", stderr || "curl failed"));
				return;
			}
			const output = Buffer.concat(stdoutChunks).toString("utf8");
			const marker = "\nHTTP_STATUS:";
			const markerIndex = output.lastIndexOf(marker);
			if (markerIndex < 0) {
				reject(new FetchError("network", "curl status missing"));
				return;
			}
			const statusCode = Number.parseInt(output.slice(markerIndex + marker.length).trim(), 10);
			if (!Number.isFinite(statusCode)) {
				reject(new FetchError("network", "curl status invalid"));
				return;
			}
			resolve({ statusCode, body: output.slice(0, markerIndex) });
		});
		child.stdin.end(`${configLines.join("\n")}\n`);
	});
}

function isRefreshResponse(value: unknown): value is { access_token: string; refresh_token?: string; expires_in?: number } {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return typeof record.access_token === "string";
}

async function refreshCodexAuth(refreshToken: string): Promise<RefreshedCodexAuth | null> {
	try {
		const res = await fetch(OPENAI_OAUTH_TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": BROWSER_USER_AGENT,
			},
			body: JSON.stringify({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			}),
		});
		if (!res.ok) return null;
		const parsed: unknown = await res.json();
		if (!isRefreshResponse(parsed)) return null;
		return {
			access: parsed.access_token,
			refresh: parsed.refresh_token,
			expires: parsed.expires_in ? Date.now() + parsed.expires_in * 1000 : undefined,
		};
	} catch {
		return null;
	}
}

function persistCodexAuth(refreshed: RefreshedCodexAuth): void {
	const auth = readAuth();
	const previous = auth["openai-codex"];
	if (!previous || typeof previous !== "object") return;
	auth["openai-codex"] = {
		...previous,
		access: refreshed.access,
		refresh: refreshed.refresh ?? (previous as { refresh?: unknown }).refresh,
		expires: refreshed.expires ?? (previous as { expires?: unknown }).expires,
	};
	writeAuth(auth);
}

async function fetchCodexUsageWithAccess(access: string, accountId: string): Promise<CodexFetchResult> {
	try {
		const { body } = await fetchWithAuth({
			url: CODEX_USAGE_URL,
			headers: codexHeaders(access, accountId),
		});
		return parseCodexUsageBody(body);
	} catch (err) {
		if (err instanceof FetchError && err.kind === "auth-needed") {
			return await fetchCodexUsageViaCurl(access, accountId);
		}
		throw err;
	}
}

export async function fetchCodexUsage(): Promise<CodexFetchResult> {
	const cred = readCodexAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	try {
		return await fetchCodexUsageWithAccess(cred.access, cred.accountId);
	} catch (err) {
		if (!(err instanceof FetchError)) {
			return err instanceof SyntaxError
				? { usage: null, status: "error", message: "bad json" }
				: { usage: null, status: "error", message: "network" };
		}
		if (err.kind !== "auth-needed" || !cred.refresh) {
			if (err.kind === "auth-needed") return { usage: null, status: "auth-needed", message: err.message };
			return { usage: null, status: "error", message: err.message };
		}
		const refreshed = await refreshCodexAuth(cred.refresh);
		if (!refreshed) return { usage: null, status: "auth-needed", message: err.message };
		persistCodexAuth(refreshed);
		try {
			return await fetchCodexUsageWithAccess(refreshed.access, cred.accountId);
		} catch (retryErr) {
			if (retryErr instanceof SyntaxError) return { usage: null, status: "error", message: "bad json" };
			if (retryErr instanceof FetchError) {
				if (retryErr.kind === "auth-needed") return { usage: null, status: "auth-needed", message: retryErr.message };
				return { usage: null, status: "error", message: retryErr.message };
			}
			return { usage: null, status: "error", message: "network" };
		}
	}
}

export function codexToProvider(result: CodexFetchResult, previous?: ProviderUsage): ProviderUsage {
	const primary = result.usage?.rate_limit?.primary_window;
	const secondary = result.usage?.rate_limit?.secondary_window;
	if (result.status !== "ok") {
		return {
			id: "codex",
			name: "Codex",
			icon: "\udb80\ude29",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}
	return {
		id: "codex",
		name: "Codex",
		icon: "\udb80\ude29",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{ label: "5h", usedPercent: primary?.used_percent, resetAt: primary?.reset_at ? primary.reset_at * 1000 : undefined },
			{ label: "week", usedPercent: secondary?.used_percent, resetAt: secondary?.reset_at ? secondary.reset_at * 1000 : undefined },
		],
	};
}
