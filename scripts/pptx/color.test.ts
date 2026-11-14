import { describe, expect, it } from "vitest";

import {
	isGradient,
	parseColor,
	parseLinearGradient,
	parseShadow,
} from "./color.ts";

describe(parseColor, () => {
	it.each([
		["red", "ff0000", 1],
		["RebeccaPurple", "663399", 1],
		["#0af", "00aaff", 1],
		["#00aaff80", "00aaff", 128 / 255],
		["rgb(0 163 255 / 3.25%)", "00a3ff", 0.0325],
		["rgba(255, 0, 0, 0.5)", "ff0000", 0.5],
		["hsl(120 100% 50%)", "00ff00", 1],
		["hsl(210deg, 50%, 40%, .5)", "336699", 0.5],
		["hsl(0.5turn 100% 50%)", "00ffff", 1],
		["hsl(200grad 100% 50%)", "00ffff", 1],
		["hsl(3.14159rad 100% 50%)", "00ffff", 1],
		["hsl(none 50% 50%)", "bf4040", 1],
		["hwb(0 0% 0%)", "ff0000", 1],
		["hwb(0 60% 60%)", "808080", 1],
		["oklch(62.8% 0.2577 29.23)", "ff0000", 1],
		["oklab(0.628 0.2249 0.1258)", "ff0000", 1],
		["lab(54.29 80.82 69.89)", "ff0000", 1],
		["lch(54.29 106.84 40.85)", "ff0000", 1],
		["color(srgb 0.5 0.5 0.5)", "808080", 1],
		["color(srgb-linear 0.2159 0.2159 0.2159)", "808080", 1],
		["color(xyz-d65 0.4124 0.2126 0.0193)", "ff0000", 1],
		["color(xyz-d50 0.4360 0.2225 0.0139)", "ff0000", 1],
		["color(display-p3 1 0 0)", "ff0000", 1],
	])("parses %s", (value, hex, alpha) => {
		expect(parseColor(value)).toEqual({ alpha: expect.closeTo(alpha), hex });
	});

	it.each([
		["color-mix(in srgb, red 50%, blue)", "800080"],
		["color-mix(in srgb, 50% red, blue)", "800080"],
		["color-mix(in srgb, red, blue 25%)", "bf0040"],
		["color-mix(in hsl, hsl(350 100% 50%), hsl(30 100% 50%))", "ff2b00"],
		["color-mix(in oklch, red, blue)", "ba00c2"],
		["color-mix(in display-p3, red, blue)", "800a91"],
	])("mixes %s", (value, hex) => {
		expect(parseColor(value)).toEqual({ alpha: 1, hex });
	});

	it("mixes with transparent as an opacity", () => {
		expect(parseColor("color-mix(in oklab, #00a3ff 20%, transparent)")).toEqual(
			{ alpha: expect.closeTo(0.2), hex: "00a3ff" },
		);
	});

	it("mixes currentcolor as the current color", () => {
		expect(
			parseColor("color-mix(in srgb, currentcolor 50%, blue)", "red"),
		).toEqual({ alpha: 1, hex: "800080" });
	});

	it("resolves currentcolor to the current color", () => {
		expect(parseColor("currentColor", "#123456")).toEqual({
			alpha: 1,
			hex: "123456",
		});
	});

	it.each(["rgba(0, 0, 0, 0)", "transparent", "Transparent"])(
		"parses %s as transparent black",
		(value) => {
			expect(parseColor(value)).toEqual({ alpha: 0, hex: "000000" });
		},
	);

	it.each([
		"none",
		"",
		"rgb(from red r g b)",
		"#12345",
		"color(rec2020 1 0 0)",
		"color-mix(in nowhere, red, blue)",
		"hsl(120px 100% 50%)",
		"currentcolor",
	])("returns undefined for %j", (value) => {
		expect(parseColor(value)).toBeUndefined();
	});
});

describe(isGradient, () => {
	it.each([
		["linear-gradient(red, blue)", true],
		["repeating-radial-gradient(red, blue 10%)", true],
		["conic-gradient(red, blue)", true],
		['url("a.png")', false],
		["none", false],
	])("returns %s for %j", (image, expected) => {
		expect(isGradient(image)).toBe(expected);
	});
});

