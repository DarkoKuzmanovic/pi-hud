import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function compileToTemp() {
	const outDir = mkdtempSync(join(tmpdir(), "pi-hud-snap-build-"));
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
			"usage-snapshot.ts",
			"types.ts",
		],
		{ cwd: resolve("."), stdio: "pipe" },
	);
	return outDir;
}

// Seed a pi-hud ProviderUsage: the reader preserves its icon/name/id.
const prev = {
	id: "anthropic",
	name: "Claude",
	icon: "\uee0d",
	status: "unknown",
	message: "loading",
	windows: [{ label: "5h" }, { label: "week" }],
};

function writeSnapshot(stateDir, snapshot) {
	const dir = join(stateDir, "usage");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "current.json"), JSON.stringify(snapshot));
}

test("readSnapshotProvider maps, gates staleness, and falls back", async () => {
	const buildDir = compileToTemp();
	const stateDir = mkdtempSync(join(tmpdir(), "pi-hud-snap-state-"));
	const prevXdg = process.env.XDG_STATE_HOME;
	process.env.XDG_STATE_HOME = stateDir;

	try {
		const { readSnapshotProvider } = await import(
			`${pathToFileURL(join(buildDir, "usage-snapshot.js")).href}?${Date.now()}`
		);

		// Space `now` past the module's 1s parse cache between cases.
		let clock = 1_000_000_000_000;
		const tick = () => (clock += 5_000);

		// 1. Missing file -> null (native fallback).
		assert.equal(readSnapshotProvider("anthropic", prev, { now: tick() }), null);

		// 2. Malformed JSON -> null.
		mkdirSync(join(stateDir, "usage"), { recursive: true });
		writeFileSync(join(stateDir, "usage", "current.json"), "{ not json");
		assert.equal(readSnapshotProvider("anthropic", prev, { now: tick() }), null);

		// 3. Unsupported schema version -> null.
		writeSnapshot(stateDir, {
			schemaVersion: 2,
			collectionFinishedAt: new Date(clock).toISOString(),
			providers: [],
		});
		assert.equal(readSnapshotProvider("anthropic", prev, { now: tick() }), null);

		// 4. Fresh ok provider -> full mapping.
		const now = tick();
		const resetAt = new Date(now + 3_600_000).toISOString();
		writeSnapshot(stateDir, {
			schemaVersion: 1,
			collectionFinishedAt: new Date(now).toISOString(),
			providers: [
				{
					id: "anthropic",
					name: "anthropic",
					state: "ok",
					status: "healthy",
					updatedAt: new Date(now).toISOString(),
					windows: [
						{ id: "5h", label: "5h", usedPercent: 42, used: 21, limit: 50, resetAt },
						{ id: "7d", label: "Week", usedPercent: 10 },
						{ id: "mystery", label: "??" },
					],
					concurrency: { used: 2, limit: 5 },
				},
			],
		});
		const ok = readSnapshotProvider("anthropic", prev, { now });
		assert.ok(ok);
		assert.equal(ok.status, "ok");
		assert.equal(ok.message, "healthy");
		assert.equal(ok.icon, prev.icon); // identity preserved from prev
		assert.equal(ok.name, prev.name);
		assert.equal(ok.updatedAt, now);
		assert.equal(ok.concurrency.used, 2);
		assert.equal(ok.concurrency.limit, 5);
		// "mystery" window id is dropped; 5h + 7d(->week) survive.
		assert.deepEqual(
			ok.windows.map((w) => w.label),
			["5h", "week"],
		);
		const fiveH = ok.windows[0];
		assert.equal(fiveH.usedPercent, 42);
		assert.equal(fiveH.usedCount, 21);
		assert.equal(fiveH.limitCount, 50);
		assert.equal(fiveH.resetAt, Date.parse(resetAt));

		// 5. Stale snapshot (finished > maxStaleMs ago) -> null.
		const staleNow = tick();
		writeSnapshot(stateDir, {
			schemaVersion: 1,
			collectionFinishedAt: new Date(staleNow - 20 * 60_000).toISOString(),
			providers: [{ id: "anthropic", name: "anthropic", state: "ok", windows: [] }],
		});
		assert.equal(readSnapshotProvider("anthropic", prev, { now: staleNow }), null);

		// 6. Provider absent this tick -> null.
		const absentNow = tick();
		writeSnapshot(stateDir, {
			schemaVersion: 1,
			collectionFinishedAt: new Date(absentNow).toISOString(),
			providers: [{ id: "codex", name: "codex", state: "ok", windows: [] }],
		});
		assert.equal(readSnapshotProvider("anthropic", prev, { now: absentNow }), null);

		// 7. State variants map to pi-hud status.
		for (const [state, status] of [
			["stale", "unknown"],
			["auth-needed", "auth-needed"],
			["error", "error"],
		]) {
			const t = tick();
			writeSnapshot(stateDir, {
				schemaVersion: 1,
				collectionFinishedAt: new Date(t).toISOString(),
				providers: [{ id: "anthropic", name: "anthropic", state, windows: [] }],
			});
			const mapped = readSnapshotProvider("anthropic", prev, { now: t });
			assert.ok(mapped, `state ${state} should map`);
			assert.equal(mapped.status, status);
			// No windows in snapshot -> prev windows retained.
			assert.deepEqual(
				mapped.windows.map((w) => w.label),
				["5h", "week"],
			);
		}
	} finally {
		if (prevXdg === undefined) delete process.env.XDG_STATE_HOME;
		else process.env.XDG_STATE_HOME = prevXdg;
		rmSync(buildDir, { recursive: true, force: true });
		rmSync(stateDir, { recursive: true, force: true });
	}
});
