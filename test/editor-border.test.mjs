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

test("fitBorder packs left/right labels into a fixed width", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { fitBorder } = await import("./render/editors/border-helpers.ts");
		const { visibleWidth } = await import("./render/pi-tui-shim.ts");
		const identity = (s) => s;

		const line = fitBorder(" left ", " right ", 20, identity);
		assert.default.equal(visibleWidth(line), 20);
		assert.default.ok(line.startsWith("─"));
		assert.default.ok(line.endsWith("─"));
		assert.default.ok(line.includes(" left "));
		assert.default.ok(line.includes(" right "));

		// Narrow width drops right first, then left. truncateToWidth may inject ANSI,
		// so measure with visibleWidth rather than string length.
		const narrow = fitBorder(" LEFTLABEL ", " RIGHTLABEL ", 12, identity);
		assert.default.equal(visibleWidth(narrow), 12);
		assert.default.ok(!narrow.includes("RIGHTLABEL"));
	`);
});

test("border label helpers compact model/context/cwd", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const {
			formatBorderModel,
			formatBorderContext,
			formatBorderCwd,
		} = await import("./render/editors/border-helpers.ts");

		assert.default.equal(formatBorderModel(undefined, undefined), "no model");
		assert.default.equal(
			formatBorderModel("anthropic", "claude-sonnet-4"),
			"anthropic/sonnet 4",
		);

		assert.default.equal(
			formatBorderContext({ tokens: null, contextWindow: 200000, percent: null }),
			"ctx ?",
		);
		assert.default.equal(
			formatBorderContext({ tokens: 42000, contextWindow: 200000, percent: 21 }),
			"ctx 21%/200k",
		);

		const home = process.env.HOME ?? "";
		if (home) {
			assert.default.equal(formatBorderCwd(home + "/code/pi-hud"), "~/code/pi-hud");
		}
		assert.default.equal(formatBorderCwd("/tmp"), "/tmp");
	`);
});
