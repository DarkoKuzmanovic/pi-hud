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
			footer: {
				left: ["model", "ext:"],
				right: "not-array",
				extraRows: [["quota", "unknownExtra"]],
			},
		};
		const issues = validateLayout(raw);
		const text = issues.map((issue) => issue.path + " " + issue.message).join("\n");
		assert.default.ok(issues.every((issue) => issue.severity === "warning"));
		assert.default.match(text, /separator/);
		assert.default.match(text, /footer\.left\[1\].*ext:/);
		assert.default.match(text, /footer\.right/);
		assert.default.match(text, /footer\.extraRows\[0\]\[1\].*unknownExtra/);
		assert.default.equal(mergeLayout(raw).separator, DEFAULT_LAYOUT.separator);
	`);
});

test("validateLayout flags legacy sprite/shelf keys as deprecated", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { validateLayout } = await import("./config.ts");
		const issues = validateLayout({
			sprite: { mode: "auto", mascot: "teal-ghost" },
			shelf: { rows: [["tokens", "cost"]] },
		});
		const text = issues.map((issue) => issue.path + " " + issue.message).join("\n");
		assert.default.ok(issues.every((issue) => issue.severity === "warning"));
		assert.default.match(text, /sprite.*removed/);
		assert.default.match(text, /shelf.*removed/);
	`);
});

test("mergeLayout folds legacy shelf.rows into footer.extraRows", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { mergeLayout } = await import("./config.ts");

		// Legacy file shape: explicit footer.extraRows (the pre-shelf default,
		// written to disk by every prior install) plus a shelf.rows the old
		// widget used to render. Migration must prepend shelf rows without
		// duplicating anything, and never touch the sprite key.
		const legacy = mergeLayout({
			sprite: { enabled: true, mode: "auto", mascot: "teal-ghost" },
			shelf: { enabled: true, rows: [["tokens", "cost"], ["branch", "dirty", "commit", "sync"]] },
			footer: { enabled: true, left: ["cwd"], right: ["quota"], extraRows: [["extStatuses"]] },
		});
		assert.default.deepEqual(legacy.footer.extraRows, [
			["tokens", "cost"],
			["branch", "dirty", "commit", "sync"],
			["extStatuses"],
		]);
		assert.default.equal("sprite" in legacy, false);
		assert.default.equal("shelf" in legacy, false);

		// Legacy shelf with no footer block at all falls back to the pre-shelf
		// tail ([["extStatuses"]]), not the new post-removal 3-row default —
		// otherwise tokens/cost + branch/dirty/commit/sync would be duplicated.
		const noFooter = mergeLayout({ shelf: { rows: [["tokens", "cost"]] } });
		assert.default.deepEqual(noFooter.footer.extraRows, [["tokens", "cost"], ["extStatuses"]]);
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

test("footer extraRows accepts {left,right} object rows alongside flat arrays", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { mergeLayout, validateLayout } = await import("./config.ts");

		const raw = {
			footer: {
				enabled: true,
				left: ["model"],
				right: [],
				extraRows: [
					{ left: ["sessionName"], right: ["sessionId"] },
					["extStatuses"],
				],
			},
		};

		assert.default.deepEqual(validateLayout(raw), []);
		const merged = mergeLayout(raw);
		assert.default.deepEqual(merged.footer.extraRows, [
			{ left: ["sessionName"], right: ["sessionId"] },
			["extStatuses"],
		]);
	`);
});

test("validateLayout warns when an extraRows object row is malformed", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { validateLayout } = await import("./config.ts");

		const missingLeft = validateLayout({ footer: { extraRows: [{ right: ["speed"] }] } });
		const text1 = missingLeft.map((i) => i.path + " " + i.message).join("\n");
		assert.default.match(text1, /footer\.extraRows\[0\].*left/);

		const badRight = validateLayout({ footer: { extraRows: [{ left: ["speed"], right: "nope" }] } });
		const text2 = badRight.map((i) => i.path + " " + i.message).join("\n");
		assert.default.match(text2, /footer\.extraRows\[0\]\.right/);

		const unknownInObjectRow = validateLayout({ footer: { extraRows: [{ left: ["bogus"] }] } });
		const text3 = unknownInObjectRow.map((i) => i.path + " " + i.message).join("\n");
		assert.default.match(text3, /footer\.extraRows\[0\]\.left\[0\].*bogus/);
	`);
});

