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

test("withEditorPadding prepends/appends blank lines", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { withEditorPadding } = await import("./render/editors/padding.ts");

		assert.default.deepEqual(
			withEditorPadding(["a", "b"], { top: 0, bottom: 0 }),
			["a", "b"],
		);
		assert.default.deepEqual(
			withEditorPadding(["a"], { top: 2, bottom: 1 }),
			["", "", "a", ""],
		);
		assert.default.deepEqual(
			withEditorPadding([], { top: 1, bottom: 1 }),
			["", ""],
		);
		// Non-finite / negative treated as 0; values clamped to max.
		assert.default.deepEqual(
			withEditorPadding(["x"], { top: -3, bottom: 99 }),
			["x", "", "", "", "", "", "", "", ""],
		);
	`);
});
