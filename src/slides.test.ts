import { parseSync } from "@slidev/parser";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getContrastRatio } from "./contrast.ts";

const slidesPath = fileURLToPath(new URL("../slides.md", import.meta.url));
const slides = parseSync(
	fs.readFileSync(slidesPath, "utf8"),
	slidesPath,
).slides;
const numberedSlides = slides.map((slide) => [slide.index + 1, slide] as const);

const tokens = fs.readFileSync(
	new URL("../styles/tokens.css", import.meta.url),
	"utf8",
);

function getToken(name: string) {
	const match = new RegExp(`--${name}: (#[\\da-f]{6});`, "i").exec(tokens);
	if (!match) {
		throw new Error(`Could not find a hex value for --${name}.`);
	}

	return match[1];
}

describe("slides.md", () => {
	it.each(numberedSlides)("slide %i has speaker notes", (_, slide) => {
		expect(slide.note?.trim()).toBeTruthy();
	});

	it.each(numberedSlides)("slide %i gives every image alt text", (_, slide) => {
		const images = slide.content.match(/<img\b[^>]*>/g) ?? [];

		expect(images.filter((image) => !/\balt="/.test(image))).toEqual([]);
	});
});

describe("styles/tokens.css", () => {
	const backgrounds = ["jg-bg-top", "jg-bg-bottom"];
	const texts = ["jg-fg", "jg-fg-strong", "jg-fg-muted", "jg-link"];

	it.each(
		backgrounds.flatMap((background) =>
			texts.map((text) => [text, background] as const),
		),
	)("--%s meets WCAG AA contrast on --%s", (text, background) => {
		expect(
			getContrastRatio(getToken(text), getToken(background)),
		).toBeGreaterThanOrEqual(4.5);
	});
});
