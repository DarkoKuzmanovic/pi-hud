import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HUD_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function compileToTemp() {
	const outDir = mkdtempSync(join(tmpdir(), "pi-hud-tps-test-build-"));
	execFileSync(
		join(HUD_DIR, "node_modules", ".bin", "tsc"),
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
			"token-speed.ts",
		],
		{ cwd: HUD_DIR, stdio: "pipe" },
	);
	return outDir;
}

async function loadTracker() {
	const buildDir = compileToTemp();
	const mod = await import(`${pathToFileURL(join(buildDir, "token-speed.js")).href}?t=${Date.now()}`);
	return { TokenSpeedTracker: mod.TokenSpeedTracker, buildDir };
}

function nearlyEqual(actual, expected, message) {
	assert.ok(Math.abs(actual - expected) < 0.000001, `${message}: expected ${expected}, got ${actual}`);
}

test("idle tracker reports zero TPS and not streaming", async () => {
	const { TokenSpeedTracker, buildDir } = await loadTracker();
	try {
		const tracker = new TokenSpeedTracker();
		const snap = tracker.snapshot(1000);
		assert.equal(snap.isStreaming, false);
		assert.equal(snap.tokenCount, 0);
		assert.equal(snap.elapsedMs, 0);
		assert.equal(snap.tps, 0);
		assert.equal(snap.averageTps, 0);
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
});

test("uses cumulative average while the sliding window is still filling", async () => {
	const { TokenSpeedTracker, buildDir } = await loadTracker();
	try {
		const tracker = new TokenSpeedTracker({ windowMs: 1000 });
		tracker.start(0);
		tracker.recordToken(0);
		tracker.recordToken(150);
		tracker.recordToken(300);

		const snap = tracker.snapshot(300);

		assert.equal(snap.isStreaming, true);
		assert.equal(snap.tokenCount, 3);
		assert.equal(snap.elapsedMs, 300);
		nearlyEqual(snap.tps, 10, "cumulative tps");
		nearlyEqual(snap.averageTps, 10, "average tps");
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
});

test("uses a fixed one-second sliding window after the window fills", async () => {
	const { TokenSpeedTracker, buildDir } = await loadTracker();
	try {
		const tracker = new TokenSpeedTracker({ windowMs: 1000 });
		tracker.start(0);
		tracker.recordToken(0);
		tracker.recordToken(900);

		const snap = tracker.snapshot(1000);

		assert.equal(snap.isStreaming, true);
		assert.equal(snap.tokenCount, 2);
		nearlyEqual(snap.tps, 2, "window tps");
		nearlyEqual(snap.averageTps, 2, "average tps");
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
});

test("discards tokens older than the sliding window", async () => {
	const { TokenSpeedTracker, buildDir } = await loadTracker();
	try {
		const tracker = new TokenSpeedTracker({ windowMs: 1000 });
		tracker.start(0);
		tracker.recordToken(0);
		tracker.recordToken(100);
		tracker.recordToken(1200);
		tracker.recordToken(1300);

		const snap = tracker.snapshot(1300);

		assert.equal(snap.isStreaming, true);
		assert.equal(snap.tokenCount, 4);
		nearlyEqual(snap.tps, 2, "window tps counts only two recent tokens over one second");
		nearlyEqual(snap.averageTps, 4 / 1.3, "average tps still uses all tokens");
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
});

test("stop freezes the final cumulative average", async () => {
	const { TokenSpeedTracker, buildDir } = await loadTracker();
	try {
		const tracker = new TokenSpeedTracker({ windowMs: 1000 });
		tracker.start(0);
		tracker.recordToken(0);
		tracker.recordToken(400);
		tracker.recordToken(800);

		const snap = tracker.stop(1000);
		const after = tracker.snapshot(5000);

		assert.equal(snap.isStreaming, false);
		assert.equal(snap.tokenCount, 3);
		nearlyEqual(snap.tps, 3, "final tps");
		nearlyEqual(snap.averageTps, 3, "final average");
		assert.equal(after.isStreaming, false);
		nearlyEqual(after.tps, 3, "stopped snapshot tps");
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
});

test("recordToken is a no-op when not streaming", async () => {
	const { TokenSpeedTracker, buildDir } = await loadTracker();
	try {
		const tracker = new TokenSpeedTracker();
		tracker.recordToken(100);
		tracker.recordToken(200);

		const snap = tracker.snapshot(300);

		assert.equal(snap.isStreaming, false);
		assert.equal(snap.tokenCount, 0);
		assert.equal(snap.tps, 0);
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
});

test("multiple start and stop cycles are independent", async () => {
	const { TokenSpeedTracker, buildDir } = await loadTracker();
	try {
		const tracker = new TokenSpeedTracker();

		tracker.start(0);
		tracker.recordToken(0);
		tracker.recordToken(200);
		const first = tracker.stop(200);

		tracker.start(1000);
		tracker.recordToken(1000);
		tracker.recordToken(1100);
		tracker.recordToken(1200);
		const second = tracker.stop(1200);

		assert.equal(first.tokenCount, 2);
		nearlyEqual(first.tps, 10, "first session tps");
		assert.equal(second.tokenCount, 3);
		nearlyEqual(second.tps, 15, "second session tps");
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
});
