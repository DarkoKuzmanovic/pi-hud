import test from "node:test";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HUD_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function runBunAssertions(source) {
	execFileSync("bun", ["--silent", "-e", source], {
		cwd: HUD_DIR,
		stdio: "pipe",
	});
}

test("terminal ghost sprite renders a wide visor and teal cloak accents", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { inflateSync } = await import("node:zlib");
		const { moodPng } = await import("./sprite.ts");

		function decodePng(base64) {
			const png = Buffer.from(base64, "base64");
			assert.default.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
			const width = png.readUInt32BE(16);
			const height = png.readUInt32BE(20);
			let offset = 8;
			const idat = [];
			while (offset < png.length) {
				const len = png.readUInt32BE(offset);
				const type = png.subarray(offset + 4, offset + 8).toString("ascii");
				if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + len));
				offset += 12 + len;
			}
			const raw = inflateSync(Buffer.concat(idat));
			const rgba = Buffer.alloc(width * height * 4);
			for (let y = 0; y < height; y++) {
				const src = y * (width * 4 + 1);
				assert.default.equal(raw[src], 0);
				raw.copy(rgba, y * width * 4, src + 1, src + 1 + width * 4);
			}
			return { width, height, rgba };
		}

		const { width, height, rgba } = decodePng(moodPng("idle", 96));
		const visorY = Math.floor(height * 0.46);
		let longestDarkRun = 0;
		let currentDarkRun = 0;
		for (let x = Math.floor(width * 0.25); x < Math.floor(width * 0.75); x++) {
			const i = (visorY * width + x) * 4;
			const isDark = rgba[i] < 25 && rgba[i + 1] < 35 && rgba[i + 2] < 45 && rgba[i + 3] > 220;
			currentDarkRun = isDark ? currentDarkRun + 1 : 0;
			longestDarkRun = Math.max(longestDarkRun, currentDarkRun);
		}
		assert.default.ok(longestDarkRun >= Math.floor(width * 0.28), "expected wide terminal visor, got dark run " + longestDarkRun);

		let tealPixels = 0;
		for (let i = 0; i < rgba.length; i += 4) {
			const r = rgba[i];
			const g = rgba[i + 1];
			const b = rgba[i + 2];
			const a = rgba[i + 3];
			if (a > 220 && r < 80 && g > 110 && b > 100) tealPixels++;
		}
		assert.default.ok(tealPixels >= Math.floor(width * height * 0.09), "expected teal cloak mass, got " + tealPixels + " pixels");
	`);
});


test("cute robot mascot follows the reference-inspired polished robot palette", () => {
	runBunAssertions(String.raw`
		const assert = await import("node:assert/strict");
		const { inflateSync } = await import("node:zlib");
		const { moodPng } = await import("./sprite.ts");

		function decodePng(base64) {
			const png = Buffer.from(base64, "base64");
			const width = png.readUInt32BE(16);
			const height = png.readUInt32BE(20);
			let offset = 8;
			const idat = [];
			while (offset < png.length) {
				const len = png.readUInt32BE(offset);
				const type = png.subarray(offset + 4, offset + 8).toString("ascii");
				if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + len));
				offset += 12 + len;
			}
			const raw = inflateSync(Buffer.concat(idat));
			const rgba = Buffer.alloc(width * height * 4);
			for (let y = 0; y < height; y++) {
				const src = y * (width * 4 + 1);
				raw.copy(rgba, y * width * 4, src + 1, src + 1 + width * 4);
			}
			return { width, height, rgba };
		}

		const ghost = moodPng("idle", 96, "teal-ghost");
		const robot = moodPng("idle", 96, "cute-robot");
		assert.default.notEqual(robot, ghost);
		assert.default.ok(Buffer.from(robot, "base64").length > 350, "robot PNG should contain detailed artwork");

		const { width, height, rgba } = decodePng(robot);
		let whiteShell = 0;
		let navyOutline = 0;
		let cyanGlow = 0;
		for (let i = 0; i < rgba.length; i += 4) {
			const r = rgba[i];
			const g = rgba[i + 1];
			const b = rgba[i + 2];
			const a = rgba[i + 3];
			if (a > 200 && r > 220 && g > 230 && b > 235) whiteShell++;
			if (a > 180 && r < 70 && g < 130 && b > 55 && b < 190) navyOutline++;
			if (a > 200 && r < 90 && g > 190 && b > 210) cyanGlow++;
		}
		const area = width * height;
		assert.default.ok(whiteShell >= Math.floor(area * 0.035), "expected glossy white robot shell, got " + whiteShell + " pixels");
		assert.default.ok(navyOutline >= Math.floor(area * 0.08), "expected navy vector outline, got " + navyOutline + " pixels");
		assert.default.ok(cyanGlow >= Math.floor(area * 0.01), "expected cyan visor/eye glow, got " + cyanGlow + " pixels");

		const working = decodePng(moodPng("working", 96, "cute-robot"));
		let changedPixels = 0;
		for (let i = 0; i < rgba.length; i += 4) {
			const dr = Math.abs(rgba[i] - working.rgba[i]);
			const dg = Math.abs(rgba[i + 1] - working.rgba[i + 1]);
			const db = Math.abs(rgba[i + 2] - working.rgba[i + 2]);
			const da = Math.abs(rgba[i + 3] - working.rgba[i + 3]);
			if (dr + dg + db + da > 40) changedPixels++;
		}
		assert.default.ok(changedPixels >= Math.floor(area * 0.08), "expected spritesheet pose change, got " + changedPixels + " changed pixels");


		const success = decodePng(moodPng("success", 96, "cute-robot"));
		let greenExpression = 0;
		for (let i = 0; i < success.rgba.length; i += 4) {
			const r = success.rgba[i];
			const g = success.rgba[i + 1];
			const b = success.rgba[i + 2];
			const a = success.rgba[i + 3];
			if (a > 160 && r > 90 && r < 190 && g > 150 && b < 190) greenExpression++;
		}
		assert.default.ok(greenExpression >= Math.floor(area * 0.009), "expected success frame to use the green up-eye pose, got " + greenExpression + " pixels");
	`);
});
