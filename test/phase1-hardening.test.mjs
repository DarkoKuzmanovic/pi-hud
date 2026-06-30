import test from "node:test";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HUD_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function runBunAssertions(source) {
	execFileSync("bun", ["--silent", "-e", source], {
		cwd: HUD_DIR,
		stdio: "pipe",
	});
}

test("stableUsageKey ignores updatedAt but tracks visible usage changes", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const mod = await import("./index.ts");
		assert.default.equal(typeof mod.stableUsageKey, "function");
		const usage = {
			id: "codex",
			name: "Codex",
			icon: "C",
			status: "ok",
			updatedAt: 1,
			windows: [{ label: "5h", usedPercent: 25 }],
		};
		assert.default.equal(
			mod.stableUsageKey(usage),
			mod.stableUsageKey({ ...usage, updatedAt: 999 }),
		);
		assert.default.notEqual(
			mod.stableUsageKey(usage),
			mod.stableUsageKey({ ...usage, message: "changed" }),
		);
	`);
});

test("hud refresh and ascii commands reuse registered UI surfaces", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { default: piHud } = await import("./index.ts");

		const handlers = new Map();
		let hudCommand = null;
		let setFooterCalls = 0;
		let setHeaderCalls = 0;
		let setEditorCalls = 0;
		let footerRenderRequests = 0;
		let intervalStarts = 0;
		let intervalClears = 0;
		const originalSetInterval = globalThis.setInterval;
		const originalClearInterval = globalThis.clearInterval;
		globalThis.setInterval = (fn, ms) => {
			intervalStarts++;
			return { fn, ms, intervalStarts };
		};
		globalThis.clearInterval = () => {
			intervalClears++;
		};
		try {
			const theme = {
				fg: (_name, text) => text,
				bg: (_name, text) => text,
				inverse: (text) => text,
				bold: (text) => text,
				getBgAnsi: () => "",
			};
			const footerData = {
				onBranchChange: () => () => {},
				getGitBranch: () => "main",
				getExtensionStatuses: () => new Map(),
			};
			const ctx = {
				hasUI: true,
				cwd: "/tmp/pi-hud-test",
				model: { provider: "unsupported", id: "unsupported/test" },
				getContextUsage: () => ({ tokens: 0, contextWindow: 1000 }),
				sessionManager: {
					getBranch: () => [],
					getSessionId: () => "session-1",
				},
				ui: {
					theme,
					notify: () => {},
					setFooter: (cb) => {
						setFooterCalls++;
						return cb({ requestRender: () => footerRenderRequests++ }, theme, footerData);
					},
					setHeader: () => {
						setHeaderCalls++;
						return { render: () => [], invalidate: () => {} };
					},
					setEditorComponent: () => {
						setEditorCalls++;
					},
				},
			};
			const pi = {
				on: (name, cb) => handlers.set(name, cb),
				registerCommand: (name, cfg) => {
					if (name === "hud") hudCommand = cfg;
				},
				registerShortcut: () => {},
				getThinkingLevel: () => "high",
			};

			piHud(pi);
			handlers.get("session_start")({}, ctx);
			assert.default.equal(setFooterCalls, 1);
			assert.default.equal(setHeaderCalls, 1);
			assert.default.equal(setEditorCalls, 1);
			assert.default.equal(intervalStarts, 1);
			assert.default.equal(intervalClears, 0);

			await hudCommand.handler("refresh", ctx);
			assert.default.equal(setFooterCalls, 1, "refresh must not reinstall footer");
			assert.default.equal(setHeaderCalls, 1, "refresh must not reinstall header");
			assert.default.equal(setEditorCalls, 1, "refresh must not reinstall editor component");
			assert.default.equal(intervalStarts, 1, "refresh must not start another wall-clock timer");
			assert.default.equal(footerRenderRequests, 1);

			await hudCommand.handler("ascii", ctx);
			assert.default.equal(setFooterCalls, 1, "ascii must not reinstall footer");
			assert.default.equal(setHeaderCalls, 1, "ascii must not reinstall header");
			assert.default.equal(setEditorCalls, 1, "ascii must not reinstall editor component");
			assert.default.equal(intervalStarts, 1, "ascii must not start another wall-clock timer");
			assert.default.equal(footerRenderRequests, 2);

			handlers.get("session_start")({}, ctx);
			assert.default.equal(setFooterCalls, 2, "second install should replace footer");
			assert.default.equal(setHeaderCalls, 2, "second install should replace header");
			assert.default.equal(setEditorCalls, 2, "second install should replace editor component");
			assert.default.equal(intervalStarts, 2, "second install starts a replacement timer");
			assert.default.equal(intervalClears, 1, "second install clears the prior timer");
		} finally {
			globalThis.setInterval = originalSetInterval;
			globalThis.clearInterval = originalClearInterval;
		}
	`);
});

test("empty layout separator falls back to the default separator", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { DEFAULT_LAYOUT, mergeLayout } = await import("./config.ts");
		const layout = mergeLayout({ separator: "" });
		assert.default.equal(layout.separator, DEFAULT_LAYOUT.separator);
	`);
});

test("HUD_ICONS=none starts the formatter in ASCII icon mode", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		process.env.HUD_ICONS = "none";
		const { ICON_MODEL, SEP_L, isAsciiMode } = await import("./render/format.ts");
		assert.default.equal(isAsciiMode(), true);
		assert.default.equal(SEP_L(), "[");
		assert.default.equal(ICON_MODEL(), "🤖");
	`);
});

test("padBetween keeps ANSI-styled output within terminal width", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { padBetween, visibleWidth } = await import("./render/format.ts");
		const line = padBetween("\x1b[31mleft side is too long\x1b[0m", "\x1b[32mRIGHT\x1b[0m", 14);
		assert.default.ok(visibleWidth(line) <= 14, "line width was " + visibleWidth(line));
		const rightOnly = padBetween("left", "\x1b[32mRIGHT-HAND\x1b[0m", 5);
		assert.default.ok(visibleWidth(rightOnly) <= 5, "right-only width was " + visibleWidth(rightOnly));
	`);
});
