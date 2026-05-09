import { existsSync, readFileSync, copyFileSync, unlinkSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { basename } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");
const FIREFOX_PROFILES_DIR = join(homedir(), ".mozilla", "firefox");
const QUOTA_REFRESH_MS = 60_000;
const GIT_REFRESH_MS = 5_000;
const HIDDEN_STATUSES = new Set(["claude-oauth-ready", "claude-oauth-issue"]);
const MAX_RESPONSE_BYTES = 64 * 1024;
const WAFER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const OPENCODE_WORKSPACE_ID = "wrk_01KQ5QT3CGXXERVF8ZHENJHT79";

type WindowLabel = "5h" | "week" | "month";
type ProviderId = "codex" | "anthropic" | "ollama-cloud" | "wafer" | "opencode";
type ProviderStatus = "ok" | "unknown" | "auth-needed" | "error";

interface UsageWindow {
	label: WindowLabel;
	usedPercent?: number;
	usedCount?: number;
	limitCount?: number;
	resetAt?: number;
}

interface ProviderUsage {
	id: ProviderId;
	name: string;
	icon: string;
	status: ProviderStatus;
	message?: string;
	updatedAt?: number;
	windows: UsageWindow[];
}

interface CodexUsageWindow {
	used_percent: number;
	limit_window_seconds: number;
	reset_after_seconds: number;
	reset_at: number;
}

interface CodexUsageResponse {
	plan_type?: string;
	rate_limit?: {
		allowed: boolean;
		limit_reached: boolean;
		primary_window?: CodexUsageWindow | null;
		secondary_window?: CodexUsageWindow | null;
	};
}

interface CodexFetchResult {
	usage: CodexUsageResponse | null;
	status: ProviderStatus;
	message?: string;
}

interface AnthropicUsageWindow {
	utilization: number;
	resets_at: string | null;
}

interface AnthropicUsageResponse {
	five_hour?: AnthropicUsageWindow | null;
	seven_day?: AnthropicUsageWindow | null;
	seven_day_oauth_apps?: AnthropicUsageWindow | null;
	seven_day_opus?: AnthropicUsageWindow | null;
}

interface AnthropicFetchResult {
	usage: AnthropicUsageResponse | null;
	status: ProviderStatus;
	message?: string;
}

interface OllamaUsageData {
	sessionPercent: number;
	weeklyPercent: number;
	sessionResetAt: number;
	weeklyResetAt: number;
}

interface OllamaFetchResult {
	usage: OllamaUsageData | null;
	status: ProviderStatus;
	message?: string;
}

interface WaferUsageData {
	windowPercent: number;
	windowRequests?: number;
	windowRequestLimit?: number;
	windowResetAt: number;
}

interface WaferFetchResult {
	usage: WaferUsageData | null;
	status: ProviderStatus;
	message?: string;
}

interface OpenCodeUsageData {
	rollingPercent: number;
	rollingResetAt: number;
	weeklyPercent: number;
	weeklyResetAt: number;
	monthlyPercent: number;
	monthlyResetAt: number;
}

interface OpenCodeFetchResult {
	usage: OpenCodeUsageData | null;
	status: ProviderStatus;
	message?: string;
}

function readAuth(): Record<string, any> {
	try {
		if (!existsSync(AUTH_PATH)) return {};
		return JSON.parse(readFileSync(AUTH_PATH, "utf8"));
	} catch {
		return {};
	}
}

function readCodexAuth(): { access: string; accountId: string } | null {
	const cred = readAuth()["openai-codex"];
	if (!cred || cred.type !== "oauth" || typeof cred.access !== "string" || typeof cred.accountId !== "string") return null;
	return { access: cred.access, accountId: cred.accountId };
}

function readAnthropicAuth(): { access: string } | null {
	const cred = readAuth().anthropic;
	if (!cred || cred.type !== "oauth" || typeof cred.access !== "string") return null;
	return { access: cred.access };
}

function hasAnthropicOAuth(): boolean {
	return !!readAnthropicAuth();
}

function readWaferAuth(): { access: string } | null {
	const cred = readAuth().wafer;
	if (!cred) return null;
	if (cred.type === "oauth" && typeof cred.access === "string") return { access: cred.access };
	if (cred.type === "api_key" && typeof cred.key === "string") return { access: cred.key };
	return null;
}

// --- Wafer: read cookies from Firefox, scrape app.wafer.ai/usage HTML ---

function readWaferCookies(): string | null {
	const profileDir = findFirefoxProfileDir();
	if (!profileDir) return null;

	const dbPath = join(profileDir, "cookies.sqlite");
	if (!existsSync(dbPath)) return null;

	const tmpPath = join("/tmp", `pi-hud-wafer-cookies-${Date.now()}.sqlite`);
	try {
		copyFileSync(dbPath, tmpPath);
	} catch {
		return null;
	}

	try {
		const out = execSync(
			`sqlite3 "${tmpPath}" "SELECT name, value FROM moz_cookies WHERE host IN ('app.wafer.ai', '.app.wafer.ai', 'wafer.ai', '.wafer.ai') AND expiry > strftime('%s','now')"`,
			{ encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
		).trim();

		if (!out) return null;

		const cookies: string[] = [];
		for (const line of out.split("\n")) {
			const sep = line.indexOf("|");
			if (sep > 0) cookies.push(`${line.slice(0, sep)}=${line.slice(sep + 1)}`);
		}
		return cookies.length > 0 ? cookies.join("; ") : null;
	} catch {
		return null;
	} finally {
		try { unlinkSync(tmpPath); } catch { /* ignore */ }
	}
}

function htmlToText(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&#x2F;|&#47;/gi, "/")
		.replace(/\s+/g, " ")
		.trim();
}

function parseNumber(text: string | undefined): number | undefined {
	if (!text) return undefined;
	const n = Number.parseFloat(text.replace(/,/g, ""));
	return Number.isFinite(n) ? n : undefined;
}

function parseRemainingMs(text: string): number | undefined {
	// "2h 58m remaining" or "3h remaining"
	const m = text.match(/(\d+)h\s*(?:(\d+)m)?\s*remaining/i);
	if (!m) return undefined;
	const hours = parseInt(m[1], 10);
	const mins = m[2] ? parseInt(m[2], 10) : 0;
	return Date.now() + hours * 3_600_000 + mins * 60_000;
}

function parseWaferUsage(html: string): WaferUsageData | null {
	try {
		const text = htmlToText(html);
		const windowStart = text.search(/WAFER PASS WINDOW/i);
		const windowEnd = windowStart >= 0 ? text.slice(windowStart).search(/OVERAGE BILLING|RECENT CLOSED WINDOWS/i) : -1;
		const windowText = windowStart >= 0
			? text.slice(windowStart, windowEnd > 0 ? windowStart + windowEnd : undefined)
			: text;

		const requestMatch = windowText.match(/REQUESTS\s*([\d,]+)\s*\/\s*([\d,]+)/i);
		const usedMatch = windowText.match(/USED\s*([\d.]+)\s*%/i);
		const requests = parseNumber(requestMatch?.[1]);
		const requestLimit = parseNumber(requestMatch?.[2]);
		const usedPercent = parseNumber(usedMatch?.[1]);
		const remainingMs = parseRemainingMs(windowText);
		if (requests !== undefined && requestLimit !== undefined) {
			return {
				windowPercent: usedPercent ?? (requestLimit > 0 ? (requests / requestLimit) * 100 : 0),
				windowRequests: requests,
				windowRequestLimit: requestLimit,
				windowResetAt: remainingMs ?? 0,
			};
		}

		const pctMatch = html.match(/data-percent="([\d.]+)"/);
		const resetMatch = html.match(/data-reset="([^"]+)"/);
		if (pctMatch) {
			return {
				windowPercent: parseFloat(pctMatch[1]),
				windowResetAt: resetMatch ? Date.parse(resetMatch[1]) : 0,
			};
		}

		const textPctMatch = windowText.match(/([\d.]+)\s*%/);
		if (textPctMatch) {
			return {
				windowPercent: parseFloat(textPctMatch[1]),
				windowResetAt: 0,
			};
		}

		return null;
	} catch {
		return null;
	}
}

async function fetchWaferUsage(): Promise<WaferFetchResult> {
	const cookieHeader = readWaferCookies();
	if (!cookieHeader) return { usage: null, status: "auth-needed", message: "login" };

	return await new Promise<WaferFetchResult>((resolve) => {
		let done = false;
		const finish = (result: WaferFetchResult) => {
			if (done) return;
			done = true;
			resolve(result);
		};

		const req = httpsRequest(
			"https://app.wafer.ai/usage",
			{
				method: "GET",
				headers: {
					"Cookie": cookieHeader,
					"User-Agent": "pi-usage-footer",
					"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
					if (body.length > WAFER_MAX_RESPONSE_BYTES) {
						req.destroy();
						finish({ usage: null, status: "error", message: "large response" });
					}
				});
				res.on("end", () => {
					const statusCode = res.statusCode ?? 500;
					if (statusCode === 302 || statusCode === 303 || statusCode === 307) return finish({ usage: null, status: "auth-needed", message: "session" });
					if (statusCode === 401 || statusCode === 403) return finish({ usage: null, status: "auth-needed", message: "expired" });
					if (statusCode < 200 || statusCode >= 300) return finish({ usage: null, status: "error", message: `http ${statusCode}` });

					if (body.includes("Sign in") || body.includes("Continue with")) return finish({ usage: null, status: "auth-needed", message: "no session" });

					const parsed = parseWaferUsage(body);
					if (!parsed) return finish({ usage: null, status: "error", message: "parse" });

					finish({ usage: parsed, status: "ok" });
				});
			},
		);
		req.on("error", () => finish({ usage: null, status: "error", message: "network" }));
		req.setTimeout(15_000, () => {
			req.destroy();
			finish({ usage: null, status: "error", message: "timeout" });
		});
		req.end();
	});
}

