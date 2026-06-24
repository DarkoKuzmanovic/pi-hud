// Mascot sprite: mood-driven faces rendered either as Kitty graphics PNGs
// (procedural teal ghost or cropped robot spritesheet frames) or ASCII art fallback.
//
// sprite.ts owns only the *art* — ASCII strings, spritesheet parsing, and raw PNG bytes. The Kitty
// transmission/encoding + image-id caching lives in render/shelf.ts, which has
// the terminal capabilities and cell dimensions.

import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

export type Mood = "idle" | "working" | "tool" | "success" | "error" | "sleeping";
export type MascotId = "teal-ghost" | "cute-robot";

export const MOODS: readonly Mood[] = [
	"idle",
	"working",
	"tool",
	"success",
	"error",
	"sleeping",
];

interface RGB {
	r: number;
	g: number;
	b: number;
}

const MOOD_COLOR: Record<Mood, RGB> = {
	idle: { r: 95, g: 175, b: 255 },
	working: { r: 255, g: 175, b: 0 },
	tool: { r: 255, g: 135, b: 0 },
	success: { r: 135, g: 215, b: 135 },
	error: { r: 215, g: 95, b: 95 },
	sleeping: { r: 130, g: 130, b: 130 },
};

/** ANSI 256 color per mood, used to tint the ASCII fallback face. */
export const MOOD_ANSI: Record<Mood, number> = {
	idle: 111,
	working: 214,
	tool: 208,
	success: 114,
	error: 167,
	sleeping: 245,
};

const MOOD_FACE: Record<Mood, string> = {
	idle: "▰_▰",
	working: "▰>▰",
	tool: "▣_▣",
	success: "^▰^",
	error: "×_×",
	sleeping: "-▰-",
};

// --- ASCII fallback -------------------------------------------------------

/** Three-line ASCII face box (uncolored). Caller tints/places it. */
export function asciiFace(mood: Mood): string[] {
	const face = MOOD_FACE[mood];
	return ["╭───╮", `│${face}│`, "╰───╯"];
}

export function asciiFaceWidth(): number {
	return 5; // "╭───╮"
}

// --- Minimal PNG encoder (RGBA, 8-bit, no interlace) ----------------------

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, "ascii");
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode an RGBA pixel buffer (length w*h*4) as a PNG, returned base64. */
function encodePng(rgba: Buffer, w: number, h: number): string {
	const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr.writeUInt8(8, 8); // bit depth
	ihdr.writeUInt8(6, 9); // color type: RGBA
	ihdr.writeUInt8(0, 10); // compression
	ihdr.writeUInt8(0, 11); // filter
	ihdr.writeUInt8(0, 12); // interlace

	// Raw scanlines: each row prefixed with filter-type byte 0.
	const stride = w * 4;
	const raw = Buffer.alloc((stride + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (stride + 1)] = 0;
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
	}
	const idat = deflateSync(raw);

	return Buffer.concat([
		sig,
		chunk("IHDR", ihdr),
		chunk("IDAT", idat),
		chunk("IEND", Buffer.alloc(0)),
	]).toString("base64");
}

interface RgbaImage {
	width: number;
	height: number;
	rgba: Buffer;
}

function decodePngRgba(png: Buffer): RgbaImage {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (let i = 0; i < signature.length; i++) {
		if (png[i] !== signature[i]) throw new Error("Invalid PNG signature");
	}
	const width = png.readUInt32BE(16);
	const height = png.readUInt32BE(20);
	const bitDepth = png[24];
	const colorType = png[25];
	if (bitDepth !== 8 || colorType !== 6) throw new Error("Only 8-bit RGBA PNG spritesheets are supported");

	let offset = 8;
	const idat: Buffer[] = [];
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.subarray(offset + 4, offset + 8).toString("ascii");
		if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
		offset += 12 + length;
	}
	const raw = inflateSync(Buffer.concat(idat));
	const bytesPerPixel = 4;
	const stride = width * bytesPerPixel;
	const rgba = Buffer.alloc(width * height * 4);
	let previous = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const rowStart = y * (stride + 1);
		const filter = raw[rowStart];
		const source = raw.subarray(rowStart + 1, rowStart + 1 + stride);
		const row = Buffer.alloc(stride);
		for (let i = 0; i < stride; i++) {
			const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
			const up = previous[i] ?? 0;
			const upLeft = i >= bytesPerPixel ? (previous[i - bytesPerPixel] ?? 0) : 0;
			let value = source[i] ?? 0;
			if (filter === 1) value = (value + left) & 0xff;
			else if (filter === 2) value = (value + up) & 0xff;
			else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff;
			else if (filter === 4) {
				const predictor = left + up - upLeft;
				const pa = Math.abs(predictor - left);
				const pb = Math.abs(predictor - up);
				const pc = Math.abs(predictor - upLeft);
				const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
				value = (value + paeth) & 0xff;
			} else if (filter !== 0) {
				throw new Error(`Unsupported PNG filter ${filter}`);
			}
			row[i] = value;
		}
		row.copy(rgba, y * stride);
		previous = row;
	}
	return { width, height, rgba };
}

