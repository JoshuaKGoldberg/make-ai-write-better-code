import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { ordinalsOf } from "./text.ts";

describe(ordinalsOf, () => {
	const ordinals = (html: string) => {
		const { document } = parseHTML(`<html><body>${html}</body></html>`);
		const list = document.querySelector("ol");
		return list && ordinalsOf(list, [...list.children]);
	};

	it("counts from 1 when a list has no start", () => {
		expect(ordinals("<ol><li>a</li><li>b</li></ol>")).toEqual([1, 2]);
	});

	it("counts from 0 when a list starts at 0", () => {
		expect(ordinals('<ol start="0"><li>a</li><li>b</li></ol>')).toEqual([0, 1]);
	});

	it("counts down from the item count when a list is reversed", () => {
		expect(ordinals("<ol reversed><li>a</li><li>b</li></ol>")).toEqual([2, 1]);
	});

	it("continues from an item's value when it has one", () => {
		expect(
			ordinals('<ol><li>a</li><li value="5">b</li><li>c</li></ol>'),
		).toEqual([1, 5, 6]);
	});
});