// --- Ollama Cloud: read session cookies from Firefox, scrape /settings HTML ---

let cachedOllamaProfileDir: string | null = null;

function findFirefoxProfileDir(): string | null {
	if (cachedOllamaProfileDir) {
		if (existsSync(join(cachedOllamaProfileDir, "cookies.sqlite"))) return cachedOllamaProfileDir;
		cachedOllamaProfileDir = null;
	}

	// Try profiles.ini to find the default profile
	const iniPath = join(FIREFOX_PROFILES_DIR, "profiles.ini");
	if (existsSync(iniPath)) {
		try {
			const ini = readFileSync(iniPath, "utf8");
			const sections: Array<Record<string, string>> = [];
			let current: Record<string, string> = {};
			for (const rawLine of ini.split("\n")) {
				const line = rawLine.trim();
				if (line.startsWith("[") && line.endsWith("]")) {
					current = {};
					sections.push(current);
				} else if (line.includes("=")) {
					const eq = line.indexOf("=");
					current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
				}
			}
			// Prefer the profile marked Default=1
			for (const sec of sections) {
				if (sec.Default === "1" && sec.Path) {
					const dir = sec.IsRelative === "1" ? join(FIREFOX_PROFILES_DIR, sec.Path) : sec.Path;
					if (existsSync(join(dir, "cookies.sqlite"))) return (cachedOllamaProfileDir = dir);
				}
			}
			// Fall back to any profile with a Path
			for (const sec of sections) {
				if (sec.Path) {
					const dir = sec.IsRelative === "1" ? join(FIREFOX_PROFILES_DIR, sec.Path) : sec.Path;
					if (existsSync(join(dir, "cookies.sqlite"))) return (cachedOllamaProfileDir = dir);
				}
			}
		} catch { /* fall through */ }
	}

	// Last resort: find any .default* directory with cookies.sqlite
	try {
		const entries = execSync(`ls -1d "${FIREFOX_PROFILES_DIR}"/*.default* 2>/dev/null`, {
			encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
		}).trim().split("\n").filter(Boolean);
		for (const dir of entries) {
			if (existsSync(join(dir, "cookies.sqlite"))) return (cachedOllamaProfileDir = dir);
		}
	} catch { /* not found */ }

	return null;
}

