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
		["hwb(0 0% 0%)", "ff0000", 1],
		["oklch(62.8% 0.2577 29.23)", "ff0000", 1],
		["oklab(0.628 0.2249 0.1258)", "ff0000", 1],
		["lab(54.29 80.82 69.89)", "ff0000", 1],
		["lch(54.29 106.84 40.85)", "ff0000", 1],
		["color(srgb 0.5 0.5 0.5)", "808080", 1],
		["color(display-p3 1 0 0)", "ff0000", 1],
	])("parses %s", (value, hex, a) => {
		const color = parseColor(value);
		expect(color?.hex).toBe(hex);
		expect(color?.a).toBeCloseTo(a);
	});

	it("mixes colors in sRGB", () => {
		expect(parseColor("color-mix(in srgb, red 50%, blue)")).toEqual({
			a: 1,
			hex: "800080",
		});
	});

	it("mixes with transparent as an opacity", () => {
		expect(parseColor("color-mix(in oklab, #00a3ff 20%, transparent)")).toEqual(
			{ a: expect.closeTo(0.2) as number, hex: "00a3ff" },
		);
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

	it.each(["transparent", "none", "", "rgb(from red r g b)", "#12345"])(
		"returns undefined for %j",
		(value) => {
			expect(parseColor(value)).toBeUndefined();
		},
	);
});
