import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "./render/format.js";

// Types
import type { ProviderUsage } from "./types.js";

// Providers
import { fetchCodexUsage, codexToProvider } from "./providers/codex.js";
import { fetchAnthropicUsage, anthropicToProvider } from "./providers/anthropic.js";
import { fetchOllamaUsage, ollamaToProvider } from "./providers/ollama-cloud.js";
import { fetchWaferUsage, waferToProvider } from "./providers/wafer.js";
import { fetchOpenCodeUsage, opencodeToProvider } from "./providers/opencode.js";

// Git
import { gitDirtyAsync, gitRemoteStatusAsync, gitLastCommitAsync } from "./git.js";
import type { GitDirtyResult, GitRemoteResult, GitLastCommit } from "./git.js";

// Render
import { renderHeader } from "./render/header.js";
import { renderFooter } from "./render/footer.js";
import { initSessionTotals, accumulateMessage } from "./render/context.js";
import type { SessionTotals } from "./render/context.js";

// --- Constants ---
const QUOTA_REFRESH_MS = 60_000;
const WAFER_QUOTA_REFRESH_MS = 300_000;
const GIT_REFRESH_MS = 5_000;

// --- Provider helpers ---
const isOllamaProvider = (provider?: string): boolean => provider === "ollama" || provider === "ollama-cloud";
const isWaferProvider = (provider?: string): boolean => provider === "wafer";
const isOpenCodeProvider = (provider?: string): boolean => provider === "opencode" || provider === "opencode-go";

