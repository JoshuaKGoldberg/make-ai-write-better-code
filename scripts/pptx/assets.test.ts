import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
	createAssets,
	cssUrls,
	imageFormat,
	imageSize,
	isNativeImage,
} from "./assets.ts";

const svg = Buffer.from(
	`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"/>`,
);

const png = Buffer.alloc(24);
png.write("\x89PNG\r\n\x1a\n", 0, "latin1");
png.write("IHDR", 12, "latin1");
png.writeUInt32BE(512, 16);
png.writeUInt32BE(256, 20);

const gif = Buffer.from("GIF89a\x40\x00\x20\x00", "latin1");

const bmp = Buffer.alloc(26);
bmp.write("BM", 0, "latin1");
bmp.writeInt32LE(30, 18);
bmp.writeInt32LE(-20, 22);

const jpeg = Buffer.from([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08,
	0x00, 0x30, 0x00, 0x40, 0x03, 0x00, 0x00, 0x00, 0x00,
]);

const webp = Buffer.alloc(30);
webp.write("RIFF", 0, "latin1");
webp.write("WEBP", 8, "latin1");
webp.write("VP8X", 12, "latin1");
webp.writeUIntLE(99, 24, 3);
webp.writeUIntLE(49, 27, 3);

const uint32 = (value: number) => {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32BE(value);
	return buffer;
};

const box = (type: string, ...contents: Buffer[]) => {
	const body = Buffer.concat(contents);
	return Buffer.concat([
		uint32(8 + body.length),
		Buffer.from(type, "latin1"),
		body,
	]);
};

const avif = Buffer.concat([
	box("ftyp", Buffer.from("avif", "latin1"), uint32(0)),
	box(
		"meta",
		uint32(0),
		box("iprp", box("ipco", box("ispe", uint32(0), uint32(70), uint32(35)))),
	),
]);

