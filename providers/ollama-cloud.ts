import { readOllamaCookies } from "../cookies.js";
import { fetchWithAuth, FetchError } from "./shared.js";
import type { OllamaUsageData, OllamaFetchResult, ProviderUsage } from "../types.js";

function parseOllamaUsage(html: string): OllamaUsageData | null {
	try {
		const pctPattern = /<span class="text-sm">([\d.]+)% used<\/span>/g;
		const pcts: number[] = [];
		let m: RegExpExecArray | null;
		while ((m = pctPattern.exec(html)) !== null) {
			pcts.push(parseFloat(m[1]));
		}

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

export async function fetchOllamaUsage(): Promise<OllamaFetchResult> {
	const cookieHeader = readOllamaCookies();
	if (!cookieHeader) return { usage: null, status: "auth-needed", message: "login" };

	try {
		const { body } = await fetchWithAuth({
			url: "https://ollama.com/settings",
			headers: { Cookie: cookieHeader, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
			authNeededBodyPatterns: ["Sign in"],
		});

		// Verify we got the authenticated page
		if (!body.includes("Cloud Usage")) return { usage: null, status: "auth-needed", message: "no session" };

		const parsed = parseOllamaUsage(body);
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

export function ollamaToProvider(result: OllamaFetchResult, previous?: ProviderUsage): ProviderUsage {
	if (result.status !== "ok") {
		return {
			id: "ollama-cloud",
			name: "Ollama",
			icon: "\ud83e\udd99",
			status: result.status,
			message: result.message,
			updatedAt: Date.now(),
			windows: previous?.windows ?? [{ label: "5h" }, { label: "week" }],
		};
	}
	return {
		id: "ollama-cloud",
		name: "Ollama",
		icon: "\ud83e\udd99",
		status: "ok",
		updatedAt: Date.now(),
		windows: [
			{ label: "5h", usedPercent: result.usage?.sessionPercent, resetAt: result.usage?.sessionResetAt },
			{ label: "week", usedPercent: result.usage?.weeklyPercent, resetAt: result.usage?.weeklyResetAt },
		],
	};
}
