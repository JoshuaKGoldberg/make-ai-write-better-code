import { describe, expect, it } from "vitest";

import type { SlidePatch, Theme, TitleLook } from "./ooxml.ts";

import {
	createGradients,
	createNumbering,
	masterXml,
	normalizeDegrees,
	notesParagraphs,
	patchSlide,
	themeXml,
} from "./ooxml.ts";

const slideXml = (shapes: string) =>
	`<p:sld><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

const shapeXml = (id: number, name: string, body = "") =>
	`<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="${name}"></p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr></p:nvPr></p:nvSpPr>${body}</p:sp>`;

const title: TitleLook = {
	align: "l",
	bold: false,
	color: "336699",
	cx: 1,
	cy: 1,
	font: "Display",
	italic: false,
	letterSpacing: 0,
	size: 1800,
	upper: false,
	x: 0,
	y: 0,
};

const theme: Theme = {
	accents: [],
	background: "000000",
	fonts: [],
	majorFont: "Heading",
	minorFont: "Body",
	name: "Deck",
	text: "FFFFFF",
	title,
};

const lightTheme: Theme = { ...theme, background: "FFFFFF", text: "000000" };

const patch = (
	xml: string,
	changes: Partial<SlidePatch>,
	gradients = createGradients(new Set()),
) =>
	patchSlide(
		xml,
		{
			decorative: [],
			effects: [],
			lists: [],
			notes: "",
			pictureCorners: [],
			...changes,
		},
		{ gradients, theme },
	);

const buildList = (xml: string) => /<p:bldLst>.*<\/p:bldLst>/.exec(xml)?.[0];

describe(patchSlide, () => {
	it("throws when an effect names a shape the slide doesn't have", () => {
		expect(() =>
			patch(slideXml(shapeXml(2, "A")), {
				effects: [{ click: 1, name: "B", type: "entr" }],
			}),
		).toThrow('Click 1: no shape named "B".');
	});

	it("groups effects by click when they're given out of order", () => {
		expect(
			patch(slideXml(shapeXml(2, "A") + shapeXml(3, "B")), {
				effects: [
					{ click: 2, name: "A", type: "exit" },
					{ click: 1, name: "A", type: "entr" },
					{ click: 1, name: "B", type: "entr" },
				],
			}),
		).toMatch(
			/presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">.*spid="2".*presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="withEffect">.*spid="3".*presetClass="exit" presetSubtype="0" fill="hold" grpId="1" nodeType="clickEffect">.*spid="2".*<p:bldLst><p:bldP spid="2" grpId="0" animBg="1"\/><p:bldP spid="3" grpId="0" animBg="1"\/><p:bldP spid="2" grpId="1" animBg="1"\/><\/p:bldLst>/s,
		);
	});

	it("builds by paragraph when an effect targets one", () => {
		const xml = patch(slideXml(shapeXml(2, "List")), {
			effects: [{ click: 1, name: "List", paragraph: 1, type: "entr" }],
		});

		expect({ builds: buildList(xml), xml }).toEqual({
			builds: '<p:bldLst><p:bldP spid="2" grpId="0" build="p"/></p:bldLst>',
			xml: expect.stringContaining(
				'<p:spTgt spid="2"><p:txEl><p:pRg st="1" end="1"/></p:txEl></p:spTgt>',
			),
		});
	});

	it("gives a list's paragraph effects their own group when the whole list also enters", () => {
		expect(
			buildList(
				patch(slideXml(shapeXml(3, "List")), {
					effects: [
						{ click: 1, name: "List", type: "entr" },
						{ click: 2, name: "List", paragraph: 1, type: "entr" },
						{ click: 3, name: "List", paragraph: 2, type: "entr" },
					],
				}),
			),
		).toBe(
			'<p:bldLst><p:bldP spid="3" grpId="0" animBg="1"/><p:bldP spid="3" grpId="1" build="p"/></p:bldLst>',
		);
	});

	it("finds shapes when their names need escaping", () => {
		expect(
			patch(slideXml(shapeXml(2, "Tom &amp; Jerry")), {
				title: { look: title, name: "Tom & Jerry", text: "Tom & Jerry" },
			}),
		).toContain('<p:nvPr><p:ph type="title"/></p:nvPr>');
	});

	it("builds nothing when only pictures animate", () => {
		expect(
			buildList(
				patch(
					slideXml(
						'<p:pic><p:nvPicPr><p:cNvPr id="2" name="Photo"/></p:nvPicPr></p:pic>',
					),
					{ effects: [{ click: 1, name: "Photo", type: "entr" }] },
				),
			),
		).toBeUndefined();
	});

	it("throws when a decorative picture's stand-in description is left", () => {
		expect(() =>
			patch(
				slideXml(
					'<p:pic><p:nvPicPr><p:cNvPr id="2" name="Photo" descr="pptx:decorative"/></p:nvPicPr></p:pic>',
				),
				{},
			),
		).toThrow(
			'Expected no descr="pptx:decorative" left in the package\'s XML.',
		);
	});

	it("throws when a gradient's placeholder color is left", () => {
		const gradients = createGradients(new Set());
		const sentinel = gradients.sentinel({ angle: 0, stops: [] });

		expect(() =>
			patch(
				slideXml(
					shapeXml(
						2,
						"A",
						`<a:solidFill><a:srgbClr val="${sentinel}"><a:lumMod val="50000"/></a:srgbClr></a:solidFill>`,
					),
				),
				{},
				gradients,
			),
		).toThrow('Expected no val="FEA000" left in the package\'s XML.');
	});

	it("throws when a shape to patch isn't written as pptxgenjs writes it", () => {
		expect(() =>
			patch(
				slideXml(
					'<p:sp><p:nvSpPr><p:cNvPr id="2" name="A"/><p:nvPr/></p:nvSpPr></p:sp>',
				),
				{ decorative: ["A"] },
			),
		).toThrow("Expected </p:cNvPr> in the package's XML.");
	});

	it("throws when a list's markers don't match its paragraphs", () => {
		expect(() =>
			patch(
				slideXml(
					shapeXml(
						2,
						"List",
						'<a:p><a:pPr><a:buSzPct val="100000"/><a:buChar char="&#x25CF;"/></a:pPr></a:p>',
					),
				),
				{ lists: [{ markers: ["keyword", "keyword"], name: "List" }] },
			),
		).toThrow("A list has 1 paragraphs but 2 markers.");
	});

	it("keeps only a paragraph's first properties when runs repeat them", () => {
		expect(
			patch(
				slideXml(
					shapeXml(
						2,
						"A",
						'<a:p><a:pPr algn="l"/><a:r><a:t>a</a:t></a:r><a:pPr algn="l"/><a:r><a:t>b</a:t></a:r></a:p>',
					),
				),
				{},
			),
		).toContain(
			'<a:p><a:pPr algn="l"/><a:r><a:t>a</a:t></a:r><a:r><a:t>b</a:t></a:r></a:p>',
		);
	});

	it("ends a paragraph with its last run's properties, without its link", () => {
		expect(
			patch(
				slideXml(
					shapeXml(
						2,
						"A",
						'<a:p><a:r><a:rPr lang="en-US" sz="1800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:hlinkClick r:id="rId1"/></a:rPr><a:t>a</a:t></a:r><a:endParaRPr lang="en-US" sz="1800" dirty="0"/></a:p>',
					),
				),
				{},
			),
		).toContain(
			'<a:endParaRPr lang="en-US" kern="100" sz="1800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:endParaRPr>',
		);
	});

	it("refers every one of a run's colors to the theme when they're the text's", () => {
		expect(
			patch(
				slideXml(
					shapeXml(
						2,
						"A",
						'<a:p><a:r><a:rPr lang="en-US"><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>a</a:t></a:r></a:p>',
					),
				),
				{},
			),
		).toContain(
			'<a:rPr lang="en-US" kern="100"><a:ln><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>',
		);
	});

	it("rounds a picture's corners by the adjustment it's given", () => {
		expect(
			patch(
				slideXml(
					'<p:pic><p:nvPicPr><p:cNvPr id="2" name="Photo"/></p:nvPicPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="400" cy="200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>',
				),
				{ pictureCorners: [{ adjust: 10000, name: "Photo" }] },
			),
		).toContain(
			'<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom>',
		);
	});
});

describe(createGradients, () => {
	it("skips colors the deck uses when it picks placeholders", () => {
		const gradient = { angle: 0, stops: [] };

		expect(createGradients(new Set(["FEA000"])).sentinel(gradient)).toBe(
			"FEA001",
		);
	});
});

describe(createNumbering, () => {
	it("numbers on from a sequence's start when paragraphs continue it", () => {
		const numbering = createNumbering();

		expect([
			numbering(0, 3, "arabicPeriod"),
			numbering(0, 4, "arabicPeriod"),
			numbering(1, 1, undefined),
			numbering(0, 5, "arabicPeriod"),
		]).toEqual([3, 3, 1, 5]);
	});
});

describe(normalizeDegrees, () => {
	it.each([
		[-30, 330],
		[0, 0],
		[360, 0],
		[725, 5],
	])("normalizes %d to %d", (rotation, normalized) => {
		expect(normalizeDegrees(rotation)).toBe(normalized);
	});
});

describe(themeXml, () => {
	const original =
		'<a:theme name="Office Theme"><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText"/></a:dk1><a:lt1><a:sysClr val="window"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Arial Black"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:objectDefaults/><thm15:themeFamily name="Office Theme"/></a:theme>';

	it("gives titles the dark second text color when the background is light", () => {
		expect(themeXml(original, lightTheme)).toBe(
			'<a:theme name="Deck"><a:clrScheme name="Deck"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="336699"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2></a:clrScheme><a:fontScheme name="Deck"><a:majorFont><a:latin typeface="Heading"/><a:ea typeface="Heading"/><a:cs typeface="Heading"/></a:majorFont><a:minorFont><a:latin typeface="Body"/><a:ea typeface="Body"/><a:cs typeface="Body"/></a:minorFont></a:fontScheme><a:objectDefaults/><thm15:themeFamily name="Deck"/></a:theme>',
		);
	});

	it("gives the theme's second background the deck's most common box over its background", () => {
		expect(
			themeXml(original, {
				...lightTheme,
				shape: { fill: { color: "336699", transparency: 50 } },
			}),
		).toContain('<a:lt2><a:srgbClr val="99B3CC"/></a:lt2>');
	});

	it("gives new shapes no outline when the deck's most common box has none", () => {
		expect(
			themeXml(original, {
				...theme,
				shape: { fill: { color: "1B2130", transparency: 0 } },
			}),
		).toContain(
			'<a:spPr><a:solidFill><a:srgbClr val="1B2130"/></a:solidFill><a:ln><a:noFill/></a:ln></a:spPr>',
		);
	});
});

describe(masterXml, () => {
	const original =
		'<p:sldMaster><p:cSld><p:spTree><p:grpSpPr></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:spcBef><a:spcPct val="0"/></a:spcBef><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:otherStyle></p:otherStyle></p:txStyles></p:sldMaster>';

	it("names the title's font and keeps the color mapping when the background is light and the font isn't the theme's", () => {
		expect(masterXml(original, lightTheme, "rId9")).toBe(
			'<p:sldMaster><p:cSld><p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId9"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:grpSpPr></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:spcBef><a:spcPct val="0"/></a:spcBef><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="Display"/><a:ea typeface="Display"/><a:cs typeface="Display"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:otherStyle></p:otherStyle></p:txStyles></p:sldMaster>',
		);
	});
});

describe(notesParagraphs, () => {
	const paragraphs = (notes: string) =>
		notesParagraphs(notes, "Mono", () => "rId1");

	it("writes an HTML block's text in its formats when the notes have one", () => {
		expect(paragraphs("<div>A whole <b>block</b></div>")).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>A whole </a:t></a:r><a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>block</a:t></a:r></a:p>',
		]);
	});

	it("breaks the line when an HTML block has a br", () => {
		expect(paragraphs("<div>Line one<br>\n  Line two</div>")).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Line one</a:t></a:r><a:br><a:rPr lang="en-US" dirty="0"/></a:br><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Line two</a:t></a:r></a:p>',
		]);
	});

	it("writes each block an HTML block nests as a paragraph", () => {
		expect(
			paragraphs("<div>\n  <p>Para one</p>\n  <p>Para two</p>\n</div>"),
		).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Para one</a:t></a:r></a:p>',
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Para two</a:t></a:r></a:p>',
		]);
	});

	it("keeps text bold after an inner bold tag closes when an outer bold is still open", () => {
		expect(paragraphs("**a <b>b</b> c**")).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>a b c</a:t></a:r></a:p>',
		]);
	});

	it("keeps text italic after inner emphasis closes when an outer italic tag is still open", () => {
		expect(paragraphs("<i>x *y* z</i>")).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" i="1" dirty="0"/><a:t>x y z</a:t></a:r></a:p>',
		]);
	});

	it("writes no empty run when a note starts with formatting", () => {
		expect(paragraphs("**Bold** start")).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>Bold</a:t></a:r><a:r><a:rPr lang="en-US" dirty="0"/><a:t> start</a:t></a:r></a:p>',
		]);
	});

	it("writes each element of an HTML block as a paragraph", () => {
		expect(paragraphs("<p>One</p><p>Two &amp; three</p>")).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>One</a:t></a:r></a:p>',
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Two &amp; three</a:t></a:r></a:p>',
		]);
	});

	it("writes nothing when an HTML block is a comment", () => {
		expect(paragraphs("<!-- hidden -->")).toEqual([]);
	});

	it("breaks the line when inline HTML has a br", () => {
		expect(paragraphs("Line one<br>Line two")).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Line one</a:t></a:r><a:br><a:rPr lang="en-US" dirty="0"/></a:br><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Line two</a:t></a:r></a:p>',
		]);
	});

	it("bolds and italicizes text when inline HTML tags format it", () => {
		expect(paragraphs("Say <b>this</b> and <em>that</em>")).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Say </a:t></a:r><a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>this</a:t></a:r><a:r><a:rPr lang="en-US" dirty="0"/><a:t> and </a:t></a:r><a:r><a:rPr lang="en-US" i="1" dirty="0"/><a:t>that</a:t></a:r></a:p>',
		]);
	});

	it("keeps a heading bold when inline HTML closes a bold tag in it", () => {
		expect(paragraphs("# A <strong>B</strong> C")).toEqual([
			'<a:p><a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>A B C</a:t></a:r></a:p>',
		]);
	});

	it("continues a list item without a marker when the item has a second paragraph", () => {
		expect(paragraphs("- one\n\n  more")).toEqual([
			'<a:p><a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" dirty="0"/><a:t>one</a:t></a:r></a:p>',
			'<a:p><a:pPr marL="285750" indent="0"><a:buNone/></a:pPr><a:r><a:rPr lang="en-US" dirty="0"/><a:t>more</a:t></a:r></a:p>',
		]);
	});
});
