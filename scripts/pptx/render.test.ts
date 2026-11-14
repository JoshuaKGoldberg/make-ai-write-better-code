import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as Render from "./render.ts";

import { createSlideRenderer } from "./render.ts";

const entry = path.join(import.meta.dirname, "fixture/slides.md");

describe(createSlideRenderer, () => {
	let renderer: Awaited<ReturnType<typeof createSlideRenderer>>;
	const renderSlideTitled = (title: string) =>
		renderer.renderSlide(
			renderer.slides.findIndex((slide) => slide.title === title) + 1,
		);

	beforeAll(async () => {
		renderer = await createSlideRenderer(entry);
	}, 60_000);

	afterAll(async () => {
		await renderer.close();
	});

	it("renders v-mark, v-motion, and v-drag when a slide uses them", async () => {
		expect((await renderSlideTitled("Directives")).states).toEqual([
			expect.stringContaining(
				'<div style="height:30px;left:40px;position:absolute;top:300px;transform:rotate(0deg);transform-origin:center center;width:120px;z-index:100;">Dragged</div>',
			),
			expect.stringContaining("<span>Marked</span>"),
		]);
	});

	it("counts v-switch and v-click-gap clicks when a slide uses them", async () => {
		const { states } = await renderSlideTitled("Switch and Gap");

		expect({ count: states.length, second: states[1] }).toEqual({
			count: 6,
			second: expect.stringContaining(
				'<div class="slidev-vclick-target slidev-vclick-current" data-slidev-clicks-start="1" data-slidev-clicks-end="2"><!--[-->Switched one',
			),
		});
	});

	it("starts at clicksStart and highlights KaTeX lines when a slide sets both", async () => {
		expect((await renderSlideTitled("Highlighted Math")).states).toEqual([
			expect.stringMatching(
				/ dishonored"><span class="[^"]+">a<\/span>.* highlighted"><span class="[^"]+">b<\/span>/,
			),
		]);
	});

	it("finds the global-bottom layers every slide renders the same when one varies by slide", async () => {
		expect(await renderer.staticGlobalBottomLayers()).toEqual([0]);
	});

	describe("from a directory with a space", () => {
		let directory: string;
		let copied: typeof renderer;

		beforeAll(async () => {
			directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptx render "));
			await fs.cp(
				path.join(import.meta.dirname, "ssr"),
				path.join(directory, "ssr"),
				{ recursive: true },
			);
			await fs.copyFile(
				path.join(import.meta.dirname, "render.ts"),
				path.join(directory, "render.ts"),
			);
			await fs.symlink(
				path.join(import.meta.dirname, "../../node_modules"),
				path.join(directory, "node_modules"),
			);
			const copy = (await import(
				path.join(directory, "render.ts")
			)) as typeof Render;
			copied = await copy.createSlideRenderer(entry);
		}, 60_000);

		afterAll(async () => {
			await fs.rm(directory, { recursive: true });
			await copied.close();
		});

		it("renders Slidev's navigation through its stand-in when its directory has a space", async () => {
			expect(await copied.renderSlide(5)).toEqual(
				expect.objectContaining({
					globalTop: expect.stringMatching(/>5 \/ \d+ · image-right</),
				}),
			);
		});
	});
});
