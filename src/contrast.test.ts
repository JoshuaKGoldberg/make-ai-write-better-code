import { describe, expect, it } from "vitest";

import { getContrastRatio } from "./contrast.ts";

describe(getContrastRatio, () => {
	it("returns 21 for black and white", () => {
		expect(getContrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
	});

	it("returns 1 for identical colors", () => {
		expect(getContrastRatio("#77bbff", "#77bbff")).toBe(1);
	});

	it("is symmetric", () => {
		expect(getContrastRatio("#071428", "#dae7f3")).toBe(
			getContrastRatio("#dae7f3", "#071428"),
		);
	});

	it("throws when given a color that isn't six-digit hex", () => {
		expect(() => getContrastRatio("#fff", "#000000")).toThrow(
			"Expected a six-digit hex color, but got: #fff",
		);
	});
});
