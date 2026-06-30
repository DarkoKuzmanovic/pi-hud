import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "./render/format.js";
import { TokenSpeedTracker } from "./token-speed.js";

// Types
import type { ProviderUsage, ThemeAccess } from "./types.js";

// Providers
import { fetchCodexUsage, codexToProvider } from "./providers/codex.js";
import {
	fetchAnthropicUsage,
	anthropicToProvider,
	loadCachedAnthropicUsage,
} from "./providers/anthropic.js";
import {
	fetchMinimaxUsage,
	minimaxToProvider,
} from "./providers/minimax.js";
import { fetchUmansUsage, umansToProvider } from "./providers/umans.js";
import { resolveProviderId } from "./provider-routing.js";

// Git
import {
	gitDirtyAsync,
	gitRemoteStatusAsync,
	gitLastCommitAsync,
} from "./git.js";
import type { GitDirtyResult, GitRemoteResult, GitLastCommit } from "./git.js";

// Render
import { renderHeader } from "./render/header.js";
import { renderFooterLine } from "./render/footer.js";
import { BLOCK_DESCRIPTIONS, KNOWN_BLOCKS, type BlockContext } from "./render/blocks.js";
import { initSessionTotals, accumulateMessage } from "./render/context.js";
import {
	setActivePalette,
	PALETTE_NAMES,
	getActivePaletteName,
	getActivePalette,
} from "./render/header.js";
import { setAsciiMode, isAsciiMode } from "./render/format.js";

// Layout config
import {
	loadLayout,
	layoutPath,
	validateLayoutFile,
	type HudLayout,
	type LayoutValidationIssue,
} from "./config.js";

// --- Constants ---
const QUOTA_REFRESH_MS = 60_000;
const GIT_REFRESH_MS = 5_000;
const TPS_RENDER_THROTTLE_MS = 250;

// --- Provider helpers ---

// Stable hash for change detection: every provider stamps `updatedAt: Date.now()`
// on refresh regardless of whether the underlying user-visible usage changed.
// Provider mappers build objects in deterministic field order; if that changes,
// switch this to a sorted-key serializer to avoid spurious render churn.
export function stableUsageKey(u: ProviderUsage): string {
	const { updatedAt: _updatedAt, ...rest } = u;
	return JSON.stringify(rest);
}

function formatHudBlocks(): string {
	const lines = [
		"Available HUD blocks:",
		...KNOWN_BLOCKS.map((id) => `- ${id}: ${BLOCK_DESCRIPTIONS[id]}`),
		`- ext:<key>: ${BLOCK_DESCRIPTIONS["ext:<key>"]}`,
		`Layout: ${layoutPath()}`,
	];
	return lines.join("\n");
}

