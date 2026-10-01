import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
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

async function withCodexHome(setup, fn) {
  const homeDir = mkdtempSync(join(tmpdir(), "pi-hud-home-"));
  const binDir = mkdtempSync(join(tmpdir(), "pi-hud-bin-"));
  const buildDir = compileToTemp();
  const saved = { HOME: process.env.HOME, PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME };
  const originalFetch = globalThis.fetch;
  try {
    mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
    process.env.HOME = homeDir;
    delete process.env.CODEX_HOME;
    // Stub curl so the Cloudflare fallback never reaches the network.
    writeFileSync(join(binDir, "curl"), "#!/bin/sh\ncat >/dev/null\nprintf 'denied\\nHTTP_STATUS:401'\n");
    chmodSync(join(binDir, "curl"), 0o755);
    process.env.PATH = binDir + ":" + (saved.PATH ?? "");
    setup(homeDir);
    const mod = await import(pathToFileURL(join(buildDir, "providers", "codex.js")).href + "?" + Date.now());
    await fn(mod, homeDir);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
    rmSync(buildDir, { recursive: true, force: true });
  }
}

function writeCodexCliAuth(dir, access = "cli-access", accountId = "cli-account") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "auth.json"),
    JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: access, account_id: accountId, refresh_token: "cli-refresh", id_token: "cli-id" } }),
  );
}

const weeklyUsage = {
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 35, limit_window_seconds: 604800, reset_after_seconds: 100, reset_at: 1791072451 },
    secondary_window: null,
  },
};

test("Codex usage falls back to the Codex CLI login when Pi only has the openai subscription login", async () => {
  await withCodexHome(
    (homeDir) => {
      writeFileSync(
        join(homeDir, ".pi", "agent", "auth.json"),
        JSON.stringify({ openai: { type: "oauth", access: "api-resource-token", refresh: "r", clientId: "c", expires: 1 } }),
      );
      writeCodexCliAuth(join(homeDir, ".codex"));
    },
    async ({ fetchCodexUsage }) => {
      const seen = [];
      globalThis.fetch = async (url, init = {}) => {
        const headers = new Headers(init.headers);
        seen.push([String(url), headers.get("Authorization"), headers.get("chatgpt-account-id")]);
        if (headers.get("Authorization") === "Bearer cli-access" && headers.get("chatgpt-account-id") === "cli-account") {
          return new Response(JSON.stringify(weeklyUsage), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("denied", { status: 401 });
      };

      const result = await fetchCodexUsage();

      assert.equal(result.status, "ok", JSON.stringify({ result, seen }));
      assert.equal(result.usage?.rate_limit?.primary_window?.used_percent, 35);
    },
  );
});

test("Codex CLI login location honors CODEX_HOME", async () => {
  await withCodexHome(
    (homeDir) => {
      const codexHome = join(homeDir, "custom-codex");
      writeCodexCliAuth(codexHome, "custom-access", "custom-account");
      process.env.CODEX_HOME = codexHome;
    },
    async ({ fetchCodexUsage }) => {
      globalThis.fetch = async (_url, init = {}) => {
        const headers = new Headers(init.headers);
        if (headers.get("Authorization") === "Bearer custom-access" && headers.get("chatgpt-account-id") === "custom-account") {
          return new Response(JSON.stringify(weeklyUsage), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("denied", { status: 401 });
      };

      const result = await fetchCodexUsage();

      assert.equal(result.status, "ok");
    },
  );
});

test("Codex CLI tokens are never refreshed by pi-hud", async () => {
  await withCodexHome(
    (homeDir) => writeCodexCliAuth(join(homeDir, ".codex")),
    async ({ fetchCodexUsage }) => {
      const urls = [];
      globalThis.fetch = async (url) => {
        urls.push(String(url));
        return new Response("expired", { status: 401 });
      };

      const result = await fetchCodexUsage();

      assert.equal(result.status, "auth-needed");
      assert.match(result.message ?? "", /codex login/);
      assert.ok(!urls.some((url) => url.includes("oauth/token")), "refreshing would rotate the Codex CLI refresh token: " + urls.join(", "));
    },
  );
});

test("Codex quota windows are labelled from the reported window length", async () => {
  await withCodexHome(
    () => {},
    async ({ codexToProvider }) => {
      const provider = codexToProvider({ usage: weeklyUsage, status: "ok" });

      assert.deepEqual(
        provider.windows.map((w) => [w.label, w.usedPercent]),
        [["week", 35]],
      );

      const both = codexToProvider({
        status: "ok",
        usage: {
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_after_seconds: 1, reset_at: 1 },
            secondary_window: { used_percent: 34, limit_window_seconds: 604800, reset_after_seconds: 1, reset_at: 2 },
          },
        },
      });
      assert.deepEqual(both.windows.map((w) => [w.label, w.usedPercent]), [["5h", 12], ["week", 34]]);
    },
  );
});
