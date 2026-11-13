import { parseSync } from "@slidev/parser";
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";

import { getContrastRatio } from "./contrast.ts";

const slides = parseSync(
	fs.readFileSync("slides.md", "utf8"),
	"slides.md",
).slides;

const tokens = fs.readFileSync("styles/tokens.css", "utf8");

function getToken(name: string) {
	const match = new RegExp(`--${name}: (#[\\da-f]{6});`, "i").exec(tokens);
	if (!match) {
		throw new Error(`Could not find a hex value for --${name}.`);
	}

	return match[1];
}

describe("slides.md", () => {
	it.each(slides.map((slide) => [slide.index + 1, slide] as const))(
		"slide %i has speaker notes",
		(_, slide) => {
			expect(slide.note?.trim()).toBeTruthy();
		},
	);

	it.each(slides.map((slide) => [slide.index + 1, slide] as const))(
		"slide %i gives every image alt text",
		(_, slide) => {
			const images = slide.content.match(/<img\b[^>]*>/g) ?? [];

			for (const image of images) {
				expect(image).toMatch(/\balt="/);
			}
		},
	);
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
