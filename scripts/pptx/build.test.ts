import JSZip from "jszip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BuildPptxResult } from "./types.ts";

import { buildPptx } from "./build.ts";

describe(buildPptx, () => {
	const options = { entry: "fixture/slides.md", root: import.meta.dirname };
	let directory: string;
	let result: BuildPptxResult;
	let zip: JSZip;

	const part = async (name: string) =>
		(await zip.file(name)?.async("string")) ?? "";
	const slide = (number: number) =>
		part(`ppt/slides/slide${String(number)}.xml`);
	const shapeNames = async (number: number) =>
		[
			...(await slide(number)).matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g),
		].map(([, name]) => name);

	beforeAll(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptx-build-"));
		const out = path.join(directory, "fixture.pptx");
		result = await buildPptx({ ...options, out });
		zip = await JSZip.loadAsync(await fs.readFile(out));
	}, 120_000);

	afterAll(async () => {
		await fs.rm(directory, { force: true, recursive: true });
	});

	it("reports content it couldn't export when a slide embeds a page and a video", () => {
		expect(result).toEqual({
			problems: [
				{
					message:
						"Couldn't export an embedded page (https://example.com/embed).",
					slide: 8,
				},
				{
					message: expect.stringMatching(
						/^Couldn't export a video \(.*clip\.mp4\)\.$/,
					),
					slide: 8,
				},
			],
			slides: 8,
		});
	});

	it("writes the same bytes when built twice", async () => {
		const out = path.join(directory, "again.pptx");
		await buildPptx({ ...options, out });

		expect(
			(await fs.readFile(out)).equals(
				await fs.readFile(path.join(directory, "fixture.pptx")),
			),
		).toBe(true);
	}, 120_000);

	it("writes one slide per click state when slidePerClick is set", async () => {
		const out = path.join(directory, "clicks.pptx");

		expect(
			await buildPptx({ ...options, out, slidePerClick: true, slides: [2] }),
		).toEqual({ problems: [], slides: 3 });
	}, 120_000);

	it("throws when a slide number is out of range", async () => {
		await expect(
			buildPptx({
				...options,
				out: path.join(directory, "invalid.pptx"),
				slides: [9],
			}),
		).rejects.toThrow("Slides must be numbers from 1 to 8; got 9.");
	}, 120_000);

	it("sizes the page by the deck's canvas and aspect ratio", async () => {
		expect(await part("ppt/presentation.xml")).toContain(
			'<p:sldSz cx="9144000" cy="6858000"/>',
		);
	});

	it("names each shape by its content", async () => {
		expect(await shapeNames(3)).toEqual([
			"",
			"Text: Colors and Units",
			"Box: hsl chip",
			"Text: hsl chip",
			"Box: ok",
			"Box: named",
			"Box: mix",
			"Text: Layered: lime",
			"Text: Unlayered: teal",
			"Text: 3 / 8 · default",
		]);
	});

	it("renders global-top layers with Slidev's navigation", async () => {
		expect(await slide(5)).toContain("<a:t>5 / 8 · image-right</a:t>");
	});

	it("names fonts by the font file when the deck loads one", async () => {
		expect(await slide(2)).toContain('<a:latin typeface="League Spartan"');
	});

	it("makes each slide's first heading its title", async () => {
		expect(await slide(2)).toContain(
			'name="Text: Lists"></p:cNvPr><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr>',
		);
	});

	it("numbers an ordered list from its start", async () => {
		expect(await slide(2)).toContain(
			'<a:buAutoNum type="arabicPeriod" startAt="3"/>',
		);
	});

	it("keeps a string marker's character", async () => {
		expect(await slide(2)).toContain('<a:buChar char="&#x2192;"/>');
	});

	it("draws a keyword marker in Arial", async () => {
		expect(await slide(2)).toContain(
			'<a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="&#x25A0;"/>',
		);
	});

	it("reveals list items one paragraph at a time when they have v-click", async () => {
		expect(await slide(2)).toContain('<p:bldP spid="7" grpId="0" build="p"/>');
	});

	it("reveals a shape when it has v-click", async () => {
		expect(await slide(7)).toContain('animBg="1"/>');
	});

	it("resolves modern colors when boxes use them", async () => {
		expect(await slide(3)).toMatch(
			/1773CF.*4CB86A.*663399.*<a:srgbClr val="FF6347"><a:alpha val="50000"\/>/s,
		);
	});

	it("sizes boxes when they use viewport units", async () => {
		expect(await slide(3)).toContain('<a:ext cx="2286000" cy="365760"/>');
	});

	it("colors text by cascade layers when rules are layered", async () => {
		expect(await slide(3)).toMatch(/00FF00.*008080/s);
	});

	it("exports generated content when elements have ::before or ::after", async () => {
		expect(await slide(4)).toMatch(
			/<a:srgbClr val="DAA520"\/>.*<a:t>★<\/a:t>.*<a:ln w="45720"><a:solidFill><a:srgbClr val="FF6347"\/>/s,
		);
	});

	it("crops cover images and background images", async () => {
		expect(await slide(5)).toMatch(
			/<a:srcRect l="0" r="0" t="25000" b="25000"\/>.*<a:srcRect l="16667" r="16667" t="0" b="0"\/>/s,
		);
	});

	it("converts images to PNG when PowerPoint can't show their format", () => {
		expect(zip.file(/^ppt\/media\/.*\.svg$/)).toEqual([]);
	});

	it("plays each slide's transition into the next", async () => {
		expect({
			fade: await slide(2),
			none: await slide(6),
			push: await slide(5),
		}).toEqual({
			fade: expect.stringContaining("<p:fade/>"),
			none: expect.not.stringContaining("<p:transition"),
			push: expect.stringContaining('<p:push dir="l"/>'),
		});
	});

	it("writes a blank code line in the code's color", async () => {
		expect(await slide(7)).toMatch(
			/<a:srgbClr val="AB5959"\/><\/a:solidFill><a:latin typeface="[^"]+" pitchFamily="34" charset="0"\/><a:ea typeface="[^"]+" pitchFamily="34" charset="-122"\/><a:cs typeface="[^"]+" pitchFamily="34" charset="-120"\/><\/a:rPr><a:t> <\/a:t>/,
		);
	});

	it("leaves out text when it's fully transparent", async () => {
		expect(await slide(7)).not.toContain("Invisible text");
	});

	it("outlines an SVG circle when it has only a stroke", async () => {
		expect(await slide(7)).toContain(
			'<a:prstGeom prst="ellipse"><a:avLst></a:avLst></a:prstGeom><a:ln w="45720"><a:solidFill><a:srgbClr val="FF6347"/>',
		);
	});

	it("angles a gradient when its CSS angle is negative", async () => {
		expect(await slide(7)).toContain('<a:lin ang="19800000" scaled="1"/>');
	});

	it("keeps fractional transparency when a fill is faint", async () => {
		expect(await slide(7)).toContain('<a:alpha val="2500"/>');
	});

	it("doesn't underline a link when the browser doesn't", async () => {
		expect(await slide(7)).toContain('u="none"');
	});

	it("rounds picture corners when an image has a border radius", async () => {
		expect(await slide(7)).toMatch(
			/name="Image: Rounded photo"(?:(?!<\/p:pic>).)*<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val \d+"\/>/s,
		);
	});

	it("formats speaker notes when they use Markdown", async () => {
		expect(await part("ppt/notesSlides/notesSlide7.xml")).toMatch(
			/<a:rPr i="1" lang="en-US" dirty="0"\/><a:t>emphasis<\/a:t>.*<a:rPr b="1" lang="en-US" dirty="0"\/><a:t>bold<\/a:t>.*<a:latin typeface="[^"]+"\/><\/a:rPr><a:t>code<\/a:t>.*<a:t>A second paragraph.<\/a:t>/s,
		);
	});

	it("themes new text in the deck's colors when the deck is light", async () => {
		expect(await part("ppt/theme/theme1.xml")).toContain(
			'<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>',
		);
	});

	it("titles the file by the deck", async () => {
		expect(await part("docProps/core.xml")).toContain(
			"<dc:title>Fixture</dc:title>",
		);
	});
});
