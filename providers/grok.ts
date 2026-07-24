import { fetchWithAuth, FetchError, readXaiAuth } from "./shared.js";
import type { GrokFetchResult, GrokUsageData, ProviderUsage } from "../types.js";

// Grok CLI billing endpoints (cli-chat-proxy.grok.com). pi's built-in `xai`
// OAuth access token (SuperGrok sign-in) is accepted here — verified live
// 2026-07-17. Same endpoints pi-grok-cli's /grok-cli-usage uses.
const BASE_URL = "https://cli-chat-proxy.grok.com/v1";
const TOKEN_AUTH_HEADER = "xai-grok-cli";

function val(value: unknown): number | null {
	if (!value || typeof value !== "object") return null;
	const n = (value as Record<string, unknown>).val;
	return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function parseIso(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const ts = Date.parse(value);
	return Number.isFinite(ts) ? ts : undefined;
}

function config(payload: unknown): Record<string, unknown> | null {
	if (!payload || typeof payload !== "object") return null;
	const cfg = (payload as Record<string, unknown>).config;
	if (!cfg || typeof cfg !== "object") return null;
	return cfg as Record<string, unknown>;
}

export async function fetchGrokUsage(): Promise<GrokFetchResult> {
	const cred = readXaiAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	const headers = {
		Authorization: `Bearer ${cred.access}`,
		"x-xai-token-auth": TOKEN_AUTH_HEADER,
		Accept: "application/json",
	};

	try {
		// Monthly credits (primary; required).
		const monthlyRes = await fetchWithAuth({ url: `${BASE_URL}/billing`, headers });
		const monthlyCfg = config(JSON.parse(monthlyRes.body));
		const monthlyLimit = val(monthlyCfg?.monthlyLimit);
		const monthlyUsed = val(monthlyCfg?.used);
		if (monthlyLimit === null || monthlyUsed === null) {
			return { usage: null, status: "error", message: "bad shape" };
		}

		const usage: GrokUsageData = {
			monthlyUsed,
			monthlyLimit,
			monthlyResetAt: parseIso(monthlyCfg?.billingPeriodEnd),
		};

		// Weekly credit window (best-effort; endpoint may omit it).
		try {
			const weeklyRes = await fetchWithAuth({
				url: `${BASE_URL}/billing?format=credits`,
				headers,
			});
			const weeklyCfg = config(JSON.parse(weeklyRes.body));
			const period = weeklyCfg?.currentPeriod as Record<string, unknown> | undefined;
			if (period?.type === "USAGE_PERIOD_TYPE_WEEKLY") {
				const raw = weeklyCfg?.creditUsagePercent;
				usage.weeklyUsedPercent =
					typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
				usage.weeklyResetAt = parseIso(weeklyCfg?.billingPeriodEnd);
			}
		} catch {
			// Weekly window is optional — monthly data alone is still useful.
		}

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

export function grokToProvider(
	result: GrokFetchResult,
	previous?: ProviderUsage,
): ProviderUsage {
	if (result.status !== "ok" || !result.usage) {
		return {
			id: "grok",
			name: "Grok",
			icon: "\ud835\udd4f",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "week" }, { label: "month" }],
		};
	}

	const u = result.usage;
	const windows: ProviderUsage["windows"] = [];
	if (u.weeklyUsedPercent !== undefined) {
		windows.push({
			label: "week",
			usedPercent: u.weeklyUsedPercent,
			resetAt: u.weeklyResetAt,
		});
	}
	windows.push({
		label: "month",
		usedPercent:
			u.monthlyLimit > 0 ? (u.monthlyUsed / u.monthlyLimit) * 100 : undefined,
		resetAt: u.monthlyResetAt,
	});

	return {
		id: "grok",
		name: "Grok",
		icon: "\ud835\udd4f",
		status: "ok",
		updatedAt: Date.now(),
		windows,
	};
}
