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
				{
					click: 0,
					message: "<span> has 2 children but takumi measured 4: ab\u200B",
					slide: 11,
				},
				{
					click: 0,
					message:
						"<li> has 3 children but takumi measured 2: Term: description Sub item",
					slide: 12,
				},
				{
					click: 0,
					message: "<h1> has 2 children but takumi measured 1: Inline Content",
					slide: 13,
				},
			],
			slides: 14,
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
				slides: [15],
			}),
		).rejects.toThrow("Slides must be numbers from 1 to 14; got 15.");
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
			"Text: 3 / 14 · default",
		]);
	});

	it("renders global-top layers with Slidev's navigation", async () => {
		expect(await slide(5)).toContain("<a:t>5 / 14 · image-right</a:t>");
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

	it("nests a sub-list's items a level deeper when list items have them", async () => {
		expect(await slide(12)).toMatch(
			/<a:pPr algn="l" lvl="1"[^>]*>(?:(?!<\/a:p>).)*<a:t>Child<\/a:t>/s,
		);
	});

	it("keeps a list item's text when it has inline formatting and a sub-list", async () => {
		expect(await slide(12)).toMatch(
			/<a:t>Term<\/a:t>.*<a:t>: description<\/a:t>.*lvl="1".*<a:t>Sub item<\/a:t>/s,
		);
	});

	it("numbers an item after a nested list from its own number", async () => {
		expect(await slide(12)).toMatch(
			/<a:buAutoNum type="arabicPeriod" startAt="2"\/>(?:(?!<\/a:p>).)*<a:t>Second<\/a:t>/s,
		);
	});

	it("marks each item when a list's items are paragraphs", async () => {
		expect(await slide(12)).toMatch(
			/<a:buChar char="&#x25CF;"\/>(?:(?!<\/a:p>).)*<a:t>Loose two<\/a:t>/s,
		);
	});

	it("draws an item's own marker when its list has none", async () => {
		expect(await slide(12)).toMatch(
			/<a:buChar char="&#x25A0;"\/>(?:(?!<\/a:p>).)*<a:t>Own marker<\/a:t>/s,
		);
	});

	it("renders an icon when it's inline in a heading", async () => {
		expect(await shapeNames(13)).toContain("Rendered: icon");
	});

	it("keeps no-break spaces when text has them", async () => {
		expect(await slide(13)).toContain("<a:t>x\u00A0\u00A0\u00A0y</a:t>");
	});

	it("lowers a subscript when text has one", async () => {
		expect(await slide(13)).toMatch(
			/baseline="-40000"(?:(?!<\/a:r>).)*<a:t>2<\/a:t>/s,
		);
	});

	it("leaves out text when it's clipped away", async () => {
		expect(await slide(13)).not.toContain("Clipped away");
	});

	it("colors text like its parent when its own color doesn't parse", async () => {
		expect(await slide(13)).toMatch(
			/<a:srgbClr val="123456"\/>(?:(?!<\/a:r>).)*<a:t>Parent color<\/a:t>/s,
		);
	});

	it("shadows text when its shadow has unitless offsets", async () => {
		expect(await slide(13)).toMatch(
			/name="Text: Glow"(?:(?!<\/p:sp>).)*<a:effectLst>/s,
		);
	});

	it("resolves padding percentages against the parent's width", async () => {
		expect(await slide(13)).toMatch(
			/name="Text: Percent padding"(?:(?!<\/p:sp>).)*<a:off x="457200"/s,
		);
	});

	it("fades an SVG shape once when it has an opacity attribute", async () => {
		expect(await slide(14)).toContain(
			'<a:prstGeom prst="ellipse"><a:avLst></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FF6347"><a:alpha val="50000"/>',
		);
	});

	it("fills an SVG shape from its group when the group sets a fill", async () => {
		expect(await slide(14)).toMatch(
			/name="Shape: Shapes"(?:(?!<\/p:sp>).)*<a:srgbClr val="008080"\/>/s,
		);
	});

	it("renders pictures when PowerPoint can't draw shapes or backgrounds natively", async () => {
		expect(await shapeNames(14)).toEqual(
			expect.arrayContaining([
				"Rendered: Turned",
				"Rendered: Radial",
				"Rendered: Tiled",
			]),
		);
	});

	it("frames an image when it has a border and background", async () => {
		expect(await shapeNames(14)).toEqual(
			expect.arrayContaining(["Box: framed", "Image: Framed photo"]),
		);
	});

	it("names a box by its first block when it holds several", async () => {
		expect(await shapeNames(14)).toContain("Box: Card title");
	});

	it("titles the file by the deck", async () => {
		expect(await part("docProps/core.xml")).toContain(
			"<dc:title>Fixture</dc:title>",
		);
	});
});