// --- Main extension ---
export default function piHud(pi: ExtensionAPI) {
	let enabled = true;
	let installedCtx: ExtensionContext | null = null;
	let activeStartedAt: number | null = null;
	let lastRunMs: number | null = null;
	let lastTps: number | null = null;
	let lastAssistantStart: number | null = null;

	// Provider usage state
	let codexUsage: ProviderUsage = { id: "codex", name: "Codex", icon: "\udb80\ude29", status: "unknown", message: "loading", windows: [{ label: "5h" }, { label: "week" }] };
	let anthropicUsage: ProviderUsage = { id: "anthropic", name: "Claude", icon: "\udb80\udc8b", status: "unknown", message: "loading", windows: [{ label: "5h" }, { label: "week" }] };
	let ollamaUsage: ProviderUsage = { id: "ollama-cloud", name: "Ollama", icon: "\ud83e\udd99", status: "unknown", message: "loading", windows: [{ label: "5h" }, { label: "week" }] };
	let waferUsage: ProviderUsage = { id: "wafer", name: "Wafer", icon: "\ud83c\udf5e", status: "unknown", message: "loading", windows: [{ label: "5h" }] };
	let opencodeUsage: ProviderUsage = { id: "opencode", name: "OpenCode", icon: "\u{1F7E2}", status: "unknown", message: "loading", windows: [{ label: "5h" }, { label: "week" }, { label: "month" }] };

	let codexInFlight: Promise<void> | null = null;
	let anthropicInFlight: Promise<void> | null = null;
	let ollamaInFlight: Promise<void> | null = null;
	let waferInFlight: Promise<void> | null = null;
	let opencodeInFlight: Promise<void> | null = null;

	// Cached session totals (incremental, not O(n) per render)
	let totals = initSessionTotals();

	// Git state (cached, refreshed async)
	let lastGitAt = 0;
	let cachedGitDirty: GitDirtyResult = { text: "", isClean: false };
	let cachedGitRemote: GitRemoteResult = { ahead: 0, behind: 0, hasRemote: false };
	let cachedGitLastCommit: GitLastCommit = { hash: "", subject: "", age: "" };
	let gitRefreshInProgress = false;

	// Palimpsest state
	let plQuestsDone = 0;
	let plQuestsTotal = 0;
	let plCurrentQuest: string | null = null;
	let plInstinctsTotal = 0;
	let plInstinctsProject = 0;
	let plObservations = 0;

	const getActiveUsage = (ctx: ExtensionContext): ProviderUsage => {
		const provider = ctx.model?.provider;
		if (provider === "anthropic") return anthropicUsage;
		if (isOllamaProvider(provider)) return ollamaUsage;
		if (isWaferProvider(provider)) return waferUsage;
		if (isOpenCodeProvider(provider)) return opencodeUsage;
		return codexUsage;
	};

	// --- Provider refresh (in-flight dedup) ---
	const refreshCodex = async () => {
		if (codexInFlight) return codexInFlight;
		codexInFlight = (async () => {
			codexUsage = codexToProvider(await fetchCodexUsage(), codexUsage);
		})().finally(() => { codexInFlight = null; });
		return codexInFlight;
	};

	const refreshAnthropic = async () => {
		if (anthropicInFlight) return anthropicInFlight;
		anthropicInFlight = (async () => {
			anthropicUsage = anthropicToProvider(await fetchAnthropicUsage(), anthropicUsage);
		})().finally(() => { anthropicInFlight = null; });
		return anthropicInFlight;
	};

	const refreshOllama = async () => {
		if (ollamaInFlight) return ollamaInFlight;
		ollamaInFlight = (async () => {
			ollamaUsage = ollamaToProvider(await fetchOllamaUsage(), ollamaUsage);
		})().finally(() => { ollamaInFlight = null; });
		return ollamaInFlight;
	};

	const refreshWafer = async () => {
		if (waferInFlight) return waferInFlight;
		waferInFlight = (async () => {
			waferUsage = waferToProvider(await fetchWaferUsage(), waferUsage);
		})().finally(() => { waferInFlight = null; });
		return waferInFlight;
	};

	const refreshOpenCode = async () => {
		if (opencodeInFlight) return opencodeInFlight;
		opencodeInFlight = (async () => {
			opencodeUsage = opencodeToProvider(await fetchOpenCodeUsage(), opencodeUsage);
		})().finally(() => { opencodeInFlight = null; });
		return opencodeInFlight;
	};

	const refreshActiveProvider = (ctx: ExtensionContext) => {
		const provider = ctx.model?.provider;
		if (provider === "anthropic") return refreshAnthropic();
		if (isOllamaProvider(provider)) return refreshOllama();
		if (isWaferProvider(provider)) return refreshWafer();
		if (isOpenCodeProvider(provider)) return refreshOpenCode();
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
		]).then(([dirty, remote, lastCommit]) => {
			cachedGitDirty = dirty;
			cachedGitRemote = remote;
			cachedGitLastCommit = lastCommit;
			lastGitAt = Date.now();
			gitRefreshInProgress = false;
		}).catch(() => {
			gitRefreshInProgress = false;
		});
	};

	// --- Install header + footer ---
	const install = (ctx: ExtensionContext) => {
		installedCtx = ctx;
		if (!enabled || !ctx.hasUI) return;
		void refreshActiveProvider(ctx);

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			const interval = setInterval(() => {
				const activeUsage = getActiveUsage(ctx);
				const isWaferActive = isWaferProvider(ctx.model?.provider);
				const quotaRefresh = isWaferActive ? WAFER_QUOTA_REFRESH_MS : QUOTA_REFRESH_MS;
				if (Date.now() - (activeUsage.updatedAt ?? 0) > quotaRefresh) {
					void refreshActiveProvider(ctx).then(() => tui.requestRender());
				}
				// Refresh git async (non-blocking)
				if (Date.now() - lastGitAt > GIT_REFRESH_MS) {
					refreshGitAsync(ctx.cwd);
				}
				tui.requestRender();
			}, 1000);

			return {
				dispose: () => {
					unsubBranch();
					clearInterval(interval);
				},
				invalidate() {},
				render(width: number): string[] {
					try {
						const activeUsage = getActiveUsage(ctx);
						const thinking = pi.getThinkingLevel();

						// Palimpsest state
						try {
							pi.events.emit("palimpsest:get-state", (state: any) => {
								if (state?.quests) {
									const progress = state.quests.progress();
									plQuestsDone = progress.done;
									plQuestsTotal = progress.total;
									plCurrentQuest = state.quests.currentQuest();
								}
								if (state?.instincts) {
									plInstinctsTotal = state.instincts.project;
									plInstinctsProject = state.instincts.project;
								}
								plObservations = state?.observations ?? 0;
							});
						} catch {}

						return renderFooter({
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
							palimpsest: {
								questsDone: plQuestsDone,
								questsTotal: plQuestsTotal,
								currentQuest: plCurrentQuest,
								instinctsTotal: plInstinctsTotal,
								instinctsProject: plInstinctsProject,
								observations: plObservations,
							},
						}, theme, footerData)(width);
					} catch (err: any) {
						return [theme.fg("error", `pi-hud: ${err?.message ?? err}`)];
					}
				},
			};
		});
	};

	pi.on("session_start", (_event, ctx) => {
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
		} catch {}

		if (ctx.hasUI) {
			ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
				const fullTheme = ctx.ui.theme;
				const editor = new (class extends CustomEditor {
					render(width: number): string[] {
						const lines = super.render(width);
						if (lines.length < 2) return lines;
						const content = lines.slice(1, -1);
						if (content.length === 0) return lines;
						const bgOpen = fullTheme.getBgAnsi("selectedBg");
						const bgClose = "\x1b[49m";
						const blankBar = `${bgOpen}${" ".repeat(width)}${bgClose}`;
						const rendered = content.map((line) => {
							const repaired = line.replace(/\x1b\[0m/g, `\x1b[0m${bgOpen}`);
							const w = visibleWidth(line);
							const padded = w < width ? repaired + " ".repeat(width - w) : repaired;
							return `${bgOpen}${padded}${bgClose}`;
						});
						return [blankBar, ...rendered, blankBar, ""];
					}
				})(tui, editorTheme, keybindings);
				return editor;
			});

			ctx.ui.setHeader((_tui, theme) => ({
				render(width: number): string[] {
					try {
						const activeUsage = getActiveUsage(ctx);
						const thinking = pi.getThinkingLevel();
						return renderHeader({
							ctx,
							activeUsage,
							thinkingLevel: thinking,
						}, theme)(width);
					} catch {
						return [theme.fg("muted", "pi-hud")];
					}
				},
				invalidate() {},
			}));
		}
	});

	pi.on("model_select", (_event, ctx) => {
		void refreshActiveProvider(ctx);
	});

	pi.on("agent_start", () => {
		activeStartedAt = Date.now();
	});

	pi.on("agent_end", () => {
		if (activeStartedAt) lastRunMs = Date.now() - activeStartedAt;
		activeStartedAt = null;
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") lastAssistantStart = Date.now();
	});

	pi.on("message_end", (event) => {
		// Incremental totals accumulation (O(1) instead of O(n) per render)
		accumulateMessage(event.message, totals);

		if (event.message.role !== "assistant" || !lastAssistantStart) return;
		const usage = (event.message as any).usage;
		const elapsed = Math.max((Date.now() - lastAssistantStart) / 1000, 0.001);
		lastTps = usage?.output ? usage.output / elapsed : lastTps;
		lastAssistantStart = null;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setFooter(undefined);
		ctx.ui.setHeader(undefined);
		installedCtx = null;
		// Reset cached totals for new session
		totals = initSessionTotals();
	});

	// Ctrl+` opens gitui as a Kitty overlay
	pi.registerShortcut("ctrl+`", {
		description: "Open gitui in a Kitty overlay",
		handler: async (ctx) => {
			if (!process.env.KITTY_WINDOW_ID) {
				ctx.ui.notify("Not running inside Kitty — cannot open overlay", "warning");
				return;
			}
			try {
				await pi.exec("kitty", ["@", "launch", "--type=overlay", `--cwd=${ctx.cwd}`, "gitui"]);
			} catch (e: any) {
				ctx.ui.notify(
					`gitui overlay failed — add allow_remote_control yes to kitty.conf (${e?.message ?? e})`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("hud", {
		description: "Manage the HUD (header + footer): /hud on|off|refresh|status",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();
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
			if (arg === "refresh") {
				await refreshActiveProvider(ctx);
				if (installedCtx) install(installedCtx);
				ctx.ui.notify("HUD refreshed", "info");
				return;
			}

			ctx.ui.notify(
				[
					`Codex: ${codexUsage.status}${codexUsage.message ? ` (${codexUsage.message})` : ""}`,
					`Anthropic: ${anthropicUsage.status}${anthropicUsage.message ? ` (${anthropicUsage.message})` : ""}`,
					`Ollama: ${ollamaUsage.status}${ollamaUsage.message ? ` (${ollamaUsage.message})` : ""}`,
					`Wafer: ${waferUsage.status}${waferUsage.message ? ` (${waferUsage.message})` : ""}`,
					`OpenCode: ${opencodeUsage.status}${opencodeUsage.message ? ` (${opencodeUsage.message})` : ""}`,
				].join("\n"),
				"info",
			);
		},
	});
}
