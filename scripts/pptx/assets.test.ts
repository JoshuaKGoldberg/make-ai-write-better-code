import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createAssets, imageFormat, imageSize } from "./assets.ts";

const svg = Buffer.from(
	`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"/>`,
);

describe(imageSize, () => {
	it("reads a PNG's size", () => {
		const png = Buffer.alloc(24);
		png.writeUInt32BE(0x89504e47, 0);
		png.writeUInt32BE(512, 16);
		png.writeUInt32BE(256, 20);
		expect(imageFormat(png)).toBe("png");
		expect(imageSize(png)).toEqual({ h: 256, w: 512 });
	});

	it("reads an SVG's size from its view box", () => {
		expect(imageFormat(svg)).toBe("svg");
		expect(imageSize(svg)).toEqual({ h: 80, w: 120 });
	});
});

describe(createAssets, () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pptx-assets-"));
	fs.mkdirSync(path.join(root, "public"));
	fs.mkdirSync(path.join(root, "images"));
	fs.writeFileSync(path.join(root, "public/a.svg"), svg);
	fs.writeFileSync(path.join(root, "images/b c.svg"), svg);
	const assets = createAssets({
		publicDir: path.join(root, "public"),
		root,
		work: path.join(root, "work"),
	});

	it.each([
		["a public file", "/a.svg"],
		["a project file, with a query", "/images/b%20c.svg?import"],
		["a file system path", `/@fs${path.join(root, "images/b c.svg")}`],
		["a data: URI", `data:image/svg+xml,${encodeURIComponent(svg.toString())}`],
		[
			"a base64 data: URI",
			`data:image/svg+xml;base64,${svg.toString("base64")}`,
		],
	])("loads %s", async (_, url) => {
		expect(await assets.load(url)).toEqual(svg);
		expect(assets.get(url)).toEqual(svg);
	});

	it("saves loaded files by content", async () => {
		await assets.load("/a.svg");
		const saved = assets.save("/a.svg");
		expect(saved).toMatch(/[\da-f]{12}\.svg$/);
		expect(saved && fs.readFileSync(saved)).toEqual(svg);
	});

	it("returns undefined for missing files", async () => {
		expect(await assets.load("/missing.png")).toBeUndefined();
	});
});
