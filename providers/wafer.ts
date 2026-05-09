import { readWaferCookies } from "../cookies.js";
import { fetchWithAuth, FetchError, readWaferAuth } from "./shared.js";
import type { WaferUsageData, WaferFetchResult, ProviderUsage } from "../types.js";

const WAFER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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

export async function fetchWaferUsage(): Promise<WaferFetchResult> {
	const cookieHeader = readWaferCookies();
	const waferAuth = readWaferAuth();
	if (!cookieHeader && !waferAuth) return { usage: null, status: "auth-needed", message: "login" };

	try {
		const headers: Record<string, string> = {
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		};
		if (cookieHeader) headers.Cookie = cookieHeader;
		if (waferAuth) headers.Authorization = `Bearer ${waferAuth.access}`;

		const { body } = await fetchWithAuth({
			url: "https://app.wafer.ai/usage",
			headers,
			authNeededBodyPatterns: ["Sign in", "Continue with"],
			maxBytes: WAFER_MAX_RESPONSE_BYTES,
		});

		const parsed = parseWaferUsage(body);
		if (!parsed) return { usage: null, status: "error", message: "parse" };

		return { usage: parsed, status: "ok" };
	} catch (err) {
		if (err instanceof FetchError) {
			if (err.kind === "auth-needed") return { usage: null, status: "auth-needed", message: err.message };
			return { usage: null, status: "error", message: err.message };
		}
		return { usage: null, status: "error", message: "network" };
	}
}

export function waferToProvider(result: WaferFetchResult, previous?: ProviderUsage): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "wafer",
			name: "Wafer",
			icon: "\ud83c\udf5e",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }],
		};
	}
	return {
		id: "wafer",
		name: "Wafer",
		icon: "\ud83c\udf5e",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{
				label: "5h",
				usedPercent: result.usage?.windowPercent,
				usedCount: result.usage?.windowRequests,
				limitCount: result.usage?.windowRequestLimit,
				resetAt: result.usage?.windowResetAt || undefined, // || not ?? — 0 means "unknown", coerce to undefined
			},
		],
	};
}
