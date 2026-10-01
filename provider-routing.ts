import type { ProviderId } from "./types.js";

export interface ProviderRoutingOptions {
	/** True when the active model authenticates with a subscription login (OAuth), not an API key. */
	subscription?: boolean;
}

export function resolveProviderId(provider?: string, options: ProviderRoutingOptions = {}): ProviderId | undefined {
	if (!provider) return undefined;
	if (provider === "anthropic") return "anthropic";
	if (provider === "codex" || provider === "openai-codex") return "codex";
	// Sign in with ChatGPT on the openai provider draws on the ChatGPT plan's Codex quota;
	// an OpenAI API key is billed separately and has no Codex quota to show.
	if (provider === "openai") return options.subscription ? "codex" : undefined;
	if (provider === "minimax" || provider === "minimax-cn") return "minimax";
	if (provider === "umans") return "umans";
	if (provider === "openference") return "openference";
	if (provider === "kimi-coding") return "kimi";
	if (provider === "xai" || provider === "xai-auth" || provider === "grok-cli") return "grok";
	if (provider === "commandcode") return "commandcode";
	return undefined;
}
