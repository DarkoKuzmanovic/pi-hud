import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function compileToTemp() {
  const outDir = mkdtempSync(join(tmpdir(), "pi-hud-test-build-"));
  const tsc = resolve("node_modules/.bin/tsc");
  execFileSync(
    existsSync(tsc) ? tsc : "tsc",
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
      "providers/openadapter.ts",
      "providers/shared.ts",
      "types.ts",
    ],
    { cwd: resolve("."), stdio: "pipe" },
  );
  return outDir;
}

async function load(buildDir) {
  return import(
    `${pathToFileURL(join(buildDir, "providers", "openadapter.js")).href}?${Date.now()}`
  );
}

// Payload shape captured live from GET https://api.openadapter.in/api/usage
// on 2026-07-30 (trimmed: hourly/by_model/recent omitted, unused by the mapper).
const LIVE_SHAPE = {
  plan: "lite",
  plan_name: "Lite",
  limits: {
    day: { percent: 0, resets_at: "2026-07-31T12:47:19.130Z" },
    "5h": { percent: 12, resets_at: "2026-07-30T17:47:19.130Z" },
    week: { percent: 9, resets_at: "2026-08-04T22:10:02.672Z" },
    month: { percent: 3, resets_at: "2026-08-27T22:10:02.672Z" },
  },
  credit_balance: 0,
  usage_percent: 3,
  remaining_percent: 97,
  requests_today: 90,
  tokens_today: 6273494,
};

test("OpenAdapter maps the live payload to 5h + week percent windows", async () => {
  const buildDir = compileToTemp();
  try {
    const { openadapterToProvider } = await load(buildDir);

    const provider = openadapterToProvider({
      status: "ok",
      usage: {
        shortPercent: LIVE_SHAPE.limits["5h"].percent,
        shortResetAt: Date.parse(LIVE_SHAPE.limits["5h"].resets_at),
        weekPercent: LIVE_SHAPE.limits.week.percent,
        weekResetAt: Date.parse(LIVE_SHAPE.limits.week.resets_at),
        monthPercent: LIVE_SHAPE.limits.month.percent,
        planName: LIVE_SHAPE.plan_name,
      },
    });

    assert.equal(provider.id, "openadapter");
    assert.equal(provider.status, "ok");
    assert.deepEqual(
      provider.windows.map((w) => w.label),
      ["5h", "week"],
    );
    assert.equal(provider.windows[0].usedPercent, 12);
    assert.equal(
      provider.windows[0].resetAt,
      Date.parse("2026-07-30T17:47:19.130Z"),
    );
    assert.equal(provider.windows[1].usedPercent, 9);
    // Percent-only provider: no absolute caps are reported, so the HUD must not
    // render a "used/limit" pair.
    assert.equal(provider.windows[0].usedCount, undefined);
    assert.equal(provider.windows[0].limitCount, undefined);
    // `message` stays reserved for non-ok states (plan name is parsed, not shown).
    assert.equal(provider.message, undefined);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("OpenAdapter keeps previous windows and surfaces the reason when a fetch fails", async () => {
  const buildDir = compileToTemp();
  try {
    const { openadapterToProvider } = await load(buildDir);

    const previous = {
      id: "openadapter",
      name: "OpenAdapter",
      icon: "x",
      status: "ok",
      windows: [
        { label: "5h", usedPercent: 12 },
        { label: "week", usedPercent: 9 },
      ],
    };

    const failed = openadapterToProvider(
      { status: "auth-needed", usage: null, message: "no key" },
      previous,
    );
    assert.equal(failed.status, "auth-needed");
    assert.equal(failed.message, "no key");
    assert.deepEqual(failed.windows, previous.windows);

    const cold = openadapterToProvider({
      status: "error",
      usage: null,
      message: "network",
    });
    assert.deepEqual(
      cold.windows.map((w) => w.label),
      ["5h", "week"],
    );
    assert.equal(cold.windows[0].usedPercent, undefined);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("OpenAdapter pins out-of-range percentages into the 0-100 render contract", async () => {
  const buildDir = compileToTemp();
  try {
    const { openadapterToProvider } = await load(buildDir);

    const provider = openadapterToProvider({
      status: "ok",
      usage: { shortPercent: 150, weekPercent: -1 },
    });
    assert.equal(provider.windows[0].usedPercent, 100);
    assert.equal(provider.windows[1].usedPercent, 0);

    const nonNumeric = openadapterToProvider({
      status: "ok",
      usage: { shortPercent: Number.NaN, weekPercent: undefined },
    });
    assert.equal(nonNumeric.windows[0].usedPercent, undefined);
    assert.equal(nonNumeric.windows[1].usedPercent, undefined);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});
