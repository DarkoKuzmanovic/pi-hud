// --- Shared types for pi-hud ---

export type WindowLabel = "5h" | "week" | "month" | "daily";
export type ProviderId =
	| "codex"
	| "anthropic"
	| "minimax"
	| "umans"
	| "openference"
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

// --- Theme access: the subset of pi-coding-agent's Theme that pi-hud calls ---
//
// Kept as a hand-written, string-keyed interface on purpose: pi-hud passes theme-color
// keys (e.g. "thinkingMax") that may not exist in the pinned pi-coding-agent ThemeColor
// union yet. A structural Pick<Theme, ...> would reject those keys at compile time even
// though the runtime Theme resolves them (with fallbacks), so string params keep hud decoupled.
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

/**
 * NOTE: requestsToday is a CALENDAR-DAY counter from Openference's dashboard API,
 * not the plan's actual rolling 5h billing window — see providers/openference.ts
 * for why (no API-key-scoped usage endpoint exists; this is the closest available
 * proxy). Field names intentionally avoid "window"/"5h" terminology used by
 * UmansUsageData to not imply a rolling-window semantic this data doesn't have.
 */
export interface OpenferenceUsageData {
	requestsToday: number;
	planName?: string;
	/** Per-minute request cap from the plan (undefined = not reported). */
	maxRpm?: number;
	totalTokensToday?: number;
	totalCostTodayUsd?: number;
}

export interface OpenferenceFetchResult {
	usage: OpenferenceUsageData | null;
	status: ProviderStatus;
	message?: string;
}
