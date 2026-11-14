import { describe, expect, it } from "vitest";

import { parseDeclarations } from "./css.ts";

describe(parseDeclarations, () => {
	it("drops comments when a value has them", () => {
		expect(
			parseDeclarations("stroke: rgb(248 113 113 / 1) /* #f87171 */"),
		).toEqual([
			{ important: false, property: "stroke", value: "rgb(248 113 113 / 1)" },
		]);
	});

	it("keeps comment-like text when it's in a string", () => {
		expect(parseDeclarations('content: "/* kept */"')).toEqual([
			{ important: false, property: "content", value: '"/* kept */"' },
		]);
	});
});
