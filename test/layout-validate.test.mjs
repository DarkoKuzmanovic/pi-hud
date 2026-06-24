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

test("validateLayout accepts the default layout", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { DEFAULT_LAYOUT, validateLayout } = await import("./config.ts");
		assert.default.deepEqual(validateLayout(DEFAULT_LAYOUT), []);
	`);
});

test("validateLayout warns for unknown and malformed block configuration", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { validateLayout, mergeLayout, DEFAULT_LAYOUT } = await import("./config.ts");
		const raw = {
			separator: "",
			shelf: { rows: [["cwd", "unknownShelf"], "bad-row"] },
			footer: {
				left: ["model", "ext:"],
				right: "not-array",
				extraRows: [["quota", "unknownExtra"]],
			},
			sprite: {
				mode: "huge",
				mascot: "dragon",
				widthCells: 0,
				heightCells: -1,
			},
		};
		const issues = validateLayout(raw);
		const text = issues.map((issue) => issue.path + " " + issue.message).join("\n");
		assert.default.ok(issues.every((issue) => issue.severity === "warning"));
		assert.default.match(text, /separator/);
		assert.default.match(text, /shelf\.rows\[0\]\[1\].*unknownShelf/);
		assert.default.match(text, /shelf\.rows\[1\]/);
		assert.default.match(text, /footer\.left\[1\].*ext:/);
		assert.default.match(text, /footer\.right/);
		assert.default.match(text, /footer\.extraRows\[0\]\[1\].*unknownExtra/);
		assert.default.match(text, /sprite\.mode/);
		assert.default.match(text, /sprite\.mascot/);
		assert.default.match(text, /sprite\.widthCells/);
		assert.default.match(text, /sprite\.heightCells/);
		assert.default.equal(mergeLayout(raw).separator, DEFAULT_LAYOUT.separator);
	`);
});

test("validateLayout accepts ext status blocks with explicit keys", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { validateLayout } = await import("./config.ts");
		const issues = validateLayout({ footer: { extraRows: [["ext:tps", "ext:pi-memory"]] } });
		assert.default.deepEqual(issues, []);
	`);
});
