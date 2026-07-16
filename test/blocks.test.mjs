import test from "node:test";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HUD_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function runBunAssertions(source) {
	execFileSync("bun", ["--silent", "-e", source], {
		cwd: HUD_DIR,
		stdio: "pipe",
		// HUD_ICONS=none → ASCII bracket glyphs in tests, so chip wraps show up
		// as literal '[' / ']' instead of Powerline PUA chars.
		env: { ...process.env, HUD_ICONS: "none" },
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
			"sessionName",
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
		const sessionTheme = { fg: (_name, text) => text, inverse: (text) => text, reset: () => "" };
		const sessionBlock = {
			theme: sessionTheme,
			totals: { input: 0, output: 0, cost: 0 },
			activeUsage: { id: "unsupported", name: "Unsupported", icon: "?", status: "unknown", windows: [] },
			thinkingLevel: "off",
			activeStartedAt: null,
			lastRunMs: null,
			lastTps: null,
			gitDirty: { text: "", isClean: true },
			gitRemote: { ahead: 0, behind: 0, hasRemote: false },
			gitLastCommit: { hash: "", subject: "", age: "" },
			branch: "main",
			extStatuses: new Map(),
			ctx: {
				cwd: "/tmp",
				model: { id: "m" },
				getContextUsage: () => ({ tokens: 0, contextWindow: 1 }),
				sessionManager: {
					getSessionId: () => "session-id",
					getSessionName: () => "Feature work",
				},
			},
		};
		assert.default.match(renderBlock("sessionName", sessionBlock), /Feature work/);
		assert.default.equal(
			renderBlock("sessionName", {
				...sessionBlock,
				ctx: {
					...sessionBlock.ctx,
					sessionManager: { getSessionId: () => "session-id", getSessionName: () => "" },
				},
			}),
			"",
		);
		assert.default.equal(
			renderBlock("sessionName", {
				...sessionBlock,
				ctx: {
					...sessionBlock.ctx,
					sessionManager: { getSessionId: () => "session-id" },
				},
			}),
			"",
		);
	`);
});

test("renderBlock chip wrapping is centralized and respects layout.chips", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { renderBlock } = await import("./render/blocks.ts");
		const { setAsciiMode } = await import("./render/format.ts");
		// Force ASCII brackets so chip wraps surface as '[' / ']' literals.
		setAsciiMode(true);
		const theme = {
			fg: (_name, text) => text,
			inverse: (text) => text,
			reset: () => "",
		};
		const base = {
			theme,
			totals: { input: 1000, output: 2000, cost: 0.12 },
			activeUsage: { id: "codex", name: "Codex", icon: "?", status: "ok", windows: [] },
			thinkingLevel: "high",
			activeStartedAt: null,
			lastRunMs: null,
			lastTps: 12.3,
			gitDirty: { text: "", isClean: true },
			gitRemote: { ahead: 0, behind: 0, hasRemote: false },
			gitLastCommit: { hash: "", subject: "", age: "" },
			branch: "main",
			extStatuses: new Map(),
			ctx: {
				cwd: "/tmp",
				model: { id: "openai-codex/gpt-5.5" },
				getContextUsage: () => ({ tokens: 5000, contextWindow: 272000 }),
				sessionManager: { getSessionId: () => "" },
			},
		};
		// Most blocks wrap their entire output as a chip.
		const fullWrapRe = /^\[\s.+?\s\]$/;
		// quota's provider badge is the chip — windows/suffix follow plain.
		const quotaChipRe = /^\[\s.+\s\]\s/;

		// 1. No chips set → blocks render plain (no chip brackets).
		assert.default.equal(renderBlock("tokens", base), "↑1.0k ↓2.0k");
		assert.default.match(renderBlock("cwd", base), /^.+ \/tmp$/);
		assert.default.match(renderBlock("branch", base), /^.+\smain$/);
		assert.default.match(renderBlock("speed", base), /^.+ 12\.3 tok\/s$/);

		// 2. Default chips → formerly chipped blocks keep their chip brackets.
		const defaultChips = new Set(["project", "folder", "model", "thinking", "context", "quota"]);
		const modelDef = renderBlock("model", { ...base, chips: defaultChips });
		assert.default.match(modelDef, fullWrapRe, "model should be chip-wrapped by default");
		const thinkDef = renderBlock("thinking", { ...base, chips: defaultChips });
		assert.default.match(thinkDef, fullWrapRe, "thinking should be chip-wrapped by default");
		const ctxDef = renderBlock("context", { ...base, chips: defaultChips });
		assert.default.match(ctxDef, fullWrapRe, "context should be chip-wrapped by default");

		// 3. Explicit empty chips → formerly chipped blocks lose their chip brackets.
		const emptyChips = new Set();
		const modelPlain = renderBlock("model", { ...base, chips: emptyChips });
		assert.default.equal(modelPlain.includes("["), false);
		assert.default.equal(renderBlock("thinking", { ...base, chips: emptyChips }).includes("["), false);
		assert.default.equal(renderBlock("context", { ...base, chips: emptyChips }).includes("["), false);
		// Chipped → plain: stripping the chip brackets recovers the plain output.
		const stripChip = (s) => s.replace(/^\[\s/, "").replace(/\s\]$/, "");
		assert.default.equal(stripChip(modelDef), modelPlain);

		// 4. Adding a non-default block to chips wraps it in dimChip.
		const optInChips = new Set(["tokens"]);
		const tokensChip = renderBlock("tokens", { ...base, chips: optInChips });
		assert.default.match(tokensChip, fullWrapRe, "tokens should be chip-wrapped when listed");
		// cwd is not in opt-in chips → plain.
		const cwdPlain = renderBlock("cwd", { ...base, chips: optInChips });
		assert.default.equal(cwdPlain.includes("["), false, "cwd should stay plain when not listed");

		// 5. Empty/whitespace output is never wrapped, even when block is in chips.
		const emptyBase = { ...base, totals: { input: 0, output: 0, cost: 0 }, lastTps: null };
		assert.default.equal(renderBlock("tokens", { ...emptyBase, chips: optInChips }), "");
		assert.default.equal(renderBlock("speed", { ...emptyBase, chips: new Set(["speed"]) }), "");
		// runDuration with no active run and no lastRun falls back to "⏱ idle" — non-empty.
		const idle = renderBlock("runDuration", { ...emptyBase, chips: new Set(["runDuration"]) });
		assert.default.match(idle, fullWrapRe, "non-empty runDuration idle label gets wrapped");
		assert.default.match(idle, /idle/);

		// 6. Unknown / extension-only blocks remain safe.
		assert.default.equal(renderBlock("unknown-block", { ...base, chips: defaultChips }), "");
		assert.default.equal(renderBlock("nope", { ...base, chips: defaultChips }), "");

		// 7. quota: when chips include "quota" the provider badge is chip-wrapped,
		// when they do not the badge is plain. Windows remain visible in both.
		const quotaUsage = {
			id: "codex", name: "Codex", icon: "◆", status: "ok",
			windows: [{ label: "5h", used: 30, limit: 100, resetAt: null }],
		};
		const withQuota = renderBlock("quota", {
			...base,
			activeUsage: quotaUsage,
			chips: new Set(["quota"]),
		});
		assert.default.match(withQuota, quotaChipRe, "quota provider badge should chip when listed");
		assert.default.match(withQuota, /5h/);
		const withoutQuota = renderBlock("quota", {
			...base,
			activeUsage: quotaUsage,
			chips: new Set(),
		});
		assert.default.equal(withoutQuota.includes("["), false, "quota must not chip when not in chips set");
		assert.default.match(withoutQuota, /5h/);
	`);
});


