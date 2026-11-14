import fs from "node:fs";
import { describe, expect, it } from "vitest";

import type { Assets } from "./assets.ts";

import { createFontBook } from "./fonts.ts";

const leagueSpartan = fs.readFileSync(
	new URL("fixture/fonts/league-spartan.woff2", import.meta.url),
);
const firaCode = fs.readFileSync(
	new URL("fixture/fonts/fira-code-symbols.woff2", import.meta.url),
);

const files: Partial<Record<string, Buffer>> = {
	"/fira-code.woff2": firaCode,
	"/league-spartan.woff2": leagueSpartan,
	"https://fonts.example/css": Buffer.from(
		`@font-face { font-family: Imported; src: url(league-spartan.woff2) }`,
	),
	"https://fonts.example/league-spartan.woff2": leagueSpartan,
};

const assets: Assets = {
	get: (url) => files[url],
	load: (url) => Promise.resolve(files[url]),
	save: () => undefined,
};

const stack = `"Spartan Test", sans-serif`;

async function createBook(stacks = [stack]) {
	const book = createFontBook({
		assets,
		fonts: { mono: [], sans: ["Spartan Test"] },
		sheets: [
			`@font-face { font-family: "Spartan Test"; font-weight: 100 900; src: url(/league-spartan.woff2) format("woff2-variations"); unicode-range: U+0000-00FF, U+2000-206F; }`,
			`@import url("https://fonts.example/css");
			@font-face { font-family: Pick; font-weight: 100; src: url(/league-spartan.woff2) }
			@font-face { font-family: Pick; font-weight: 600; src: local("Nowhere Mono"), url(/fira-code.woff2) }`,
		],
	});
	const fonts = await book.load(stacks);
	return { book, fonts };
}

describe(createFontBook, () => {
	it("registers @font-face faces under their CSS family, with their ranges", async () => {
		const { fonts } = await createBook();
		expect(fonts[0]).toEqual({
			data: leagueSpartan,
			name: "Spartan Test",
			unicodeRange: [
				[0, 0xff],
				[0x2000, 0x206f],
			],
		});
	});

	it.each([
		[300, "League Spartan Light"],
		[400, "League Spartan"],
		[700, "League Spartan Bold"],
	])(
		"names a variable font's weight %i by its named instance",
		async (weight, font) => {
			const { book } = await createBook();
			expect(book.resolve(stack, weight, false)).toEqual({ bold: false, font });
		},
	);

	it.each([
		[400, "League Spartan"],
		[700, "Fira Code Bold"],
	])(
		"picks the face CSS font matching does when the weight is %i",
		async (weight, font) => {
			const { book } = await createBook(["Pick"]);
			expect(book.resolve("Pick", weight, false)).toEqual({
				bold: false,
				font,
			});
		},
	);

	it("follows @import rules to their @font-face rules", async () => {
		const { book } = await createBook(["Imported"]);
		expect(book.resolve("Imported", 400, false)).toEqual({
			bold: false,
			font: "League Spartan",
		});
	});

	it("reads metrics from a loaded font's file before anything resolves to it", async () => {
		const { book } = await createBook();
		expect(book.metrics("League Spartan Bold")).toEqual({
			ascent: 0.7,
			baseline: 0.753,
			descent: 0.22,
		});
	});

	it("uses Menlo's metrics when a font has no file", async () => {
		const { book } = await createBook();
		expect(book.metrics("Nowhere Sans")).toEqual({
			ascent: 0.928,
			baseline: 0.745,
			descent: 0.236,
		});
	});

	it("knows a loaded font's coverage before anything resolves to it", async () => {
		const { book } = await createBook(["Pick"]);
		expect([
			book.covers("League Spartan", 0x61),
			book.covers("League Spartan", 0x2713),
			book.covers("Fira Code", 0x61),
			book.covers("Nowhere Sans", 0x61),
		]).toEqual([true, false, false, undefined]);
	});

	it("uses the deck's sans font for the theme", async () => {
		const { book } = await createBook();
		expect(book.theme()).toBe("League Spartan");
	});

	it("names a font as written when it's unavailable", async () => {
		const { book } = await createBook();
		expect(book.resolve(`"Nowhere Sans", "Nowhere Serif"`, 700, false)).toEqual(
			{ bold: true, font: "Nowhere Sans" },
		);
	});
});
