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

test("block registry exports known blocks and descriptions", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { KNOWN_BLOCKS, BLOCK_DESCRIPTIONS } = await import("./render/blocks.ts");
		const expected = [
			"project",
			"folder",
			"model",
			"thinking",
			"context",
			"statusDot",
			"tokens",
			"cost",
			"runDuration",
			"speed",
			"cwd",
			"branch",
			"dirty",
			"commit",
			"sync",
			"sessionId",
			"quota",
			"extStatuses",
		];
		assert.default.deepEqual(KNOWN_BLOCKS, expected);
		assert.default.equal(new Set(KNOWN_BLOCKS).size, KNOWN_BLOCKS.length);
		for (const id of KNOWN_BLOCKS) {
			assert.default.equal(typeof BLOCK_DESCRIPTIONS[id], "string", id + " has a description");
			assert.default.ok(BLOCK_DESCRIPTIONS[id].length > 10, id + " description is useful");
		}
		assert.default.equal(typeof BLOCK_DESCRIPTIONS["ext:<key>"], "string");
		assert.default.match(BLOCK_DESCRIPTIONS["ext:<key>"], /extension status/i);
	`);
});

test("block registry metadata stays in sync with rendered block behavior", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { KNOWN_BLOCKS, renderBlock } = await import("./render/blocks.ts");
		assert.default.ok(KNOWN_BLOCKS.includes("cwd"));
		assert.default.ok(KNOWN_BLOCKS.includes("extStatuses"));
		assert.default.equal(renderBlock("unknown-block", {}), "");
		assert.default.equal(renderBlock("ext:", { extStatuses: new Map() }), "");
	`);
});