function formatLayoutValidationIssues(issues: LayoutValidationIssue[]): string {
	const shown = issues.slice(0, 10).map((issue) => `- ${issue.path}: ${issue.message}`);
	const hidden = issues.length - shown.length;
	return hidden > 0 ? `${shown.join("\n")}\n... ${hidden} more` : shown.join("\n");
}
// --- Main extension ---
export default function piHud(pi: ExtensionAPI) {
	let enabled = true;
	let installedCtx: ExtensionContext | null = null;
	let activeStartedAt: number | null = null;
	let lastRunMs: number | null = null;
	let lastTps: number | null = null;
	let lastAssistantStart: number | null = null;
	const tokenSpeed = new TokenSpeedTracker();
	let lastTpsRenderAt = 0;

	// Provider usage state
	let codexUsage: ProviderUsage = {
		id: "codex",
		name: "Codex",
		icon: "\uee0d",
		status: "unknown",
		message: "loading",
		windows: [{ label: "5h" }, { label: "week" }],
	};
	let anthropicUsage: ProviderUsage = {
		id: "anthropic",
		name: "Claude",
		icon: "\uee0d",
		status: "unknown",
		message: "loading",
		windows: [{ label: "5h" }, { label: "week" }],
	};
	let minimaxUsage: ProviderUsage = {
		id: "minimax",
		name: "MiniMax",
		icon: "\udb81\udc07",
		status: "unknown",
		message: "loading",
		windows: [{ label: "5h" }, { label: "week" }],
	};
	let umansUsage: ProviderUsage = {
		id: "umans",
		name: "Umans",
		icon: "\uee0d",
		status: "unknown",
		message: "loading",
		windows: [{ label: "5h" }],
	};

	let codexInFlight: Promise<void> | null = null;
	let anthropicInFlight: Promise<void> | null = null;
	let minimaxInFlight: Promise<void> | null = null;
	let umansInFlight: Promise<void> | null = null;

	// Cached session totals (incremental, not O(n) per render)
	let totals = initSessionTotals();

	// Git state (cached, refreshed async)
	let lastGitAt = 0;
	let cachedGitDirty: GitDirtyResult = { text: "", isClean: false };
	let cachedGitRemote: GitRemoteResult = {
		ahead: 0,
		behind: 0,
		hasRemote: false,
	};
	let cachedGitLastCommit: GitLastCommit = { hash: "", subject: "", age: "" };
	let gitRefreshInProgress = false;


	// HUD UI handle for event-driven re-renders
	let footerTui: { requestRender: () => void } | null = null;
	let wallClockTimer: ReturnType<typeof setInterval> | null = null;

	// Layout config
	const initialLayout = loadLayout();
	let layout: HudLayout = initialLayout.layout;
	// Footer-only data (git branch + extension statuses) cached for re-renders.
	let cachedBranch = "";
	let cachedExtStatuses: ReadonlyMap<string, string> = new Map<string, string>();

	const requestRenderAll = (): void => {
		footerTui?.requestRender();
	};

	const unsupportedUsage = (provider?: string): ProviderUsage => ({
		id: "unsupported",
		name: provider ? `Unsupported: ${provider}` : "Unsupported provider",
		icon: "\udb80\ude29",
		status: "unknown",
		message: "unsupported",
		windows: [{ label: "5h" }, { label: "week" }],
	});

	const getActiveUsage = (ctx: ExtensionContext): ProviderUsage => {
		switch (resolveProviderId(ctx.model?.provider)) {
			case "anthropic":
				return anthropicUsage;
			case "minimax":
				return minimaxUsage;
			case "codex":
				return codexUsage;
			case "umans":
				return umansUsage;
			default:
				return unsupportedUsage(ctx.model?.provider);
		}
	};


	/** Assemble the live data the footer renders from. */
	const buildBlockContext = (
		activeCtx: ExtensionContext,
		theme: ThemeAccess,
	): BlockContext => ({
		ctx: activeCtx,
		theme,
		totals,
		activeUsage: getActiveUsage(activeCtx),
		thinkingLevel: pi.getThinkingLevel(),
		activeStartedAt,
		lastRunMs,
		lastTps,
		gitDirty: cachedGitDirty,
		gitRemote: cachedGitRemote,
		gitLastCommit: cachedGitLastCommit,
		branch: cachedBranch,
		extStatuses: cachedExtStatuses,
		palette: getActivePalette(),
		// Drive centralized chip wrapping in render/blocks.ts. Snapshotted as a
		// Set so the O(1) membership check stays fast even with many blocks.
		chips: new Set(layout.chips),
		separator: layout.separator,
	});


	const requestTpsRender = (now = Date.now()): void => {
		if (now - lastTpsRenderAt < TPS_RENDER_THROTTLE_MS) return;
		lastTpsRenderAt = now;
		footerTui?.requestRender();
	};

	// --- Provider refresh (in-flight dedup) ---
	const refreshCodex = async () => {
		if (codexInFlight) return codexInFlight;
		codexInFlight = (async () => {
			codexUsage = codexToProvider(await fetchCodexUsage(), codexUsage);
		})().finally(() => {
			codexInFlight = null;
		});
		return codexInFlight;
	};

	const refreshAnthropic = async () => {
		if (anthropicInFlight) return anthropicInFlight;
		anthropicInFlight = (async () => {
			anthropicUsage = anthropicToProvider(
				await fetchAnthropicUsage(),
				anthropicUsage,
			);
		})().finally(() => {
			anthropicInFlight = null;
		});
		return anthropicInFlight;
	};


	const refreshMinimax = async () => {
		if (minimaxInFlight) return minimaxInFlight;
		minimaxInFlight = (async () => {
			minimaxUsage = minimaxToProvider(await fetchMinimaxUsage(), minimaxUsage);
		})().finally(() => {
			minimaxInFlight = null;
		});
		return minimaxInFlight;
	};

	const refreshUmans = async () => {
		if (umansInFlight) return umansInFlight;
		umansInFlight = (async () => {
			umansUsage = umansToProvider(await fetchUmansUsage(), umansUsage);
		})().finally(() => {
			umansInFlight = null;
		});
		return umansInFlight;
	};



	const refreshActiveProvider = (ctx: ExtensionContext) => {
		switch (resolveProviderId(ctx.model?.provider)) {
			case "anthropic":
				return refreshAnthropic();
			case "minimax":
				return refreshMinimax();
			case "codex":
				return refreshCodex();
			case "umans":
				return refreshUmans();
			default:
				return Promise.resolve();
		}
	};

	// --- Async git refresh (non-blocking) ---
	const refreshGitAsync = (cwd: string) => {
		if (gitRefreshInProgress) return;
		gitRefreshInProgress = true;
		Promise.all([
			gitDirtyAsync(cwd),
			gitRemoteStatusAsync(cwd),
			gitLastCommitAsync(cwd),
		])
			.then(([dirty, remote, lastCommit]) => {
				const changed =
					dirty.text !== cachedGitDirty.text ||
					dirty.isClean !== cachedGitDirty.isClean ||
					remote.ahead !== cachedGitRemote.ahead ||
					remote.behind !== cachedGitRemote.behind ||
					remote.hasRemote !== cachedGitRemote.hasRemote ||
					lastCommit.hash !== cachedGitLastCommit.hash ||
					lastCommit.subject !== cachedGitLastCommit.subject ||
					lastCommit.age !== cachedGitLastCommit.age;
				cachedGitDirty = dirty;
				cachedGitRemote = remote;
				cachedGitLastCommit = lastCommit;
				lastGitAt = Date.now();
				gitRefreshInProgress = false;
				// Only re-render if git data actually changed
				if (changed) {
					requestRenderAll();
				}
			})
			.catch(() => {
				gitRefreshInProgress = false;
			});
	};

	// --- Install header + footer ---
	const install = (ctx: ExtensionContext) => {
		installedCtx = ctx;
		if (!ctx.hasUI) return;
		void refreshActiveProvider(ctx);

		ctx.ui.setFooter((tui, theme, footerData) => {
			footerTui = tui;
			const unsubBranch = footerData.onBranchChange(() => {
				cachedBranch = footerData.getGitBranch() ?? "";
				requestRenderAll();
			});

			// Wall-clock refresh at 30s: quota/git refresh checks + time-based display updates.
			// Only requestRender() when something actually changed — unconditional re-renders
			// cause the TUI to scroll the viewport back to the bottom, disrupting reading.
			if (wallClockTimer !== null) {
				clearInterval(wallClockTimer);
				wallClockTimer = null;
			}
			wallClockTimer = setInterval(() => {
				const activeCtx = installedCtx ?? ctx;
				const activeUsage = getActiveUsage(activeCtx);
				const needsQuotaRefresh = Date.now() - (activeUsage.updatedAt ?? 0) > QUOTA_REFRESH_MS;
				if (needsQuotaRefresh) {
					const prevUsage = stableUsageKey(activeUsage);
					void refreshActiveProvider(activeCtx).then(() => {
						const latestCtx = installedCtx ?? activeCtx;
						const newUsage = stableUsageKey(getActiveUsage(latestCtx));
						if (newUsage !== prevUsage) {
							requestRenderAll();
						}
					});
				}
				const needsGitRefresh = Date.now() - lastGitAt > GIT_REFRESH_MS;
				if (needsGitRefresh) {
					refreshGitAsync(activeCtx.cwd);
				}
				// Re-render when a live timer is active (the ⏱ duration display
				// updates per-minute via fmtDuration). Quota and git refreshes are
				// handled by their async callbacks — quota calls requestRenderAll()
				// when data actually changed, and git's then() requests a render.
				// When idle with no data changes, skip re-render entirely.
				if (activeStartedAt !== null) {
					tui.requestRender();
				}
			}, 30_000);

			return {
				dispose: () => {
					unsubBranch();
					if (wallClockTimer !== null) {
						clearInterval(wallClockTimer);
						wallClockTimer = null;
					}
					footerTui = null;
				},
				invalidate() {},
				render(width: number): string[] {
					if (!enabled) return [];
					try {
						const activeCtx = installedCtx ?? ctx;
						cachedBranch = footerData.getGitBranch() ?? "";
						cachedExtStatuses = footerData.getExtensionStatuses();
						const block = buildBlockContext(
							activeCtx,
							theme as unknown as ThemeAccess,
						);
						return renderFooterLine(block, layout)(width);
					} catch (err: any) {
						return [theme.fg("error", `pi-hud: ${err?.message ?? err}`)];
					}
				},
			};
		});
	};

	pi.on("session_start", (_event, ctx) => {
		// Seed Anthropic usage from disk before kicking off any refresh so the footer
		// shows last-known-good values immediately, even when a 429 prevents a fresh fetch.
		const cached = loadCachedAnthropicUsage();
		if (cached) anthropicUsage = anthropicToProvider(cached, anthropicUsage);

		install(ctx);

		// Resync session totals from existing branch on start/resume/fork
		totals = initSessionTotals();
		try {
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type !== "message") continue;
				const message = (entry as { message?: unknown }).message;
				if (!message || typeof message !== "object") continue;
				if ((message as { role?: unknown }).role !== "assistant") continue;
				accumulateMessage(message, totals);
			}
		} catch {
			/* Session totals sync best-effort */
			// pi-lens-ignore: error-swallowing
			/* Session totals sync best-effort */
		}

		ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
				const fullTheme = ctx.ui.theme;
				const editor = new (class extends CustomEditor {
					render(width: number): string[] {
						if (!enabled) return super.render(width);
						const markerWidth = 3; // Fixed column: "▌  " or "↑3 " or "↓12 "
						const innerWidth = Math.max(1, width - markerWidth);

						// Render at innerWidth so text wraps correctly for the narrower column
						const lines = super.render(innerWidth);
						if (lines.length < 2) return lines;

						const bgOpen = fullTheme.getBgAnsi("userMessageBg");
						const bgClose = "\u001b[49m";
						const resetAnsi = "\u001b[0m";
						// biome-ignore lint/complexity/useRegexLiterals: regex literals trip noControlCharactersInRegex for ANSI escapes.
						const sgrPattern = new RegExp("\\u001b\\[[0-9;]*m", "g");
						// biome-ignore lint/complexity/useRegexLiterals: regex literals trip noControlCharactersInRegex for ANSI escapes.
						const resetPattern = new RegExp("\\u001b\\[0m", "g");
						const markerRaw = "\u258C"; // ▌ LEFT HALF BLOCK

						// Detect scroll indicators from the original border lines.
						// Top border (lines[0]): when scrolled up contains "↑ N more"
						// Bottom border (lines[last]): when scrolled down contains "↓ N more"
						// Autocomplete lines appear after the bottom border — preserve them.
						const topBorder = lines[0] ?? "";
						const scrollUpMatch = topBorder.match(/↑ (\d+) more/);

						// Find the bottom border: it's the last line that starts with border chars
						// or contains the scroll-down indicator.
						// Autocomplete lines come after it.
						let bottomBorderIdx = -1;
						for (let i = lines.length - 1; i >= 1; i--) {
							const stripped = lines[i].replace(sgrPattern, "").trim();
							if (stripped.startsWith("─") || /↓ \d+ more/.test(stripped)) {
								bottomBorderIdx = i;
								break;
							}
						}

						const scrollDownMatch = bottomBorderIdx >= 0
							? lines[bottomBorderIdx].match(/↓ (\d+) more/)
							: null;

						// Extract content lines (between borders) and autocomplete lines (after bottom border)
						const content = bottomBorderIdx >= 0
							? lines.slice(1, bottomBorderIdx)
							: lines.slice(1, -1);
						const autocompleteLines = bottomBorderIdx >= 0 && bottomBorderIdx < lines.length - 1
							? lines.slice(bottomBorderIdx + 1)
							: [];

						// Build the marker column: ▌ in borderColor (thinking level / bash mode),
						// or scroll indicator replaces ▌ on that line. Padded to markerWidth.
						const makeMarker = (indicator?: string): string => {
							const glyph = indicator ?? markerRaw;
							const styled = this.borderColor(glyph);
							const styledVisible = indicator ? indicator.length : 1;
							const pad = " ".repeat(Math.max(0, markerWidth - styledVisible));
							return `${styled}${pad}`;
						};

						const rendered: string[] = [];

						// Top blank line with ▌ (or scroll-up indicator)
						const topMarker = scrollUpMatch
							? makeMarker(`↑${scrollUpMatch[1]}`)
							: makeMarker();
						rendered.push(`${bgOpen}${topMarker}${bgOpen}${" ".repeat(Math.max(0, innerWidth))}${bgClose}`);

						// Content lines: ▌ + bg-colored text
						for (const line of content) {
							// Re-anchor background after any \x1b[0m resets inside the line
							// (cursor highlight, color codes, etc.)
							const repaired = line.replace(resetPattern, `${resetAnsi}${bgOpen}`);
							const w = visibleWidth(line);
							const padded = w < innerWidth
								? repaired + " ".repeat(innerWidth - w)
								: repaired;
							rendered.push(`${bgOpen}${makeMarker()}${bgOpen}${padded}${bgClose}`);
						}

						// Bottom blank line with ▌ (or scroll-down indicator)
						const bottomMarker = scrollDownMatch
							? makeMarker(`↓${scrollDownMatch[1]}`)
							: makeMarker();
						rendered.push(`${bgOpen}${bottomMarker}${bgOpen}${" ".repeat(innerWidth)}${bgClose}`);

						// Autocomplete lines: rendered at innerWidth by parent, pad to full width
						for (const acLine of autocompleteLines) {
							const w = visibleWidth(acLine);
							const pad = w < width
								? " ".repeat(width - w)
								: "";
							rendered.push(acLine + pad);
						}

						// Trailing empty line for spacing
						rendered.push("");

						return rendered;
					}
				})(tui, editorTheme, keybindings);
				return editor;
			});

		ctx.ui.setHeader((_tui, theme) => ({
			render(width: number): string[] {
				if (!enabled) return [];
				try {
					const activeCtx = installedCtx ?? ctx;
					const activeUsage = getActiveUsage(activeCtx);
					const thinking = pi.getThinkingLevel();
					return renderHeader(
						{
							ctx: activeCtx,
							activeUsage,
							thinkingLevel: thinking,
						},
						theme,
					)(width);
				} catch {
					return [theme.fg("muted", "pi-hud")];
				}
			},
			invalidate() {},
		}));

		if (initialLayout.warning) {
			ctx.ui.notify(`HUD layout: ${initialLayout.warning}`, "warning");
		} else if (initialLayout.warnings && initialLayout.warnings.length > 0) {
			ctx.ui.notify(
				`HUD layout loaded with warnings\n${formatLayoutValidationIssues(initialLayout.warnings)}`,
				"warning",
			);
		}
	});

	pi.on("model_select", (_event, ctx) => {
		installedCtx = ctx;
		void refreshActiveProvider(ctx);
		requestRenderAll();
	});

	pi.on("agent_start", () => {
		activeStartedAt = Date.now();
		requestRenderAll();
	});

	pi.on("agent_end", () => {
		if (activeStartedAt) lastRunMs = Date.now() - activeStartedAt;
		activeStartedAt = null;
		requestRenderAll();
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") {
			lastAssistantStart = Date.now();
			lastTps = null;
			lastTpsRenderAt = 0;
			tokenSpeed.start(lastAssistantStart);
			footerTui?.requestRender();
		}
	});

	pi.on("message_update", (event) => {
		const update = event.assistantMessageEvent;
		if (update.type !== "text_delta" && update.type !== "thinking_delta") return;
		tokenSpeed.recordToken();
		lastTps = tokenSpeed.snapshot().tps;
		requestTpsRender();
	});

	pi.on("message_end", (event) => {
		// Incremental totals accumulation (O(1) instead of O(n) per render)
		accumulateMessage(event.message, totals);

		if (event.message.role !== "assistant") return;
		const now = Date.now();
		const snapshot = tokenSpeed.stop(now);
		const usage = (event.message as { usage?: { output?: number } }).usage;
		const elapsed = lastAssistantStart
			? Math.max((now - lastAssistantStart) / 1000, 0.001)
			: 0;
		lastTps = usage?.output && elapsed > 0
			? usage.output / elapsed
			: snapshot.tokenCount > 0
				? snapshot.averageTps
				: lastTps;
		lastAssistantStart = null;
		requestRenderAll();
	});

	pi.on("turn_end", () => {
		if (!tokenSpeed.isStreaming) return;
		lastTps = tokenSpeed.stop().averageTps;
		lastAssistantStart = null;
		footerTui?.requestRender();
	});
	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setFooter(undefined);
		ctx.ui.setHeader(undefined);
		if (wallClockTimer !== null) {
			clearInterval(wallClockTimer);
			wallClockTimer = null;
		}
		footerTui = null;
		installedCtx = null;
		// Reset cached totals for new session
		totals = initSessionTotals();
		lastTps = null;
		lastAssistantStart = null;
		lastTpsRenderAt = 0;
		if (tokenSpeed.isStreaming) tokenSpeed.stop();
	});


	pi.registerCommand("hud", {
		description:
			"Manage the HUD: /hud on|off|refresh|reload|layout|blocks|validate|status|theme [name]|ascii",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();

			// --- on / off ---
			if (arg === "off") {
				enabled = false;
				requestRenderAll();
				ctx.ui.notify("HUD disabled", "warning");
				return;
			}
			if (arg === "on") {
				enabled = true;
				requestRenderAll();
				ctx.ui.notify("HUD enabled", "info");
				return;
			}

			// --- refresh ---
			if (arg === "refresh") {
				const activeCtx = installedCtx ?? ctx;
				await refreshActiveProvider(activeCtx);
				requestRenderAll();
				ctx.ui.notify("HUD refreshed", "info");
				return;
			}

			// --- reload layout config ---
			if (arg === "reload") {
				const res = loadLayout();
				layout = res.layout;
				requestRenderAll();
				if (res.warning) {
					ctx.ui.notify(res.warning, "warning");
					return;
				}
				if (res.warnings && res.warnings.length > 0) {
					ctx.ui.notify(
						`HUD layout reloaded with warnings\n${formatLayoutValidationIssues(res.warnings)}`,
						"warning",
					);
					return;
				}
				ctx.ui.notify("HUD layout reloaded", "info");
				return;
			}
			if (arg === "layout") {
				ctx.ui.notify(`HUD layout config: ${layoutPath()}`, "info");
				return;
			}

			if (arg === "blocks") {
				ctx.ui.notify(formatHudBlocks(), "info");
				return;
			}

			if (arg === "validate") {
				const result = validateLayoutFile();
				if (result.issues.length === 0) {
					ctx.ui.notify(`HUD layout valid\n${result.path}`, "info");
					return;
				}
				ctx.ui.notify(
					`HUD layout warnings (${result.path})\n${formatLayoutValidationIssues(result.issues)}`,
					"warning",
				);
				return;
			}


			// --- theme ---
			if (arg.startsWith("theme")) {
				const themeName = arg.slice(5).trim();
				if (!themeName) {
					// Just "theme" — list available palettes
					const current = getActivePaletteName();
					const names = PALETTE_NAMES.map((n) =>
						n === current ? `*${n}*` : n,
					).join(", ");
					ctx.ui.notify(`HUD themes: ${names}`, "info");
					return;
				}
				if (!PALETTE_NAMES.includes(themeName) && themeName !== "random") {
					ctx.ui.notify(
						`Unknown theme. Use: ${PALETTE_NAMES.join(", ")}, or "random"`,
						"error",
					);
					return;
				}
				setActivePalette(themeName);
				ctx.ui.notify(
					`HUD theme: ${themeName} (applies on next session start)`,
					"info",
				);
				return;
			}

			// --- ascii ---
			if (arg === "ascii") {
				const current = isAsciiMode();
				setAsciiMode(!current);
				requestRenderAll();
				ctx.ui.notify(`HUD ASCII mode: ${!current ? "ON" : "OFF"}`, "info");
				return;
			}

			// --- status (default) ---
			ctx.ui.notify(
				[
					`Codex: ${codexUsage.status}${codexUsage.message ? ` (${codexUsage.message})` : ""}`,
					`Anthropic: ${anthropicUsage.status}${anthropicUsage.message ? ` (${anthropicUsage.message})` : ""}`,
					`MiniMax: ${minimaxUsage.status}${minimaxUsage.message ? ` (${minimaxUsage.message})` : ""}`,
					`Umans: ${umansUsage.status}${umansUsage.message ? ` (${umansUsage.message})` : ""}`,
				].join("\n"),
				"info",
			);
		},
	});
}
