import { fetchWithAuth, FetchError, readAuth } from "./shared.js";
import type { CommandCodeFetchResult, CommandCodeUsageData, ProviderUsage } from "../types.js";

// Command Code (commandcode.ai) billing API — the `/alpha/*` surface that the
// Studio web app uses, authenticated with the same API key (stored by pi as
// auth.json `commandcode` entry, type oauth, access == API key `user_...`).
//
// Endpoints verified live 2026-08-12 against a GOAT-plan account:
//   GET /alpha/billing/credits  → { credits: { monthlyCredits, purchasedCredits,
//                                   freeCredits, belowThreshold, creditThreshold },
//                                   windowLimits: { limited, exceeded,
//                                   fiveHour: { used, cap, exceeded, resetAt },
//                                   weekly: { used, cap, exceeded, resetAt } } }
//   GET /alpha/billing/subscriptions → { data: { planId, currentPeriodEnd, ... } }
const BASE_URL = "https://api.commandcode.ai";
const CREDITS_URL = `${BASE_URL}/alpha/billing/credits`;
const SUBSCRIPTION_URL = `${BASE_URL}/alpha/billing/subscriptions`;

/** Plan ids → human plan name, for the footer message. Unknown plans render "cc". */
const PLAN_NAMES: Record<string, string> = {
	"individual-go": "Go",
	"individual-goat": "GOAT",
	"individual-pro": "Pro",
	"individual-max10x": "Max10x",
};

function readCommandCodeAuth(): { access: string } | null {
	const cred = readAuth().commandcode;
	if (
		cred &&
		typeof cred === "object" &&
		(cred as Record<string, unknown>).type === "oauth" &&
		typeof (cred as Record<string, unknown>).access === "string"
	) {
		return { access: (cred as Record<string, unknown>).access as string };
	}
	const env = process.env.COMMANDCODE_API_KEY;
	if (env) return { access: env };
	return null;
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asEpochMs(value: unknown): number | undefined {
	const n = asNumber(value);
	if (n === null || n <= 0) return undefined;
	return n;
}

function parseCredits(body: string): CommandCodeUsageData | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;

	const credits = (parsed as Record<string, unknown>).credits as
		| Record<string, unknown>
		| undefined;
	if (!credits || typeof credits !== "object") return null;

	const windowLimits = (parsed as Record<string, unknown>).windowLimits as
		| Record<string, unknown>
		| undefined;
	const fiveHour = windowLimits?.fiveHour as Record<string, unknown> | undefined;
	const weekly = windowLimits?.weekly as Record<string, unknown> | undefined;

	const fiveHourUsed = asNumber(fiveHour?.used);
	const fiveHourCap = asNumber(fiveHour?.cap);
	const weeklyUsed = asNumber(weekly?.used);
	const weeklyCap = asNumber(weekly?.cap);

	if (fiveHourUsed === null || fiveHourCap === null) return null;

	const usage: CommandCodeUsageData = {
		fiveHourUsed,
		fiveHourCap,
		fiveHourResetAt: asEpochMs(fiveHour?.resetAt),
		weeklyUsed: weeklyUsed ?? null,
		weeklyCap: weeklyCap ?? null,
		weeklyResetAt: asEpochMs(weekly?.resetAt),
		monthlyCredits: asNumber(credits.monthlyCredits),
		purchasedCredits: asNumber(credits.purchasedCredits),
		freeCredits: asNumber(credits.freeCredits),
	};

	// Weekly window is optional; include only when both halves are present.
	if (usage.weeklyUsed === null || usage.weeklyCap === null) {
		usage.weeklyUsed = null;
		usage.weeklyCap = null;
	}

	return usage;
}

export async function fetchCommandCodeUsage(): Promise<CommandCodeFetchResult> {
	const cred = readCommandCodeAuth();
	if (!cred) {
		return { usage: null, status: "auth-needed", message: "login" };
	}

	const headers = {
		Authorization: `Bearer ${cred.access}`,
		Accept: "application/json",
	};

	try {
		const creditsRes = await fetchWithAuth({ url: CREDITS_URL, headers });
		const usage = parseCredits(creditsRes.body);
		if (!usage) return { usage: null, status: "error", message: "bad shape" };

		// Plan name is a nice-to-have; failures here don't fail the provider.
		try {
			const subRes = await fetchWithAuth({ url: SUBSCRIPTION_URL, headers });
			const sub = JSON.parse(subRes.body) as unknown;
			const data = (sub as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
			const planId = data?.planId;
			if (typeof planId === "string" && PLAN_NAMES[planId]) {
				usage.planName = PLAN_NAMES[planId];
			}
		} catch {
			// optional
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

export function commandCodeToProvider(
	result: CommandCodeFetchResult,
	previous?: ProviderUsage,
): ProviderUsage {
	if (result.status !== "ok" || !result.usage) {
		return {
			id: "commandcode",
			name: "CommandCode",
			icon: "\ud835\udd4f",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}

	const u = result.usage;
	const windows: ProviderUsage["windows"] = [];

	const fiveHourPct =
		u.fiveHourCap > 0 ? (u.fiveHourUsed / u.fiveHourCap) * 100 : undefined;
	windows.push({
		label: "5h",
		usedPercent: fiveHourPct,
		resetAt: u.fiveHourResetAt,
	});

	if (u.weeklyUsed !== null && u.weeklyCap !== null && u.weeklyCap > 0) {
		windows.push({
			label: "week",
			usedPercent: (u.weeklyUsed / u.weeklyCap) * 100,
			resetAt: u.weeklyResetAt,
		});
	}

	// Monthly credit allowance is a cap, not spend — the API exposes no monthly
	// used figure, so a month window would render "30d: n/a". Skip it; the two
	// rolling windows above are the live quota (same as the CLI's /usage).

	const planSuffix = u.planName ? ` (${u.planName})` : "";
	return {
		id: "commandcode",
		name: "CommandCode",
		icon: "\ud835\udd4f",
		status: "ok",
		message: planSuffix,
		updatedAt: Date.now(),
		windows,
	};
}