test("fallback chip wrapping strips nested ANSI colors for uniform background", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { renderBlock } = await import("./render/blocks.ts");
		const { setAsciiMode } = await import("./render/format.ts");
		setAsciiMode(true);
		const theme = {
			fg: (name, text) => "\x1b[" + (name === "dim" ? "2" : "35") + "m" + text + "\x1b[39m",
			inverse: (text) => "\x1b[7m" + text + "\x1b[27m",
			reset: () => "\x1b[0m",
		};
		const base = {
			theme,
			totals: { input: 0, output: 0, cost: 0 },
			activeUsage: { id: "unsupported", name: "X", icon: "?", status: "unknown", windows: [] },
			thinkingLevel: "off",
			activeStartedAt: null,
			lastRunMs: null,
			lastTps: null,
			gitDirty: { text: "", isClean: true },
			gitRemote: { ahead: 0, behind: 0, hasRemote: false },
			gitLastCommit: { hash: "", subject: "", age: "" },
			branch: "main",
			extStatuses: new Map(),
			ctx: {
				cwd: "/tmp",
				model: { id: "m" },
				getContextUsage: () => ({ tokens: 0, contextWindow: 1 }),
				sessionManager: { getSessionId: () => "" },
			},
		};

		const plain = renderBlock("cwd", base);
		assert.default.match(plain, /\x1b\[2m\/tmp\x1b\[39m/, "plain cwd keeps its dim text styling");

		const chipped = renderBlock("cwd", { ...base, chips: new Set(["cwd"]) });
		assert.default.match(chipped, /\x1b\[7m 📁 \/tmp \x1b\[27m/, "chipped cwd uses one inverse span for the whole body");
		assert.default.doesNotMatch(chipped, /\x1b\[2m\/tmp/, "inner dim foreground would change the inverse chip background");
	`);
});

test("renderGroup threads chip wrapping through shelf and footer block lists", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { renderGroup } = await import("./render/blocks.ts");
		const { setAsciiMode } = await import("./render/format.ts");
		setAsciiMode(true);
		const theme = {
			fg: (_name, text) => text,
			inverse: (text) => text,
			reset: () => "",
		};
		const block = {
			theme,
			totals: { input: 100, output: 200, cost: 0 },
			activeUsage: { id: "unsupported", name: "X", icon: "?", status: "unknown", windows: [] },
			thinkingLevel: "off",
			activeStartedAt: null,
			lastRunMs: null,
			lastTps: null,
			gitDirty: { text: "", isClean: true },
			gitRemote: { ahead: 0, behind: 0, hasRemote: false },
			gitLastCommit: { hash: "", subject: "", age: "" },
			branch: "main",
			extStatuses: new Map(),
			ctx: {
				cwd: "/tmp",
				model: { id: "m" },
				getContextUsage: () => ({ tokens: 0, contextWindow: 1 }),
				sessionManager: { getSessionId: () => "" },
			},
		};

		// No chips: row renders plain, joined by separator.
		const plain = renderGroup(["cwd", "branch"], block, " | ");
		assert.default.match(plain, /^.+ \/tmp \| .+main$/);

		// chips: ["cwd"] wraps only cwd; branch stays plain.
		const optIn = renderGroup(["cwd", "branch"], { ...block, chips: new Set(["cwd"]) }, " | ");
		assert.default.match(optIn, /^\[ .+ \/tmp \] \| .+main$/);

		// Empty branch is filtered out; cwd is the only surviving chip-wrapped block.
		const noBranch = renderGroup(["cwd", "branch"], {
			...block,
			branch: "",
			chips: new Set(["cwd", "branch"]),
		}, " | ");
		assert.default.match(noBranch, /^\[ .+ \/tmp \]$/);

		// Unknown block id is filtered silently, never emits brackets.
		const safe = renderGroup(["cwd", "unknown"], { ...block, chips: new Set() }, " | ");
		assert.default.match(safe, /^.+ \/tmp$/);
		assert.default.equal(safe.includes("["), false);
	`);
});


test("project block renders the resolved machine name in plain and chip modes", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { renderBlock } = await import("./render/blocks.ts");
		const { setAsciiMode } = await import("./render/format.ts");
		setAsciiMode(true);
		const block = {
			machineName: "darko-laptop",
			theme: { fg: (_name, text) => text, inverse: (text) => text, reset: () => "" },
			totals: { input: 0, output: 0, cost: 0 },
			activeUsage: { id: "unsupported", name: "X", icon: "?", status: "unknown", windows: [] },
			thinkingLevel: "off",
			activeStartedAt: null,
			lastRunMs: null,
			lastTps: null,
			gitDirty: { text: "", isClean: true },
			gitRemote: { ahead: 0, behind: 0, hasRemote: false },
			gitLastCommit: { hash: "", subject: "", age: "" },
			branch: "main",
			extStatuses: new Map(),
			ctx: {
				cwd: "/tmp",
				model: { id: "m" },
				getContextUsage: () => ({ tokens: 0, contextWindow: 1 }),
				sessionManager: { getSessionId: () => "" },
			},
		};

		assert.default.equal(renderBlock("project", block), "π - darko-laptop");
		assert.default.equal(
			renderBlock("project", { ...block, chips: new Set(["project"]) }),
			"[ π - darko-laptop ]",
		);
	`);
});