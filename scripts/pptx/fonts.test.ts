import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { Assets } from "./assets.ts";

import { createFontBook } from "./fonts.ts";

const leagueSpartan = fs.readFileSync(
	new URL("fixture/fonts/league-spartan.woff2", import.meta.url),
);
const firaCode = fs.readFileSync(
	new URL("fixture/fonts/fira-code-symbols.woff2", import.meta.url),
);

vi.spyOn(fs, "readdirSync").mockReturnValue([]);

const files: Partial<Record<string, Buffer>> = {
	"./fonts.css": Buffer.from(
		`@font-face { font-family: Relative; src: url(league-spartan.woff2) }`,
	),
	"/fira-code.woff2": firaCode,
	"/league-spartan.woff2": leagueSpartan,
	"https://api.fonts.coollabs.io/fonts?family=Web+Test:ital,wght@0,400;1,400&display=swap":
		Buffer.from(
			`@font-face { font-family: "Web Test"; src: url(/fira-code.woff2) }`,
		),
	"https://fonts.example/css": Buffer.from(
		`@font-face { font-family: Imported; src: url(league-spartan.woff2) }`,
	),
	"https://fonts.example/league-spartan.woff2": leagueSpartan,
	"https://fonts.googleapis.com/css2?family=Web+Test:wght@200;400&display=swap":
		Buffer.from(
			`@font-face { font-family: "Web Test"; src: url(/league-spartan.woff2) }`,
		),
	"league-spartan.woff2": leagueSpartan,
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
			@import "./fonts.css";
			@font-face { font-family: Pick; font-weight: 100; src: url(/league-spartan.woff2) }
			@font-face { font-family: Pick; font-weight: 600; src: local("Nowhere Mono"), url(/fira-code.woff2) }
			@font-face { font-family: Styled; font-style: italic; src: url(/fira-code.woff2) }
			@font-face { font-family: Styled; src: url(/league-spartan.woff2) }
			@font-face { font-family: Ranged; src: url(/fira-code.woff2); unicode-range: U+2000-206F }
			@font-face { font-family: Ranged; src: url(/league-spartan.woff2) }`,
		],
	});
	const fonts = await book.load(stacks);
	return { book, fonts };
}

describe(createFontBook, () => {
	it("registers @font-face faces under their CSS family, with their ranges", async () => {
		const { fonts } = await createBook();
		expect(fonts).toEqual([
			{
				data: leagueSpartan,
				name: "Spartan Test",
				unicodeRange: [
					[0, 0xff],
					[0x2000, 0x206f],
				],
			},
		]);
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

	it.each([
		[true, "Fira Code"],
		[false, "League Spartan"],
	])(
		"picks the face matching the style when italic is %s",
		async (italic, font) => {
			const { book } = await createBook(["Styled"]);
			expect(book.resolve("Styled", 400, italic)).toEqual({
				bold: false,
				font,
			});
		},
	);

	it("picks a face covering Latin text when another's unicode-range doesn't", async () => {
		const { book } = await createBook(["Ranged"]);
		expect(book.resolve("Ranged", 400, false)).toEqual({
			bold: false,
			font: "League Spartan",
		});
	});

	it.each(["Imported", "Relative"])(
		"follows @import rules to their @font-face rules for %s",
		async (family) => {
			const { book } = await createBook([family]);
			expect(book.resolve(family, 400, false)).toEqual({
				bold: false,
				font: "League Spartan",
			});
		},
	);

	it.each([
		["google", false, ["400", "200"], "League Spartan"],
		["coollabs", true, ["400"], "Fira Code"],
	] as const)(
		"loads %s web fonts when italic is %s",
		async (provider, italic, weights, font) => {
			const book = createFontBook({
				assets,
				fonts: {
					italic,
					provider,
					webfonts: ["Web Test"],
					weights: [...weights],
				},
				sheets: [],
			});
			await book.load(["Web Test"]);
			expect(book.resolve("Web Test", 400, false)).toEqual({
				bold: false,
				font,
			});
		},
	);

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

	it("names a font as written when it's unavailable", async () => {
		const { book } = await createBook();
		expect(book.resolve(`"Nowhere Sans", "Nowhere Serif"`, 700, false)).toEqual(
			{ bold: true, font: "Nowhere Sans" },
		);
	});

	it("uses Courier New for spacers when no monospace font is installed", async () => {
		const { book } = await createBook();
		expect(book.spacer()).toEqual({ advance: 0.6, font: "Courier New" });
	});
});

describe("missingFamilies", () => {
	it("returns the fonts option's families when nothing provides them", async () => {
		const book = createFontBook({
			assets,
			fonts: {
				local: ["Nowhere Local"],
				provider: "none",
				webfonts: ["Spartan Test", `"Totally Missing Font"`],
			},
			sheets: [
				`@font-face { font-family: "Spartan Test"; src: url(/league-spartan.woff2) }`,
			],
		});
		expect(await book.missingFamilies()).toEqual([
			"Totally Missing Font",
			"Nowhere Local",
		]);
	});
});
