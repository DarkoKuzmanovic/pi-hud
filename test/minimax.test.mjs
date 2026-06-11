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
      "providers/minimax.ts",
      "providers/shared.ts",
      "types.ts",
    ],
    { cwd: resolve("."), stdio: "pipe" },
  );
  return outDir;
}

test("MiniMax legacy token-plan remains render as 5h and weekly request usage", async () => {
  const buildDir = compileToTemp();
  try {
    const { minimaxToProvider } = await import(
      `${pathToFileURL(join(buildDir, "providers", "minimax.js")).href}?${Date.now()}`
    );

    const provider = minimaxToProvider({
      status: "ok",
      usage: {
        category_remains: [
          {
            category: "text_generation",
            display_name: "Text Generation",
            start_time: 1_780_203_600_000,
            end_time: 1_780_221_600_000,
            remains_time: 14_600_000,
            current_interval_total_count: 4_500,
            current_interval_usage_count: 450,
            current_weekly_total_count: 45_000,
            current_weekly_usage_count: 9_000,
            weekly_start_time: 1_779_667_200_000,
            weekly_end_time: 1_780_272_000_000,
            weekly_remains_time: 65_000_000,
          },
        ],
      },
    });

    assert.equal(provider.id, "minimax");
    assert.equal(provider.name, "MiniMax");
    assert.equal(provider.status, "ok");
    assert.deepEqual(provider.windows, [
      {
        label: "5h",
        usedPercent: 10,
        usedCount: 450,
        limitCount: 4_500,
        resetAt: 1_780_221_600_000,
      },
      {
        label: "week",
        usedPercent: 20,
        usedCount: 9_000,
        limitCount: 45_000,
        resetAt: 1_780_272_000_000,
      },
    ]);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});



test("MiniMax credit-based token-plan remains render usage from remaining percent without request counts", async () => {
  const buildDir = compileToTemp();
  try {
    const { minimaxToProvider } = await import(
      `${pathToFileURL(join(buildDir, "providers", "minimax.js")).href}?${Date.now()}`
    );

    const provider = minimaxToProvider({
      status: "ok",
      usage: {
        model_remains: [
          {
            model_name: "general",
            start_time: 1_780_290_000_000,
            end_time: 1_780_308_000_000,
            remains_time: 14_158_520,
            current_interval_total_count: 0,
            current_interval_usage_count: 0,
            current_interval_remaining_percent: 73.5,
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            current_weekly_remaining_percent: 81.25,
            weekly_start_time: 1_780_272_000_000,
            weekly_end_time: 1_780_876_800_000,
            weekly_remains_time: 582_958_520,
          },
        ],
      },
    });

    assert.equal(provider.status, "ok");
    assert.deepEqual(provider.windows, [
      {
        label: "5h",
        usedPercent: 26.5,
        resetAt: 1_780_308_000_000,
      },
      {
        label: "week",
        usedPercent: 18.75,
        resetAt: 1_780_876_800_000,
      },
    ]);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});
