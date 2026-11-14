import { describe, expect, it } from "vitest";

import {
	edgeBox,
	fitSize,
	geometryOf,
	insetBox,
	intersect,
	positionIn,
} from "./geometry.ts";

describe(edgeBox, () => {
	const box = { height: 50, width: 100, x: 0, y: 0 };

	it("shortens a side by its corner radius when the box is rounded", () => {
		expect(edgeBox(box, { side: "top", width: 2 }, 10, 0)).toEqual({
			box: { height: 2, width: 80, x: 10, y: 0 },
			rotation: 0,
		});
	});

	it("turns a side about the box's center when the box is rotated", () => {
		expect(edgeBox(box, { side: "bottom", width: 2 }, 0, 180)).toEqual({
			box: {
				height: 2,
				width: 100,
				x: expect.closeTo(0),
				y: expect.closeTo(0),
			},
			rotation: 180,
		});
	});
});

describe(fitSize, () => {
	const area = { height: 100, width: 200 };

	it("fits the height when containing a square in a wide area", () => {
		expect(fitSize("contain", area, 1)).toEqual({ height: 100, width: 100 });
	});

	it("fits the width when covering a wide area with a square", () => {
		expect(fitSize("cover", area, 1)).toEqual({ height: 200, width: 200 });
	});
});

describe(geometryOf, () => {
	it("scales a box when its transform scales", () => {
		expect(
			geometryOf({ height: 10, matrix: [2, 0, 0, 2], width: 20, x: 5, y: 6 }),
		).toEqual({
			box: { height: 20, width: 40, x: 5, y: 6 },
			rotation: 0,
			scale: 2,
		});
	});

	it("centers the unrotated box when its transform rotates", () => {
		expect(
			geometryOf({ height: 10, matrix: [0, 1, -1, 0], width: 20, x: 10, y: 0 }),
		).toEqual({
			box: { height: 10, width: 20, x: -5, y: 5 },
			rotation: 90,
			scale: 1,
		});
	});
});

describe(insetBox, () => {
	it("shrinks a box by scaled insets", () => {
		expect(
			insetBox(
				{ height: 100, width: 100, x: 10, y: 10 },
				{ bottom: 4, left: 1, right: 2, top: 3 },
				2,
			),
		).toEqual({ height: 86, width: 94, x: 12, y: 16 });
	});
});

describe(intersect, () => {
	it("returns an empty box when boxes don't overlap", () => {
		expect(
			intersect(
				{ height: 10, width: 10, x: 0, y: 0 },
				{ height: 10, width: 10, x: 20, y: 0 },
			),
		).toEqual({ height: 10, width: 0, x: 20, y: 0 });
	});
});

describe(positionIn, () => {
	const area = { height: 100, width: 200, x: 10, y: 20 };
	const size = { height: 50, width: 100 };
	const resolve = (length: string, free: number) =>
		length.endsWith("%") ? (parseFloat(length) / 100) * free : 7;

	it("centers an image when the position is empty", () => {
		expect(positionIn(area, size, "", resolve)).toEqual({
			height: 50,
			width: 100,
			x: 60,
			y: 45,
		});
	});

	it("places an image by keywords when they're in either order", () => {
		expect(positionIn(area, size, "bottom right", resolve)).toEqual({
			height: 50,
			width: 100,
			x: 110,
			y: 70,
		});
	});

	it("resolves a length when it has spaces inside a function", () => {
		expect(positionIn(area, size, "calc(1px + 2px) 0%", resolve)).toEqual({
			height: 50,
			width: 100,
			x: 17,
			y: 20,
		});
	});
});