function readOllamaCookies(): string | null {
	const profileDir = findFirefoxProfileDir();
	if (!profileDir) return null;

	const dbPath = join(profileDir, "cookies.sqlite");
	if (!existsSync(dbPath)) return null;

	// Copy to temp — Firefox locks the live DB
	const tmpPath = join("/tmp", `pi-hud-ollama-cookies-${Date.now()}.sqlite`);
	try {
		copyFileSync(dbPath, tmpPath);
	} catch {
		return null;
	}

	try {
		// Query for non-expired ollama.com cookies
		// sqlite3 default separator is |; name never contains | so split on first |
		const out = execSync(
			`sqlite3 "${tmpPath}" "SELECT name, value FROM moz_cookies WHERE host = 'ollama.com' AND name IN ('__Secure-session', 'aid') AND expiry > strftime('%s','now')"`,
			{ encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
		).trim();

		if (!out) return null;

		const cookies: string[] = [];
		for (const line of out.split("\n")) {
			const sep = line.indexOf("|");
			if (sep > 0) cookies.push(`${line.slice(0, sep)}=${line.slice(sep + 1)}`);
		}
		return cookies.length > 0 ? cookies.join("; ") : null;
	} catch {
		return null;
	} finally {
		try { unlinkSync(tmpPath); } catch { /* ignore */ }
	}
}

function readOpenCodeCookies(): string | null {
	const profileDir = findFirefoxProfileDir();
	if (!profileDir) return null;

	const dbPath = join(profileDir, "cookies.sqlite");
	if (!existsSync(dbPath)) return null;

	const tmpPath = join("/tmp", `pi-hud-opencode-cookies-${Date.now()}.sqlite`);
	try {
		copyFileSync(dbPath, tmpPath);
	} catch {
		return null;
	}

	try {
		const out = execSync(
			`sqlite3 "${tmpPath}" "SELECT value FROM moz_cookies WHERE host IN ('opencode.ai', '.opencode.ai') AND name = 'auth' AND expiry > strftime('%s','now') LIMIT 1"`,
			{ encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
		).trim();

		return out || null;
	} catch {
		return null;
	} finally {
		try { unlinkSync(tmpPath); } catch { /* ignore */ }
	}
}

function parseOllamaUsage(html: string): OllamaUsageData | null {
	try {
		// Extract session and weekly usage percentages: <span class="text-sm">X% used</span>
		const pctPattern = /<span class="text-sm">([\d.]+)% used<\/span>/g;
		const pcts: number[] = [];
		let m: RegExpExecArray | null;
		while ((m = pctPattern.exec(html)) !== null) {
			pcts.push(parseFloat(m[1]));
		}

		// Extract reset timestamps: data-time="ISO_TIMESTAMP"
		const timePattern = /data-time="([^"]+)"/g;
		const times: number[] = [];
		while ((m = timePattern.exec(html)) !== null) {
			const ts = Date.parse(m[1]);
			if (Number.isFinite(ts)) times.push(ts);
		}

		if (pcts.length < 2 || times.length < 2) return null;

		return {
			sessionPercent: pcts[0],
			weeklyPercent: pcts[1],
			sessionResetAt: times[0],
			weeklyResetAt: times[1],
		};
	} catch {
		return null;
	}
}

// --- OpenCode Go: read auth cookie from Firefox, fetch usage API (fallback: HTML scrape) ---

function parseOpenCodeApiResponse(json: any): OpenCodeUsageData | null {
	try {
		if (!json || typeof json !== "object") return null;
		const rolling = json.rolling;
		const weekly = json.weekly;
		const monthly = json.monthly;
		if (!rolling || !weekly || !monthly) return null;
		return {
			rollingPercent: rolling.usagePercent,
			rollingResetAt: Date.now() + (rolling.resetsInSeconds ?? 0) * 1000,
			weeklyPercent: weekly.usagePercent,
			weeklyResetAt: Date.now() + (weekly.resetsInSeconds ?? 0) * 1000,
			monthlyPercent: monthly.usagePercent,
			monthlyResetAt: Date.now() + (monthly.resetsInSeconds ?? 0) * 1000,
		};
	} catch {
		return null;
	}
}

function parseOpenCodeHtml(html: string): OpenCodeUsageData | null {
	try {
		// SolidJS SSR hydration: rollingUsage:$R[N]={status:"ok",resetInSec:N,usagePercent:N}
		// The captured value is a JS object literal (unquoted keys), not JSON.
		// Extract numeric fields directly via regex instead of parsing.
		// SolidJS SSR hydration: rollingUsage:$R[30]={status:"ok",resetInSec:8412,usagePercent:8}
		// Extract percent and reset directly — avoid JSON.parse on JS object literals.
		const extractWindow = (prefix: string): { percent: number; resetAt: number } | null => {
			const marker = `${prefix}:`;
			const idx = html.indexOf(marker);
			if (idx < 0) return null;
			const segment = html.substring(idx + marker.length, idx + marker.length + 200);
			const m = /resetInSec:(\d+),usagePercent:(\d+)/.exec(segment);
			if (!m) return null;
			const resetInSec = parseInt(m[1], 10);
			const usagePercent = parseInt(m[2], 10);
			if (!Number.isFinite(resetInSec) || !Number.isFinite(usagePercent)) return null;
			return { percent: usagePercent, resetAt: Date.now() + resetInSec * 1000 };
		};

		const rolling = extractWindow("rollingUsage");
		const weekly = extractWindow("weeklyUsage");
		const monthly = extractWindow("monthlyUsage");
		if (!rolling || !weekly || !monthly) return null;

		return {
			rollingPercent: rolling.percent,
			rollingResetAt: rolling.resetAt,
			weeklyPercent: weekly.percent,
			weeklyResetAt: weekly.resetAt,
			monthlyPercent: monthly.percent,
			monthlyResetAt: monthly.resetAt,
		};
	} catch {
		return null;
	}
}

async function fetchOpenCodeUsage(): Promise<OpenCodeFetchResult> {
	const authCookie = readOpenCodeCookies();
	if (!authCookie) return { usage: null, status: "auth-needed", message: "login" };

	const cookieHeader = `auth=${authCookie}`;

	return new Promise<OpenCodeFetchResult>((resolve) => {
		let done = false;
		const finish = (result: OpenCodeFetchResult) => {
			if (done) return;
			done = true;
			resolve(result);
		};

		const req = httpsRequest(
			`https://opencode.ai/workspace/${OPENCODE_WORKSPACE_ID}/go`,
			{
				method: "GET",
				headers: {
					"Cookie": cookieHeader,
					"User-Agent": "pi-usage-footer",
					"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
					if (body.length > MAX_RESPONSE_BYTES) {
						req.destroy();
						finish({ usage: null, status: "error", message: "large response" });
					}
				});
				res.on("end", () => {
					const statusCode = res.statusCode ?? 500;
					if (statusCode === 302 || statusCode === 303 || statusCode === 307) return finish({ usage: null, status: "auth-needed", message: "session" });
					if (statusCode === 401 || statusCode === 403) return finish({ usage: null, status: "auth-needed", message: "expired" });
					if (statusCode < 200 || statusCode >= 300) return finish({ usage: null, status: "error", message: `http ${statusCode}` });

					if (body.includes("Sign in") || body.includes("Log in")) return finish({ usage: null, status: "auth-needed", message: "no session" });

					const parsed = parseOpenCodeHtml(body);
					if (!parsed) return finish({ usage: null, status: "error", message: "parse" });

					finish({ usage: parsed, status: "ok" });
				});
			},
		);
		req.on("error", () => finish({ usage: null, status: "error", message: "network" }));
		req.setTimeout(15_000, () => {
			req.destroy();
			finish({ usage: null, status: "error", message: "timeout" });
		});
		req.end();
	});
}

