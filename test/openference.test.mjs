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
      "providers/openference.ts",
      "providers/shared.ts",
      "types.ts",
    ],
    { cwd: resolve("."), stdio: "pipe" },
  );
  return outDir;
}

test("Openference usage renders as a labeled 'daily' window, not a mislabeled 5h window", async () => {
  const buildDir = compileToTemp();
  try {
    const { openferenceToProvider } = await import(
      `${pathToFileURL(join(buildDir, "providers", "openference.js")).href}?${Date.now()}`
    );

    const before = Date.now();
    const provider = openferenceToProvider({
      status: "ok",
      usage: {
        requestsToday: 206,
        planName: "Lite",
        maxRpm: 20,
        totalTokensToday: 3_594_215,
        totalCostTodayUsd: 3.1083,
      },
    });

    assert.equal(provider.id, "openference");
    assert.equal(provider.name, "Openference");
    assert.equal(provider.status, "ok");
    assert.equal(provider.windows.length, 1);
    assert.equal(provider.windows[0].label, "daily");
    assert.equal(provider.windows[0].usedCount, 206);
    // No fabricated limit/percent — Openference exposes no reliable daily cap.
    assert.equal(provider.windows[0].limitCount, undefined);
    assert.equal(provider.windows[0].usedPercent, undefined);

    // resetAt is a best-effort "next UTC midnight" assumption, not data from the
    // API — assert its shape rather than a fixed value.
    const resetAt = provider.windows[0].resetAt;
    assert.ok(typeof resetAt === "number" && resetAt > before);
    const resetDate = new Date(resetAt);
    assert.equal(resetDate.getUTCHours(), 0);
    assert.equal(resetDate.getUTCMinutes(), 0);
    assert.equal(resetDate.getUTCSeconds(), 0);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("Openference usage falls back to auth-needed status without fabricating usage data", async () => {
  const buildDir = compileToTemp();
  try {
    const { openferenceToProvider } = await import(
      `${pathToFileURL(join(buildDir, "providers", "openference.js")).href}?${Date.now()}`
    );

    const noPrevious = openferenceToProvider({
      status: "auth-needed",
      usage: null,
      message: "no browser session",
    });
    assert.equal(noPrevious.status, "auth-needed");
    assert.equal(noPrevious.message, "no browser session");
    assert.deepEqual(noPrevious.windows, [{ label: "daily" }]);

    const previous = {
      id: "openference",
      name: "Openference",
      icon: "\udb80\udfbd",
      status: "ok",
      updatedAt: 1_780_000_000_000,
      windows: [{ label: "daily", usedCount: 42, resetAt: 1_780_100_000_000 }],
    };
    const withPrevious = openferenceToProvider(
      { status: "error", usage: null, message: "network" },
      previous,
    );
    assert.equal(withPrevious.status, "error");
    // Preserves last-known windows instead of blanking them on a transient failure.
    assert.deepEqual(withPrevious.windows, previous.windows);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});
