// --- Shared types for pi-hud ---

export type WindowLabel = "5h" | "week" | "month" | "daily";
export type ProviderId =
	| "codex"
	| "anthropic"
	| "ollama-cloud"
	| "opencode"
	| "minimax"
	| "umans"
	| "zai"
	| "unsupported";
export type ProviderStatus = "ok" | "unknown" | "auth-needed" | "error";

export interface UsageWindow {
	label: WindowLabel;
	usedPercent?: number;
	usedCount?: number;
	limitCount?: number;
	resetAt?: number;
}

export interface ProviderUsage {
	id: ProviderId;
	name: string;
	icon: string;
	status: ProviderStatus;
	message?: string;
	updatedAt?: number;
	windows: UsageWindow[];
	concurrency?: { used: number; limit: number | null };
}

// --- Theme type (replaces `any`) ---

export interface ThemeAccess {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	inverse(text: string): string;
	bold(text: string): string;
	getBgAnsi(color: string): string;
}

// --- Provider-internal types ---

export interface CodexUsageWindow {
	used_percent: number;
	limit_window_seconds: number;
	reset_after_seconds: number;
	reset_at: number;
}

export interface CodexUsageResponse {
	plan_type?: string;
	rate_limit?: {
		allowed: boolean;
		limit_reached: boolean;
		primary_window?: CodexUsageWindow | null;
		secondary_window?: CodexUsageWindow | null;
	};
}

export interface CodexFetchResult {
	usage: CodexUsageResponse | null;
	status: ProviderStatus;
	message?: string;
}

export interface AnthropicUsageWindow {
	utilization: number;
	resets_at: string | null;
}

export interface AnthropicUsageResponse {
	five_hour?: AnthropicUsageWindow | null;
	seven_day?: AnthropicUsageWindow | null;
	seven_day_oauth_apps?: AnthropicUsageWindow | null;
	seven_day_opus?: AnthropicUsageWindow | null;
}

export interface AnthropicFetchResult {
	usage: AnthropicUsageResponse | null;
	status: ProviderStatus;
	message?: string;
	/** Timestamp the underlying data was originally fetched at — only set when result comes from disk cache. */
	fetchedAt?: number;
}

export interface OllamaUsageData {
	sessionPercent: number;
	weeklyPercent: number;
	sessionResetAt: number;
	weeklyResetAt: number;
}

export interface OllamaFetchResult {
	usage: OllamaUsageData | null;
	status: ProviderStatus;
	message?: string;
}

export interface ZaiUsageData {
	/** 5-hour rolling window. */
	fiveHourPercent?: number;
	fiveHourUsedTokens?: number;
	fiveHourLimitTokens?: number;
	fiveHourResetAt?: number;
	/** Weekly quota + 7-day raw token count. */
	sevenDayPercent?: number;
	sevenDayResetAt?: number;
	sevenDayTokens?: number;
}

export interface ZaiFetchResult {
	usage: ZaiUsageData | null;
	status: ProviderStatus;
	message?: string;
}

export interface OpenCodeUsageData {
	rollingPercent: number;
	rollingResetAt: number;
	weeklyPercent: number;
	weeklyResetAt: number;
	monthlyPercent: number;
	monthlyResetAt: number;
}

export interface OpenCodeFetchResult {
	usage: OpenCodeUsageData | null;
	status: ProviderStatus;
	message?: string;
}

export interface MinimaxTokenPlanRemain {
	start_time?: number;
	end_time?: number;
	remains_time?: number;
	current_interval_total_count: number;
	current_interval_usage_count: number;
	current_weekly_total_count: number;
	current_weekly_usage_count: number;
	current_interval_remaining_percent?: number;
	current_interval_status?: number;
	current_weekly_remaining_percent?: number;
	current_weekly_status?: number;
	weekly_start_time?: number;
	weekly_end_time?: number;
	weekly_remains_time?: number;
	model_name?: string;
	category?: string;
	display_name?: string;
}

export interface MinimaxTokenPlanResponse {
	model_remains?: MinimaxTokenPlanRemain[];
	category_remains?: MinimaxTokenPlanRemain[];
	base_resp?: {
		status_code?: number;
		status_msg?: string;
	};
}

export interface MinimaxFetchResult {
	usage: MinimaxTokenPlanResponse | null;
	status: ProviderStatus;
	message?: string;
}

export interface UmansUsageData {
	requestsUsed: number;
	/** null = unlimited plan (no request cap). */
	requestsLimit: number | null;
	/** Absolute epoch ms when the rolling window resets (0 = unknown). */
	resetAt: number;
	/** Rolling window length in seconds (used to label the window, e.g. 18000 = 5h). */
	windowSeconds: number;
	/** Active concurrent sessions (for providers that report concurrency, e.g. Umans). */
	concurrencyUsed: number;
	/** Concurrency cap (null = unlimited/not reported). */
	concurrencyLimit: number | null;
}

export interface UmansFetchResult {
	usage: UmansUsageData | null;
	status: ProviderStatus;
	message?: string;
}
