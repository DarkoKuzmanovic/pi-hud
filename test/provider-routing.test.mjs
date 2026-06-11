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
      "provider-routing.ts",
      "types.ts",
    ],
    { cwd: resolve("."), stdio: "pipe" },
  );
  return outDir;
}

test("active provider routing maps MiniMax and Codex explicitly", async () => {
  const buildDir = compileToTemp();
  try {
    const { resolveProviderId } = await import(
      `${pathToFileURL(join(buildDir, "provider-routing.js")).href}?${Date.now()}`
    );

    assert.equal(resolveProviderId("minimax"), "minimax");
    assert.equal(resolveProviderId("minimax-cn"), "minimax");
    assert.equal(resolveProviderId("openai-codex"), "codex");
    assert.equal(resolveProviderId("codex"), "codex");
    assert.equal(resolveProviderId("mimo"), undefined);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});
