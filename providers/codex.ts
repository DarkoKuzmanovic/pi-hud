import { readCodexAuth } from "./shared.js";
import { fetchWithAuth, FetchError } from "./shared.js";
import type { CodexUsageResponse, CodexFetchResult, ProviderUsage } from "../types.js";

function isValidCodexResponse(value: unknown): value is CodexUsageResponse {
	if (!value || typeof value !== "object") return false;
	const rateLimit = (value as Record<string, unknown>).rate_limit;
	return rateLimit === undefined || (typeof rateLimit === "object" && rateLimit !== null);
}

export async function fetchCodexUsage(): Promise<CodexFetchResult> {
	const cred = readCodexAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	try {
		const { body } = await fetchWithAuth({
			url: "https://chatgpt.com/backend-api/codex/usage",
			headers: {
				Authorization: `Bearer ${cred.access}`,
				"chatgpt-account-id": cred.accountId,
				"OpenAI-Beta": "responses=experimental",
			},
		});

		try {
			const parsed: unknown = JSON.parse(body);
			if (!isValidCodexResponse(parsed)) return { usage: null, status: "error", message: "bad shape" };
			return { usage: parsed, status: "ok" };
		} catch {
			return { usage: null, status: "error", message: "bad json" };
		}
	} catch (err) {
		if (err instanceof FetchError) {
			if (err.kind === "auth-needed") return { usage: null, status: "auth-needed", message: err.message };
			return { usage: null, status: "error", message: err.message };
		}
		return { usage: null, status: "error", message: "network" };
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
