import { basename } from "node:path";
import { truncateToWidth } from "./format.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderUsage, ThemeAccess } from "../types.js";
import type { SessionTotals } from "./context.js";
import { fmtInt, fmtDuration, compactPath, compactModelName, chip, dimChip, thinkingChip, rainbowChip, padBetween, renderProviderUsage, costStr, statusDot, ICON_PROJECT, ICON_FOLDER, ICON_CWD, ICON_MODEL, ICON_BRANCH, isAsciiMode } from "./format.js";
import { formatContext } from "./context.js";
import type { GitDirtyResult, GitRemoteResult, GitLastCommit } from "../git.js";
import { getActivePalette, nextHint } from "./header.js";

const HIDDEN_STATUSES = new Set(["claude-oauth-ready", "claude-oauth-issue", "ultrathink"]);

export interface FooterDeps {
	ctx: ExtensionContext;
	activeUsage: ProviderUsage;
	totals: SessionTotals;
	thinkingLevel: string;
	activeStartedAt: number | null;
	lastRunMs: number | null;
	lastTps: number | null;
	gitDirty: GitDirtyResult;
	gitRemote: GitRemoteResult;
	gitLastCommit: GitLastCommit;
	hintMode: "cycle" | "once" | "off";
	firstUserMessageSeen: boolean;
}

export function renderFooter(deps: FooterDeps, theme: ThemeAccess, footerData: any): (width: number) => string[] {
	return (width: number) => {
		try {
			const { ctx, activeUsage, totals, thinkingLevel, activeStartedAt, lastRunMs, lastTps, gitDirty, gitRemote, gitLastCommit } = deps;
			const palette = getActivePalette();
			const ascii = isAsciiMode();
			const vert = ascii ? "|" : "│";
			const dotSep = ascii ? "·" : "·";

			const cwdName = basename(ctx.cwd) || ctx.cwd;
			const cwdPath = compactPath(ctx.cwd);
			const branch = footerData.getGitBranch();

			const statuses = [...footerData.getExtensionStatuses().entries()]
				.filter(([key, val]) => !HIDDEN_STATUSES.has(key) && Boolean(val))
				.map(([, val]) => val.replace(/ · [↻⏸]?\s*auto-update.*$/, ""))
				.join(theme.fg("dim", ` ${vert} `))
				.replace(/\u00b7/g, theme.fg("dim", vert))
				.replace(/\u2022/g, theme.fg("dim", vert));
			const model = ctx.model ? compactModelName(ctx.model.id) : "no model";
			const ultrathinkStatus = footerData.getExtensionStatuses().get("ultrathink") ?? "";
			const run = activeStartedAt ? `\uf017 ${fmtDuration(Date.now() - activeStartedAt)}` : lastRunMs ? `\uf017 ${fmtDuration(lastRunMs)}` : "\uf017 idle";
			const speed = lastTps ? `\udb80\ude41 ${lastTps.toFixed(1)} tok/s` : "";
			const cost = costStr(totals.cost);

			// --- Cluster: path + branch + git status (line 2) ---
			const location = [
				`${ICON_CWD()} ${theme.fg("dim", cwdPath)}`,
				branch ? `${theme.fg("muted", ICON_BRANCH())} ${branch}` : "",
				gitDirty.text ? theme.fg(gitDirty.isClean ? "success" : "warning", gitDirty.text) : "",
			].filter(Boolean).join(theme.fg("dim", "  "));

			// --- Git commit (shared across lines) ---
			const commit = gitLastCommit.hash
				? `${theme.fg("muted", gitLastCommit.hash)} ${truncateToWidth(gitLastCommit.subject, 36, "…")} ${theme.fg("dim", gitLastCommit.age)}`
				: "";

			// --- Line 1: identity + folder + model state ---
			const left1 = [
				chip(`${ICON_PROJECT()} `, theme),
				dimChip(`${ICON_FOLDER()} ${cwdName}`, theme),
				dimChip(`${ICON_MODEL()} ${model}`, theme),
				thinkingChip(thinkingLevel, theme),
				ultrathinkStatus ? rainbowChip(ultrathinkStatus, theme) : "",
			].filter(Boolean).join(theme.fg("dim", "  "));

			const right1 = [
				dimChip(formatContext(ctx), theme),
				statusDot(activeUsage.status, theme),
			].filter(Boolean).join(theme.fg("dim", ` ${vert} `));

			// --- Line 2: performance metrics ---
			const tokenStr = totals.input > 0 || totals.output > 0
				? `↑${fmtInt(totals.input)} ↓${fmtInt(totals.output)}${cost ? ` ${cost}` : ""}` : "";
			const left2 = [tokenStr, run, location, commit].filter(Boolean).join(theme.fg("dim", ` ${vert} `));

			// --- Right side of line 2 ---
			// Supported providers (Anthropic/Codex/MiniMax/…) show their quota usage.
			// Unsupported providers (e.g. umans) have no quota windows, so instead of
			// the empty "Unsupported: x  5h: n/a  7d: n/a" row we surface live speed +
			// session activity (tok/s │ N ⟳uptime) in that same slot.
			let right2: string;
			if (activeUsage.id === "unsupported") {
				const entries = ctx.sessionManager?.getEntries?.() ?? [];
				const msgCount = entries.filter((e: any) => e.type === "message").length;
				const firstTs = entries[0]?.timestamp;
				const firstMs = firstTs ? Date.parse(firstTs) : NaN;
				const sessionUptime = Number.isFinite(firstMs) ? fmtDuration(Date.now() - firstMs) : "";
				right2 = [speed, msgCount ? `${msgCount} \u27f3${sessionUptime}` : null]
					.filter(Boolean)
					.join(theme.fg("dim", ` ${vert} `));
			} else {
				right2 = renderProviderUsage(activeUsage, theme, palette);
			}

			// --- Line 3: session ID + git details + extension statuses ---
			const sessionId = ctx.sessionManager.getSessionId();
			const sessionIdDisplay = sessionId ? sessionId : "????????-????-????-????-????????????";
			const sessionChip = theme.fg("muted", `🪪 ${sessionIdDisplay}`);
			const syncParts: string[] = [sessionChip];
			if (gitRemote.hasRemote) {
				if (gitRemote.ahead === 0 && gitRemote.behind === 0) {
					syncParts.push(theme.fg("success", "✓ synced"));
				} else {
					if (gitRemote.ahead > 0) syncParts.push(theme.fg("warning", `↑${gitRemote.ahead}`));
					if (gitRemote.behind > 0) syncParts.push(theme.fg("error", `↓${gitRemote.behind}`));
				}
			}
			const gitSync = syncParts.join(" ");
			const left3 = [gitSync, statuses].filter(Boolean).join(theme.fg("dim", ` ${vert} `));
			const right3 = speed;

			// --- Line 4: hint ---
			const showHint =
				deps.hintMode === "cycle" ||
				(deps.hintMode === "once" && !deps.firstUserMessageSeen);
			const hintLine = showHint ? `${theme.fg("dim", "\uea74")} ${theme.fg("accent", nextHint())}` : null;

			const lines = [
				padBetween(left1, right1, width),
				padBetween(left2, right2, width),
				padBetween(left3, right3, width),
				...(hintLine !== null ? [hintLine] : []),
			];
			return lines.filter((l) => l.length > 0).map((line) => truncateToWidth(line, width, "…"));
		} catch (err: any) {
			return [theme.fg("error", `pi-hud: ${err?.message ?? err}`)];
		}
	};
}
