import { describe, expect, it } from "vitest";

import { parseDeclarations, splitTopLevel, unquote } from "./css.ts";

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

	it("lowercases properties when they aren't custom properties", () => {
		expect(parseDeclarations("COLOR: red; --myColor: lime")).toEqual([
			{ important: false, property: "color", value: "red" },
			{ important: false, property: "--myColor", value: "lime" },
		]);
	});
});

describe(splitTopLevel, () => {
	it.each([
		["a, b(c, d), e", ",", ["a", "b(c, d)", "e"]],
		["a b(c (d e)) f", " ", ["a", "b(c (d e))", "f"]],
		["a\tb\nc", " ", ["a", "b", "c"]],
		[`"a b" 'c d'`, " ", [`"a b"`, `'c d'`]],
		[`"a \\" b", c`, ",", [`"a \\" b"`, "c"]],
		["a,, b ,", ",", ["a", "b"]],
		["12px / 1.5", "/", ["12px", "1.5"]],
	] as const)("splits %j on %j", (value, separator, parts) => {
		expect(splitTopLevel(value, separator)).toEqual(parts);
	});
});

describe(unquote, () => {
	it.each([
		[`"a b"`, "a b"],
		[` 'a' `, "a"],
		["a", "a"],
		[`"a'`, `"a'`],
		[`"a\nb"`, "a\nb"],
	])("unquotes %j", (value, unquoted) => {
		expect(unquote(value)).toBe(unquoted);
	});
});
