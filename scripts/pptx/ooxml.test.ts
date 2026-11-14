import { describe, expect, it } from "vitest";

import { createGradients, normalizeDegrees, patchSlide } from "./ooxml.ts";

const slideXml = (shapes: string) =>
	`<p:sld><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

const shapeXml = (id: number, name: string, body = "") =>
	`<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="${name}"></p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr></p:nvPr></p:nvSpPr>${body}</p:sp>`;

const emptyPatch = {
	effects: [],
	lists: [],
	pictureCorners: [],
};

const patch = (
	xml: string,
	changes: Partial<Parameters<typeof patchSlide>[1]>,
) =>
	patchSlide(xml, { ...emptyPatch, ...changes }, createGradients(new Set()), 1);

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
		expect(
			patch(slideXml(shapeXml(2, "List")), {
				effects: [{ click: 1, name: "List", paragraph: 1, type: "entr" }],
			}),
		).toContain(
			'<p:txEl><p:pRg st="1" end="1"/></p:txEl></p:spTgt></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst>',
		);
	});

	it("finds shapes when their names need escaping", () => {
		expect(
			patch(slideXml(shapeXml(2, "Tom &amp; Jerry")), { title: "Tom & Jerry" }),
		).toContain('<p:nvPr><p:ph type="title"/></p:nvPr>');
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

	it("rounds a picture's corners by its shorter side", () => {
		expect(
			patch(
				slideXml(
					'<p:pic><p:nvPicPr><p:cNvPr id="2" name="Photo"/></p:nvPicPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="400" cy="200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>',
				),
				{ pictureCorners: [{ name: "Photo", radius: 20 }] },
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