// --- Procedural face drawing ----------------------------------------------

function setPx(buf: Buffer, w: number, x: number, y: number, c: RGB, a = 255): void {
	if (x < 0 || y < 0 || x >= w) return;
	const i = (y * w + x) * 4;
	if (i < 0 || i + 3 >= buf.length) return;
	buf[i] = c.r;
	buf[i + 1] = c.g;
	buf[i + 2] = c.b;
	buf[i + 3] = a;
}

function fillCircle(buf: Buffer, w: number, cx: number, cy: number, r: number, c: RGB): void {
	const r2 = r * r;
	for (let y = cy - r; y <= cy + r; y++) {
		for (let x = cx - r; x <= cx + r; x++) {
			const dx = x - cx;
			const dy = y - cy;
			if (dx * dx + dy * dy <= r2) setPx(buf, w, x, y, c);
		}
	}
}


function drawLine(buf: Buffer, w: number, x0: number, y0: number, x1: number, y1: number, c: RGB, thick = 1): void {
	const dx = Math.abs(x1 - x0);
	const dy = Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx - dy;
	let x = x0;
	let y = y0;
	for (;;) {
		for (let ox = 0; ox < thick; ox++) {
			for (let oy = 0; oy < thick; oy++) setPx(buf, w, x + ox, y + oy, c);
		}
		if (x === x1 && y === y1) break;
		const e2 = 2 * err;
		if (e2 > -dy) {
			err -= dy;
			x += sx;
		}
		if (e2 < dx) {
			err += dx;
			y += sy;
		}
	}
}

const OUTLINE: RGB = { r: 15, g: 23, b: 42 };
const VISOR: RGB = { r: 9, g: 9, b: 11 };
const TEAL_CLOAK: RGB = { r: 15, g: 118, b: 110 };
const TEAL_LIGHT: RGB = { r: 20, g: 184, b: 166 };
const TEAL_EDGE: RGB = { r: 153, g: 246, b: 228 };
const CYAN: RGB = { r: 103, g: 232, b: 249 };
const VIOLET_SPARK: RGB = { r: 240, g: 171, b: 252 };
const AMBER: RGB = { r: 250, g: 204, b: 21 };

type Point = readonly [number, number];

function lighten(c: RGB, amount: number): RGB {
	return {
		r: Math.min(255, c.r + amount),
		g: Math.min(255, c.g + amount),
		b: Math.min(255, c.b + amount),
	};
}

function darken(c: RGB, amount: number): RGB {
	return {
		r: Math.max(0, c.r - amount),
		g: Math.max(0, c.g - amount),
		b: Math.max(0, c.b - amount),
	};
}

function fillRect(buf: Buffer, w: number, x: number, y: number, width: number, height: number, c: RGB): void {
	for (let yy = y; yy < y + height; yy++) {
		for (let xx = x; xx < x + width; xx++) setPx(buf, w, xx, yy, c);
	}
}

function fillRoundedRect(buf: Buffer, w: number, x: number, y: number, width: number, height: number, radius: number, c: RGB): void {
	const r = Math.max(1, radius);
	fillRect(buf, w, x + r, y, Math.max(0, width - r * 2), height, c);
	fillRect(buf, w, x, y + r, width, Math.max(0, height - r * 2), c);
	fillCircle(buf, w, x + r, y + r, r, c);
	fillCircle(buf, w, x + width - r - 1, y + r, r, c);
	fillCircle(buf, w, x + r, y + height - r - 1, r, c);
	fillCircle(buf, w, x + width - r - 1, y + height - r - 1, r, c);
}

