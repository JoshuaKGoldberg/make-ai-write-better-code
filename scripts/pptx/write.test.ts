import JSZip from "jszip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FontBook } from "./fonts.ts";
import type { Deck, Item, ListItem, Run, Slide, TextItem } from "./model.ts";

import { writePptx } from "./write.ts";

const fonts: FontBook = {
	covers: () => undefined,
	load: () => Promise.resolve([]),
	metrics: () => ({ ascent: 0.8, baseline: 0.75, descent: 0.2 }),
	resolve: () => ({ bold: false, font: "Body" }),
	spacer: () => ({ advance: 0.6, font: "Mono" }),
	theme: () => "Body",
};

const run = (text: string, overrides: Partial<Run> = {}): Run => ({
	bold: false,
	color: "dae7f3",
	font: "Body",
	italic: false,
	letterSpacing: 0,
	size: 24,
	superscript: false,
	text,
	transparency: 0,
	underline: false,
	upper: false,
	...overrides,
});

const textItem = (
	paragraphs: Run[][],
	overrides: Partial<TextItem> = {},
): TextItem => ({
	baselines: [40],
	box: { h: 40, w: 400, x: 40, y: 20 },
	key: "text",
	kind: "text",
	order: 0,
	paragraphs: paragraphs.map((runs) => ({ runs })),
	rotation: 0,
	style: { align: "left", lineHeight: 36, nowrap: false },
	...overrides,
});

const listItem = (numbers: number[], marker: string): ListItem => ({
	box: { h: 80, w: 400, x: 40, y: 20 },
	key: "list",
	kind: "list",
	marker,
	order: 0,
	paragraphs: numbers.map((number) => ({
		baselines: [],
		bullet: true,
		number,
		runs: [run(`Item ${String(number)}`)],
		visible: true,
	})),
	style: { align: "left", lineHeight: 36, nowrap: false },
});

