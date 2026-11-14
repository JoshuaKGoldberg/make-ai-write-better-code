import JSZip from "jszip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FontBook } from "./fonts.ts";
import type {
	Deck,
	ImageItem,
	Item,
	ListItem,
	ListParagraph,
	Run,
	Slide,
	TextItem,
} from "./model.ts";

import { writePptx } from "./write.ts";

const fonts: FontBook = {
	load: () => Promise.resolve([]),
	metrics: () => ({ ascent: 0.8, baseline: 0.75, descent: 0.2 }),
	missingFamilies: () => Promise.resolve([]),
	resolve: () => ({ bold: false, font: "Body" }),
	spacer: () => ({ advance: 0.6, font: "Mono" }),
};

const photo = fileURLToPath(
	new URL("fixture/public/photo.png", import.meta.url),
);

const style = { align: "left", availableWidth: 880, lineHeight: 36 } as const;

const run = (text: string, overrides: Partial<Run> = {}): Run => ({
	bold: false,
	color: "dae7f3",
	font: "Body",
	italic: false,
	letterSpacing: 0,
	pad: false,
	size: 24,
	strike: false,
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
	box: { height: 40, width: 400, x: 40, y: 20 },
	decorative: false,
	heading: false,
	key: "text",
	kind: "text",
	paragraphs: paragraphs.map((runs) => ({ runs })),
	rotation: 0,
	style: { ...style, nowrap: false, wrapWidth: 400 },
	...overrides,
});

const listParagraph = (
	text: string,
	overrides: Partial<ListParagraph> = {},
): ListParagraph => ({
	baselines: [],
	bullet: true,
	indent: 0,
	level: 0,
	marker: "disc",
	number: 1,
	runs: [run(text)],
	visible: true,
	...overrides,
});

const listItem = (
	paragraphs: ListParagraph[],
	overrides: Partial<ListItem> = {},
): ListItem => ({
	box: { height: 80, width: 400, x: 40, y: 20 },
	decorative: false,
	key: "list",
	kind: "list",
	paragraphs,
	style: { ...style, nowrap: false },
	...overrides,
});

const firstLevel = (xml: string | undefined, style: string) => {
	const match = new RegExp(
		`<${style}>.*?<a:lvl1pPr\\b[^>]*algn="(\\w+)"[^>]*>(.*?)</a:lvl1pPr>`,
		"s",
	).exec(xml ?? "");
	return match ? { align: match[1], properties: match[2] } : undefined;
};

const numberedList = (numbers: number[], marker: string) =>
	listItem(
		numbers.map((number) =>
			listParagraph(`Item ${String(number)}`, { marker, number }),
		),
	);

type BoxItem = Extract<Item, { kind: "box" }>;

const boxItem = (overrides: Partial<BoxItem> = {}): BoxItem => ({
	box: { height: 10, width: 10, x: 0, y: 0 },
	decorative: false,
	key: "box",
	kind: "box",
	radius: 0,
	rotation: 0,
	...overrides,
});

const imageItem = (overrides: Partial<ImageItem> = {}): ImageItem => ({
	alt: "A photo",
	box: { height: 100, width: 200, x: 0, y: 0 },
	decorative: false,
	file: photo,
	key: "image",
	kind: "image",
	radius: 0,
	src: "/photo.png",
	transparency: 0,
	...overrides,
});

