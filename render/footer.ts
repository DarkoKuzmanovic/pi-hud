import { basename } from "node:path";
import { truncateToWidth } from "./format.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderUsage, ThemeAccess } from "../types.js";
import type { SessionTotals } from "./context.js";
import { fmtInt, fmtDuration, compactPath, compactModelName, chip, dimChip, thinkingChip, padBetween, renderProviderUsage, costStr, statusDot, ICON_PROJECT, ICON_FOLDER, ICON_MODEL, ICON_BRANCH, isAsciiMode } from "./format.js";
import { formatContext } from "./context.js";
import type { GitDirtyResult, GitRemoteResult, GitLastCommit } from "../git.js";
import { getActivePalette } from "./header.js";

const HIDDEN_STATUSES = new Set(["claude-oauth-ready", "claude-oauth-issue"]);

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
}
export function renderFooter(deps: FooterDeps, theme: ThemeAccess, footerData: any): (width: number) => string[] {
	return (width: number) => {
		try {
			const { ctx, activeUsage, totals, thinkingLevel, activeStartedAt, lastRunMs, lastTps, gitDirty, gitRemote, gitLastCommit } = deps;
			const palette = getActivePalette();
			const ascii = isAsciiMode();
			const vert = ascii ? "|" : "\u2502";
			const dotSep = ascii ? "\u00b7" : "\u00b7"; // middle dot renders in both modes

			const cwdName = basename(ctx.cwd) || ctx.cwd;
			const cwdPath = compactPath(ctx.cwd);
			const branch = footerData.getGitBranch();

			const statuses = [...footerData.getExtensionStatuses().entries()]
				.filter(([key, val]) => !HIDDEN_STATUSES.has(key) && Boolean(val))
				.map(([, val]) => val)
				.join(theme.fg("dim", ` ${vert} `))
				.replace(/\u00b7/g, theme.fg("dim", vert))
				.replace(/\u2022/g, theme.fg("dim", vert));
			const model = ctx.model ? compactModelName(ctx.model.id) : "no model";
			const run = activeStartedAt ? `\udb81\udcef ${fmtDuration(Date.now() - activeStartedAt)}` : lastRunMs ? `\udb81\udcef ${fmtDuration(lastRunMs)}` : "\udb81\udcef idle";
			const speed = lastTps ? `\u26a1 ${lastTps.toFixed(1)} tok/s` : "";
			const cost = costStr(totals.cost);

			// --- Line 1: identity + navigation ---
			const left1 = [
				chip(ICON_PROJECT(), theme),
				dimChip(`${ICON_FOLDER()} ${cwdName}`, theme),
				theme.fg("dim", cwdPath),
				branch ? `${theme.fg("muted", ICON_BRANCH())} ${branch}` : "",
				gitDirty.text ? theme.fg(gitDirty.isClean ? "success" : "warning", gitDirty.text) : "",
				dimChip(`${ICON_MODEL()} ${model}`, theme),
				thinkingChip(thinkingLevel, theme),
			].filter(Boolean).join(theme.fg("dim", "  "));

			const right1 = [
				formatContext(ctx),
				statusDot(activeUsage.status, theme),
			].filter(Boolean).join(theme.fg("dim", ` ${vert} `));

			// --- Line 2: performance metrics + quota ---
			const tokenStr = totals.input > 0 || totals.output > 0
				? `\u2191${fmtInt(totals.input)} \u2193${fmtInt(totals.output)}${cost ? ` ${cost}` : ""}`
				: "";
			const left2 = [tokenStr, run, speed].filter(Boolean).join(theme.fg("dim", ` ${vert} `));

			// Right side of line 2: quota bar (palette-tinted provider chip)
			const right2 = renderProviderUsage(activeUsage, theme, palette);

			// --- Line 3: session ID + git details + extension statuses ---
			const sessionId = ctx.sessionManager.getSessionId();
			const sessionIdShort = sessionId ? sessionId.slice(0, 8) : "????????";
			const sessionChip = theme.fg("muted", `\udb80\udda2 ${sessionIdShort}`);
			const syncParts: string[] = [sessionChip];
			if (!gitRemote.hasRemote) {
				syncParts.push(theme.fg("error", "\u26a0 no remote"));
			} else if (gitRemote.ahead === 0 && gitRemote.behind === 0) {
				syncParts.push(theme.fg("success", "\u2713 synced"));
			} else {
				if (gitRemote.ahead > 0) syncParts.push(theme.fg("warning", `\u2191${gitRemote.ahead}`));
				if (gitRemote.behind > 0) syncParts.push(theme.fg("error", `\u2193${gitRemote.behind}`));
			}
			const gitSync = syncParts.join(" ");
			const commit = gitLastCommit.hash
				? `${theme.fg("muted", gitLastCommit.hash)} ${truncateToWidth(gitLastCommit.subject, 36, "\u2026")} ${theme.fg("dim", gitLastCommit.age)}`
				: "";
			const left3 = [gitSync, commit, statuses].filter(Boolean).join(theme.fg("dim", ` ${vert} `));
			const right3 = "";


			const lines = [
				padBetween(left1, right1, width),
				padBetween(left2, right2, width),
				padBetween(left3, right3, width),
			];
			return lines.filter((l) => l.length > 0).map((line) => truncateToWidth(line, width, "\u2026"));
		} catch (err: any) {
			return [theme.fg("error", `pi-hud: ${err?.message ?? err}`)];
		}
	};
}
