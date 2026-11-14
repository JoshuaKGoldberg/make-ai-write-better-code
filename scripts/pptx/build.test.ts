import JSZip from "jszip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import type { Deck, ImageItem, Item, ListItem, TextItem } from "./model.ts";

import { buildPptx } from "./build.ts";

// The fixture deck exercises what this deck doesn't: a light 4:3 canvas, installed fonts,
// numbered and string-marked lists, modern colors, cascade layers, generated content,
// background and imported images, per-slide transitions, and a global-top layer.
describe(buildPptx, () => {
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "pptx-fixture-"));
	const out = path.join(work, "fixture.pptx");
	let deck: Deck;
	let zip: JSZip;
	let problems: string[];

	const items = (no: number): Item[] =>
		deck.slides[no].states.at(-1)?.items ?? [];
	const texts = (no: number) =>
		items(no)
			.filter((item): item is TextItem => item.kind === "text")
			.map((item) => item.paragraphs.flatMap((p) => p.runs));

	beforeAll(async () => {
		({ problems } = await buildPptx({
			entry: "fixture/slides.md",
			out,
			root: import.meta.dirname,
			work,
		}));
		deck = JSON.parse(
			fs.readFileSync(path.join(work, "model.json"), "utf8"),
		) as Deck;
		zip = await JSZip.loadAsync(fs.readFileSync(out));
	}, 120_000);

	it("lays out without problems", () => {
		expect(problems).toEqual([]);
	});

	it("sizes the page by the deck's canvas and aspect ratio", async () => {
		expect(deck.canvas).toEqual({ height: 600, width: 800 });
		expect(await zip.file("ppt/presentation.xml")?.async("string")).toContain(
			'<p:sldSz cx="9144000" cy="6858000"/>',
		);
	});

	it("renders global-top layers with Slidev's navigation", () => {
		expect(
			texts(5)
				.flat()
				.map((run) => run.text),
		).toContain("5 / 6 · image-right");
	});

	it("uses installed fonts by name", () => {
		expect(texts(2)[0][0].font).toBe("Georgia");
	});

	it("numbers ordered lists and keeps string markers", () => {
		const lists = items(2).filter(
			(item): item is ListItem => item.kind === "list",
		);
		expect(
			lists.map((list) => [list.marker, list.paragraphs.map((p) => p.number)]),
		).toEqual([
			["none", [3, 4]],
			[`"\\2192  "`, [1, 2]],
			["square", [1]],
			["lower-alpha", [1, 2]],
		]);
	});

	it("resolves modern colors, viewport units, and cascade layers", () => {
		const fills = items(3).flatMap((item) =>
			item.kind === "box" && item.fill
				? [[item.fill.color, Math.round(item.box.w)]]
				: [],
		);
		expect(fills).toEqual([
			["1773cf", expect.any(Number)],
			["4cb86a", 200],
			["663399", 160],
			["ff6347", 240],
		]);
		expect(texts(3).map((runs) => runs[0].color)).toContain("00ff00");
		expect(texts(3).map((runs) => runs[0].color)).toContain("008080");
	});

	it("exports generated content", () => {
		expect(
			texts(4)
				.flat()
				.map((run) => [run.text, run.color]),
		).toContainEqual(["★ ", "daa520"]);
		expect(
			items(4).some(
				(item) => item.kind === "box" && item.border?.color === "ff6347",
			),
		).toBe(true);
	});

	it("crops cover images and background images", () => {
		const images = items(5).filter(
			(item): item is ImageItem => item.kind === "image",
		);
		expect(images.map((image) => [image.src, Boolean(image.crop)])).toEqual([
			["/photo.png", true],
			[expect.stringMatching(/^data:image\/svg\+xml,/), false],
			["/assets/local.png", false],
			["/photo.png", true],
		]);
		// The SVG became a PNG.
		expect(fs.readFileSync(images[1].file).readUInt32BE(0)).toBe(0x89504e47);
	});

	it("plays each slide's transition into the next", async () => {
		expect(Object.values(deck.slides).map((slide) => slide.transition)).toEqual(
			[undefined, "fade", "fade", "fade", "slide-left", "none"],
		);
		expect(await zip.file("ppt/slides/slide5.xml")?.async("string")).toContain(
			'<p:push dir="l"/>',
		);
	});
});
