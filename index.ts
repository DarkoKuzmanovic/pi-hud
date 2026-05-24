import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "./render/format.js";

// Types
import type { ProviderUsage } from "./types.js";

// Providers
import { fetchCodexUsage, codexToProvider } from "./providers/codex.js";
import {
	fetchAnthropicUsage,
	anthropicToProvider,
	loadCachedAnthropicUsage,
} from "./providers/anthropic.js";
import {
	fetchOllamaUsage,
	ollamaToProvider,
} from "./providers/ollama-cloud.js";
import { fetchWaferUsage, waferToProvider } from "./providers/wafer.js";
import { fetchCrofaiUsage, crofaiToProvider } from "./providers/crofai.js";
import {
	fetchOpenCodeUsage,
	opencodeToProvider,
} from "./providers/opencode.js";

// Git
import {
	gitDirtyAsync,
	gitRemoteStatusAsync,
	gitLastCommitAsync,
} from "./git.js";
import type { GitDirtyResult, GitRemoteResult, GitLastCommit } from "./git.js";

// Render
import { renderHeader } from "./render/header.js";
import { renderFooter } from "./render/footer.js";
import { initSessionTotals, accumulateMessage } from "./render/context.js";
import {
	setActivePalette,
	PALETTE_NAMES,
	getActivePaletteName,
} from "./render/header.js";
import { setAsciiMode, isAsciiMode } from "./render/format.js";

// --- Constants ---
const QUOTA_REFRESH_MS = 60_000;
const WAFER_QUOTA_REFRESH_MS = 60_000;
const GIT_REFRESH_MS = 5_000;

// --- Provider helpers ---
const isOllamaProvider = (provider?: string): boolean =>
	provider === "ollama" || provider === "ollama-cloud";
const isWaferProvider = (provider?: string): boolean => provider === "wafer";
const isCrofaiProvider = (provider?: string): boolean => provider === "crofai";
const isOpenCodeProvider = (provider?: string): boolean =>
	provider === "opencode" || provider === "opencode-go";