function opencodeToProvider(result: OpenCodeFetchResult, previous?: ProviderUsage): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "opencode",
			name: "OpenCode",
			icon: "\u{1F7E2}",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }, { label: "month" }],
		};
	}
	return {
		id: "opencode",
		name: "OpenCode",
		icon: "\u{1F7E2}",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{ label: "5h", usedPercent: result.usage?.rollingPercent, resetAt: result.usage?.rollingResetAt },
			{ label: "week", usedPercent: result.usage?.weeklyPercent, resetAt: result.usage?.weeklyResetAt },
			{ label: "month", usedPercent: result.usage?.monthlyPercent, resetAt: result.usage?.monthlyResetAt },
		],
	};
}

async function fetchOllamaUsage(): Promise<OllamaFetchResult> {
	const cookieHeader = readOllamaCookies();
	if (!cookieHeader) return { usage: null, status: "auth-needed", message: "login" };

	return await new Promise<OllamaFetchResult>((resolve) => {
		let done = false;
		const finish = (result: OllamaFetchResult) => {
			if (done) return;
			done = true;
			resolve(result);
		};

		const req = httpsRequest(
			"https://ollama.com/settings",
			{
				method: "GET",
				headers: {
					"Cookie": cookieHeader,
					"User-Agent": "pi-usage-footer",
					"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
					if (body.length > MAX_RESPONSE_BYTES) {
						req.destroy();
						finish({ usage: null, status: "error", message: "large response" });
					}
				});
				res.on("end", () => {
					const statusCode = res.statusCode ?? 500;
					// Redirects mean session expired (unauthenticated → login page)
					if (statusCode === 302 || statusCode === 303 || statusCode === 307) return finish({ usage: null, status: "auth-needed", message: "session" });
					if (statusCode === 401 || statusCode === 403) return finish({ usage: null, status: "auth-needed", message: "expired" });
					if (statusCode < 200 || statusCode >= 300) return finish({ usage: null, status: "error", message: `http ${statusCode}` });

					// Verify we got the authenticated page (not a login form)
					if (!body.includes("Cloud Usage")) return finish({ usage: null, status: "auth-needed", message: "no session" });

					const parsed = parseOllamaUsage(body);
					if (!parsed) return finish({ usage: null, status: "error", message: "parse" });

					finish({ usage: parsed, status: "ok" });
				});
			},
		);
		req.on("error", () => finish({ usage: null, status: "error", message: "network" }));
		req.setTimeout(15_000, () => {
			req.destroy();
			finish({ usage: null, status: "error", message: "timeout" });
		});
		req.end();
	});
}

function isValidCodexResponse(value: unknown): value is CodexUsageResponse {
	if (!value || typeof value !== "object") return false;
	const rateLimit = (value as Record<string, unknown>).rate_limit;
	return rateLimit === undefined || (typeof rateLimit === "object" && rateLimit !== null);
}

