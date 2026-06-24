import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HUD_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function runBunAssertions(source, env = {}) {
	execFileSync("bun", ["--silent", "-e", source], {
		cwd: HUD_DIR,
		stdio: "pipe",
		env: { ...process.env, ...env },
	});
}

test("doctor local probes are redacted and use only filesystem/command checks", () => {
	const home = mkdtempHome();
	try {
		const authPath = join(home, ".pi", "agent", "auth.json");
		mkdirSync(dirname(authPath), { recursive: true });
		writeFileSync(
			authPath,
			JSON.stringify({
				"openai-codex": { type: "oauth", access: "SECRET_CODEX", accountId: "acct" },
				anthropic: { type: "oauth", access: "SECRET_ANTHROPIC" },
				minimax: { type: "api_key", key: "SECRET_MINIMAX" },
			}),
			"utf8",
		);
		const profileDir = join(home, ".mozilla", "firefox", "abc.default-release");
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(join(home, ".mozilla", "firefox", "profiles.ini"), "[Profile0]\nDefault=1\nIsRelative=1\nPath=abc.default-release\n", "utf8");
		writeFileSync(join(profileDir, "cookies.sqlite"), "", "utf8");
		const assetPath = join(home, "robot-spritesheet.png");
		writeFileSync(assetPath, "png", "utf8");

		runBunAssertions(String.raw`
			const assert = await import("node:assert/strict");
			const { collectDoctorProbes } = await import("./diagnostics.ts");
			const probes = collectDoctorProbes({
				homeDir: process.env.PI_HUD_TEST_HOME,
				spriteAssetPath: process.env.PI_HUD_TEST_ASSET,
				commandExists: (name) => name === "sqlite3",
			});
			assert.default.equal(probes.sqlite3, true);
			assert.default.equal(probes.firefoxProfile, true);
			assert.default.equal(probes.robotSpriteAsset, true);
			assert.default.equal(probes.auth.codex, true);
			assert.default.equal(probes.auth.anthropic, true);
			assert.default.equal(probes.auth.minimax, true);
			assert.default.equal(probes.auth.umans, false);
			assert.default.equal(JSON.stringify(probes).includes("SECRET"), false);
		`, { PI_HUD_TEST_HOME: home, PI_HUD_TEST_ASSET: assetPath, UMANS_API_KEY: "", ZAI_API_KEY: "" });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("doctor report summarizes UI, providers, layout, probes, and omits secrets", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { formatDoctorReport } = await import("./diagnostics.ts");
		const report = formatDoctorReport({
			now: 1_700_000_120_000,
			ctx: {
				hasUI: true,
				cwd: "/repo/pi-hud",
				model: { provider: "codex", id: "openai-codex/gpt" },
			},
			layoutPath: "/home/user/.pi/agent/pi-hud.layout.jsonc",
			layout: {
				separator: " · ",
				sprite: { enabled: true, mode: "auto", mascot: "cute-robot", widthCells: 10, heightCells: 5 },
				shelf: { enabled: true, rows: [["tokens"]] },
				footer: { enabled: true, left: ["cwd"], right: ["quota"], extraRows: [["extStatuses"]] },
			},
			layoutWarnings: [{ severity: "warning", path: "footer.left[1]", message: "unknown block id SECRET_BLOCK" }],
			asciiMode: false,
			surfaces: { footer: true, shelf: true, wallClockTimer: true },
			probes: {
				auth: { codex: true, anthropic: false, minimax: false, umans: false, zai: false },
				sqlite3: true,
				firefoxProfile: true,
				robotSpriteAsset: true,
			},
			providers: [{
				name: "Codex",
				inFlight: true,
				usage: { id: "codex", name: "Codex", icon: "", status: "ok", updatedAt: 1_700_000_000_000, windows: [{ label: "5h", usedPercent: 42 }] },
			}],
		});
		assert.default.match(report, /pi-hud doctor/);
		assert.default.match(report, /UI: yes/);
		assert.default.match(report, /footer registered/);
		assert.default.match(report, /sprite: cute-robot auto 10×5/);
		assert.default.match(report, /on-disk status:/);
		assert.default.match(report, /Codex: ok/);
		assert.default.match(report, /age 2m/);
		assert.default.match(report, /in-flight yes/);
		assert.default.match(report, /auth: codex yes/);
		assert.default.match(report, /sqlite3: yes/);
		assert.default.match(report, /robot spritesheet: yes/);
		assert.default.doesNotMatch(report, /SECRET/);
	`);
});

test("/hud doctor reports diagnostics without registering UI surfaces", () => {
	const home = mkdtempHome();
	try {
		runBunAssertions(String.raw`
			const assert = await import("node:assert/strict");
			const { default: piHud } = await import("./index.ts");
			let hudCommand = null;
			let setFooterCalls = 0;
			const notifications = [];
			const pi = {
				on: () => {},
				registerShortcut: () => {},
				registerCommand: (name, cfg) => {
					if (name === "hud") hudCommand = cfg;
				},
				getThinkingLevel: () => "high",
			};
			const ctx = {
				hasUI: true,
				cwd: "/tmp/pi-hud-test",
				model: { provider: "codex", id: "openai-codex/gpt" },
				ui: {
					notify: (message, level) => notifications.push({ message, level }),
					setFooter: () => setFooterCalls++,
				},
			};
			piHud(pi);
			await hudCommand.handler("doctor", ctx);
			assert.default.equal(setFooterCalls, 0);
			assert.default.equal(notifications.at(-1).level, "info");
			assert.default.match(notifications.at(-1).message, /pi-hud doctor/);
			assert.default.match(notifications.at(-1).message, /providers:/);
		`, { HOME: home });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

function mkdtempHome() {
	const home = join(tmpdir(), `pi-hud-doctor-${Math.random().toString(36).slice(2)}`);
	assert.equal(existsSync(home), false);
	mkdirSync(home, { recursive: true });
	return home;
}
