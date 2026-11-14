import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createAssets, cssUrls, imageFormat, imageSize } from "./assets.ts";

const svg = Buffer.from(
	`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"/>`,
);

const png = Buffer.alloc(24);
png.writeUInt32BE(0x89504e47, 0);
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

const avif = Buffer.alloc(16);
avif.write("ftyp", 4, "latin1");
avif.write("avif", 8, "latin1");

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
});

describe(imageSize, () => {
	it.each([
		["a PNG", png, { h: 256, w: 512 }],
		["a GIF", gif, { h: 32, w: 64 }],
		["a bottom-up BMP", bmp, { h: 20, w: 30 }],
		["a JPEG", jpeg, { h: 48, w: 64 }],
		["a WebP", webp, { h: 50, w: 100 }],
		["an SVG's view box", svg, { h: 80, w: 120 }],
		[
			"an SVG's width and height",
			svgOf(`width="2em" height="16"`),
			{ h: 16, w: 32 },
		],
		[
			"an SVG's view box when its size is a percentage",
			svgOf(`width="100%" viewBox="0 0 120 80"`),
			{ h: 80, w: 120 },
		],
		[
			"an SVG's width and view box's aspect ratio",
			svgOf(`width="60" viewBox="0 0 120 80"`),
			{ h: 40, w: 60 },
		],
	])("reads the size of %s", (_, data, size) => {
		expect(imageSize(data)).toEqual(size);
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
