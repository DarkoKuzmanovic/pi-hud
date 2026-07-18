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

test("BOX_CHARSETS cover bracket/pill/double corners", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { BOX_CHARSETS } = await import("./render/editors/boxed.ts");

		assert.default.equal(BOX_CHARSETS.bracket.topLeft, "┌");
		assert.default.equal(BOX_CHARSETS.bracket.bottomRight, "┘");
		assert.default.equal(BOX_CHARSETS.pill.topLeft, "╭");
		assert.default.equal(BOX_CHARSETS.pill.bottomRight, "╯");
		assert.default.equal(BOX_CHARSETS.double.topLeft, "╔");
		assert.default.equal(BOX_CHARSETS.double.horizontal, "═");
		assert.default.equal(BOX_CHARSETS.double.vertical, "║");
	`);
});

test("fitBoxEdge packs labels into a fixed width with corners", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { fitBoxEdge, BOX_CHARSETS } = await import("./render/editors/boxed.ts");
		const { visibleWidth } = await import("./render/pi-tui-shim.ts");
		const identity = (s) => s;
		const chars = {
			topLeft: BOX_CHARSETS.bracket.topLeft,
			topRight: BOX_CHARSETS.bracket.topRight,
			horizontal: BOX_CHARSETS.bracket.horizontal,
		};

		const line = fitBoxEdge(" left ", " right ", 20, chars, identity);
		assert.default.equal(visibleWidth(line), 20);
		assert.default.ok(line.startsWith("┌"));
		assert.default.ok(line.endsWith("┐"));
		assert.default.ok(line.includes(" left "));
		assert.default.ok(line.includes(" right "));

		const bottomChars = {
			topLeft: BOX_CHARSETS.pill.bottomLeft,
			topRight: BOX_CHARSETS.pill.bottomRight,
			horizontal: BOX_CHARSETS.pill.horizontal,
		};
		const bottom = fitBoxEdge(" ↑3 ", "", 12, bottomChars, identity);
		assert.default.equal(visibleWidth(bottom), 12);
		assert.default.ok(bottom.startsWith("╰"));
		assert.default.ok(bottom.endsWith("╯"));
		assert.default.ok(bottom.includes("↑3"));

		// Narrow width drops right first, then left.
		const narrow = fitBoxEdge(" LEFTLABEL ", " RIGHTLABEL ", 10, chars, identity);
		assert.default.equal(visibleWidth(narrow), 10);
		assert.default.ok(!narrow.includes("RIGHTLABEL"));
	`);
});