describe(writePptx, () => {
	let directory: string;
	let background: string;
	let written = 0;

	beforeAll(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptx-write-"));
		background = path.join(directory, "background.png");
		await fs.writeFile(
			background,
			Buffer.concat([await fs.readFile(photo), Buffer.from([0])]),
		);
	});

	afterAll(async () => {
		await fs.rm(directory, { force: true, recursive: true });
	});

	const deckOf = (slides: Partial<Slide>[]): Deck => ({
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
		title: "Deck Title",
	});

	const write = async (deck: Deck, slidePerClick = false) => {
		const out = path.join(directory, `${String(written++)}.pptx`);
		const result = await writePptx({ deck, fonts, out, slidePerClick });
		return { file: await fs.readFile(out), result };
	};

	const writeZip = async (deck: Deck, slidePerClick = false) =>
		JSZip.loadAsync((await write(deck, slidePerClick)).file);

	const writeItems = (items: Item[]) =>
		writeZip(deckOf([{ states: [{ clicks: 0, items }] }]));

	const part = (zip: JSZip, name: string) => zip.file(name)?.async("string");

	const slideXml = async (items: Item[]) =>
		part(await writeItems(items), "ppt/slides/slide1.xml");

	const notesXml = async (notes: string) =>
		part(
			await writeZip(deckOf([{ notes, states: [{ clicks: 0, items: [] }] }])),
			"ppt/notesSlides/notesSlide1.xml",
		);

	it("writes the same bytes when written twice", async () => {
		const deck = deckOf([
			{ states: [{ clicks: 0, items: [textItem([[run("Same")]])] }] },
		]);

		expect((await write(deck)).file.equals((await write(deck)).file)).toBe(
			true,
		);
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
				textItem([[run("Twice")]], { key: "b" }),
			]),
		).toContain('name="Text: Twice (2)"');
	});

	it("styles a blank paragraph like the text when it has no runs", async () => {
		expect(
			await slideXml([
				{
					baselines: [40, 76, 112],
					box: { height: 108, width: 400, x: 40, y: 20 },
					decorative: false,
					key: "code",
					kind: "code",
					paragraphs: [
						{ runs: [run("one", { color: "ab5959", font: "Mono" })] },
						{ runs: [] },
						{ runs: [run("two", { font: "Mono" })] },
					],
					style: { ...style, nowrap: true },
				},
			]),
		).toContain(
			'<a:p><a:pPr algn="l" indent="0" marL="0"><a:lnSpc><a:spcPct val="125000"/></a:lnSpc><a:buNone/></a:pPr><a:r><a:rPr lang="en-US" kern="100" sz="2400" dirty="0"><a:solidFill><a:srgbClr val="AB5959"/></a:solidFill><a:latin typeface="Mono" pitchFamily="34" charset="0"/><a:ea typeface="Mono" pitchFamily="34" charset="-122"/><a:cs typeface="Mono" pitchFamily="34" charset="-120"/></a:rPr><a:t> </a:t></a:r><a:endParaRPr lang="en-US" kern="100" sz="2400" dirty="0"><a:solidFill><a:srgbClr val="AB5959"/></a:solidFill><a:latin typeface="Mono" pitchFamily="34" charset="0"/><a:ea typeface="Mono" pitchFamily="34" charset="-122"/><a:cs typeface="Mono" pitchFamily="34" charset="-120"/></a:endParaRPr></a:p>',
		);
	});

	it("throws when a text item has no runs", async () => {
		await expect(slideXml([textItem([[]])])).rejects.toThrow(
			"Text items need at least one run.",
		);
	});

	it("outlines an ellipse when it has a border", async () => {
		expect(
			await slideXml([
				{
					border: { color: "ff6347", transparency: 0, width: 4 },
					box: { height: 40, width: 40, x: 10, y: 10 },
					decorative: false,
					key: "ring",
					kind: "ellipse",
				},
			]),
		).toContain(
			'<a:prstGeom prst="ellipse"><a:avLst></a:avLst></a:prstGeom><a:ln w="50800"><a:solidFill><a:srgbClr val="FF6347"/></a:solidFill>',
		);
	});

	it("draws no line when a box has no border", async () => {
		expect(
			await slideXml([boxItem({ fill: { color: "ff0000", transparency: 0 } })]),
		).toContain(
			'<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln><a:noFill/></a:ln>',
		);
	});

	it("doesn't underline a link when its text isn't underlined", async () => {
		expect(
			await slideXml([textItem([[run("Link", { href: "https://sli.dev" })]])]),
		).toContain('<a:rPr lang="en-US" kern="100" sz="2400" u="none" dirty="0">');
	});

	it("strikes a run through when it's struck", async () => {
		expect(
			await slideXml([textItem([[run("Gone", { strike: true })]])]),
		).toContain('<a:rPr lang="en-US" kern="100" sz="2400" strike="sngStrike"');
	});

	it("capitalizes a run without its stand-in language when it's uppercase", async () => {
		expect(
			await slideXml([textItem([[run("Loud", { upper: true })]])]),
		).toContain(
			'<a:rPr lang="en-US" kern="100" cap="all" sz="2400" dirty="0">',
		);
	});

	it("kerns a run when it's letter-spaced", async () => {
		expect(
			await slideXml([textItem([[run("Wide", { letterSpacing: 2 })]])]),
		).toContain(
			'<a:rPr lang="en-US" sz="2400" spc="200" kern="100" dirty="0">',
		);
	});

	it("keeps a real color when it's one a gradient placeholder would use", async () => {
		const xml = await slideXml([
			boxItem({ fill: { color: "fea000", transparency: 0 }, key: "solid" }),
			boxItem({
				box: { height: 10, width: 10, x: 20, y: 0 },
				fill: {
					color: "0000ff",
					gradient: {
						angle: 90,
						stops: [
							{ color: "ff0000", position: 0, transparency: 0 },
							{ color: "0000ff", position: 100, transparency: 50 },
						],
					},
					transparency: 0,
				},
				key: "gradient",
			}),
		]);

		expect(xml).toContain(
			'<a:solidFill><a:srgbClr val="FEA000"/></a:solidFill>',
		);
		expect(xml).toContain(
			'<a:gradFill flip="none" rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"><a:alpha val="50000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill>',
		);
	});

	it.each([
		["decimal", 'indent="-350520"'],
		["lower-roman", 'indent="-853440"'],
	])("leaves hanging room for the widest %s number", async (marker, indent) => {
		expect(await slideXml([numberedList([7, 8], marker)])).toContain(indent);
	});

	it("draws keyword markers in Arial when a list has them", async () => {
		expect(await slideXml([numberedList([1], "disc")])).toContain(
			'<a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="&#x25CF;"/>',
		);
	});

	it("hides a marker when a list's marker is an empty string", async () => {
		expect(await slideXml([numberedList([1], '""')])).toContain(
			'<a:buSzPct val="100000"/><a:buChar char="&#x00A0;"/>',
		);
	});

	it("styles each paragraph's marker when a disc list nests a numbered one", async () => {
		const xml = await slideXml([
			listItem([
				listParagraph("Outer"),
				listParagraph("Inner", { indent: 24, level: 1, marker: "decimal" }),
			]),
		]);

		expect(xml?.match(/<a:pPr\b.*?<\/a:pPr>/g)).toEqual([
			'<a:pPr algn="l" marL="228600" indent="-228600"><a:lnSpc><a:spcPct val="125000"/></a:lnSpc><a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="&#x25CF;"/></a:pPr>',
			'<a:pPr algn="l" lvl="1" marL="533400" indent="-266700"><a:lnSpc><a:spcPct val="125000"/></a:lnSpc><a:buSzPct val="100000"/><a:buFontTx/><a:buAutoNum type="arabicPeriod" startAt="1"/></a:pPr>',
		]);
	});

	it("draws a nested keyword marker in Arial when a numbered list has one", async () => {
		const xml = await slideXml([
			listItem([
				listParagraph("Outer", { marker: "decimal" }),
				listParagraph("Inner", { indent: 24, level: 1, marker: "circle" }),
			]),
		]);

		expect(xml?.match(/<a:bu\w.*?(?=<\/a:pPr>)/g)).toEqual([
			'<a:buSzPct val="100000"/><a:buFontTx/><a:buAutoNum type="arabicPeriod" startAt="1"/>',
			'<a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="&#x25CB;"/>',
		]);
	});

	it("colors only shown markers when a list's markers have a color", async () => {
		const xml = await slideXml([
			listItem(
				[listParagraph("Shown"), listParagraph("Continued", { bullet: false })],
				{ bulletColor: "ff0000" },
			),
		]);

		expect(xml?.match(/<a:bu\w.*?(?=<\/a:pPr>)/g)).toEqual([
			'<a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="&#x25CF;"/>',
			'<a:buSzPct val="100000"/><a:buChar char="&#x00A0;"/>',
		]);
	});

	it("colors a string marker in the text's font when a list has one", async () => {
		expect(
			await slideXml([
				listItem([listParagraph("Arrow", { marker: '"→"' })], {
					bulletColor: "ff0000",
				}),
			]),
		).toContain(
			'<a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPct val="100000"/><a:buChar char="&#x2192;"/>',
		);
	});

	it("nests a paragraph a level deeper when its list is nested", async () => {
		expect(
			await slideXml([
				listItem([
					listParagraph("Parent"),
					listParagraph("Child", { indent: 24, level: 1 }),
				]),
			]),
		).toContain('<a:pPr algn="l" lvl="1" marL="533400" indent="-266700">');
	});

	it("numbers an item from its own number when a nested list comes before it", async () => {
		expect(
			await slideXml([
				listItem([
					listParagraph("First", { marker: "decimal" }),
					listParagraph("Inner", { indent: 24, level: 1 }),
					listParagraph("Second", { marker: "decimal", number: 2 }),
				]),
			]),
		).toContain('<a:buAutoNum type="arabicPeriod" startAt="2"/>');
	});

	it("numbers a list from 1 and reports it when the list starts at 0", async () => {
		const { file, result } = await write(
			deckOf([
				{ states: [{ clicks: 0, items: [numberedList([0, 1], "decimal")] }] },
			]),
		);
		const xml = await part(
			await JSZip.loadAsync(file),
			"ppt/slides/slide1.xml",
		);

		expect({
			problems: result.problems,
			starts: xml?.match(/startAt="\d+"/g),
		}).toEqual({
			problems: [
				{
					message:
						"PowerPoint can't number list items below 1, so a list here is numbered from 1.",
					severity: "warning",
					slide: 1,
				},
			],
			starts: ['startAt="1"', 'startAt="1"'],
		});
	});

	it("indents a paragraph without a marker when it continues an item", async () => {
		expect(
			await slideXml([
				listItem([
					listParagraph("First"),
					listParagraph("More", { bullet: false }),
				]),
			]),
		).toContain(
			'<a:pPr algn="l" marL="228600" indent="-228600"><a:lnSpc><a:spcPct val="125000"/></a:lnSpc><a:buSzPct val="100000"/><a:buChar char="&#x00A0;"/></a:pPr><a:r><a:rPr lang="en-US" kern="100" sz="2400" dirty="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:rPr><a:t>More</a:t>',
		);
	});

	it("lowers a run when it's a subscript", async () => {
		expect(
			await slideXml([textItem([[run("H"), run("2", { script: "sub" })]])]),
		).toContain('baseline="-40000"');
	});

	it("keeps a shadow's zero offset when text glows", async () => {
		expect(
			await slideXml([
				textItem([
					[
						run("Glow", {
							shadow: {
								blur: 8,
								color: "ffffff",
								offsetX: 0,
								offsetY: 0,
								transparency: 0,
							},
						}),
					],
				]),
			]),
		).toContain('blurRad="101600" dist="127"');
	});

	it("casts a shadow to the right when it's offset straight right", async () => {
		expect(
			await slideXml([
				textItem([
					[
						run("Right", {
							shadow: {
								blur: 0,
								color: "000000",
								offsetX: 4,
								offsetY: 0,
								transparency: 0,
							},
						}),
					],
				]),
			]),
		).toContain('dist="50800" dir="21540000"');
	});

	it("casts no shadow when it's transparent", async () => {
		expect(
			await slideXml([
				textItem([
					[
						run("Faint", {
							shadow: {
								blur: 4,
								color: "000000",
								offsetX: 2,
								offsetY: 2,
								transparency: 100,
							},
						}),
					],
				]),
			]),
		).not.toContain("<a:outer");
	});

	it("keeps one-line text within its container when the container leaves little room", async () => {
		expect(
			await slideXml([
				textItem([[run("Tight")]], {
					style: { ...style, availableWidth: 410, nowrap: false },
				}),
			]),
		).toContain('<a:off x="508000" y="165100"/><a:ext cx="5207000"');
	});

	it("grows one-line text by its full slack when its container has room", async () => {
		expect(
			await slideXml([
				textItem([[run("Roomy")]], {
					style: { ...style, nowrap: false },
				}),
			]),
		).toContain('<a:off x="508000" y="165100"/><a:ext cx="5384800"');
	});

	it("places rotated text by its line box when it's rotated", async () => {
		expect(
			await slideXml([
				textItem([[run("Turned")]], { baselines: undefined, rotation: 90 }),
			]),
		).toContain(
			'<a:xfrm rot="5400000"><a:off x="508000" y="231140"/><a:ext cx="5080000" cy="530860"/>',
		);
	});

	it("makes a slide's first heading its title", async () => {
		expect(
			await slideXml([
				textItem([[run("Body")]], { key: "body" }),
				textItem([[run("Heading")]], { heading: true, key: "a" }),
				textItem([[run("Later")]], { heading: true, key: "b" }),
			]),
		).toMatch(
			/name="Text: Heading"><\/p:cNvPr><p:cNvSpPr><a:spLocks noGrp="1"\/><\/p:cNvSpPr><p:nvPr><p:ph type="title"\/><\/p:nvPr>.*name="Text: Later"><\/p:cNvPr><p:cNvSpPr txBox="1"\/><p:nvPr><\/p:nvPr>/s,
		);
	});

	it("marks a shape decorative when it's decoration", async () => {
		expect(await slideXml([boxItem({ decorative: true })])).toContain(
			'name="Box"><a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst></p:cNvPr>',
		);
	});

	it("marks a picture decorative without a description when it has no alt text", async () => {
		expect(await slideXml([imageItem({ alt: "" })])).toMatch(
			/name="Image" descr="">\s*<a:extLst><a:ext uri="\{C183D7F6-B498-43B3-948B-1728B52AA6E4\}">/,
		);
	});

	it("marks a text stroke's outlined copy decorative when text is stroked", async () => {
		expect(
			await slideXml([
				textItem([[run("Inked", { stroke: { color: "000000", width: 2 } })]]),
			]),
		).toMatch(
			/name="Text: Inked \(outline\)"><a:extLst>.*?<adec:decorative .*?name="Text: Inked"><\/p:cNvPr>/s,
		);
	});

	it("rounds a picture's corners by its shorter side", async () => {
		expect(await slideXml([imageItem({ radius: 20 })])).toContain(
			'<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom>',
		);
	});

	it("rounds a picture into an ellipse when its radius reaches half its shorter side", async () => {
		expect(await slideXml([imageItem({ radius: 50 })])).toMatch(
			/<p:pic>(?:(?!<\/p:pic>).)*<a:prstGeom prst="ellipse">/s,
		);
	});

	it("points identical pictures at one media file when their files differ", async () => {
		const copies = ["a.png", "b.png"].map((name) => path.join(directory, name));
		for (const copy of copies) {
			await fs.writeFile(
				copy,
				Buffer.concat([await fs.readFile(photo), Buffer.from([2])]),
			);
		}

		const zip = await writeItems([
			imageItem({ file: copies[0], key: "a" }),
			imageItem({ file: copies[1], key: "b" }),
		]);

		expect({
			media: zip.file(/^ppt\/media\/image/).map(({ name }) => name),
			rels: (await part(zip, "ppt/slides/_rels/slide1.xml.rels"))?.match(
				/Target="[^"]*media[^"]*"/g,
			),
		}).toEqual({
			media: ["ppt/media/image-1-1.png"],
			rels: [
				'Target="../media/image-1-1.png"',
				'Target="../media/image-1-1.png"',
			],
		});
	});

	it("declares JPEGs by their standard type when the deck has them", async () => {
		const jpeg = path.join(directory, "photo.jpg");
		await fs.writeFile(
			jpeg,
			Buffer.concat([await fs.readFile(photo), Buffer.from([1])]),
		);

		expect(
			await part(
				await writeItems([imageItem({ file: jpeg })]),
				"[Content_Types].xml",
			),
		).toMatch(/^(?!.*image\/jpg").*Extension="jpg" ContentType="image\/jpeg"/s);
	});

	it("points a link's runs at one relationship when a line break splits it", async () => {
		const href = "https://sli.dev";
		const zip = await writeItems([
			textItem([
				[run("first", { href }), run("second", { href, lineBreak: "forced" })],
			]),
		]);

		expect({
			rels: (await part(zip, "ppt/slides/_rels/slide1.xml.rels"))?.match(
				/Target="https:\/\/sli\.dev"/g,
			),
			runs: (await part(zip, "ppt/slides/slide1.xml"))?.match(/r:id="rId\d+"/g),
		}).toEqual({
			rels: ['Target="https://sli.dev"'],
			runs: ['r:id="rId1"', 'r:id="rId1"'],
		});
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
				{ key: "body" },
			),
		]);
		const theme = await part(zip, "ppt/theme/theme1.xml");

		expect(theme).toContain(
			'<a:clrScheme name="Deck Title"><a:dk1><a:srgbClr val="101010"/></a:dk1><a:lt1><a:srgbClr val="DAE7F3"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="3366CC"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>',
		);
		expect(theme).toContain(
			'<a:hlink><a:srgbClr val="3366CC"/></a:hlink><a:folHlink><a:srgbClr val="3366CC"/></a:folHlink>',
		);
		expect(theme).toContain(
			'<a:fontScheme name="Deck Title"><a:majorFont><a:latin typeface="Heading"/><a:ea typeface="Heading"/><a:cs typeface="Heading"/>',
		);
		expect(theme).toContain(
			'<a:minorFont><a:latin typeface="Body"/><a:ea typeface="Body"/><a:cs typeface="Body"/>',
		);
	});

	it("picks accents by how many shapes and texts use them when the deck colors several", async () => {
		const theme = await part(
			await writeItems([
				boxItem({ fill: { color: "00a3ff", transparency: 0 }, key: "a" }),
				boxItem({ fill: { color: "00a3ff", transparency: 0 }, key: "b" }),
				boxItem({
					border: { color: "55e1f3", transparency: 0, width: 1 },
					key: "c",
				}),
				boxItem({ fill: { color: "ffffff", transparency: 97 }, key: "d" }),
			]),
			"ppt/theme/theme1.xml",
		);

		expect(theme).toContain(
			'<a:accent1><a:srgbClr val="00A3FF"/></a:accent1><a:accent2><a:srgbClr val="55E1F3"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>',
		);
	});

	it("refers runs to the theme's fonts and colors when they're the theme's", async () => {
		expect(
			await slideXml([
				textItem([[run("Themed"), run("Linked", { href: "https://sli.dev" })]]),
			]),
		).toContain(
			'<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:rPr><a:t>Themed</a:t></a:r><a:r><a:rPr lang="en-US" kern="100" sz="2400" u="none" dirty="0"><a:solidFill><a:schemeClr val="hlink"/></a:solidFill>',
		);
	});

	it("styles the master's title like the slides' titles when it writes it", async () => {
		const master = await part(
			await writeItems([
				textItem([[run("Title", { color: "e5edf3", font: "Heading" })]], {
					heading: true,
				}),
				textItem([[run("Body text")]], { key: "body" }),
			]),
			"ppt/slideMasters/slideMaster1.xml",
		);

		expect({
			placeholder: master?.match(
				/name="Title Placeholder 1".*?<\/p:spPr>/,
			)?.[0],
			style: firstLevel(master, "p:titleStyle"),
		}).toEqual({
			placeholder:
				'name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="508000" y="165100"/><a:ext cx="5130800" cy="596900"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>',
			style: {
				align: "l",
				properties:
					'<a:lnSpc><a:spcPct val="125000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="2400" kern="1200"><a:solidFill><a:srgbClr val="E5EDF3"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr>',
			},
		});
	});

	it("gives new text the deck's most used body size and spacing", async () => {
		const zip = await writeItems([
			textItem([[run("Body text")]]),
			textItem([[run("Rare", { size: 12 })]], { key: "rare" }),
		]);
		const body = {
			align: "l",
			properties:
				'<a:lnSpc><a:spcPct val="125000"/></a:lnSpc><a:defRPr sz="2400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr>',
		};

		expect({
			master: firstLevel(
				await part(zip, "ppt/slideMasters/slideMaster1.xml"),
				"p:otherStyle",
			),
			presentation: firstLevel(
				await part(zip, "ppt/presentation.xml"),
				"p:defaultTextStyle",
			),
		}).toEqual({ master: body, presentation: body });
	});

	it("maps text to the light color when the background is dark", async () => {
		const zip = await writeItems([textItem([[run("Light")]])]);

		expect(await part(zip, "ppt/slideMasters/slideMaster1.xml")).toContain(
			'<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"',
		);
	});

	it("puts the background on the master when it writes the one layout", async () => {
		const zip = await writeItems([]);

		expect({
			layout: (await part(zip, "ppt/slideLayouts/slideLayout1.xml"))?.match(
				/type="titleOnly" preserve="1">\s*<p:cSld name="Title Only"><p:spTree>/,
			)?.length,
			layouts: zip.file(/^ppt\/slideLayouts\/[^/]+$/).map(({ name }) => name),
			master: await part(zip, "ppt/slideMasters/slideMaster1.xml"),
		}).toEqual({
			layout: 1,
			layouts: ["ppt/slideLayouts/slideLayout1.xml"],
			master: expect.stringContaining(
				'<p:cSld><p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId3"/>',
			),
		});
	});

	it("keeps the notes master on pptxgenjs's own theme when it themes the slides", async () => {
		const zip = await writeItems([textItem([[run("Text")]])]);

		expect({
			contentTypes: await part(zip, "[Content_Types].xml"),
			notesMaster: await part(
				zip,
				"ppt/notesMasters/_rels/notesMaster1.xml.rels",
			),
			notesTheme: await part(zip, "ppt/theme/theme2.xml"),
		}).toEqual({
			contentTypes: expect.stringMatching(
				/<Override PartName="\/ppt\/theme\/theme2\.xml" ContentType="[^"]+theme\+xml"\/>/,
			),
			notesMaster: expect.stringContaining('Target="../theme/theme2.xml"'),
			notesTheme: expect.stringContaining(
				'<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>',
			),
		});
	});

	it("sizes notes pages as portrait pages", async () => {
		expect(await part(await writeItems([]), "ppt/presentation.xml")).toContain(
			'<p:notesSz cx="6858000" cy="9144000"/>',
		);
	});

	it("lists the deck's fonts, theme, and slide titles in its properties", async () => {
		const app = await part(
			await writeZip(
				deckOf([
					{
						states: [
							{
								clicks: 0,
								items: [
									textItem([[run("Hello & welcome")]], { heading: true }),
								],
							},
						],
					},
					{ states: [{ clicks: 0, items: [] }] },
				]),
			),
			"docProps/app.xml",
		);

		expect({
			headings: app?.match(/<HeadingPairs>.*<\/HeadingPairs>/s)?.[0],
			titles: app?.match(/<TitlesOfParts>.*<\/TitlesOfParts>/s)?.[0],
		}).toEqual({
			headings:
				'<HeadingPairs><vt:vector size="6" baseType="variant"><vt:variant><vt:lpstr>Fonts Used</vt:lpstr></vt:variant><vt:variant><vt:i4>2</vt:i4></vt:variant><vt:variant><vt:lpstr>Theme</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant><vt:variant><vt:lpstr>Slide Titles</vt:lpstr></vt:variant><vt:variant><vt:i4>2</vt:i4></vt:variant></vt:vector></HeadingPairs>',
			titles:
				'<TitlesOfParts><vt:vector size="5" baseType="lpstr"><vt:lpstr>Body</vt:lpstr><vt:lpstr>Mono</vt:lpstr><vt:lpstr>Deck Title</vt:lpstr><vt:lpstr>Hello &amp; welcome</vt:lpstr><vt:lpstr>PowerPoint Presentation</vt:lpstr></vt:vector></TitlesOfParts>',
		});
	});

	it("writes no folder entries or company", async () => {
		const zip = await writeItems([]);

		expect({
			app: await part(zip, "docProps/app.xml"),
			folders: Object.values(zip.files).filter(({ dir }) => dir),
		}).toEqual({
			app: expect.stringContaining("<Company></Company>"),
			folders: [],
		});
	});

	it("formats notes' Markdown when a note is one line", async () => {
		expect(await notesXml("Say **this** and `that`")).toContain(
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Say </a:t></a:r><a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>this</a:t></a:r><a:r><a:rPr lang="en-US" dirty="0"/><a:t> and </a:t></a:r><a:r><a:rPr lang="en-US" dirty="0"><a:latin typeface="Mono"/></a:rPr><a:t>that</a:t></a:r></a:p></p:txBody>',
		);
	});

	it("keeps notes' line breaks and adds a blank paragraph where the Markdown has blank lines", async () => {
		expect(await notesXml("One *two*\nthree\n\nFour ~~five~~")).toContain(
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>One </a:t></a:r><a:r><a:rPr lang="en-US" i="1" dirty="0"/><a:t>two</a:t></a:r><a:br><a:rPr lang="en-US" dirty="0"/></a:br><a:r><a:rPr lang="en-US" dirty="0"/><a:t>three</a:t></a:r></a:p><a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Four </a:t></a:r><a:r><a:rPr lang="en-US" strike="sngStrike" dirty="0"/><a:t>five</a:t></a:r></a:p></p:txBody>',
		);
	});

	it("links notes' text when the Markdown has a link", async () => {
		const zip = await writeZip(
			deckOf([
				{
					notes: "See [Slidev](https://sli.dev) and [again](https://sli.dev)",
					states: [{ clicks: 0, items: [] }],
				},
			]),
		);

		expect({
			notes: (await part(zip, "ppt/notesSlides/notesSlide1.xml"))?.match(
				/<a:hlinkClick r:id="rId\d+"\/>/g,
			),
			rels: (
				await part(zip, "ppt/notesSlides/_rels/notesSlide1.xml.rels")
			)?.match(/<Relationship Id="rId\d+" Type="[^"]*hyperlink"[^>]*>/g),
		}).toEqual({
			notes: ['<a:hlinkClick r:id="rId3"/>', '<a:hlinkClick r:id="rId3"/>'],
			rels: [
				'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://sli.dev" TargetMode="External"/>',
			],
		});
	});

	it("bullets and numbers notes' list items when the Markdown has lists", async () => {
		expect(
			(await notesXml("- one\n  1. two\n  2. three\n- four"))?.match(
				/<a:pPr.*?<\/a:pPr>/g,
			),
		).toEqual([
			'<a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr>',
			'<a:pPr marL="571500" indent="-285750"><a:buAutoNum type="arabicPeriod" startAt="1"/></a:pPr>',
			'<a:pPr marL="571500" indent="-285750"><a:buAutoNum type="arabicPeriod" startAt="1"/></a:pPr>',
			'<a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr>',
		]);
	});

	it("bolds notes' headings and breaks their lines where the Markdown breaks them", async () => {
		expect(await notesXml("# Intro\nOne  \nTwo")).toContain(
			'<a:p><a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>Intro</a:t></a:r></a:p><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>One</a:t></a:r><a:br><a:rPr lang="en-US" dirty="0"/></a:br><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Two</a:t></a:r></a:p></p:txBody>',
		);
	});

	it("writes notes' code blocks in the monospace font, a paragraph per line", async () => {
		expect(await notesXml("```\nconst a = 1;\nconst b = 2;\n```")).toContain(
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"><a:latin typeface="Mono"/></a:rPr><a:t>const a = 1;</a:t></a:r></a:p><a:p><a:r><a:rPr lang="en-US" dirty="0"><a:latin typeface="Mono"/></a:rPr><a:t>const b = 2;</a:t></a:r></a:p></p:txBody>',
		);
	});

	it("writes one slide per click state when slidePerClick is set", async () => {
		const zip = await writeZip(
			deckOf([
				{
					states: [
						{ clicks: 0, items: [] },
						{ clicks: 1, items: [textItem([[run("Shown")]])] },
					],
				},
			]),
			true,
		);

		expect({
			first: await part(zip, "ppt/slides/slide1.xml"),
			second: await part(zip, "ppt/slides/slide2.xml"),
		}).toEqual({
			first: expect.not.stringContaining("Shown"),
			second: expect.stringContaining("<a:t>Shown</a:t>"),
		});
	});

	it("plays a slide's transition only into its first click state when slidePerClick is set", async () => {
		const zip = await writeZip(
			deckOf([
				{
					states: [
						{ clicks: 0, items: [] },
						{ clicks: 1, items: [] },
					],
					transition: "slide-left",
				},
			]),
			true,
		);

		expect({
			first: await part(zip, "ppt/slides/slide1.xml"),
			second: await part(zip, "ppt/slides/slide2.xml"),
		}).toEqual({
			first: expect.stringContaining('<p:push dir="l"/>'),
			second: expect.not.stringContaining("<p:transition"),
		});
	});

	it("fades shapes in when a click shows them", async () => {
		const zip = await writeZip(
			deckOf([
				{
					states: [
						{ clicks: 0, items: [] },
						{ clicks: 1, items: [textItem([[run("Shown")]])] },
					],
				},
			]),
		);

		expect(await part(zip, "ppt/slides/slide1.xml")).toContain(
			'<p:par><p:cTn id="3" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">',
		);
	});

	it("fades a list's paragraph out when a click hides it", async () => {
		const shown = listItem([listParagraph("A"), listParagraph("B")]);
		const hidden = listItem([
			listParagraph("A"),
			listParagraph("B", { visible: false }),
		]);
		const zip = await writeZip(
			deckOf([
				{
					states: [
						{ clicks: 0, items: [shown] },
						{ clicks: 1, items: [hidden] },
					],
				},
			]),
		);

		expect(await part(zip, "ppt/slides/slide1.xml")).toMatch(
			/presetClass="exit".*<p:pRg st="1" end="1"\/>.*<p:bldP spid="2" grpId="0" build="p"\/>/s,
		);
	});
});
