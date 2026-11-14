import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as Render from "./render.ts";

import {
	createSlideRenderer,
	resolveDeck,
	staticGlobalBottomLayers,
} from "./render.ts";

const entry = path.join(import.meta.dirname, "fixture/slides.md");

describe(createSlideRenderer, () => {
	let cacheDir: string;
	let deck: Awaited<ReturnType<typeof resolveDeck>>;
	let renderer: Awaited<ReturnType<typeof createSlideRenderer>>;
	const renderSlideTitled = (title: string) =>
		renderer.renderSlide(
			deck.data.slides.findIndex((slide) => slide.title === title) + 1,
		);

	beforeAll(async () => {
		cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "pptx-render-"));
		deck = await resolveDeck(entry);
		renderer = await createSlideRenderer(deck, cacheDir);
	}, 60_000);

	afterAll(async () => {
		await renderer.close();
		await fs.rm(cacheDir, { force: true, recursive: true });
	});

	it("keeps Vite's cache in the given directory", async () => {
		expect(await fs.readdir(cacheDir)).toEqual([
			expect.stringMatching(/^deps/),
		]);
	});

	it("throws when Slidev's client lacks a file it stands in for", async () => {
		await expect(
			createSlideRenderer({ ...deck, clientRoot: cacheDir }, cacheDir),
		).rejects.toThrow(
			"This version of Slidev isn't supported: its client has no builtin/CodeBlockWrapper.vue, builtin/CodeGroup.vue, builtin/KaTexBlockWrapper.vue, builtin/Monaco.vue, builtin/ShikiMagicMove.vue, builtin/VClickGap.vue, builtin/VSwitch.ts, composables/useNav.ts to stand in for.",
		);
	});

	it("positions v-drag elements when a slide drags them by position and by name", async () => {
		expect((await renderSlideTitled("Directives")).states[0]).toContain(
			'<div>Moving</div><div style="height:30px;left:40px;position:absolute;top:300px;transform:rotate(0deg);transform-origin:center center;width:120px;z-index:100;">Dragged</div><div style="height:30px;left:200px;position:absolute;top:300px;transform:rotate(0deg);transform-origin:center center;width:120px;z-index:100;">Named</div>',
		);
	});

	it("reports a v-mark and counts its click when a slide uses one", async () => {
		expect(await renderSlideTitled("Directives")).toEqual(
			expect.objectContaining({
				problems: ["Couldn't draw a v-mark: Marked"],
				states: [expect.any(String), expect.any(String)],
			}),
		);
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
		expect(await renderSlideTitled("Highlighted Math")).toEqual(
			expect.objectContaining({
				clicksStart: 1,
				states: [
					expect.stringMatching(
						/ slidev-vclick-target dishonored"><span class="[^"]+">a<\/span>.* slidev-vclick-target highlighted"><span class="[^"]+">b<\/span>/,
					),
				],
			}),
		);
	});

	it("registers clicks children first, like Slidev's mounted hooks, when clicks nest", async () => {
		expect((await renderSlideTitled("Click Order")).states[0]).toContain(
			'<div data-slidev-clicks-start="2" class="slidev-vclick-target slidev-vclick-hidden">Outer<div data-slidev-clicks-start="1" class="slidev-vclick-target slidev-vclick-hidden">Inner</div></div><ul><li data-slidev-clicks-start="3" class="slidev-vclick-target slidev-vclick-hidden">One <ul><li data-slidev-clicks-start="4" class="slidev-vclick-target slidev-vclick-hidden">One a</li></ul></li><li data-slidev-clicks-start="5" class="slidev-vclick-target slidev-vclick-hidden">Two</li></ul>',
		);
	});

	it("adds v-click animation and hide classes when an element has modifiers", async () => {
		const { states } = await renderSlideTitled("Click Order");

		expect({ first: states[0], last: states.at(-1) }).toEqual({
			first: expect.stringContaining(
				'<div data-slidev-clicks-start="6" class="slidev-vclick-target slidev-vclick-hidden slidev-vclick-anim-fade">Faded</div><div data-slidev-clicks-start="7" class="slidev-vclick-target">Hidden</div>',
			),
			last: expect.stringContaining(
				'<div data-slidev-clicks-start="7" class="slidev-vclick-target slidev-vclick-hidden slidev-vclick-hidden-explicitly slidev-vclick-current">Hidden</div>',
			),
		});
	});

	it("shows an element only within its range when v-click has one, and never registers v-click=false", async () => {
		expect((await renderSlideTitled("Click Order")).states[2]).toContain(
			'<div data-slidev-clicks-end="2" data-slidev-clicks-start="1" class="slidev-vclick-target slidev-vclick-hidden">Ranged</div><div>Unclicked</div>',
		);
	});

	it("activates a code group's first tab when a slide groups code blocks", async () => {
		expect((await renderSlideTitled("Code Blocks")).states[0]).toContain(
			'<div class="slidev-code-wrapper relative group active" style="--start:1;" data-title="first.ts">',
		);
	});

	it("highlights code lines, then hides the block, when its ranges say so", async () => {
		const { states } = await renderSlideTitled("Code Blocks");

		expect({ first: states[0], second: states[1] }).toEqual({
			first: expect.stringMatching(
				/<span class="line slidev-code-highlighted highlighted">.*highlighted.*<span class="line slidev-code-dishonored dishonored">.*dishonored/s,
			),
			second: expect.stringContaining(
				'<div class="slidev-code-wrapper relative group slidev-vclick-hidden" style="--start:1;" data-title="">',
			),
		});
	});

	it("renders Monaco and twoslash code statically when a slide has them", async () => {
		expect((await renderSlideTitled("Code Blocks")).states[0]).toMatch(
			/<span class="line">const edited = 1;<\/span>.*>hovered</s,
		);
	});

	it("renders each magic-move step at its click when a slide has one", async () => {
		const { states } = await renderSlideTitled("Code Blocks");

		expect({ first: states[0], last: states.at(-1) }).toEqual({
			first: expect.not.stringMatching(/>after</),
			last: expect.not.stringMatching(/>before</),
		});
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
				path.resolve("node_modules"),
				path.join(directory, "node_modules"),
			);
			const copy = (await import(
				path.join(directory, "render.ts")
			)) as typeof Render;
			copied = await copy.createSlideRenderer(
				await copy.resolveDeck(entry),
				path.join(directory, "cache"),
			);
		}, 60_000);

		afterAll(async () => {
			await copied.close();
			await fs.rm(directory, { force: true, recursive: true });
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

describe(staticGlobalBottomLayers, () => {
	it("finds the top-level elements that are the same on every slide", () => {
		expect(
			staticGlobalBottomLayers([
				'<div class="backdrop"></div><div data-layout="cover"></div>',
				'<div class="backdrop"></div><div data-layout="default"></div>',
			]),
		).toEqual([0]);
	});

	it("finds none when a slide has different layers", () => {
		expect(
			staticGlobalBottomLayers([
				'<div class="backdrop"></div>',
				'<div class="backdrop"></div><div class="extra"></div>',
			]),
		).toEqual([]);
	});

	it("finds none when there are no slides", () => {
		expect(staticGlobalBottomLayers([])).toEqual([]);
	});
});
