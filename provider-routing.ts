import type { ProviderId } from "./types.js";

export function resolveProviderId(provider?: string): ProviderId | undefined {
	if (!provider) return undefined;
	if (provider === "anthropic") return "anthropic";
	if (provider === "codex" || provider === "openai-codex") return "codex";
	if (provider === "ollama" || provider === "ollama-cloud") return "ollama-cloud";
	if (provider === "opencode" || provider === "opencode-go") return "opencode";
	if (provider === "minimax" || provider === "minimax-cn") return "minimax";
	if (provider === "umans") return "umans";
	if (provider === "zai" || provider === "z.ai" || provider === "z-ai") return "zai";
	return undefined;
}
