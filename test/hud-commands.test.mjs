import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HUD_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function runBunAssertions(source, env = {}) {
	execFileSync("bun", ["--silent", "-e", source], {
		cwd: HUD_DIR,
		stdio: "pipe",
		env: { ...process.env, ...env },
	});
}

test("/hud blocks lists discoverable block ids without registering UI surfaces", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-hud-home-"));
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
			await hudCommand.handler("blocks", ctx);
			assert.default.equal(setFooterCalls, 0);
			assert.default.equal(notifications.length, 1);
			assert.default.equal(notifications[0].level, "info");
			assert.default.match(notifications[0].message, /Available HUD blocks/);
			assert.default.match(notifications[0].message, /cwd/);
			assert.default.match(notifications[0].message, /quota/);
			assert.default.match(notifications[0].message, /ext:<key>/);
		`, { HOME: home });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("/hud validate reports valid and invalid layout files without mutating them", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-hud-home-"));
	try {
		const agentDir = join(home, ".pi", "agent");
		mkdirSync(agentDir, { recursive: true });
		const layoutFile = join(agentDir, "pi-hud.layout.jsonc");
		const validLayout = JSON.stringify({ footer: { left: ["cwd", "model"] } }, null, 2);
		writeFileSync(layoutFile, `${validLayout}\n`, "utf8");
		runBunAssertions(String.raw`
			const assert = await import("node:assert/strict");
			const { readFileSync, writeFileSync } = await import("node:fs");
			const { default: piHud } = await import("./index.ts");
			const layoutFile = process.env.PI_HUD_TEST_LAYOUT_FILE;
			let hudCommand = null;
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
				ui: { notify: (message, level) => notifications.push({ message, level }) },
			};
			piHud(pi);
			const validLayout = JSON.stringify({ footer: { left: ["cwd", "model"] } }, null, 2) + "\n";
			await hudCommand.handler("validate", ctx);
			assert.default.equal(notifications.at(-1).level, "info");
			assert.default.match(notifications.at(-1).message, /HUD layout valid/);
			assert.default.equal(readFileSync(layoutFile, "utf8"), validLayout);

			const invalidLayout = '{ "footer": { "left": ["unknownBlock"] }, "separator": "" }\n';
			writeFileSync(layoutFile, invalidLayout, "utf8");
			await hudCommand.handler("validate", ctx);
			assert.default.equal(notifications.at(-1).level, "warning");
			assert.default.match(notifications.at(-1).message, /HUD layout warnings/);
			assert.default.match(notifications.at(-1).message, /unknownBlock/);
			assert.default.match(notifications.at(-1).message, /separator/);
			assert.default.equal(readFileSync(layoutFile, "utf8"), invalidLayout);
		`, { HOME: home, PI_HUD_TEST_LAYOUT_FILE: layoutFile });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});


test("/hud theme applies immediately and persists the choice to the layout file", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-hud-home-"));
	try {
		const agentDir = join(home, ".pi", "agent");
		mkdirSync(agentDir, { recursive: true });
		const layoutFile = join(agentDir, "pi-hud.layout.jsonc");
		// A commented layout with no theme key — exercises the insert path and
		// proves comments survive the write-back (no parse→stringify).
		const original = '// pi-hud layout\n{\n  "separator": " · "\n}\n';
		writeFileSync(layoutFile, original, "utf8");
		runBunAssertions(String.raw`
			const assert = await import("node:assert/strict");
			const { readFileSync } = await import("node:fs");
			const { default: piHud } = await import("./index.ts");
			const { PALETTE_NAMES } = await import("./render/header.ts");
			const layoutFile = process.env.PI_HUD_TEST_LAYOUT_FILE;
			let hudCommand = null;
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
				ui: { notify: (message, level) => notifications.push({ message, level }) },
			};
			piHud(pi);

			const name = PALETTE_NAMES[0];
			await hudCommand.handler("theme " + name, ctx);

			// Notify text no longer defers to "next session start".
			assert.default.equal(notifications.at(-1).level, "info");
			assert.default.equal(notifications.at(-1).message, "HUD theme: " + name);
			assert.default.doesNotMatch(notifications.at(-1).message, /next session/i);

			// Choice written to disk; comment preserved; exactly one theme key.
			const afterInsert = readFileSync(layoutFile, "utf8");
			assert.default.match(afterInsert, /pi-hud layout/);
			assert.default.match(afterInsert, new RegExp('"theme"\\s*:\\s*"' + name + '"'));
			assert.default.equal(afterInsert.match(/"theme"/g).length, 1);

			// Switching swaps the existing value in place (replace path).
			await hudCommand.handler("theme random", ctx);
			const afterSwap = readFileSync(layoutFile, "utf8");
			assert.default.match(afterSwap, /"theme"\s*:\s*"random"/);
			assert.default.equal(afterSwap.match(/"theme"/g).length, 1);
			assert.default.doesNotMatch(afterSwap, new RegExp('"' + name + '"'));
		`, { HOME: home, PI_HUD_TEST_LAYOUT_FILE: layoutFile });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("/hud reload surfaces layout validation warnings", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-hud-home-"));
	try {
		const agentDir = join(home, ".pi", "agent");
		mkdirSync(agentDir, { recursive: true });
		const layoutFile = join(agentDir, "pi-hud.layout.jsonc");
		const invalidLayout = '{ "footer": { "left": ["unknownBlock"] } }\n';
		writeFileSync(layoutFile, invalidLayout, "utf8");
		runBunAssertions(String.raw`
			const assert = await import("node:assert/strict");
			const { readFileSync } = await import("node:fs");
			const { default: piHud } = await import("./index.ts");
			const layoutFile = process.env.PI_HUD_TEST_LAYOUT_FILE;
			let hudCommand = null;
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
				ui: { notify: (message, level) => notifications.push({ message, level }) },
			};
			piHud(pi);
			await hudCommand.handler("reload", ctx);
			assert.default.equal(notifications.at(-1).level, "warning");
			assert.default.match(notifications.at(-1).message, /HUD layout reloaded with warnings/);
			assert.default.match(notifications.at(-1).message, /unknownBlock/);
			assert.default.equal(readFileSync(layoutFile, "utf8"), '{ "footer": { "left": ["unknownBlock"] } }\n');
		`, { HOME: home, PI_HUD_TEST_LAYOUT_FILE: layoutFile });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