function fillPolygon(buf: Buffer, w: number, points: readonly Point[], c: RGB): void {
	if (points.length < 3) return;
	const ys = points.map(([, y]) => y);
	const minY = Math.floor(Math.min(...ys));
	const maxY = Math.ceil(Math.max(...ys));
	for (let y = minY; y <= maxY; y++) {
		const intersections: number[] = [];
		let previous = points[points.length - 1];
		if (!previous) return;
		for (const current of points) {
			const [xi, yi] = current;
			const [xj, yj] = previous;
			if ((yi > y) !== (yj > y)) intersections.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
			previous = current;
		}
		intersections.sort((a, b) => a - b);
		for (let i = 0; i + 1 < intersections.length; i += 2) {
			const start = intersections[i];
			const end = intersections[i + 1];
			if (start === undefined || end === undefined) continue;
			for (let x = Math.floor(start); x <= Math.ceil(end); x++) setPx(buf, w, x, y, c);
		}
	}
}

function outlinePolygon(buf: Buffer, w: number, points: readonly Point[], c: RGB, thick: number): void {
	if (points.length < 2) return;
	let previous = points[points.length - 1];
	if (!previous) return;
	for (const current of points) {
		drawLine(buf, w, previous[0], previous[1], current[0], current[1], c, thick);
		previous = current;
	}
}

function moodAccent(mood: Mood): RGB {
	if (mood === "idle") return CYAN;
	if (mood === "sleeping") return { r: 148, g: 163, b: 184 };
	return lighten(MOOD_COLOR[mood], 25);
}

/**
 * Generate the teal terminal ghost PNG for a mood at the given pixel size.
 */
