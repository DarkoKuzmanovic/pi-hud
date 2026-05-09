import { readOpenCodeCookies } from "../cookies.js";
import { fetchWithAuth, FetchError } from "./shared.js";
import type { OpenCodeUsageData, OpenCodeFetchResult, ProviderUsage } from "../types.js";

const OPENCODE_WORKSPACE_ID = "wrk_01KQ5QT3CGXXERVF8ZHENJHT79";

function parseOpenCodeHtml(html: string): OpenCodeUsageData | null {
	try {
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

export async function fetchOpenCodeUsage(): Promise<OpenCodeFetchResult> {
	const authCookie = readOpenCodeCookies();
	if (!authCookie) return { usage: null, status: "auth-needed", message: "login" };

	const cookieHeader = `auth=${authCookie}`;

	try {
		const { body } = await fetchWithAuth({
			url: `https://opencode.ai/workspace/${OPENCODE_WORKSPACE_ID}/go`,
			headers: { Cookie: cookieHeader, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
			authNeededBodyPatterns: ["Sign in", "Log in"],
		});

		const parsed = parseOpenCodeHtml(body);
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

export function opencodeToProvider(result: OpenCodeFetchResult, previous?: ProviderUsage): ProviderUsage {
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