// --- Main extension ---
export default function piHud(pi: ExtensionAPI) {
	let enabled = true;
	let installedCtx: ExtensionContext | null = null;
	let activeStartedAt: number | null = null;
	let lastRunMs: number | null = null;
	let lastTps: number | null = null;
	let lastAssistantStart: number | null = null;

	// Hint mode — controls footer line 4 (cycling hint).
	//   cycle = rotate every 5s (HINTS array, via nextHint cache TTL)
	//   once  = show until first user message of session, then omit
	//   off   = never show
	// Default "once" matches the design goal: hint visible briefly at session
	// start (welcome / feature discovery), then out of the way for the rest
	// of the session. Change with /hud hint cycle|once|off.
	let hintMode: "cycle" | "once" | "off" = "once";
	let firstUserMessageSeen = false;

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
	let ollamaUsage: ProviderUsage = {
		id: "ollama-cloud",
		name: "Ollama",
		icon: "\uee0d",
		status: "unknown",
		message: "loading",
		windows: [{ label: "5h" }, { label: "week" }],
	};
	let waferUsage: ProviderUsage = {
		id: "wafer",
		name: "Wafer",
		icon: "\uee0d",
		status: "unknown",
		message: "loading",
		windows: [{ label: "5h" }],
	};
	let crofaiUsage: ProviderUsage = {
		id: "crofai",
		name: "CrofAI",
		icon: "\uee0d",
		status: "unknown",
		message: "loading",
		windows: [{ label: "daily" }],
	};
	let opencodeUsage: ProviderUsage = {
		id: "opencode",
		name: "OpenCode",
		icon: "\uee0d",
		status: "unknown",
		message: "loading",
		windows: [{ label: "5h" }, { label: "week" }, { label: "month" }],
	};

	let codexInFlight: Promise<void> | null = null;
	let anthropicInFlight: Promise<void> | null = null;
	let ollamaInFlight: Promise<void> | null = null;
	let waferInFlight: Promise<void> | null = null;
	let opencodeInFlight: Promise<void> | null = null;
	let crofaiInFlight: Promise<void> | null = null;

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

	const getActiveUsage = (ctx: ExtensionContext): ProviderUsage => {
		const provider = ctx.model?.provider;
		if (provider === "anthropic") return anthropicUsage;
		if (isOllamaProvider(provider)) return ollamaUsage;
		if (isWaferProvider(provider)) return waferUsage;
		if (isOpenCodeProvider(provider)) return opencodeUsage;
		if (isCrofaiProvider(provider)) return crofaiUsage;
		return codexUsage;
	};

	// Stable hash for change detection: every provider stamps `updatedAt: Date.now()`
	// on every refresh regardless of whether the underlying usage values changed.
	// Including it in the JSON comparison made the "did data change?" check always
	// true, causing pi-hud to call tui.requestRender() on every quota tick — which
	// snaps the user's terminal scrollback back to the bottom. Compare on the
	// user-visible subset only.
	const stableUsageKey = (u: ProviderUsage): string => {
		const { updatedAt: _updatedAt, ...rest } = u;
		return JSON.stringify(rest);
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

	const refreshOllama = async () => {
		if (ollamaInFlight) return ollamaInFlight;
		ollamaInFlight = (async () => {
			ollamaUsage = ollamaToProvider(await fetchOllamaUsage(), ollamaUsage);
		})().finally(() => {
			ollamaInFlight = null;
		});
		return ollamaInFlight;
	};

	const refreshWafer = async () => {
		if (waferInFlight) return waferInFlight;
		waferInFlight = (async () => {
			waferUsage = waferToProvider(await fetchWaferUsage(), waferUsage);
		})().finally(() => {
			waferInFlight = null;
		});
		return waferInFlight;
	};

	const refreshCrofai = async () => {
		if (crofaiInFlight) return crofaiInFlight;
		crofaiInFlight = (async () => {
			crofaiUsage = crofaiToProvider(await fetchCrofaiUsage(), crofaiUsage);
		})().finally(() => {
			crofaiInFlight = null;
		});
		return crofaiInFlight;
	};

	const refreshOpenCode = async () => {
		if (opencodeInFlight) return opencodeInFlight;
		opencodeInFlight = (async () => {
			opencodeUsage = opencodeToProvider(
				await fetchOpenCodeUsage(),
				opencodeUsage,
			);
		})().finally(() => {
			opencodeInFlight = null;
		});
		return opencodeInFlight;
	};

	const refreshActiveProvider = (ctx: ExtensionContext) => {
		const provider = ctx.model?.provider;
		if (provider === "anthropic") return refreshAnthropic();
		if (isOllamaProvider(provider)) return refreshOllama();
		if (isWaferProvider(provider)) return refreshWafer();
		if (isOpenCodeProvider(provider)) return refreshOpenCode();
		if (isCrofaiProvider(provider)) return refreshCrofai();
		return refreshCodex();
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
					footerTui?.requestRender();
				}
			})
			.catch(() => {
				gitRefreshInProgress = false;
			});
	};

	// --- Install header + footer ---
	const install = (ctx: ExtensionContext) => {
		installedCtx = ctx;
		if (!enabled || !ctx.hasUI) return;
		void refreshActiveProvider(ctx);

		ctx.ui.setFooter((tui, theme, footerData) => {
			footerTui = tui;
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			// Wall-clock refresh at 30s: quota/git refresh checks + time-based display updates.
			// Only requestRender() when something actually changed — unconditional re-renders
			// cause the TUI to scroll the viewport back to the bottom, disrupting reading.
			wallClockTimer = setInterval(() => {
				const activeUsage = getActiveUsage(ctx);
				const isWaferActive = isWaferProvider(ctx.model?.provider);
				const quotaRefresh = isWaferActive
					? WAFER_QUOTA_REFRESH_MS
					: QUOTA_REFRESH_MS;
				const needsQuotaRefresh = Date.now() - (activeUsage.updatedAt ?? 0) > quotaRefresh;
				if (needsQuotaRefresh) {
					const prevUsage = stableUsageKey(activeUsage);
					void refreshActiveProvider(ctx).then(() => {
						const newUsage = stableUsageKey(getActiveUsage(ctx));
						if (newUsage !== prevUsage) {
							tui.requestRender();
						}
					});
				}
				const needsGitRefresh = Date.now() - lastGitAt > GIT_REFRESH_MS;
				if (needsGitRefresh) {
					refreshGitAsync(ctx.cwd);
				}
				// Re-render when a live timer is active (the ⏱ duration display
				// updates per-minute via fmtDuration). Quota and git refreshes are
				// handled by their async callbacks — quota's then() and git's then()
				// each call requestRender() only when data actually changed.
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
					try {
						const activeUsage = getActiveUsage(ctx);
						const thinking = pi.getThinkingLevel();


						return renderFooter(
							{
								ctx,
								activeUsage,
								totals,
								thinkingLevel: thinking,
								activeStartedAt,
								lastRunMs,
								lastTps,
								gitDirty: cachedGitDirty,
								gitRemote: cachedGitRemote,
								gitLastCommit: cachedGitLastCommit,
								hintMode,
								firstUserMessageSeen,
							},
							theme,
							footerData,
						)(width);
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
				if (entry.type === "assistant") {
					const usage = (entry as any).usage;
					totals.input += usage?.input ?? 0;
					totals.output += usage?.output ?? 0;
					totals.cost += usage?.cost?.total ?? 0;
				}
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
						const markerWidth = 3; // Fixed column: "▌  " or "↑3 " or "↓12 "
						const innerWidth = Math.max(1, width - markerWidth);

						// Render at innerWidth so text wraps correctly for the narrower column
						const lines = super.render(innerWidth);
						if (lines.length < 2) return lines;

						const bgOpen = fullTheme.getBgAnsi("toolSuccessBg");
						const bgClose = "\x1b[49m";
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
							const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
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
							// Only apply fg color — bg is set at the line level via bgOpen.
							// Using theme.bg here would emit \x1b[49m and break the line's background.
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
							const repaired = line.replace(/\x1b\[0m/g, `\x1b[0m${bgOpen}`);
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
				try {
					const activeUsage = getActiveUsage(ctx);
					const thinking = pi.getThinkingLevel();
					return renderHeader(
						{
							ctx,
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
	});

	pi.on("model_select", (_event, ctx) => {
		void refreshActiveProvider(ctx);
		footerTui?.requestRender();
	});

	pi.on("agent_start", () => {
		activeStartedAt = Date.now();
		footerTui?.requestRender();
	});

	pi.on("agent_end", () => {
		if (activeStartedAt) lastRunMs = Date.now() - activeStartedAt;
		activeStartedAt = null;
		footerTui?.requestRender();
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") lastAssistantStart = Date.now();
		// First user message of the session: flip the flag and trigger one re-render
		// so the hint disappears from the footer (when hintMode === "once").
		if (event.message.role === "user" && !firstUserMessageSeen) {
			firstUserMessageSeen = true;
			if (hintMode === "once") footerTui?.requestRender();
		}
	});

	pi.on("message_end", (event) => {
		// Incremental totals accumulation (O(1) instead of O(n) per render)
		accumulateMessage(event.message, totals);

		if (event.message.role !== "assistant" || !lastAssistantStart) return;
		const usage = (event.message as any).usage;
		const elapsed = Math.max((Date.now() - lastAssistantStart) / 1000, 0.001);
		lastTps = usage?.output ? usage.output / elapsed : lastTps;
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
		// Reset first-message tracking for the next session
		firstUserMessageSeen = false;
	});

	// Ctrl+` opens gitui as a Kitty overlay
	pi.registerShortcut("ctrl+`", {
		description: "Open gitui in a Kitty overlay",
		handler: async (ctx) => {
			if (typeof process === "undefined" || !process.env?.KITTY_WINDOW_ID) {
				ctx.ui.notify(
					"Not running inside Kitty — cannot open overlay",
					"warning",
				);
				return;
			}
			try {
				await pi.exec("kitty", [
					"@",
					"launch",
					"--type=overlay",
					`--cwd=${ctx.cwd}`,
					"gitui",
				]);
			} catch (e: any) {
				ctx.ui.notify(
					`gitui overlay failed — add allow_remote_control yes to kitty.conf (${e?.message ?? e})`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("hud", {
		description:
			"Manage the HUD: /hud on|off|refresh|status|theme [name]|ascii|hint [cycle|once|off]",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();

			// --- on / off ---
			if (arg === "off") {
				enabled = false;
				ctx.ui.setFooter(undefined);
				ctx.ui.setHeader(undefined);
				ctx.ui.notify("HUD disabled", "warning");
				return;
			}
			if (arg === "on") {
				enabled = true;
				install(ctx);
				ctx.ui.notify("HUD enabled", "success");
				return;
			}

			// --- refresh ---
			if (arg === "refresh") {
				await refreshActiveProvider(ctx);
				if (installedCtx) install(installedCtx);
				ctx.ui.notify("HUD refreshed", "info");
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
					"success",
				);
				return;
			}

			// --- ascii ---
			if (arg === "ascii") {
				const current = isAsciiMode();
				setAsciiMode(!current);
				ctx.ui.notify(`HUD ASCII mode: ${!current ? "ON" : "OFF"}`, "success");
				if (installedCtx) install(installedCtx);
				return;
			}

			// --- hint mode ---
			if (arg.startsWith("hint")) {
				const mode = arg.slice(4).trim();
				if (!mode) {
					ctx.ui.notify(
						`HUD hint mode: ${hintMode} (cycle | once | off)`,
						"info",
					);
					return;
				}
				if (mode !== "cycle" && mode !== "once" && mode !== "off") {
					ctx.ui.notify(
						`Unknown hint mode "${mode}". Use: cycle | once | off`,
						"error",
					);
					return;
				}
				hintMode = mode;
				footerTui?.requestRender();
				ctx.ui.notify(`HUD hint mode: ${mode}`, "success");
				return;
			}

			// --- status (default) ---
			ctx.ui.notify(
				[
					`Codex: ${codexUsage.status}${codexUsage.message ? ` (${codexUsage.message})` : ""}`,
					`Anthropic: ${anthropicUsage.status}${anthropicUsage.message ? ` (${anthropicUsage.message})` : ""}`,
					`Ollama: ${ollamaUsage.status}${ollamaUsage.message ? ` (${ollamaUsage.message})` : ""}`,
					`Wafer: ${waferUsage.status}${waferUsage.message ? ` (${waferUsage.message})` : ""}`,
					`CrofAI: ${crofaiUsage.status}${crofaiUsage.message ? ` (${crofaiUsage.message})` : ""}`,
					`OpenCode: ${opencodeUsage.status}${opencodeUsage.message ? ` (${opencodeUsage.message})` : ""}`,
				].join("\n"),
				"info",
			);
		},
	});
}
