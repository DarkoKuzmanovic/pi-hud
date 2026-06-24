import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HudLayout, LayoutValidationIssue } from "./config.js";
import type { ProviderUsage } from "./types.js";

export const DEFAULT_ROBOT_SPRITE_PATH = fileURLToPath(
	new URL("./assets/robot-spritesheet.png", import.meta.url),
);

export interface DoctorAuthProbe {
	codex: boolean;
	anthropic: boolean;
	minimax: boolean;
	umans: boolean;
	zai: boolean;
}

export interface DoctorProbes {
	auth: DoctorAuthProbe;
	sqlite3: boolean;
	firefoxProfile: boolean;
	robotSpriteAsset: boolean;
}

export interface DoctorProbeOptions {
	homeDir?: string;
	spriteAssetPath?: string;
	commandExists?: (name: string) => boolean;
}

export interface DoctorProviderSnapshot {
	name: string;
	usage: ProviderUsage;
	inFlight: boolean;
}

export interface DoctorContextSnapshot {
	hasUI?: boolean;
	cwd?: string;
	model?: {
		provider?: string;
		id?: string;
	} | null;
}

export interface DoctorSurfaceSnapshot {
	footer: boolean;
	shelf: boolean;
	wallClockTimer: boolean;
}

export interface DoctorReportInput {
	now?: number;
	ctx: DoctorContextSnapshot;
	layoutPath: string;
	layout: HudLayout;
	layoutWarning?: string;
	layoutWarnings?: LayoutValidationIssue[];
	asciiMode: boolean;
	surfaces: DoctorSurfaceSnapshot;
	probes: DoctorProbes;
	providers: DoctorProviderSnapshot[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStringProp(record: Record<string, unknown>, key: string): boolean {
	const value = record[key];
	return typeof value === "string" && value.length > 0;
}

function recordProp(
	record: Record<string, unknown>,
	key: string,
): Record<string, unknown> | null {
	const value = record[key];
	return isRecord(value) ? value : null;
}

function readAuthFile(homeDir: string): Record<string, unknown> {
	try {
		const authPath = join(homeDir, ".pi", "agent", "auth.json");
		if (!existsSync(authPath)) return {};
		const parsed: unknown = JSON.parse(readFileSync(authPath, "utf8"));
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function hasOAuth(record: Record<string, unknown> | null): record is Record<string, unknown> {
	return record?.type === "oauth" && hasStringProp(record, "access");
}

function hasApiKey(record: Record<string, unknown> | null): record is Record<string, unknown> {
	return record?.type === "api_key" && hasStringProp(record, "key");
}

function readAuthProbe(homeDir: string): DoctorAuthProbe {
	const auth = readAuthFile(homeDir);
	const codex = recordProp(auth, "openai-codex");
	const anthropic = recordProp(auth, "anthropic");
	const minimax = recordProp(auth, "minimax");
	const umans = recordProp(auth, "umans");
	const zai = recordProp(auth, "zai");
	return {
		codex: hasOAuth(codex) && hasStringProp(codex, "accountId"),
		anthropic: hasOAuth(anthropic),
		minimax: hasApiKey(minimax) || Boolean(process.env.MINIMAX_API_KEY),
		umans: hasOAuth(umans) || hasApiKey(umans) || Boolean(process.env.UMANS_API_KEY),
		zai: hasOAuth(zai) || hasApiKey(zai) || Boolean(process.env.ZAI_API_KEY),
	};
}

function defaultCommandExists(name: string): boolean {
	try {
		execFileSync(name, ["--version"], {
			stdio: "ignore",
			timeout: 1000,
		});
		return true;
	} catch {
		return false;
	}
}

function hasFirefoxCookieProfile(homeDir: string): boolean {
	const firefoxDir = join(homeDir, ".mozilla", "firefox");
	const hasCookies = (path: string): boolean => existsSync(join(path, "cookies.sqlite"));
	try {
		const iniPath = join(firefoxDir, "profiles.ini");
		if (existsSync(iniPath)) {
			const ini = readFileSync(iniPath, "utf8");
			const sections: Array<Record<string, string>> = [];
			let current: Record<string, string> | null = null;
			for (const rawLine of ini.split("\n")) {
				const line = rawLine.trim();
				if (line.startsWith("[") && line.endsWith("]")) {
					current = {};
					sections.push(current);
				} else if (current && line.includes("=")) {
					const eq = line.indexOf("=");
					current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
				}
			}
			for (const section of sections) {
				if (section.Default !== "1" || !section.Path) continue;
				const profileDir = section.IsRelative === "1"
					? join(firefoxDir, section.Path)
					: section.Path;
				if (hasCookies(profileDir)) return true;
			}
			for (const section of sections) {
				if (!section.Path) continue;
				const profileDir = section.IsRelative === "1"
					? join(firefoxDir, section.Path)
					: section.Path;
				if (hasCookies(profileDir)) return true;
			}
		}
		const entries = readdirSync(firefoxDir, { withFileTypes: true });
		return entries.some((entry) => entry.isDirectory() && hasCookies(join(firefoxDir, entry.name)));
	} catch {
		return false;
	}
}

export function collectDoctorProbes(options: DoctorProbeOptions = {}): DoctorProbes {
	const homeDir = options.homeDir ?? homedir();
	const commandExists = options.commandExists ?? defaultCommandExists;
	return {
		auth: readAuthProbe(homeDir),
		sqlite3: commandExists("sqlite3"),
		firefoxProfile: hasFirefoxCookieProfile(homeDir),
		robotSpriteAsset: existsSync(options.spriteAssetPath ?? DEFAULT_ROBOT_SPRITE_PATH),
	};
}

function yes(value: boolean | undefined): string {
	return value ? "yes" : "no";
}

function registered(value: boolean): string {
	return value ? "registered" : "missing";
}

function timerState(value: boolean): string {
	return value ? "running" : "stopped";
}

function formatAge(updatedAt: number | undefined, now: number): string {
	if (!updatedAt) return "unknown";
	const ageMs = Math.max(0, now - updatedAt);
	if (ageMs < 60_000) return "<1m";
	const minutes = Math.floor(ageMs / 60_000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

function formatWindowSummary(usage: ProviderUsage): string {
	const rendered = usage.windows
		.map((window) => {
			if (typeof window.usedPercent === "number") {
				return `${window.label} ${Math.round(window.usedPercent)}%`;
			}
			if (typeof window.usedCount === "number" && typeof window.limitCount === "number") {
				return `${window.label} ${window.usedCount}/${window.limitCount}`;
			}
			return window.label;
		})
		.join(", ");
	return rendered || "no windows";
}

function formatProvider(snapshot: DoctorProviderSnapshot, now: number): string {
	const usage = snapshot.usage;
	const message = usage.message ? ` (${usage.message})` : "";
	return `- ${snapshot.name}: ${usage.status}${message}, age ${formatAge(usage.updatedAt, now)}, in-flight ${yes(snapshot.inFlight)}, windows ${formatWindowSummary(usage)}`;
}

function formatLayoutWarningSummary(
	layoutWarning: string | undefined,
	layoutWarnings: LayoutValidationIssue[] | undefined,
): string {
	if (layoutWarning) return "parse warning present";
	const count = layoutWarnings?.length ?? 0;
	if (count === 0) return "valid";
	return `${count} warning${count === 1 ? "" : "s"} (run /hud validate for details)`;
}

export function formatDoctorReport(input: DoctorReportInput): string {
	const now = input.now ?? Date.now();
	const provider = input.ctx.model?.provider ?? "unknown";
	const model = input.ctx.model?.id ?? "unknown";
	const sprite = input.layout.sprite;
	const probes = input.probes;
	return [
		"pi-hud doctor",
		"runtime:",
		`- UI: ${yes(input.ctx.hasUI)}; cwd: ${input.ctx.cwd ?? "unknown"}`,
		`- model: ${provider} / ${model}`,
		`- surfaces: footer ${registered(input.surfaces.footer)}, shelf ${registered(input.surfaces.shelf)}, timer ${timerState(input.surfaces.wallClockTimer)}`,
		`- ascii icons: ${yes(input.asciiMode)}`,
		"layout:",
		`- path: ${input.layoutPath}`,
		`- on-disk status: ${formatLayoutWarningSummary(input.layoutWarning, input.layoutWarnings)}`,
		`- sprite: ${sprite.mascot} ${sprite.mode} ${sprite.widthCells}×${sprite.heightCells}`,
		`- shelf rows: ${input.layout.shelf.rows.length}; footer extra rows: ${input.layout.footer.extraRows.length}`,
		"local probes:",
		`- auth: codex ${yes(probes.auth.codex)}, anthropic ${yes(probes.auth.anthropic)}, minimax ${yes(probes.auth.minimax)}, umans ${yes(probes.auth.umans)}, zai ${yes(probes.auth.zai)}`,
		`- sqlite3: ${yes(probes.sqlite3)}; firefox profile: ${yes(probes.firefoxProfile)}; robot spritesheet: ${yes(probes.robotSpriteAsset)}`,
		"providers:",
		...input.providers.map((providerSnapshot) => formatProvider(providerSnapshot, now)),
	].join("\n");
}