describe(parseLinearGradient, () => {
	const square = { height: 100, width: 100 };
	const wide = { height: 552, width: 980 };

	it("spreads stops evenly when they have no positions", () => {
		expect(
			parseLinearGradient("linear-gradient(red, blue)", 1, square),
		).toEqual({
			angle: 180,
			stops: [
				{ color: "ff0000", position: 0, transparency: 0 },
				{ color: "0000ff", position: 100, transparency: 0 },
			],
		});
	});

	it("reads a side and positions when the gradient has them", () => {
		expect(
			parseLinearGradient(
				"linear-gradient(to right, red 20%, blue 80%)",
				1,
				square,
			),
		).toEqual({
			angle: 90,
			stops: [
				{ color: "ff0000", position: 20, transparency: 0 },
				{ color: "0000ff", position: 80, transparency: 0 },
			],
		});
	});

	it.each([
		["to top", 0],
		["to right", 90],
		["to bottom", 180],
		["to left", 270],
		["to top right", 29.39],
		["to bottom right", 150.61],
		["to left  bottom", 209.39],
		["to top left", 330.61],
	])(
		"angles the gradient by the box's size when it's %s",
		(direction, angle) => {
			expect(
				parseLinearGradient(`linear-gradient(${direction}, red, blue)`, 1, wide)
					?.angle,
			).toBeCloseTo(angle);
		},
	);

	it.each([
		["to right in oklab", 90],
		["in oklch longer hue to right", 90],
		["90deg in srgb", 90],
		["in oklab", 180],
	])(
		"ignores the interpolation method when the direction is %j",
		(direction, angle) => {
			expect(
				parseLinearGradient(
					`linear-gradient(${direction}, red, blue)`,
					1,
					wide,
				),
			).toEqual({
				angle,
				stops: [
					{ color: "ff0000", position: 0, transparency: 0 },
					{ color: "0000ff", position: 100, transparency: 0 },
				],
			});
		},
	);

	it("reads a unitless 0 as an angle", () => {
		expect(
			parseLinearGradient("linear-gradient(0, red, blue)", 1, square),
		).toEqual({
			angle: 0,
			stops: [
				{ color: "ff0000", position: 0, transparency: 0 },
				{ color: "0000ff", position: 100, transparency: 0 },
			],
		});
	});

	it("resolves px positions along the gradient line", () => {
		expect(
			parseLinearGradient("linear-gradient(red 10px, blue 30px)", 1, {
				height: 40,
				width: 100,
			})?.stops,
		).toEqual([
			{ color: "ff0000", position: expect.closeTo(25), transparency: 0 },
			{ color: "0000ff", position: expect.closeTo(75), transparency: 0 },
		]);
	});

	it("spaces stops without positions between their neighbors' positions", () => {
		expect(
			parseLinearGradient("linear-gradient(red 0%, lime, blue 20%)", 1, square)
				?.stops,
		).toEqual([
			{ color: "ff0000", position: 0, transparency: 0 },
			{ color: "00ff00", position: 10, transparency: 0 },
			{ color: "0000ff", position: 20, transparency: 0 },
		]);
	});

	it("keeps positions in order when a later stop's is smaller", () => {
		expect(
			parseLinearGradient("linear-gradient(red 50%, blue 20%)", 1, square)
				?.stops,
		).toEqual([
			{ color: "ff0000", position: 50, transparency: 0 },
			{ color: "0000ff", position: 50, transparency: 0 },
		]);
	});

	it("drops color hints", () => {
		expect(
			parseLinearGradient("linear-gradient(red, 30%, blue)", 1, square)?.stops,
		).toEqual([
			{ color: "ff0000", position: 0, transparency: 0 },
			{ color: "0000ff", position: 100, transparency: 0 },
		]);
	});

	it("fades a transparent stop", () => {
		expect(
			parseLinearGradient("linear-gradient(transparent, red)", 1, square)
				?.stops[0],
		).toEqual({ color: "000000", position: 0, transparency: 100 });
	});

	it("converts an angle when it's in turns", () => {
		expect(
			parseLinearGradient("linear-gradient(0.25turn, red, blue)", 1, square)
				?.angle,
		).toBe(90);
	});

	it("makes two stops when a stop has two positions", () => {
		expect(
			parseLinearGradient("linear-gradient(red 0% 50%, blue)", 1, square)
				?.stops,
		).toEqual([
			{ color: "ff0000", position: 0, transparency: 0 },
			{ color: "ff0000", position: 50, transparency: 0 },
			{ color: "0000ff", position: 100, transparency: 0 },
		]);
	});

	it("fades stops by an opacity", () => {
		expect(
			parseLinearGradient(
				"linear-gradient(rgb(255 0 0 / 50%), blue)",
				0.5,
				square,
			)?.stops,
		).toEqual([
			{ color: "ff0000", position: 0, transparency: 75 },
			{ color: "0000ff", position: 100, transparency: 50 },
		]);
	});

	it.each([
		"repeating-linear-gradient(red, blue 10%)",
		"radial-gradient(red, blue)",
		"linear-gradient(red, blue), linear-gradient(green, blue)",
		"linear-gradient(red, nonsense, blue)",
		"linear-gradient(to sideways, red, blue)",
		"linear-gradient(to left right, red, blue)",
		"linear-gradient(in oklab red, blue)",
	])("returns undefined for %j", (image) => {
		expect(parseLinearGradient(image, 1, square)).toBeUndefined();
	});
});

describe(parseShadow, () => {
	const toPixels = (length: string) => parseFloat(length);

	it.each([
		[
			"0 0 8px #fff",
			{ blur: 8, color: "ffffff", offsetX: 0, offsetY: 0, transparency: 0 },
		],
		[
			"red 1px 2px",
			{ blur: 0, color: "ff0000", offsetX: 1, offsetY: 2, transparency: 0 },
		],
		[
			"1px 1px 2px rgb(0 0 0 / 50%), 4px 4px blue",
			{ blur: 2, color: "000000", offsetX: 1, offsetY: 1, transparency: 50 },
		],
		[
			"2px 3px",
			{ blur: 0, color: "123456", offsetX: 2, offsetY: 3, transparency: 0 },
		],
	])("parses %j", (value, expected) => {
		expect(parseShadow(value, toPixels, "#123456")).toEqual(expected);
	});

	it.each(["none", "0 0 4px transparent", "1px red"])(
		"returns undefined for %j",
		(value) => {
			expect(parseShadow(value, toPixels, "#123456")).toBeUndefined();
		},
	);
});
