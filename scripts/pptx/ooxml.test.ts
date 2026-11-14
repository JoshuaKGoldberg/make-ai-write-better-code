import { describe, expect, it } from "vitest";

import type { SlidePatch } from "./ooxml.ts";

import {
	createGradients,
	createNumbering,
	normalizeDegrees,
	patchSlide,
} from "./ooxml.ts";

const slideXml = (shapes: string) =>
	`<p:sld><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

const shapeXml = (id: number, name: string, body = "") =>
	`<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="${name}"></p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr></p:nvPr></p:nvSpPr>${body}</p:sp>`;

const theme = {
	accents: [],
	background: "000000",
	fonts: [],
	name: "Deck",
	text: "FFFFFF",
};

const patch = (xml: string, changes: Partial<SlidePatch>) =>
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
		{ gradients: createGradients(new Set()), theme },
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

		expect({
			builds: buildList(xml),
			target: xml.includes(
				'<p:spTgt spid="2"><p:txEl><p:pRg st="1" end="1"/></p:txEl></p:spTgt>',
			),
		}).toEqual({
			builds: '<p:bldLst><p:bldP spid="2" grpId="0" build="p"/></p:bldLst>',
			target: true,
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
				title: {
					look: {
						align: "l",
						color: "FFFFFF",
						cx: 1,
						cy: 1,
						font: "Body",
						size: 1800,
						x: 0,
						y: 0,
					},
					name: "Tom & Jerry",
					text: "Tom & Jerry",
				},
			}),
		).toContain('<p:nvPr><p:ph type="title"/></p:nvPr>');
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
