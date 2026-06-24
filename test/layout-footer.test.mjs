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


test("layout config accepts mascot selection", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { mergeLayout } = await import("./config.ts");
		const layout = mergeLayout({ sprite: { mascot: "cute-robot" } });
		assert.default.equal(layout.sprite.mascot, "cute-robot");

		const fallback = mergeLayout({ sprite: { mascot: "not-real" } });
		assert.default.equal(fallback.sprite.mascot, "teal-ghost");
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
			sprite: { enabled: true, mode: "auto", widthCells: 6, heightCells: 3 },
			shelf: { enabled: true, rows: [] },
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