describe(writePptx, () => {
	let directory: string;
	const background = fileURLToPath(
		new URL("fixture/assets/local.png", import.meta.url),
	);

	beforeAll(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptx-write-"));
	});

	afterAll(async () => {
		await fs.rm(directory, { force: true, recursive: true });
	});

	const deckOf = (slides: Partial<Slide>[], overrides: Partial<Deck> = {}) => ({
		aspectRatio: 16 / 9,
		author: "Author",
		background: { color: "101010", file: background },
		canvas: { height: 540, width: 960 },
		slides: slides.map((slide, index) => ({
			notes: "",
			number: index + 1,
			states: [],
			...slide,
		})),
		title: "Title",
		...overrides,
	});

	const write = async (deck: Deck, slidePerClick = false) => {
		const out = path.join(directory, `${String(Math.random())}.pptx`);
		await writePptx({ deck, fonts, out, slidePerClick });
		return fs.readFile(out);
	};

	const writeItems = async (items: Item[]) =>
		JSZip.loadAsync(await write(deckOf([{ states: [{ clicks: 0, items }] }])));

	const slideXml = async (items: Item[]) =>
		(await writeItems(items)).file("ppt/slides/slide1.xml")?.async("string");

	it("writes the same bytes when written twice", async () => {
		const deck = deckOf([
			{ states: [{ clicks: 0, items: [textItem([[run("Same")]])] }] },
		]);

		expect((await write(deck)).equals(await write(deck))).toBe(true);
	});

	it("strips control characters when text has them", async () => {
		const xml = await slideXml([textItem([[run("a\u0007b")]])]);

		expect(xml).toContain('name="Text: ab"');
		expect(xml).toContain("<a:t>ab</a:t>");
	});

	it("cuts long names at a word with an ellipsis", async () => {
		expect(
			await slideXml([
				textItem([
					[
						run(
							"Every word of this text makes the name much longer than it could be",
						),
					],
				]),
			]),
		).toContain('name="Text: Every word of this text makes the name…"');
	});

	it("numbers names when shapes would share one", async () => {
		expect(
			await slideXml([
				textItem([[run("Twice")]], { key: "a" }),
				textItem([[run("Twice")]], { key: "b", order: 1 }),
			]),
		).toContain('name="Text: Twice (2)"');
	});

	it("styles a blank paragraph like the text when it has no runs", async () => {
		expect(
			await slideXml([
				{
					baselines: [40, 76, 112],
					box: { h: 108, w: 400, x: 40, y: 20 },
					key: "code",
					kind: "code",
					order: 0,
					paragraphs: [
						{ runs: [run("one", { color: "ab5959", font: "Mono" })] },
						{ runs: [] },
						{ runs: [run("two", { font: "Mono" })] },
					],
					style: { align: "left", lineHeight: 36, nowrap: true },
				},
			]),
		).toContain(
			'<a:p><a:pPr algn="l" indent="0" marL="0"><a:lnSpc><a:spcPct val="125000"/></a:lnSpc><a:buNone/></a:pPr><a:r><a:rPr lang="en-US" kern="100" sz="2400" dirty="0"><a:solidFill><a:srgbClr val="AB5959"/></a:solidFill><a:latin typeface="Mono" pitchFamily="34" charset="0"/><a:ea typeface="Mono" pitchFamily="34" charset="-122"/><a:cs typeface="Mono" pitchFamily="34" charset="-120"/></a:rPr><a:t> </a:t></a:r><a:endParaRPr lang="en-US" kern="100" sz="2400" dirty="0"><a:solidFill><a:srgbClr val="AB5959"/></a:solidFill><a:latin typeface="Mono" pitchFamily="34" charset="0"/><a:ea typeface="Mono" pitchFamily="34" charset="-122"/><a:cs typeface="Mono" pitchFamily="34" charset="-120"/></a:endParaRPr></a:p>',
		);
	});

	it("outlines an ellipse when it has a border", async () => {
		expect(
			await slideXml([
				{
					border: { color: "ff6347", transparency: 0, width: 4 },
					box: { h: 40, w: 40, x: 10, y: 10 },
					key: "ring",
					kind: "ellipse",
					order: 0,
				},
			]),
		).toContain(
			'<a:prstGeom prst="ellipse"><a:avLst></a:avLst></a:prstGeom><a:ln w="50800"><a:solidFill><a:srgbClr val="FF6347"/></a:solidFill>',
		);
	});

	it("doesn't underline a link when its text isn't underlined", async () => {
		expect(
			await slideXml([textItem([[run("Link", { href: "https://sli.dev" })]])]),
		).toContain('<a:rPr lang="en-US" kern="100" sz="2400" u="none" dirty="0">');
	});

	it("keeps a real color when it's one a gradient placeholder would use", async () => {
		const xml = await slideXml([
			{
				box: { h: 10, w: 10, x: 0, y: 0 },
				fill: { color: "fea000", transparency: 0 },
				key: "solid",
				kind: "box",
				order: 0,
				radius: 0,
				rotation: 0,
			},
			{
				box: { h: 10, w: 10, x: 20, y: 0 },
				fill: {
					color: "0000ff",
					gradient: {
						angle: 90,
						stops: [
							{ hex: "ff0000", position: 0, transparency: 0 },
							{ hex: "0000ff", position: 100, transparency: 50 },
						],
					},
					transparency: 0,
				},
				key: "gradient",
				kind: "box",
				order: 1,
				radius: 0,
				rotation: 0,
			},
		]);

		expect(xml).toContain(
			'<a:solidFill><a:srgbClr val="FEA000"/></a:solidFill>',
		);
		expect(xml).toContain(
			'<a:gradFill flip="none" rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"><a:alpha val="50000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>',
		);
	});

	it.each([
		["decimal", 'indent="-350520"'],
		["lower-roman", 'indent="-853440"'],
	])("leaves hanging room for the widest %s number", async (marker, indent) => {
		expect(await slideXml([listItem([7, 8], marker)])).toContain(indent);
	});

	it("draws keyword markers in Arial when a list has them", async () => {
		expect(await slideXml([listItem([1], "disc")])).toContain(
			'<a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="&#x25CF;"/>',
		);
	});

	it("hides a marker when a list's marker is an empty string", async () => {
		expect(await slideXml([listItem([1], '""')])).toContain(
			'<a:buSzPct val="100000"/><a:buChar char="&#x00A0;"/>',
		);
	});

	it("makes a slide's first heading its title", async () => {
		expect(
			await slideXml([
				textItem([[run("Body")]], { key: "body" }),
				textItem([[run("Heading")]], { heading: true, key: "a", order: 1 }),
				textItem([[run("Later")]], { heading: true, key: "b", order: 2 }),
			]),
		).toMatch(
			/name="Text: Heading"><\/p:cNvPr><p:cNvSpPr><a:spLocks noGrp="1"\/><\/p:cNvSpPr><p:nvPr><p:ph type="title"\/><\/p:nvPr>.*name="Text: Later"><\/p:cNvPr><p:cNvSpPr txBox="1"\/><p:nvPr><\/p:nvPr>/s,
		);
	});

	it("themes text, background, links, and fonts by what the deck uses most", async () => {
		const zip = await writeItems([
			textItem([[run("Heading", { font: "Heading" })]], {
				heading: true,
				key: "heading",
			}),
			textItem(
				[
					[
						run("Most of the body text"),
						run("a link", { color: "3366cc", href: "https://sli.dev" }),
					],
				],
				{ key: "body", order: 1 },
			),
		]);
		const theme = await zip.file("ppt/theme/theme1.xml")?.async("string");

		expect(theme).toContain(
			'<a:clrScheme name="Office"><a:dk1><a:srgbClr val="101010"/></a:dk1><a:lt1><a:srgbClr val="DAE7F3"/></a:lt1><a:dk2><a:srgbClr val="101010"/></a:dk2><a:lt2><a:srgbClr val="DAE7F3"/></a:lt2>',
		);
		expect(theme).toContain(
			'<a:hlink><a:srgbClr val="3366CC"/></a:hlink><a:folHlink><a:srgbClr val="3366CC"/></a:folHlink>',
		);
		expect(theme).toContain('<a:majorFont><a:latin typeface="Heading"/>');
		expect(theme).toContain('<a:minorFont><a:latin typeface="Body"/>');
	});

	it("maps text to the light color when the background is dark", async () => {
		const zip = await writeItems([textItem([[run("Light")]])]);

		expect(
			await zip.file("ppt/slideMasters/slideMaster1.xml")?.async("string"),
		).toContain('<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"');
	});

	it("puts the background on the master when it writes the one layout", async () => {
		const zip = await writeItems([]);

		expect({
			layouts: zip.file(/^ppt\/slideLayouts\/[^/]+$/).map(({ name }) => name),
			master: await zip
				.file("ppt/slideMasters/slideMaster1.xml")
				?.async("string"),
		}).toEqual({
			layouts: ["ppt/slideLayouts/slideLayout1.xml"],
			master: expect.stringContaining(
				'<p:cSld><p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId3"/>',
			),
		});
	});

	it("writes no folder entries or company", async () => {
		const zip = await writeItems([]);

		expect({
			app: await zip.file("docProps/app.xml")?.async("string"),
			folders: Object.values(zip.files).filter(({ dir }) => dir),
		}).toEqual({
			app: expect.stringContaining("<Company></Company>"),
			folders: [],
		});
	});

	it("splits notes into formatted paragraphs", async () => {
		const zip = await JSZip.loadAsync(
			await write(
				deckOf([
					{
						notes: "One *two* **three** `four`\n\nFive",
						states: [{ clicks: 0, items: [] }],
					},
				]),
			),
		);

		expect(
			await zip.file("ppt/notesSlides/notesSlide1.xml")?.async("string"),
		).toContain(
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>One </a:t></a:r><a:r><a:rPr i="1" lang="en-US" dirty="0"/><a:t>two</a:t></a:r><a:r><a:rPr lang="en-US" dirty="0"/><a:t> </a:t></a:r><a:r><a:rPr b="1" lang="en-US" dirty="0"/><a:t>three</a:t></a:r><a:r><a:rPr lang="en-US" dirty="0"/><a:t> </a:t></a:r><a:r><a:rPr lang="en-US" dirty="0"><a:latin typeface="Mono"/></a:rPr><a:t>four</a:t></a:r></a:p><a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Five</a:t></a:r></a:p>',
		);
	});

	it("writes one slide per click state when slidePerClick is set", async () => {
		const zip = await JSZip.loadAsync(
			await write(
				deckOf([
					{
						states: [
							{ clicks: 0, items: [] },
							{ clicks: 1, items: [textItem([[run("Shown")]])] },
						],
					},
				]),
				true,
			),
		);

		expect({
			first: await zip.file("ppt/slides/slide1.xml")?.async("string"),
			second: await zip.file("ppt/slides/slide2.xml")?.async("string"),
		}).toEqual({
			first: expect.not.stringContaining("Shown"),
			second: expect.stringContaining("<a:t>Shown</a:t>"),
		});
	});

	it("fades shapes in when a click shows them", async () => {
		const zip = await JSZip.loadAsync(
			await write(
				deckOf([
					{
						states: [
							{ clicks: 0, items: [] },
							{ clicks: 1, items: [textItem([[run("Shown")]])] },
						],
					},
				]),
			),
		);

		expect(await zip.file("ppt/slides/slide1.xml")?.async("string")).toContain(
			'<p:par><p:cTn id="3" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">',
		);
	});
});