const svgOf = (attributes: string) =>
	Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`);

function createTestAssets() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pptx-assets-"));
	onTestFinished(() => {
		fs.rmSync(root, { force: true, recursive: true });
	});
	fs.mkdirSync(path.join(root, "public"));
	fs.mkdirSync(path.join(root, "images"));
	fs.writeFileSync(path.join(root, "public/a.svg"), svg);
	fs.writeFileSync(path.join(root, "images/b c.svg"), svg);
	fs.writeFileSync(path.join(root, "images/notes.txt"), "notes");
	return {
		assets: createAssets({
			publicDir: path.join(root, "public"),
			root,
			work: path.join(root, "work"),
		}),
		root,
	};
}

describe(imageFormat, () => {
	it.each([
		["png", png],
		["jpeg", jpeg],
		["gif", gif],
		["bmp", bmp],
		["webp", webp],
		["avif", avif],
		["svg", svg],
		[undefined, Buffer.from("notes")],
	])("recognizes %s", (format, data) => {
		expect(imageFormat(data)).toBe(format);
	});

	it.each([
		["a text file that starts like a BMP", Buffer.from("BMW notes")],
		["a text file that starts like a GIF", Buffer.from("GIFs I like")],
		["a truncated PNG", png.subarray(0, 8)],
	])("recognizes nothing in %s", (_, data) => {
		expect(imageFormat(data)).toBeUndefined();
	});
});

describe(isNativeImage, () => {
	it.each([
		["a PNG", png, true],
		["a JPEG", jpeg, true],
		["a WebP", webp, false],
		["an SVG", svg, false],
	])("returns whether %s is native", (_, data, native) => {
		expect(isNativeImage(data)).toBe(native);
	});
});

describe(imageSize, () => {
	it.each([
		["a PNG", png, { height: 256, width: 512 }],
		["a GIF", gif, { height: 32, width: 64 }],
		["a bottom-up BMP", bmp, { height: 20, width: 30 }],
		["a JPEG", jpeg, { height: 48, width: 64 }],
		["a WebP", webp, { height: 50, width: 100 }],
		["an SVG's view box", svg, { height: 80, width: 120 }],
		[
			"an SVG's width and height",
			svgOf(`width="2em" height="16"`),
			{ height: 16, width: 32 },
		],
		[
			"an SVG's view box when its size is a percentage",
			svgOf(`width="100%" viewBox="0 0 120 80"`),
			{ height: 80, width: 120 },
		],
		[
			"an SVG's width and view box's aspect ratio",
			svgOf(`width="60" viewBox="0 0 120 80"`),
			{ height: 40, width: 60 },
		],
		[
			"an SVG's fractional width and height",
			svgOf(`width="12.5" height="10"`),
			{ height: 10, width: 12.5 },
		],
		["an AVIF", avif, { height: 35, width: 70 }],
	])("reads the size of %s", (_, data, size) => {
		expect(imageSize(data)).toEqual(size);
	});

	it.each([
		["a truncated PNG", png.subarray(0, 8)],
		["a truncated GIF", gif.subarray(0, 4)],
		["a truncated BMP", Buffer.from("BM")],
		["a truncated JPEG", jpeg.subarray(0, 4)],
	])("returns undefined for %s", (_, data) => {
		expect(imageSize(data)).toBeUndefined();
	});
});

describe(cssUrls, () => {
	it("reads every url(), including quoted ones with parentheses", () => {
		expect(
			cssUrls(
				`url("data:image/svg+xml,<svg transform='rotate(45)'/>"), url(/a.png)`,
			),
		).toEqual(["data:image/svg+xml,<svg transform='rotate(45)'/>", "/a.png"]);
	});
});

describe(createAssets, () => {
	it.each([
		["a public file", "/a.svg"],
		["a project file, with a query", "/images/b%20c.svg?import"],
		["a data: URI", `data:image/svg+xml,${encodeURIComponent(svg.toString())}`],
		[
			"a base64 data: URI",
			`data:image/svg+xml;base64,${svg.toString("base64")}`,
		],
	])("loads %s", async (_, url) => {
		const { assets } = createTestAssets();
		expect([await assets.load(url), assets.get(url)]).toEqual([svg, svg]);
	});

	it("loads a file system path", async () => {
		const { assets, root } = createTestAssets();
		const url = `/@fs${path.join(root, "images/b c.svg")}`;
		expect(await assets.load(url)).toEqual(svg);
	});

	it("keeps a data: URI's % when it doesn't start an escape", async () => {
		const { assets } = createTestAssets();
		expect(
			(
				await assets.load(`data:image/svg+xml,<svg width='100%25 100%'/>`)
			)?.toString(),
		).toBe("<svg width='100% 100%'/>");
	});

	it("loads remote URLs", async () => {
		const { assets } = createTestAssets();
		const fetch = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("remote"));
		onTestFinished(() => {
			fetch.mockRestore();
		});
		expect((await assets.load("//example.com/a.css"))?.toString()).toBe(
			"remote",
		);
	});

	it.each([
		[
			"responds with an error",
			() => Promise.resolve(new Response("", { status: 404 })),
		],
		["rejects", () => Promise.reject(new Error("offline"))],
	])("returns undefined when a remote URL's fetch %s", async (_, respond) => {
		const { assets } = createTestAssets();
		const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(respond);
		onTestFinished(() => {
			fetch.mockRestore();
		});
		expect(await assets.load("https://example.com/a.png")).toBeUndefined();
	});

	it("saves nothing when a file isn't loaded", () => {
		const { assets } = createTestAssets();
		expect(assets.save("/a.svg")).toBeUndefined();
	});

	it("saves a loaded file named by its content and format", async () => {
		const { assets } = createTestAssets();
		await assets.load("/a.svg");
		const saved = assets.save("/a.svg") ?? "";
		expect([path.basename(saved), fs.readFileSync(saved)]).toEqual([
			"7a6e4ccb6aeb.svg",
			svg,
		]);
	});

	it("saves a loaded file with its URL's extension when it isn't an image", async () => {
		const { assets } = createTestAssets();
		await assets.load("/images/notes.txt");
		expect(path.extname(assets.save("/images/notes.txt") ?? "")).toBe(".txt");
	});

	it("returns undefined when a file is missing", async () => {
		const { assets } = createTestAssets();
		expect(await assets.load("/missing.png")).toBeUndefined();
	});
});
