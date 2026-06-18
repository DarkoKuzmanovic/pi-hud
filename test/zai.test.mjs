import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function compileToTemp() {
  const outDir = mkdtempSync(join(tmpdir(), "pi-hud-test-build-"));
  execFileSync(
    resolve("node_modules/.bin/tsc"),
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
      "providers/zai.ts",
      "providers/shared.ts",
      "types.ts",
    ],
    { cwd: resolve("."), stdio: "pipe" },
  );
  return outDir;
}

test("Z.AI provider maps 5h quota and 7d token usage", async () => {
  const buildDir = compileToTemp();
  try {
    const { parseZaiUsage, zaiToProvider } = await import(
      `${pathToFileURL(join(buildDir, "providers", "zai.js")).href}?${Date.now()}`
    );

    const usage = parseZaiUsage(
      {
        code: 200,
        data: {
          limits: [
            { type: "TIME_LIMIT", percentage: 0 },
            { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 42, nextResetTime: 1_781_444_214_912 },
            { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 22, nextResetTime: 1_781_974_829_998 },
          ],
        },
        success: true,
      },
      {
        code: 200,
        data: {
          totalUsage: { totalTokensUsage: 987_654, totalModelCallCount: 12 },
        },
        success: true,
      },
    );
    const provider = zaiToProvider({ status: "ok", usage });

    assert.equal(provider.id, "zai");
    assert.equal(provider.name, "Z.AI");
    assert.equal(provider.status, "ok");
    assert.deepEqual(provider.windows, [
      {
        label: "5h",
        usedPercent: 42,
        resetAt: 1_781_444_214_912,
      },
      {
        label: "week",
        usedPercent: 22,
        usedCount: 987_654,
        resetAt: 1_781_974_829_998,
      },
    ]);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("Z.AI provider preserves previous windows on non-ok fetch result", async () => {
  const buildDir = compileToTemp();
  try {
    const { zaiToProvider } = await import(
      `${pathToFileURL(join(buildDir, "providers", "zai.js")).href}?${Date.now()}`
    );

    const previous = {
      id: "zai",
      name: "Z.AI",
      icon: "\uee0d",
      status: "ok",
      windows: [{ label: "5h", usedPercent: 10 }],
    };
    const provider = zaiToProvider(
      { status: "auth-needed", usage: null, message: "login" },
      previous,
    );

    assert.equal(provider.id, "zai");
    assert.equal(provider.status, "auth-needed");
    assert.equal(provider.message, "login");
    assert.deepEqual(provider.windows, previous.windows);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});