test("DEFAULT_LAYOUT includes the default chip set", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { DEFAULT_LAYOUT, DEFAULT_CHIPS } = await import("./config.ts");
		assert.default.deepEqual(DEFAULT_LAYOUT.chips, [...DEFAULT_CHIPS]);
		assert.default.ok(DEFAULT_LAYOUT.chips.length > 0);
	`);
});

test("mergeLayout fills default chips when the field is omitted", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { mergeLayout, DEFAULT_LAYOUT } = await import("./config.ts");
		assert.default.deepEqual(mergeLayout({}).chips, DEFAULT_LAYOUT.chips);
		assert.default.deepEqual(mergeLayout({ separator: " | " }).chips, DEFAULT_LAYOUT.chips);
	`);
});

test("mergeLayout preserves an explicit empty chips list", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { mergeLayout } = await import("./config.ts");
		assert.default.deepEqual(mergeLayout({ chips: [] }).chips, []);
		assert.default.deepEqual(
			mergeLayout({ chips: [] }).footer.extraRows,
			mergeLayout({}).footer.extraRows,
		);
	`);
});

test("mergeLayout replaces chips with an explicit list", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { mergeLayout } = await import("./config.ts");
		const chips = ["tokens", "cwd", "ext:tps"];
		const layout = mergeLayout({ chips });
		assert.default.deepEqual(layout.chips, chips);
		// Returned list must be a fresh copy (mutating input must not mutate defaults).
		assert.default.notEqual(layout.chips, chips);
		assert.default.notDeepEqual(layout.chips, []);
	`);
});

test("mergeLayout falls back to defaults for malformed chips values", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { mergeLayout, DEFAULT_LAYOUT } = await import("./config.ts");
		assert.default.deepEqual(mergeLayout({ chips: "tokens" }).chips, DEFAULT_LAYOUT.chips);
		assert.default.deepEqual(mergeLayout({ chips: [1, 2, 3] }).chips, DEFAULT_LAYOUT.chips);
		assert.default.deepEqual(mergeLayout({ chips: null }).chips, DEFAULT_LAYOUT.chips);
	`);
});

test("validateLayout accepts a valid theme and warns on an unknown one", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { validateLayout } = await import("./config.ts");
		const { PALETTE_NAMES } = await import("./render/header.ts");

		// Every named palette plus "random" must validate cleanly.
		for (const name of [...PALETTE_NAMES, "random"]) {
			assert.default.deepEqual(validateLayout({ theme: name }), []);
		}

		const unknown = validateLayout({ theme: "chartreuse" });
		assert.default.equal(unknown.length, 1);
		assert.default.equal(unknown[0].severity, "warning");
		assert.default.match(unknown[0].path + " " + unknown[0].message, /theme.*chartreuse/);

		const nonString = validateLayout({ theme: 42 });
		assert.default.match(nonString.map((i) => i.path + " " + i.message).join("\n"), /theme.*string/);
	`);
});

test("mergeLayout keeps a valid theme and drops an invalid one", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { mergeLayout } = await import("./config.ts");
		const { PALETTE_NAMES } = await import("./render/header.ts");
		const first = PALETTE_NAMES[0];
		assert.default.equal(mergeLayout({ theme: first }).theme, first);
		assert.default.equal(mergeLayout({ theme: "random" }).theme, "random");
		// Unknown / malformed themes leave the key undefined (startup keeps random default).
		assert.default.equal(mergeLayout({ theme: "chartreuse" }).theme, undefined);
		assert.default.equal(mergeLayout({ theme: 42 }).theme, undefined);
		assert.default.equal(mergeLayout({}).theme, undefined);
	`);
});

test("validateLayout warns for bad chip ids like other block lists", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { validateLayout, DEFAULT_LAYOUT } = await import("./config.ts");
		const issues = validateLayout({
			chips: ["tokens", "unknownChip", "ext:", "ok", 42],
		});
		assert.default.ok(issues.every((issue) => issue.severity === "warning"));
		const text = issues.map((issue) => issue.path + " " + issue.message).join("\n");
		assert.default.match(text, /chips\[1\].*unknownChip/);
		assert.default.match(text, /chips\[2\].*ext:/);
		assert.default.match(text, /chips\[3\].*ok/);
		assert.default.match(text, /chips\[4\]/);
		// A clean list of valid ids must not warn.
		assert.default.deepEqual(
			validateLayout({ chips: ["tokens", "cwd", "ext:tps"] }),
			[],
		);
		// Sanity: default layout still validates cleanly.
		assert.default.deepEqual(validateLayout(DEFAULT_LAYOUT), []);
	`);
});