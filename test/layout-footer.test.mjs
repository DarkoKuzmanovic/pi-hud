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

test("layout config accepts footer extra rows", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { mergeLayout } = await import("./config.ts");
		const layout = mergeLayout({
			footer: {
				enabled: true,
				left: ["model"],
				right: [],
				extraRows: [["extStatuses"]],
			},
		});
		assert.default.deepEqual(layout.footer.extraRows, [["extStatuses"]]);
	`);
});


test("footer extra rows render native extension statuses including pi-pulse tps", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { renderFooterLine } = await import("./render/footer.ts");

		const theme = {
			fg: (_name, text) => text,
			inverse: (text) => text,
		};
		const ctx = {
			cwd: "/home/quzma/.pi/agent/extensions/pi-hud",
			model: { id: "openai-codex/gpt-5.5" },
			getContextUsage: () => ({ tokens: 0, contextWindow: 272000 }),
			sessionManager: { getSessionId: () => "session-1" },
		};
		const block = {
			ctx,
			theme,
			totals: { input: 0, output: 0, cost: 0 },
			activeUsage: { id: "unsupported", name: "Unsupported", icon: "?", status: "unknown", windows: [] },
			thinkingLevel: "xhigh",
			activeStartedAt: null,
			lastRunMs: null,
			lastTps: null,
			gitDirty: { text: "", isClean: true },
			gitRemote: { ahead: 0, behind: 0, hasRemote: false },
			gitLastCommit: { hash: "", subject: "", age: "" },
			branch: "main",
			extStatuses: new Map([
				["tps", "TPS 42 avg | TTFT μ 0.25s"],
				["pi-memory", "mem 3"],
			]),
		};
		const layout = {
			separator: " · ",
			footer: {
				enabled: true,
				left: ["model"],
				right: [],
				extraRows: [["extStatuses"]],
			},
		};

		const lines = renderFooterLine(block, layout)(140);
		assert.default.equal(lines.length, 2);
		assert.default.match(lines[1], /TPS 42 avg/);
		assert.default.match(lines[1], /mem 3/);
	`);
});

test("footer renders with and without chip wrapping driven by layout.chips", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { renderFooterLine } = await import("./render/footer.ts");
		const { setAsciiMode } = await import("./render/format.ts");
		setAsciiMode(true);

		const theme = {
			fg: (_name, text) => text,
			inverse: (text) => text,
			reset: () => "",
		};
		const ctx = {
			cwd: "/tmp",
			model: { id: "openai-codex/gpt-5.5" },
			getContextUsage: () => ({ tokens: 0, contextWindow: 272000 }),
			sessionManager: { getSessionId: () => "session-1" },
		};
		const baseBlock = {
			ctx,
			theme,
			totals: { input: 0, output: 0, cost: 0 },
			activeUsage: { id: "unsupported", name: "Unsupported", icon: "?", status: "unknown", windows: [] },
			thinkingLevel: "xhigh",
			activeStartedAt: null,
			lastRunMs: null,
			lastTps: 42,
			gitDirty: { text: "", isClean: true },
			gitRemote: { ahead: 0, behind: 0, hasRemote: false },
			gitLastCommit: { hash: "", subject: "", age: "" },
			branch: "main",
			extStatuses: new Map(),
		};
		const layout = {
			separator: " · ",
			footer: {
				enabled: true,
				left: ["cwd", "model"],
				right: ["speed"],
				extraRows: [],
			},
		};

		// chips omitted: every block renders plain, no chip brackets appear.
		const plainLine = renderFooterLine({ ...baseBlock }, { ...layout })(140)[0];
		assert.default.equal(plainLine.includes("["), false, "no chips set → footer renders plain");
assert.default.match(plainLine, /\/tmp/, "cwd renders");

		// chips = ["cwd"]: cwd is wrapped, model and speed are plain.
		const optIn = renderFooterLine({ ...baseBlock, chips: new Set(["cwd"]) }, { ...layout })(140)[0];
		assert.default.match(optIn, /\[ .+ \/tmp \]/, "cwd should be chip-wrapped when listed");
		assert.default.equal(optIn.match(/\[/g)?.length, 1, "only cwd should be chipped in opt-in layout");

		// chips = DEFAULT_CHIPS subset: model keeps its original chip wrapper.
		const def = renderFooterLine(
			{ ...baseBlock, chips: new Set(["project", "folder", "model", "thinking", "context", "quota"]) },
			{ ...layout },
		)(140)[0];
assert.default.match(def, /\[ .+ gpt 5[._]?[0-9]*.* \]/, "model should be chip-wrapped under default chips");

		// chips = []: model loses its chip wrapper.
		const unchip = renderFooterLine({ ...baseBlock, chips: new Set() }, { ...layout })(140)[0];
		assert.default.equal(unchip.includes("["), false, "empty chips set must unchip model");
	`);
});

test("renderFooterLine splits an extraRows {left,right} object row across the width", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { renderFooterLine } = await import("./render/footer.ts");

		const theme = {
			fg: (_name, text) => text,
			inverse: (text) => text,
		};
		const ctx = {
			cwd: "/tmp",
			model: { id: "openai-codex/gpt-5.5" },
			getContextUsage: () => ({ tokens: 0, contextWindow: 272000 }),
			sessionManager: { getSessionId: () => "session-1" },
		};
		const block = {
			ctx,
			theme,
			totals: { input: 0, output: 0, cost: 0 },
			activeUsage: { id: "unsupported", name: "Unsupported", icon: "?", status: "unknown", windows: [] },
			thinkingLevel: "xhigh",
			activeStartedAt: null,
			lastRunMs: null,
			lastTps: null,
			gitDirty: { text: "", isClean: true },
			gitRemote: { ahead: 0, behind: 0, hasRemote: false },
			gitLastCommit: { hash: "", subject: "", age: "" },
			branch: "main",
			extStatuses: new Map(),
		};
		const layout = {
			separator: " · ",
			footer: {
				enabled: true,
				left: ["model"],
				right: [],
				extraRows: [
					{ left: ["branch"], right: ["cwd"] },
					["extStatuses"],
				],
			},
		};

		const lines = renderFooterLine(block, layout)(140);
		// extraRows[1] (extStatuses) is empty for this fixture, so only the main
		// line + the object row render.
		assert.default.equal(lines.length, 2);
		const row = lines[1];
		assert.default.match(row, /main/, "left side (branch) renders");
		assert.default.match(row, /\/tmp/, "right side (cwd) renders");
		assert.default.ok(row.indexOf("main") < row.indexOf("/tmp"), "left renders before right");
	`);
});