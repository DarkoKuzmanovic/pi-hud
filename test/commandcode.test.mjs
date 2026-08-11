import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function compileToTemp() {
  const outDir = mkdtempSync(join(tmpdir(), "pi-hud-test-build-"));
  // Prefer pi's shared dev toolchain (see ~/.pi/agent/docs/DEVTOOLS.md): local
  // node_modules/.bin/tsc when present, else the pi-agent shared install, else PATH.
  const candidates = [
    resolve("node_modules/.bin/tsc"),
    join(homedir(), ".pi", "agent", "node_modules", ".bin", "tsc"),
    "tsc",
  ];
  const tsc = candidates.find((c) => c === "tsc" || existsSync(c)) ?? "tsc";
  execFileSync(
    tsc,
    [
      "--outDir",
      outDir,
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--skipLibCheck",
      "--noEmit",
      "false",
      "providers/commandcode.ts",
      "providers/shared.ts",
      "types.ts",
    ],
    { cwd: resolve("."), stdio: "pipe" },
  );
  return outDir;
}

test("CommandCode credits map to 5h and weekly percent windows with reset times", async () => {
  const buildDir = compileToTemp();
  try {
    const { commandCodeToProvider } = await import(
      `${pathToFileURL(join(buildDir, "providers", "commandcode.js")).href}?${Date.now()}`
    );

    const provider = commandCodeToProvider({
      status: "ok",
      usage: {
        fiveHourUsed: 0.0499,
        fiveHourCap: 14,
        fiveHourResetAt: 1_786_501_716_864,
        weeklyUsed: 0.0499,
        weeklyCap: 35,
        weeklyResetAt: 1_787_088_518_664,
        monthlyCredits: 69.95,
      },
    });

    assert.equal(provider.id, "commandcode");
    assert.equal(provider.name, "CommandCode");
    assert.equal(provider.status, "ok");
    assert.equal(provider.message, "");
	assert.deepEqual(provider.windows, [
		{
			label: "5h",
			usedPercent: (0.0499 / 14) * 100,
			resetAt: 1_786_501_716_864,
		},
		{
			label: "week",
			usedPercent: (0.0499 / 35) * 100,
			resetAt: 1_787_088_518_664,
		},
	]);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("CommandCode weekly window omitted when API omits it; plan name surfaced", async () => {
  const buildDir = compileToTemp();
  try {
    const { commandCodeToProvider } = await import(
      `${pathToFileURL(join(buildDir, "providers", "commandcode.js")).href}?${Date.now()}`
    );

    const provider = commandCodeToProvider({
      status: "ok",
      usage: {
        fiveHourUsed: 7,
        fiveHourCap: 14,
        weeklyUsed: null,
        weeklyCap: null,
        monthlyCredits: 69.95,
        planName: "GOAT",
      },
    });

    assert.equal(provider.status, "ok");
    assert.equal(provider.message, " (GOAT)");
	assert.deepEqual(provider.windows, [
		{
			label: "5h",
			usedPercent: 50,
			resetAt: undefined,
		},
	]);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("CommandCode non-ok status keeps windows from previous state", async () => {
  const buildDir = compileToTemp();
  try {
    const { commandCodeToProvider } = await import(
      `${pathToFileURL(join(buildDir, "providers", "commandcode.js")).href}?${Date.now()}`
    );

    const previous = {
      id: "commandcode",
      name: "CommandCode",
      icon: "𝕏",
      status: "ok",
      updatedAt: 0,
      windows: [{ label: "5h", usedPercent: 50 }],
    };
    const provider = commandCodeToProvider(
      { usage: null, status: "error", message: "bad shape" },
      previous,
    );

    assert.equal(provider.status, "error");
    assert.equal(provider.message, "bad shape");
    assert.deepEqual(provider.windows, previous.windows);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});
