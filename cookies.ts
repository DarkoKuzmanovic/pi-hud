import { existsSync, readFileSync, copyFileSync, unlinkSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const FIREFOX_PROFILES_DIR = join(homedir(), ".mozilla", "firefox");

// --- Firefox profile discovery ---

let cachedProfileDir: string | null = null;

export function findFirefoxProfileDir(): string | null {
	if (cachedProfileDir) {
		if (existsSync(join(cachedProfileDir, "cookies.sqlite"))) return cachedProfileDir;
		cachedProfileDir = null;
	}

	// Try profiles.ini to find the default profile
	const iniPath = join(FIREFOX_PROFILES_DIR, "profiles.ini");
	if (existsSync(iniPath)) {
		try {
			const ini = readFileSync(iniPath, "utf8");
			const sections: Array<Record<string, string>> = [];
			let current: Record<string, string> = {};
			for (const rawLine of ini.split("\n")) {
				const line = rawLine.trim();
				if (line.startsWith("[") && line.endsWith("]")) {
					current = {};
					sections.push(current);
				} else if (line.includes("=")) {
					const eq = line.indexOf("=");
					current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
				}
			}
			// Prefer the profile marked Default=1
			for (const sec of sections) {
				if (sec.Default === "1" && sec.Path) {
					const dir = sec.IsRelative === "1" ? join(FIREFOX_PROFILES_DIR, sec.Path) : sec.Path;
					if (existsSync(join(dir, "cookies.sqlite"))) return (cachedProfileDir = dir);
				}
			}
			// Fall back to any profile with a Path
			for (const sec of sections) {
				if (sec.Path) {
					const dir = sec.IsRelative === "1" ? join(FIREFOX_PROFILES_DIR, sec.Path) : sec.Path;
					if (existsSync(join(dir, "cookies.sqlite"))) return (cachedProfileDir = dir);
				}
			}
		} catch { /* fall through */ }
	}

	// Last resort: find any .default* directory with cookies.sqlite
	try {
		const entries = readdirSync(FIREFOX_PROFILES_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory() && entry.name.includes("default")) {
				const dir = join(FIREFOX_PROFILES_DIR, entry.name);
				if (existsSync(join(dir, "cookies.sqlite"))) return (cachedProfileDir = dir);
			}
		}
	} catch { /* not found */ }

	return null;
}

// --- Shared cookie reader ---

export interface CookieReadOptions {
	hosts: string[];
	cookieNames: string[];
	/** "name=value" pairs joined by "; " (default), or "value-only" for single raw value */
	format?: "name=value" | "value-only";
}

/**
 * Read cookies from Firefox's cookies.sqlite.
 * Copies the DB to a temp file to avoid Firefox's lock, then queries via sqlite3 CLI.
 */
export function readFirefoxCookies(opts: CookieReadOptions, callerId = ""): string | null {
	const profileDir = findFirefoxProfileDir();
	if (!profileDir) return null;

	const dbPath = join(profileDir, "cookies.sqlite");
	if (!existsSync(dbPath)) return null;

	const tmpPath = join("/tmp", `pi-hud-cookies-${callerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
	try {
		copyFileSync(dbPath, tmpPath);
	} catch {
		return null;
	}

	try {
		const hostsClause = opts.hosts.map((h) => `'${h}'`).join(", ");
		const namesFilter = opts.cookieNames.length > 0
			? ` AND name IN (${opts.cookieNames.map((n) => `'${n}'`).join(", ")})`
			: "";
		const sql = `SELECT name, value FROM moz_cookies WHERE host IN (${hostsClause})${namesFilter} AND expiry > strftime('%s','now')`;

		const out = execSync(
			`sqlite3 "${tmpPath}" "${sql}"`,
			{ encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
		).trim();

		if (!out) return null;

		if (opts.format === "value-only") {
			// Return first value only
			const line = out.split("\n")[0];
			const sep = line.indexOf("|");
			return sep >= 0 ? line.slice(sep + 1) : line;
		}

		// "name=value" format: join all as cookie header
		const cookies: string[] = [];
		for (const line of out.split("\n")) {
			const sep = line.indexOf("|");
			if (sep > 0) cookies.push(`${line.slice(0, sep)}=${line.slice(sep + 1)}`);
		}
		return cookies.length > 0 ? cookies.join("; ") : null;
	} catch {
		return null;
	} finally {
		try { unlinkSync(tmpPath); } catch { /* ignore */ }
	}
}

// --- Convenience wrappers for each provider ---

export function readOllamaCookies(): string | null {
	return readFirefoxCookies({
		hosts: ["ollama.com"],
		cookieNames: ["__Secure-session", "aid"],
		format: "name=value",
	}, "ollama");
}

export function readWaferCookies(): string | null {
	return readFirefoxCookies({
		hosts: ["app.wafer.ai", ".app.wafer.ai", "wafer.ai", ".wafer.ai"],
		cookieNames: [], // Read all non-expired cookies for these hosts
		format: "name=value",
	}, "wafer");
}

export function readOpenCodeCookies(): string | null {
	return readFirefoxCookies({
		hosts: ["opencode.ai", ".opencode.ai"],
		cookieNames: ["auth"],
		format: "value-only",
	}, "opencode");
}
