import { basename } from "node:path";
import { truncateToWidth } from "./format.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderUsage, ThemeAccess } from "../types.js";
import type { SessionTotals } from "./context.js";
import { fmtInt, fmtDuration, compactPath, compactModelName, chip, dimChip, thinkingChip, padBetween, renderProviderUsage } from "./format.js";
import { formatContext } from "./context.js";
import type { GitDirtyResult, GitRemoteResult, GitLastCommit } from "../git.js";

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
	palimpsest: {
		questsDone: number;
		questsTotal: number;
		currentQuest: string | null;
		instinctsTotal: number;
		instinctsProject: number;
		observations: number;
	};
}

export function renderFooter(deps: FooterDeps, theme: ThemeAccess, footerData: any): (width: number) => string[] {
	return (width: number) => {
		try {
			const { ctx, activeUsage, totals, thinkingLevel, activeStartedAt, lastRunMs, lastTps, gitDirty, gitRemote, gitLastCommit, palimpsest } = deps;

			const cwdName = basename(ctx.cwd) || ctx.cwd;
			const cwdPath = compactPath(ctx.cwd);
			const branch = footerData.getGitBranch();

			const statuses = [...footerData.getExtensionStatuses().entries()]
				.filter(([key, val]) => !HIDDEN_STATUSES.has(key) && Boolean(val))
				.map(([, val]) => val)
				.join(theme.fg("dim", " \u2502 "))
				.replace(/\u00b7/g, theme.fg("dim", "\u2502"))
				.replace(/\u2022/g, theme.fg("dim", "\u2502"));
			const model = ctx.model ? compactModelName(ctx.model.id) : "no model";
			const run = activeStartedAt ? `\udb81\udcef ${fmtDuration(Date.now() - activeStartedAt)}` : lastRunMs ? `\udb81\udcef ${fmtDuration(lastRunMs)}` : "\udb81\udcef idle";
			const speed = lastTps ? `\u26a1 ${lastTps.toFixed(1)} tok/s` : "";

			const left1 = [
				chip("\ue22c", theme),
				dimChip(`\udb80\udc5c ${cwdName}`, theme),
				theme.fg("dim", cwdPath),
				branch ? `${theme.fg("muted", "\udb80\udc65")} ${branch}` : "",
				gitDirty.text ? theme.fg(gitDirty.isClean ? "success" : "warning", gitDirty.text) : "",
				dimChip(`\udb80\ude29 ${model}`, theme),
				thinkingChip(thinkingLevel, theme),
			].filter(Boolean).join(theme.fg("dim", "  "));

			const right1 = [
				formatContext(ctx),
				`\u2191${fmtInt(totals.input)} \u2193${fmtInt(totals.output)}`,
				run,
				speed,
			].filter(Boolean).join(theme.fg("dim", "  \u2502  "));

			const syncParts: string[] = [];
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
			const left2 = [gitSync, commit, statuses].filter(Boolean).join(theme.fg("dim", "  \u2502  "));
			const right2 = renderProviderUsage(activeUsage, theme);

			// Palimpsest line (only when active)
			let line3 = "";
			const hasPalimpsest = palimpsest.questsTotal > 0 || palimpsest.instinctsTotal > 0;
			if (hasPalimpsest) {
				const plParts: string[] = [];

				if (palimpsest.questsTotal > 0) {
					const filled = Math.round((palimpsest.questsDone / palimpsest.questsTotal) * 4);
					const bar = "\u25a0".repeat(filled) + "\u25a1".repeat(4 - filled);
					const questColor = palimpsest.questsDone === palimpsest.questsTotal ? "success" : "accent";
					const questStatus = `${theme.fg(questColor, bar)} ${palimpsest.questsDone}/${palimpsest.questsTotal} quests`;
					const current = palimpsest.currentQuest ? theme.fg("muted", ` \u00b7 ${truncateToWidth(palimpsest.currentQuest, 40, "\u2026")}`) : "";
					plParts.push(`\u2503 ${questStatus}${current}`);
				}

				const instLabel = palimpsest.instinctsTotal > 0
					? `${palimpsest.instinctsTotal} instincts${palimpsest.instinctsProject > 0 ? ` (${palimpsest.instinctsProject} project)` : ""}`
					: "";
				const obsLabel = palimpsest.observations > 0 ? `${palimpsest.observations} obs` : "";
				const metaParts = [instLabel, obsLabel].filter(Boolean).join(theme.fg("dim", " \u00b7 "));

				const left3 = plParts.length > 0
					? plParts[0]
					: `${theme.fg("dim", "\ud83d\udcdc")} palimpsest`;
				const right3 = metaParts ? theme.fg("dim", `\ud83d\udcdc ${metaParts}`) : "";
				line3 = padBetween(left3, right3, width);
			}

			const lines = [padBetween(left1, right1, width), padBetween(left2, right2, width)];
			if (line3) lines.push(line3);
			return lines.map((line) => truncateToWidth(line, width, "…"));
		} catch (err: any) {
			return [theme.fg("error", `pi-hud: ${err?.message ?? err}`)];
		}
	};
}
