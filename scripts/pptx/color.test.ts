import { describe, expect, it } from "vitest";

import { parseColor } from "./color.ts";

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
	])("parses %s", (value, hex, a) => {
		expect(parseColor(value)).toEqual({ a: expect.closeTo(a), hex });
	});

	it.each([
		["color-mix(in srgb, red 50%, blue)", "800080"],
		["color-mix(in srgb, 50% red, blue)", "800080"],
		["color-mix(in srgb, red, blue 25%)", "bf0040"],
		["color-mix(in hsl, hsl(350 100% 50%), hsl(30 100% 50%))", "ff2b00"],
		["color-mix(in oklch, red, blue)", "ba00c2"],
	])("mixes %s", (value, hex) => {
		expect(parseColor(value)).toEqual({ a: 1, hex });
	});

	it("mixes with transparent as an opacity", () => {
		expect(parseColor("color-mix(in oklab, #00a3ff 20%, transparent)")).toEqual(
			{ a: expect.closeTo(0.2), hex: "00a3ff" },
		);
	});

	it("mixes currentcolor as the current color", () => {
		expect(
			parseColor("color-mix(in srgb, currentcolor 50%, blue)", "red"),
		).toEqual({ a: 1, hex: "800080" });
	});

	it("resolves currentcolor to the current color", () => {
		expect(parseColor("currentColor", "#123456")).toEqual({
			a: 1,
			hex: "123456",
		});
	});

	it("keeps fully transparent colors' alpha", () => {
		expect(parseColor("rgba(0, 0, 0, 0)")).toEqual({ a: 0, hex: "000000" });
	});

	it.each([
		"transparent",
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
