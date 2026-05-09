import { readAnthropicAuth } from "./shared.js";
import { fetchWithAuth, FetchError } from "./shared.js";
import type { AnthropicUsageResponse, AnthropicFetchResult, ProviderUsage } from "../types.js";

function isValidAnthropicResponse(value: unknown): value is AnthropicUsageResponse {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	const validWindow = (window: unknown) => window == null || (typeof window === "object" && typeof (window as Record<string, unknown>).utilization === "number");
	return validWindow(record.five_hour) && validWindow(record.seven_day);
}

export async function fetchAnthropicUsage(): Promise<AnthropicFetchResult> {
	const cred = readAnthropicAuth();
	if (!cred) return { usage: null, status: "auth-needed", message: "login" };

	try {
		const { body } = await fetchWithAuth({
			url: "https://api.anthropic.com/api/oauth/usage",
			headers: {
				Accept: "application/json, text/plain, */*",
				"Content-Type": "application/json",
				"User-Agent": "claude-code/2.0.31",
				Authorization: `Bearer ${cred.access}`,
				"anthropic-beta": "oauth-2025-04-20",
			},
		});

		try {
			const parsed: unknown = JSON.parse(body);
			if (!isValidAnthropicResponse(parsed)) return { usage: null, status: "error", message: "bad shape" };
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

export function anthropicToProvider(result: AnthropicFetchResult, previous?: ProviderUsage): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "anthropic",
			name: "Claude",
			icon: "\udb80\udc8b",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}
	return {
		id: "anthropic",
		name: "Claude",
		icon: "\udb80\udc8b",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{ label: "5h", usedPercent: result.usage?.five_hour?.utilization, resetAt: result.usage?.five_hour?.resets_at ? Date.parse(result.usage.five_hour.resets_at) : undefined },
			{ label: "week", usedPercent: result.usage?.seven_day?.utilization, resetAt: result.usage?.seven_day?.resets_at ? Date.parse(result.usage.seven_day.resets_at) : undefined },
		],
	};
}
