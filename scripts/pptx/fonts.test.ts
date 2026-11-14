import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { Assets } from "./assets.ts";

import { createFontBook } from "./fonts.ts";

const file = path.join(
	path.dirname(
		createRequire(import.meta.url).resolve(
			"@fontsource-variable/league-spartan/package.json",
		),
	),
	"files/league-spartan-latin-wght-normal.woff2",
);

const assets: Assets = {
	get: () => undefined,
	load: (url) =>
		Promise.resolve(url === "/ls.woff2" ? fs.readFileSync(file) : undefined),
	save: () => undefined,
};

const stack = `"Spartan Test", sans-serif`;

async function createBook() {
	const book = createFontBook({
		assets,
		fonts: { mono: [], sans: ["Spartan Test"] },
		sheets: [
			`@font-face { font-family: "Spartan Test"; font-weight: 100 900; src: url(/ls.woff2) format("woff2-variations"); unicode-range: U+0000-00FF, U+2000-206F; }`,
		],
	});
	const fonts = await book.load([stack]);
	return { book, fonts };
}

describe(createFontBook, () => {
	it("registers @font-face faces under their CSS family, with their ranges", async () => {
		const { fonts } = await createBook();
		expect(fonts[0]).toMatchObject({
			name: "Spartan Test",
			unicodeRange: [
				[0, 0xff],
				[0x2000, 0x206f],
			],
			weight: undefined,
		});
	});

	it("names a variable font's weights by their named instances", async () => {
		const { book } = await createBook();
		expect(book.resolve(stack, 300, false)).toEqual({
			bold: false,
			font: "League Spartan Light",
		});
		expect(book.resolve(stack, 400, false)).toEqual({
			bold: false,
			font: "League Spartan",
		});
		expect(book.resolve(stack, 700, false)).toEqual({
			bold: false,
			font: "League Spartan Bold",
		});
	});

	it("reads metrics from the font file", async () => {
		const { book } = await createBook();
		book.resolve(stack, 400, false);
		expect(book.metrics("League Spartan")).toEqual({
			ascent: 0.7,
			baseline: 0.753,
			descent: 0.22,
		});
	});

	it("knows the font's coverage", async () => {
		const { book } = await createBook();
		book.resolve(stack, 400, false);
		expect(book.covers("League Spartan", 0x61)).toBe(true);
		expect(book.covers("League Spartan", 0x2713)).toBe(false);
		expect(book.covers("Unknown", 0x61)).toBeUndefined();
	});

	it("uses the deck's sans font for the theme", async () => {
		const { book } = await createBook();
		expect(book.theme()).toBe("League Spartan");
	});

	it("names unavailable fonts as written", async () => {
		const { book } = await createBook();
		expect(book.resolve(`"Nowhere Sans", "Nowhere Serif"`, 700, false)).toEqual(
			{
				bold: true,
				font: "Nowhere Sans",
			},
		);
	});
});