function tealGhostPng(mood: Mood, size: number): string {
	const w = size;
	const h = size;
	const buf = Buffer.alloc(w * h * 4); // transparent
	const accent = moodAccent(mood);
	const edge = mood === "idle" ? TEAL_EDGE : lighten(MOOD_COLOR[mood], 75);
	const cloak = mood === "sleeping" ? { r: 71, g: 85, b: 105 } : TEAL_CLOAK;
	const cloakLight = mood === "sleeping" ? { r: 100, g: 116, b: 139 } : TEAL_LIGHT;
	const cloakDark = mood === "sleeping" ? { r: 51, g: 65, b: 85 } : darken(TEAL_CLOAK, 35);
	const top = Math.floor(size * 0.08);
	const artH = Math.floor(size * 0.78);
	const sx = (x: number): number => Math.round((x / 128) * w);
	const sy = (y: number): number => Math.round(top + (y / 96) * artH);
	const sc = (n: number): number => Math.max(1, Math.round((n / 128) * w));
	const pt = (x: number, y: number): Point => [sx(x), sy(y)];
	const pts = (items: readonly Point[]): Point[] => items.map(([x, y]) => pt(x, y));

	const body = pts([
		[31, 28],
		[64, 10],
		[97, 28],
		[103, 71],
		[91, 64],
		[80, 82],
		[66, 69],
		[54, 84],
		[43, 67],
		[28, 76],
		[24, 54],
	]);
	const hood = pts([
		[31, 28],
		[64, 10],
		[97, 28],
		[86, 34],
		[64, 23],
		[42, 34],
	]);

	// Cloak silhouette: dark rim first, then teal body and lighter folded hood.
	outlinePolygon(buf, w, body, OUTLINE, sc(5));
	fillPolygon(buf, w, body, cloak);
	fillPolygon(buf, w, pts([[64, 10], [97, 28], [64, 23]]), cloakLight);
	fillPolygon(buf, w, hood, cloakLight);
	fillPolygon(buf, w, pts([[31, 28], [42, 34], [28, 76], [24, 54]]), cloakDark);
	outlinePolygon(buf, w, body, edge, sc(3));

	// Hood folds and jagged cloak points.
	drawLine(buf, w, sx(34), sy(31), sx(29), sy(55), cloakDark, sc(2));
	drawLine(buf, w, sx(95), sy(32), sx(101), sy(68), cloakDark, sc(2));
	drawLine(buf, w, sx(45), sy(67), sx(55), sy(82), edge, sc(2));
	drawLine(buf, w, sx(66), sy(70), sx(80), sy(82), edge, sc(2));

	// Three tiny runes on the hood read as "magical terminal" detail.
	for (const [x, y] of [pt(48, 28), pt(60, 25), pt(75, 28)]) {
		fillRect(buf, w, x - sc(3), y, sc(7), sc(2), TEAL_EDGE);
		fillRect(buf, w, x - sc(1), y - sc(2), sc(2), sc(7), TEAL_EDGE);
	}

	// Dark terminal visor with scanlines.
	const vx = sx(38);
	const vy = sy(35);
	const vw = sx(91) - vx;
	const vh = sy(66) - vy;
	fillRoundedRect(buf, w, vx, vy, vw, vh, sc(6), OUTLINE);
	fillRoundedRect(buf, w, vx + sc(3), vy + sc(3), vw - sc(6), vh - sc(6), sc(5), VISOR);
	fillRect(buf, w, vx + sc(7), vy + sc(8), vw - sc(14), sc(2), darken(accent, 75));
	fillRect(buf, w, vx + sc(7), vy + sc(16), vw - sc(14), sc(1), darken(accent, 80));

	const leftEyeX = sx(51);
	const rightEyeX = sx(70);
	const eyeY = sy(43);
	const eyeW = sc(8);
	const eyeH = sc(5);
	switch (mood) {
		case "sleeping":
			drawLine(buf, w, leftEyeX, eyeY + sc(2), leftEyeX + eyeW, eyeY + sc(2), accent, sc(2));
			drawLine(buf, w, rightEyeX, eyeY + sc(2), rightEyeX + eyeW, eyeY + sc(2), accent, sc(2));
			break;
		case "error":
			drawLine(buf, w, leftEyeX, eyeY, leftEyeX + eyeW, eyeY + eyeH, accent, sc(2));
			drawLine(buf, w, leftEyeX + eyeW, eyeY, leftEyeX, eyeY + eyeH, accent, sc(2));
			drawLine(buf, w, rightEyeX, eyeY, rightEyeX + eyeW, eyeY + eyeH, accent, sc(2));
			drawLine(buf, w, rightEyeX + eyeW, eyeY, rightEyeX, eyeY + eyeH, accent, sc(2));
			break;
		case "success":
			drawLine(buf, w, leftEyeX, eyeY + eyeH, leftEyeX + Math.floor(eyeW / 2), eyeY, accent, sc(2));
			drawLine(buf, w, leftEyeX + Math.floor(eyeW / 2), eyeY, leftEyeX + eyeW, eyeY + eyeH, accent, sc(2));
			drawLine(buf, w, rightEyeX, eyeY + eyeH, rightEyeX + Math.floor(eyeW / 2), eyeY, accent, sc(2));
			drawLine(buf, w, rightEyeX + Math.floor(eyeW / 2), eyeY, rightEyeX + eyeW, eyeY + eyeH, accent, sc(2));
			break;
		case "working":
			drawLine(buf, w, leftEyeX, eyeY, leftEyeX + eyeW, eyeY + sc(2), accent, sc(3));
			drawLine(buf, w, rightEyeX, eyeY + sc(2), rightEyeX + eyeW, eyeY, accent, sc(3));
			break;
		default:
			fillRect(buf, w, leftEyeX, eyeY, eyeW, eyeH, accent);
			fillRect(buf, w, rightEyeX, eyeY, eyeW, eyeH, accent);
			break;
	}

	// Prompt glyph inside the visor.
	const promptX = sx(49);
	const promptY = sy(56);
	drawLine(buf, w, promptX, promptY, promptX + sc(5), promptY + sc(4), AMBER, sc(2));
	drawLine(buf, w, promptX + sc(5), promptY + sc(4), promptX, promptY + sc(8), AMBER, sc(2));
	fillRect(buf, w, promptX + sc(11), promptY + sc(8), sc(12), sc(2), AMBER);

	// Floating code brackets and spark nodes around the cloak.
	drawLine(buf, w, sx(17), sy(28), sx(9), sy(36), edge, sc(2));
	drawLine(buf, w, sx(9), sy(36), sx(17), sy(44), edge, sc(2));
	drawLine(buf, w, sx(111), sy(51), sx(119), sy(59), edge, sc(2));
	drawLine(buf, w, sx(119), sy(59), sx(111), sy(67), edge, sc(2));
	drawLine(buf, w, sx(93), sy(35), sx(112), sy(24), CYAN, sc(2));
	fillCircle(buf, w, sx(115), sy(23), sc(3), CYAN);
	drawLine(buf, w, sx(107), sy(14), sx(107), sy(28), CYAN, sc(1));
	drawLine(buf, w, sx(100), sy(21), sx(114), sy(21), CYAN, sc(1));
	fillCircle(buf, w, sx(116), sy(35), sc(2), VIOLET_SPARK);
	fillCircle(buf, w, sx(22), sy(59), sc(2), CYAN);

	return encodePng(buf, w, h);
}


