import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
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
      "providers/codex.ts",
      "providers/shared.ts",
      "types.ts",
    ],
    { cwd: resolve("."), stdio: "pipe" },
  );
  return outDir;
}

test("Codex usage refresh retries with browser-compatible headers", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "pi-hud-home-"));
  const buildDir = compileToTemp();
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  try {
    mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
    writeFileSync(
      join(homeDir, ".pi", "agent", "auth.json"),
      JSON.stringify({
        "openai-codex": {
          type: "oauth",
          access: "stale-access",
          refresh: "refresh-token",
          accountId: "account-id",
        },
      }),
    );
    process.env.HOME = homeDir;

    const usageUserAgents = [];
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes("oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      const headers = new Headers(init.headers);
      usageUserAgents.push(headers.get("User-Agent"));
      const token = headers.get("Authorization");
      const hasBrowserUserAgent = headers.get("User-Agent")?.includes("Mozilla/5.0");
      if (token === "Bearer fresh-access" && hasBrowserUserAgent) {
        return new Response(
          JSON.stringify({
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_after_seconds: 60, reset_at: 1 },
              secondary_window: { used_percent: 34, limit_window_seconds: 604800, reset_after_seconds: 120, reset_at: 2 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("expired", { status: 403 });
    };

    const { fetchCodexUsage } = await import(
      `${pathToFileURL(join(buildDir, "providers", "codex.js")).href}?${Date.now()}`
    );

    const result = await fetchCodexUsage();

    assert.equal(result.status, "ok");
    assert.equal(result.usage?.rate_limit?.primary_window?.used_percent, 12);
    assert.ok(
      usageUserAgents.every((userAgent) => userAgent?.includes("Mozilla/5.0")),
      `expected browser user agent, got ${usageUserAgents.join(", ")}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("Codex usage falls back to curl when Node fetch is blocked", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "pi-hud-home-"));
  const binDir = mkdtempSync(join(tmpdir(), "pi-hud-bin-"));
  const buildDir = compileToTemp();
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalFetch = globalThis.fetch;

  try {
    mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
    writeFileSync(
      join(homeDir, ".pi", "agent", "auth.json"),
      JSON.stringify({
        "openai-codex": {
          type: "oauth",
          access: "node-fetch-blocked-access",
          refresh: "refresh-token",
          accountId: "account-id",
        },
      }),
    );
    writeFileSync(
      join(binDir, "curl"),
      "#!/bin/sh\ncat >/dev/null\nprintf '%s\\nHTTP_STATUS:200' '{\"rate_limit\":{\"allowed\":true,\"limit_reached\":false,\"primary_window\":{\"used_percent\":21},\"secondary_window\":{\"used_percent\":43}}}'\n",
    );
    chmodSync(join(binDir, "curl"), 0o755);
    process.env.HOME = homeDir;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    globalThis.fetch = async () => new Response("cloudflare", { status: 403 });

    const { fetchCodexUsage } = await import(
      `${pathToFileURL(join(buildDir, "providers", "codex.js")).href}?${Date.now()}`,
    );

    const result = await fetchCodexUsage();

    assert.equal(result.status, "ok");
    assert.equal(result.usage?.rate_limit?.primary_window?.used_percent, 21);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
    rmSync(buildDir, { recursive: true, force: true });
  }
});