async function fetchCodexUsage(): Promise<CodexFetchResult> {
	const cred = readCodexAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	return await new Promise<CodexFetchResult>((resolve) => {
		let done = false;
		const finish = (result: CodexFetchResult) => {
			if (done) return;
			done = true;
			resolve(result);
		};

		const req = httpsRequest(
			"https://chatgpt.com/backend-api/codex/usage",
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${cred.access}`,
					"chatgpt-account-id": cred.accountId,
					"OpenAI-Beta": "responses=experimental",
					"User-Agent": "pi-usage-footer",
				},
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
					if (body.length > MAX_RESPONSE_BYTES) {
						req.destroy();
						finish({ usage: null, status: "error", message: "large response" });
					}
				});
				res.on("end", () => {
					const statusCode = res.statusCode ?? 500;
					if (statusCode === 401 || statusCode === 403) return finish({ usage: null, status: "auth-needed", message: "expired" });
					if (statusCode < 200 || statusCode >= 300) return finish({ usage: null, status: "error", message: `http ${statusCode}` });
					try {
						const parsed: unknown = JSON.parse(body);
						if (!isValidCodexResponse(parsed)) return finish({ usage: null, status: "error", message: "bad shape" });
						finish({ usage: parsed, status: "ok" });
					} catch {
						finish({ usage: null, status: "error", message: "bad json" });
					}
				});
			},
		);
		req.on("error", () => finish({ usage: null, status: "error", message: "network" }));
		req.setTimeout(15_000, () => {
			req.destroy();
			finish({ usage: null, status: "error", message: "timeout" });
		});
		req.end();
	});
}

function codexToProvider(result: CodexFetchResult, previous?: ProviderUsage): ProviderUsage {
	const primary = result.usage?.rate_limit?.primary_window;
	const secondary = result.usage?.rate_limit?.secondary_window;
	if (result.status !== "ok") {
		return {
			id: "codex",
			name: "Codex",
			icon: "󰚩",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}
	return {
		id: "codex",
		name: "Codex",
		icon: "󰚩",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{ label: "5h", usedPercent: primary?.used_percent, resetAt: primary?.reset_at ? primary.reset_at * 1000 : undefined },
			{ label: "week", usedPercent: secondary?.used_percent, resetAt: secondary?.reset_at ? secondary.reset_at * 1000 : undefined },
		],
	};
}

function isValidAnthropicResponse(value: unknown): value is AnthropicUsageResponse {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	const validWindow = (window: unknown) => window == null || (typeof window === "object" && typeof (window as Record<string, unknown>).utilization === "number");
	return validWindow(record.five_hour) && validWindow(record.seven_day);
}

async function fetchAnthropicUsage(): Promise<AnthropicFetchResult> {
	const cred = readAnthropicAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	try {
		const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
			method: "GET",
			headers: {
				Accept: "application/json, text/plain, */*",
				"Content-Type": "application/json",
				"User-Agent": "claude-code/2.0.31",
				Authorization: `Bearer ${cred.access}`,
				"anthropic-beta": "oauth-2025-04-20",
			},
		});
		if (response.status === 401 || response.status === 403) return { usage: null, status: "auth-needed", message: "expired" };
		if (!response.ok) return { usage: null, status: "error", message: `http ${response.status}` };
		const parsed: unknown = await response.json();
		if (!isValidAnthropicResponse(parsed)) return { usage: null, status: "error", message: "bad shape" };
		return { usage: parsed, status: "ok" };
	} catch {
		return { usage: null, status: "error", message: "network" };
	}
}

function anthropicToProvider(result: AnthropicFetchResult, previous?: ProviderUsage): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "anthropic",
			name: "Claude",
			icon: "󰒋",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}
	return {
		id: "anthropic",
		name: "Claude",
		icon: "󰒋",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{ label: "5h", usedPercent: result.usage?.five_hour?.utilization, resetAt: result.usage?.five_hour?.resets_at ? Date.parse(result.usage.five_hour.resets_at) : undefined },
			{ label: "week", usedPercent: result.usage?.seven_day?.utilization, resetAt: result.usage?.seven_day?.resets_at ? Date.parse(result.usage.seven_day.resets_at) : undefined },
		],
	};
}

function ollamaToProvider(result: OllamaFetchResult, previous?: ProviderUsage): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "ollama-cloud",
			name: "Ollama",
			icon: "\u{1F999}",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}
	return {
		id: "ollama-cloud",
		name: "Ollama",
		icon: "\u{1F999}",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{ label: "5h", usedPercent: result.usage?.sessionPercent, resetAt: result.usage?.sessionResetAt },
			{ label: "week", usedPercent: result.usage?.weeklyPercent, resetAt: result.usage?.weeklyResetAt },
		],
	};
}

function waferToProvider(result: WaferFetchResult, previous?: ProviderUsage): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "wafer",
			name: "Wafer",
			icon: "\u{1F35E}",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }],
		};
	}
	return {
		id: "wafer",
		name: "Wafer",
		icon: "\u{1F35E}",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{
				label: "5h",
				usedPercent: result.usage?.windowPercent,
				usedCount: result.usage?.windowRequests,
				limitCount: result.usage?.windowRequestLimit,
				resetAt: result.usage?.windowResetAt || undefined,
			},
		],
	};
}

function fmtInt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${Math.round(n)}`;
}

function fmtMoney(n: number): string {
	return `$${n.toFixed(3)}`;
}

function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "now";
	const totalMinutes = Math.ceil(ms / 60_000);
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d${hours ? `${hours}h` : ""}`;
	if (hours > 0) return `${hours}h${minutes ? `${minutes}m` : ""}`;
	return `${minutes}m`;
}

function compactPath(cwd: string): string {
	const home = homedir();
	const next = cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
	const parts = next.split("/").filter(Boolean);
	if (parts.length <= 3) return next;
	return `${parts[0] === "~" ? "~/" : "/"}${parts.slice(-3).join("/")}`;
}

function usageColor(percent: number | undefined): "success" | "warning" | "error" | "muted" {
	if (percent === undefined || !Number.isFinite(percent)) return "muted";
	if (percent >= 90) return "error";
	if (percent >= 75) return "warning";
	return "success";
}

function formatPercent(percent: number, precise = false): string {
	return `${precise ? percent.toFixed(1) : Math.round(percent)}%`;
}

function formatCount(count: number): string {
	return `${Math.round(count)}`;
}

function renderWindow(window: UsageWindow, theme: any): string {
	const pct = window.usedPercent;
	const hasCount = window.usedCount !== undefined && window.limitCount !== undefined;
	const pctText = pct === undefined || !Number.isFinite(pct) ? "n/a" : formatPercent(pct, hasCount);
	const countText = hasCount ? ` (${formatCount(window.usedCount!)}/${formatCount(window.limitCount!)})` : "";
	const reset = window.resetAt ? ` (${fmtDuration(window.resetAt - Date.now())})` : "";
	const label = window.label === "week" ? "7d" : window.label === "month" ? "30d" : window.label;
	return `${theme.fg("muted", `${label}:`)} ${theme.fg(usageColor(pct), pctText)}${theme.fg("dim", countText + reset)}`;
}

function renderProviderUsage(provider: ProviderUsage, theme: any): string {
	const windows = provider.windows.map((w) => renderWindow(w, theme)).join(theme.fg("dim", "  "));
	const suffix = provider.status === "ok" ? "" : ` ${theme.fg(provider.status === "error" ? "error" : "dim", provider.message ?? provider.status)}`;
	return `${chip(`${provider.icon} ${provider.name}`, theme)}  ${windows}${suffix}`;
}

function padBetween(left: string, right: string, width: number): string {
	if (!right) return truncateToWidth(left, width, "…");
	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) return truncateToWidth(right, width, "…");
	const leftWidth = width - rightWidth - 1;
	const fittedLeft = visibleWidth(left) > leftWidth ? truncateToWidth(left, leftWidth, "…") : left;
	const space = Math.max(1, width - visibleWidth(fittedLeft) - rightWidth);
	const raw = fittedLeft + " ".repeat(space) + right;
	// Safety: ANSI sequence edge cases can cause visibleWidth to undercount.
	// If the raw line still exceeds width, force-truncate.
	return visibleWidth(raw) > width ? truncateToWidth(raw, width, "…") : raw;
}

function compactModelName(id: string): string {
	return id
		.replace(/^.*\//, "")
		.replace(/^claude-/, "")
		.replace(/-20\d{6}$/, "")
		.replace(/-/g, " ");
}

function chip(text: string, theme: any): string {
	return `${theme.fg("accent", "\ue0b6")}${theme.inverse(` ${text} `)}${theme.fg("accent", "\ue0b4")}`;
}

function dimChip(text: string, theme: any): string {
	return `${theme.fg("muted", "\ue0b6")}${theme.inverse(` ${text} `)}${theme.fg("muted", "\ue0b4")}`;
}

function thinkingChip(level: string, theme: any): string {
	const color =
		level === "xhigh" ? "thinkingXhigh" :
		level === "high" ? "thinkingHigh" :
		level === "medium" ? "thinkingMedium" :
		level === "low" ? "thinkingLow" :
		level === "minimal" ? "thinkingMinimal" :
		"muted";
	return `${theme.fg(color, "\ue0b6")}${theme.fg(color, theme.inverse(` \u25c7 ${level} `))}${theme.fg(color, "\ue0b4")}`;
}

function formatContext(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	if (!usage) return "ctx n/a";
	const pct = usage.contextWindow ? ` ${Math.round((usage.tokens / usage.contextWindow) * 100)}%` : "";
	return `\udb80\udd1c ${fmtInt(usage.tokens)}${usage.contextWindow ? `/${fmtInt(usage.contextWindow)}` : ""}${pct}`;
}

function sessionTotals(ctx: ExtensionContext): { input: number; output: number; cost: number } {
	let input = 0;
	let output = 0;
	let cost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = (entry.message as any).usage;
		input += usage?.input ?? 0;
		output += usage?.output ?? 0;
		cost += usage?.cost?.total ?? 0;
	}
	return { input, output, cost };
}

function gitDirty(cwd: string): string {
	try {
		const out = execSync("git status --porcelain", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 });
		if (!out.trim()) return "clean";
		let staged = 0;
		let modified = 0;
		let untracked = 0;
		for (const line of out.split("\n")) {
			if (!line) continue;
			if (line.startsWith("??")) untracked++;
			else {
				if (line[0] !== " ") staged++;
				if (line[1] !== " ") modified++;
			}
		}
		return [`\u25cf${modified}`, `\u271a${staged}`, `?${untracked}`].filter((part) => !part.endsWith("0")).join(" ") || "dirty";
	} catch {
		return "";
	}
}

function gitRemoteStatus(cwd: string): { ahead: number; behind: number; hasRemote: boolean } {
	try {
		const out = execSync("git rev-list --left-right --count HEAD...@{u}", {
			cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
		});
		const parts = out.trim().split(/\s+/);
		return { ahead: parseInt(parts[0] ?? "0", 10), behind: parseInt(parts[1] ?? "0", 10), hasRemote: true };
	} catch {
		return { ahead: 0, behind: 0, hasRemote: false };
	}
}

function gitLastCommit(cwd: string): { hash: string; subject: string; age: string } {
	try {
		const out = execSync("git log -1 --format=%h%x09%s%x09%cr", {
			cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
		});
		const parts = out.trim().split("\t");
		return { hash: parts[0] ?? "", subject: parts[1] ?? "", age: parts[2] ?? "" };
	} catch {
		return { hash: "", subject: "", age: "" };
	}
}


// --- Custom Header: Gradient Pi ASCII art + info panel ---

const PI_ART = [
	"    █████████████████████",
	"    █████████████████████",
	"    █████████████████████",
	"    ███████       ███████",
	"    ███████       ███████",
	"    ███████       ███████",
	"    ███████       ███████",
	"    ██████████████       ███████",
	"    ██████████████       ███████",
	"    ██████████████       ███████",
	"    ███████              ███████",
	"    ███████              ███████",
	"    ███████              ███████",
	"    ███████              ███████",
];

const PI_ART_W = Math.max(...PI_ART.map((l) => [...l].length));

function timeGreeting(): string {
	const h = new Date().getHours();
	if (h < 5)  return "Night owl mode \ud83e\udd89";
	if (h < 12) return "Good morning \u2600\ufe0f";
	if (h < 17) return "Good afternoon \ud83c\udf24\ufe0f";
	if (h < 21) return "Good evening \ud83c\udf05";
	return "Late night session \ud83c\udf19";
}

function lerpColor(t: number): [number, number, number] {
	// Gradient: electric blue (#3b82f6) -> violet (#8b5cf6) -> magenta (#d946ef)
	const stops: [number, number, number][] = [
		[59, 130, 246],   // blue
		[139, 92, 246],   // violet
		[217, 70, 239],   // magenta
	];
	const seg = t * (stops.length - 1);
	const i = Math.min(Math.floor(seg), stops.length - 2);
	const f = seg - i;
	return [
		Math.round(stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f),
		Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f),
		Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f),
	];
}

function renderGradientArt(): string[] {
	return PI_ART.map((line, row) => {
		const t = row / (PI_ART.length - 1);
		const [r, g, b] = lerpColor(t);
		let result = "";
		let inBlock = false;
		for (const ch of line) {
			if (ch === "\u2588") {
				if (!inBlock) { result += `\x1b[38;2;${r};${g};${b}m`; inBlock = true; }
				result += ch;
			} else {
				if (inBlock) { result += "\x1b[0m"; inBlock = false; }
				result += ch;
			}
		}
		if (inBlock) result += "\x1b[0m";
		return result;
	});
}

export default function piHud(pi: ExtensionAPI) {
	let enabled = true;
	let installedCtx: ExtensionContext | null = null;
	let activeStartedAt: number | null = null;
	let lastRunMs: number | null = null;
	let lastTps: number | null = null;
	let lastAssistantStart: number | null = null;
	let codexUsage: ProviderUsage = { id: "codex", name: "Codex", icon: "\udb80\ude29", status: "unknown", message: "loading", windows: [{ label: "5h" }, { label: "week" }] };
	let anthropicUsage: ProviderUsage = { id: "anthropic", name: "Claude", icon: "\udb80\udc8b", status: "unknown", message: "loading", windows: [{ label: "5h" }, { label: "week" }] };
	let ollamaUsage: ProviderUsage = { id: "ollama-cloud", name: "Ollama", icon: "\ud83e\udd99", status: "unknown", message: "loading", windows: [{ label: "5h" }, { label: "week" }] };
	let waferUsage: ProviderUsage = { id: "wafer", name: "Wafer", icon: "\ud83c\udf5e", status: "unknown", message: "loading", windows: [{ label: "5h" }] };
	let opencodeUsage: ProviderUsage = { id: "opencode", name: "OpenCode", icon: "\u{1F7E2}", status: "unknown", message: "loading", windows: [{ label: "5h" }, { label: "week" }, { label: "month" }] };
	let codexInFlight: Promise<void> | null = null;
	let anthropicInFlight: Promise<void> | null = null;
	let ollamaInFlight: Promise<void> | null = null;
	let waferInFlight: Promise<void> | null = null;
	let opencodeInFlight: Promise<void> | null = null;
	let lastGitAt = 0;
	let lastGitDirty = "";
	let lastGitAhead = 0;
	let lastGitBehind = 0;
	let lastGitHasRemote = false;
	let lastCommitHash = "";
	let lastCommitSubject = "";
	let lastCommitAge = "";

	// Palimpsest state (populated via event bus)
	let plQuestsDone = 0;
	let plQuestsTotal = 0;
	let plCurrentQuest: string | null = null;
	let plInstinctsTotal = 0;
	let plInstinctsProject = 0;
	let plObservations = 0;

	const isOllamaProvider = (provider?: string): boolean => provider === "ollama" || provider === "ollama-cloud";
	const isWaferProvider = (provider?: string): boolean => provider === "wafer";
	const isOpenCodeProvider = (provider?: string): boolean => provider === "opencode" || provider === "opencode-go";

	const getActiveUsage = (ctx: ExtensionContext): ProviderUsage => {
		const provider = ctx.model?.provider;
		if (provider === "anthropic") return anthropicUsage;
		if (isOllamaProvider(provider)) return ollamaUsage;
		if (isWaferProvider(provider)) return waferUsage;
		if (isOpenCodeProvider(provider)) return opencodeUsage;
		return codexUsage;
	};

	const refreshCodex = async () => {
		if (codexInFlight) return codexInFlight;
		codexInFlight = (async () => {
			codexUsage = codexToProvider(await fetchCodexUsage(), codexUsage);
		})().finally(() => {
			codexInFlight = null;
		});
		return codexInFlight;
	};

	const refreshAnthropic = async () => {
		if (anthropicInFlight) return anthropicInFlight;
		anthropicInFlight = (async () => {
			anthropicUsage = anthropicToProvider(await fetchAnthropicUsage(), anthropicUsage);
		})().finally(() => {
			anthropicInFlight = null;
		});
		return anthropicInFlight;
	};

	const refreshOllama = async () => {
		if (ollamaInFlight) return ollamaInFlight;
		ollamaInFlight = (async () => {
			ollamaUsage = ollamaToProvider(await fetchOllamaUsage(), ollamaUsage);
		})().finally(() => {
			ollamaInFlight = null;
		});
		return ollamaInFlight;
	};

	const refreshWafer = async () => {
		if (waferInFlight) return waferInFlight;
		waferInFlight = (async () => {
			waferUsage = waferToProvider(await fetchWaferUsage(), waferUsage);
		})().finally(() => {
			waferInFlight = null;
		});
		return waferInFlight;
	};

	const refreshOpenCode = async () => {
		if (opencodeInFlight) return opencodeInFlight;
		opencodeInFlight = (async () => {
			opencodeUsage = opencodeToProvider(await fetchOpenCodeUsage(), opencodeUsage);
		})().finally(() => {
			opencodeInFlight = null;
		});
		return opencodeInFlight;
	};

	const refreshActiveProvider = (ctx: ExtensionContext) => {
		const provider = ctx.model?.provider;
		if (provider === "anthropic") return refreshAnthropic();
		if (isOllamaProvider(provider)) return refreshOllama();
		if (isWaferProvider(provider)) return refreshWafer();
		if (isOpenCodeProvider(provider)) return refreshOpenCode();
		return refreshCodex();
	};

	const install = (ctx: ExtensionContext) => {
		installedCtx = ctx;
		if (!enabled || !ctx.hasUI) return;
		void refreshActiveProvider(ctx);

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			const interval = setInterval(() => {
				const provider = ctx.model?.provider;
				const activeUsage = getActiveUsage(ctx);
				if (Date.now() - (activeUsage.updatedAt ?? 0) > QUOTA_REFRESH_MS) {
					void refreshActiveProvider(ctx).then(() => tui.requestRender());
				}
				tui.requestRender();
			}, 1000);

			return {
				dispose: () => {
					unsubBranch();
					clearInterval(interval);
				},
				invalidate() {},
				render(width: number): string[] {
					try {
					const cwdName = basename(ctx.cwd) || ctx.cwd;
					const cwdPath = compactPath(ctx.cwd);
					const branch = footerData.getGitBranch();
					if (Date.now() - lastGitAt > GIT_REFRESH_MS) {
						lastGitDirty = gitDirty(ctx.cwd);
						const remote = gitRemoteStatus(ctx.cwd);
						lastGitAhead = remote.ahead;
						lastGitBehind = remote.behind;
						lastGitHasRemote = remote.hasRemote;
						const lc = gitLastCommit(ctx.cwd);
						lastCommitHash = lc.hash;
						lastCommitSubject = lc.subject;
						lastCommitAge = lc.age;
						lastGitAt = Date.now();
					}

					const totals = sessionTotals(ctx);
					const statuses = [...footerData.getExtensionStatuses().entries()]
						.filter(([key, val]) => !HIDDEN_STATUSES.has(key) && Boolean(val))
						.map(([, val]) => val)
						.join(theme.fg("dim", " \u00b7 "));
					const model = ctx.model ? compactModelName(ctx.model.id) : "no model";
					const run = activeStartedAt ? `\udb81\udcef ${fmtDuration(Date.now() - activeStartedAt)}` : lastRunMs ? `\udb81\udcef ${fmtDuration(lastRunMs)}` : "\udb81\udcef idle";
					const speed = lastTps ? `\u26a1 ${lastTps.toFixed(1)} tok/s` : "";
					const activeUsage = getActiveUsage(ctx);
					const thinking = pi.getThinkingLevel();

					const left1 = [
						chip("\ue22c", theme),
						dimChip(`\udb80\udc5c ${cwdName}`, theme),
						theme.fg("dim", cwdPath),
						branch ? `${theme.fg("muted", "\udb80\udc65")} ${branch}` : "",
						lastGitDirty ? theme.fg(lastGitDirty === "clean" ? "success" : "warning", lastGitDirty) : "",
						dimChip(`\udb80\ude29 ${model}`, theme),
						thinkingChip(thinking, theme),
					].filter(Boolean).join(theme.fg("dim", "  "));

					const right1 = [
						formatContext(ctx),
						`\u2191${fmtInt(totals.input)} \u2193${fmtInt(totals.output)}`,
						run,
						speed,
					].filter(Boolean).join(theme.fg("dim", "  \u2502  "));

					const syncParts: string[] = [];
					if (!lastGitHasRemote) {
						syncParts.push(theme.fg("error", "\u26a0 no remote"));
					} else if (lastGitAhead === 0 && lastGitBehind === 0) {
						syncParts.push(theme.fg("success", "\u2713 synced"));
					} else {
						if (lastGitAhead > 0) syncParts.push(theme.fg("warning", `\u2191${lastGitAhead}`));
						if (lastGitBehind > 0) syncParts.push(theme.fg("error", `\u2193${lastGitBehind}`));
					}
					const gitSync = syncParts.join(" ");
					const commit = lastCommitHash
						? `${theme.fg("muted", lastCommitHash)} ${truncateToWidth(lastCommitSubject, 36, "\u2026")} ${theme.fg("dim", lastCommitAge)}`
						: "";
					const left2 = [gitSync, commit, statuses].filter(Boolean).join(theme.fg("dim", "  \u00b7  "));
					const right2 = renderProviderUsage(activeUsage, theme);
					// Line 3: Palimpsest (quests + instincts) — only when active
					let line3 = "";
					try {
						pi.events.emit("palimpsest:get-state", (state: any) => {
							if (state?.quests) {
								const progress = state.quests.progress();
								plQuestsDone = progress.done;
								plQuestsTotal = progress.total;
								plCurrentQuest = state.quests.currentQuest();
							}
							if (state?.instincts) {
								plInstinctsTotal = state.instincts.project;
								plInstinctsProject = state.instincts.project;
							}
							plObservations = state?.observations ?? 0;
						});
					} catch {}

					const hasPalimpsest = plQuestsTotal > 0 || plInstinctsTotal > 0;
					if (hasPalimpsest) {
						const plParts: string[] = [];

						if (plQuestsTotal > 0) {
							const filled = Math.round((plQuestsDone / plQuestsTotal) * 4);
							const bar = "\u25a0".repeat(filled) + "\u25a1".repeat(4 - filled);
							const questColor = plQuestsDone === plQuestsTotal ? "success" : "accent";
							const questStatus = `${theme.fg(questColor, bar)} ${plQuestsDone}/${plQuestsTotal} quests`;
							const current = plCurrentQuest ? theme.fg("muted", ` \u00b7 ${truncateToWidth(plCurrentQuest, 40, "\u2026")}`) : "";
							plParts.push(`\u2503 ${questStatus}${current}`);
						}

						const instLabel = plInstinctsTotal > 0
							? `${plInstinctsTotal} instincts${plInstinctsProject > 0 ? ` (${plInstinctsProject} project)` : ""}`
							: "";
						const obsLabel = plObservations > 0 ? `${plObservations} obs` : "";
						const metaParts = [instLabel, obsLabel].filter(Boolean).join(theme.fg("dim", " \u00b7 "));

						const left3 = plParts.length > 0
							? plParts[0]
							: `${theme.fg("dim", "\ud83d\udcdc")} palimpsest`;
						const right3 = metaParts ? theme.fg("dim", `\ud83d\udcdc ${metaParts}`) : "";
						line3 = padBetween(left3, right3, width);
					}

					const lines = [padBetween(left1, right1, width), padBetween(left2, right2, width)];
					if (line3) lines.push(line3);
					// Safety: ensure no line exceeds terminal width
					return lines.map((line) => truncateToWidth(line, width, "…"));
					} catch {
					// Render error — return minimal safe footer instead of crashing Pi
					return [theme.fg("muted", `pi-hud error — use /hud off to disable`)];
					}
				},
			};
		});
	};

	pi.on("session_start", (_event, ctx) => {
		install(ctx);

		if (ctx.hasUI) {
			ctx.ui.setHeader((_tui, theme) => ({
				render(width: number): string[] {
					const artLines = renderGradientArt();
					const artW = PI_ART_W;
					const gap = 3;
					const rw = Math.max(20, width - artW - gap);

					const modelShort = ctx.model ? compactModelName(ctx.model.id) : "no model";
					const thinking = pi.getThinkingLevel();
					const projectName = basename(ctx.cwd) || "~";
					const cwdShort = compactPath(ctx.cwd);

					const activeUsage = getActiveUsage(ctx);
					const usageSection = activeUsage.status === "ok"
						? [
							theme.bold(theme.fg("accent", "Quota")),
							...activeUsage.windows.map((w) => `  ${renderWindow(w, theme)}`),
						]
						: [
							theme.bold(theme.fg("accent", "Quota")),
							theme.fg("dim", `  ${activeUsage.icon} ${activeUsage.name}: ${activeUsage.message ?? activeUsage.status}`),
						];

					const right = [
						theme.fg("dim", `pi v${VERSION}`),
						theme.fg("accent", timeGreeting()),
						"",
						...usageSection,
						"",
						theme.bold(theme.fg("accent", "Session")),
						`${theme.fg("dim", "Model:")}   ${modelShort}${thinking !== "off" ? theme.fg("dim", ` \u00b7 \u25c7 ${thinking}`) : ""}`,
						`${theme.fg("dim", "Project:")} ${projectName}`,
						`${theme.fg("dim", "Path:")}    ${theme.fg("muted", cwdShort)}`,
						"",
						theme.fg("muted", "/ commands  \u00b7  ! bash  \u00b7  Ctrl+O more"),
						theme.fg("muted", "Esc interrupt  \u00b7  Ctrl+P cycle models"),
					];

					const total = Math.max(artLines.length, right.length);
					const lines: string[] = [];
					const sp = " ".repeat(gap);
					for (let i = 0; i < total; i++) {
					const a = i < artLines.length ? artLines[i] + " ".repeat(artW - visibleWidth(artLines[i])) : " ".repeat(artW);
						const r = i < right.length ? right[i] : "";
						lines.push(`${a}${sp}${truncateToWidth(r, rw, "\u2026")}`);
					}
					lines.push(theme.fg("dim", "\u2500".repeat(Math.min(width, 80))));
					// Safety: ensure no line exceeds terminal width
					return lines.map((line) => truncateToWidth(line, width, "\u2026"));
					} catch {
					// Render error — return minimal safe header instead of crashing Pi
					return [theme.fg("muted", "pi-hud")];
					}
				},
				invalidate() {},
			}));
		}
	});
	pi.on("model_select", (_event, ctx) => {
		void refreshActiveProvider(ctx);
	});
	pi.on("agent_start", () => {
		activeStartedAt = Date.now();
	});
	pi.on("agent_end", () => {
		if (activeStartedAt) lastRunMs = Date.now() - activeStartedAt;
		activeStartedAt = null;
	});
	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") lastAssistantStart = Date.now();
	});
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant" || !lastAssistantStart) return;
		const usage = (event.message as any).usage;
		const elapsed = Math.max((Date.now() - lastAssistantStart) / 1000, 0.001);
		lastTps = usage?.output ? usage.output / elapsed : lastTps;
		lastAssistantStart = null;
	});
	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setFooter(undefined);
		ctx.ui.setHeader(undefined);
		installedCtx = null;
	});

	// Ctrl+` opens gitui as a Kitty overlay.
	// Requires: allow_remote_control yes  (or socket-only) in ~/.config/kitty/kitty.conf
	pi.registerShortcut("ctrl+`", {
		description: "Open gitui in a Kitty overlay",
		handler: async (ctx) => {
			if (!process.env.KITTY_WINDOW_ID) {
				ctx.ui.notify("Not running inside Kitty \u2014 cannot open overlay", "warning");
				return;
			}
			try {
				await pi.exec("kitty", ["@", "launch", "--type=overlay", `--cwd=${ctx.cwd}`, "gitui"]);
			} catch (e: any) {
				ctx.ui.notify(
					`gitui overlay failed \u2014 add allow_remote_control yes to kitty.conf (${e?.message ?? e})`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("hud", {
		description: "Manage the HUD (header + footer): /hud on|off|refresh|status",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();
			if (arg === "off") {
				enabled = false;
				ctx.ui.setFooter(undefined);
				ctx.ui.setHeader(undefined);
				ctx.ui.notify("HUD disabled", "warning");
				return;
			}
			if (arg === "on") {
				enabled = true;
				install(ctx);
				ctx.ui.notify("HUD enabled", "success");
				return;
			}
			if (arg === "refresh") {
				await refreshActiveProvider(ctx);
				if (installedCtx) install(installedCtx);
				ctx.ui.notify("HUD refreshed", "info");
				return;
			}

			ctx.ui.notify(
				[
					`Codex: ${codexUsage.status}${codexUsage.message ? ` (${codexUsage.message})` : ""}`,
					`Anthropic: ${anthropicUsage.status}${anthropicUsage.message ? ` (${anthropicUsage.message})` : ""}`,
					`Ollama: ${ollamaUsage.status}${ollamaUsage.message ? ` (${ollamaUsage.message})` : ""}`,
					`Wafer: ${waferUsage.status}${waferUsage.message ? ` (${waferUsage.message})` : ""}`,
					`OpenCode: ${opencodeUsage.status}${opencodeUsage.message ? ` (${opencodeUsage.message})` : ""}`,
					`Auth file: ${AUTH_PATH}`,
				].join("\n"),
				"info",
			);
		},
	});
}