const ROBOT_FRAME_INDEX: Record<Mood, number> = {
	idle: 0,
	working: 1,
	tool: 2,
	success: 3,
	error: 4,
	sleeping: 5,
};

let robotSpritesheet: RgbaImage | null | undefined;
const robotPngCache = new Map<string, string>();

function loadRobotSpritesheet(): RgbaImage | null {
	if (robotSpritesheet !== undefined) return robotSpritesheet;
	try {
		robotSpritesheet = decodePngRgba(readFileSync(new URL("./assets/robot-spritesheet.png", import.meta.url)));
	} catch {
		robotSpritesheet = null;
	}
	return robotSpritesheet;
}

function sampleImage(image: RgbaImage, x: number, y: number): RGB & { a: number } {
	const clampedX = Math.max(0, Math.min(image.width - 1, x));
	const clampedY = Math.max(0, Math.min(image.height - 1, y));
	const i = (clampedY * image.width + clampedX) * 4;
	return {
		r: image.rgba[i] ?? 0,
		g: image.rgba[i + 1] ?? 0,
		b: image.rgba[i + 2] ?? 0,
		a: image.rgba[i + 3] ?? 0,
	};
}

function writeBilinearSample(out: Buffer, outIndex: number, image: RgbaImage, x: number, y: number): void {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = x0 + 1;
	const y1 = y0 + 1;
	const fx = x - x0;
	const fy = y - y0;
	const samples = [
		{ pixel: sampleImage(image, x0, y0), weight: (1 - fx) * (1 - fy) },
		{ pixel: sampleImage(image, x1, y0), weight: fx * (1 - fy) },
		{ pixel: sampleImage(image, x0, y1), weight: (1 - fx) * fy },
		{ pixel: sampleImage(image, x1, y1), weight: fx * fy },
	];
	let alpha = 0;
	let red = 0;
	let green = 0;
	let blue = 0;
	for (const { pixel, weight } of samples) {
		const weightedAlpha = pixel.a * weight;
		alpha += weightedAlpha;
		red += pixel.r * weightedAlpha;
		green += pixel.g * weightedAlpha;
		blue += pixel.b * weightedAlpha;
	}
	out[outIndex + 3] = Math.round(alpha);
	if (alpha > 0) {
		out[outIndex] = Math.round(red / alpha);
		out[outIndex + 1] = Math.round(green / alpha);
		out[outIndex + 2] = Math.round(blue / alpha);
	}
}

function spriteSheetRobotPng(mood: Mood, size: number): string | null {
	const sheet = loadRobotSpritesheet();
	if (!sheet) return null;
	const frameCount = MOODS.length;
	const sourceW = Math.floor(sheet.width / frameCount);
	const sourceH = sheet.height;
	const sourceX = ROBOT_FRAME_INDEX[mood] * sourceW;
	const scale = Math.min(size / sourceW, size / sourceH);
	const destW = Math.max(1, Math.round(sourceW * scale));
	const destH = Math.max(1, Math.round(sourceH * scale));
	const offsetX = Math.floor((size - destW) / 2);
	const offsetY = Math.floor((size - destH) / 2);
	const out = Buffer.alloc(size * size * 4);
	for (let y = 0; y < destH; y++) {
		for (let x = 0; x < destW; x++) {
			const srcX = sourceX + (x + 0.5) / scale - 0.5;
			const srcY = (y + 0.5) / scale - 0.5;
			writeBilinearSample(out, ((offsetY + y) * size + offsetX + x) * 4, sheet, srcX, srcY);
		}
	}
	return encodePng(out, size, size);
}

function cuteRobotPng(mood: Mood, size: number): string {
	const key = `${mood}:${size}`;
	const cached = robotPngCache.get(key);
	if (cached) return cached;
	const png = spriteSheetRobotPng(mood, size) ?? tealGhostPng(mood, size);
	robotPngCache.set(key, png);
	return png;
}

/** Generate a mascot PNG for a mood at the given pixel size, returned as base64. */
export function moodPng(mood: Mood, size = 54, mascot: MascotId = "teal-ghost"): string {
	return mascot === "cute-robot" ? cuteRobotPng(mood, size) : tealGhostPng(mood, size);
}
