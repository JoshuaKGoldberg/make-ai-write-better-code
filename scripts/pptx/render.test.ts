import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as Render from "./render.ts";

import { BuildPptxError } from "./error.ts";
import {
	createSlideRenderer,
	resolveDeck,
	staticGlobalBottomLayers,
} from "./render.ts";

const entry = path.join(import.meta.dirname, "fixture/slides.md");

describe(createSlideRenderer, () => {
	let deck: Awaited<ReturnType<typeof resolveDeck>>;
	let renderer: Awaited<ReturnType<typeof createSlideRenderer>>;
	const renderSlideTitled = (title: string) =>
		renderer.renderSlide(
			deck.data.slides.findIndex((slide) => slide.title === title) + 1,
		);

	beforeAll(async () => {
		deck = await resolveDeck(entry);
		renderer = await createSlideRenderer(deck);
	}, 60_000);

	afterAll(async () => {
		await renderer.close();
	});

	it("throws when Slidev's client lacks a file it stands in for", async () => {
		await expect(
			createSlideRenderer({ ...deck, clientRoot: import.meta.dirname }),
		).rejects.toThrow(
			new BuildPptxError(
				"This version of Slidev isn't supported: its client has no builtin/CodeBlockWrapper.vue, builtin/CodeGroup.vue, builtin/KaTexBlockWrapper.vue, builtin/Mermaid.vue, builtin/Monaco.vue, builtin/ShikiMagicMove.vue, builtin/VClickGap.vue, builtin/VSwitch.ts, composables/useNav.ts to stand in for.",
			),
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
				problems: [
					{ message: "Couldn't draw a v-mark: Marked", severity: "warning" },
				],
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

	it("shows an element only within its range when v-click has one", async () => {
		expect((await renderSlideTitled("Click Order")).states[2]).toContain(
			'<div data-slidev-clicks-end="2" data-slidev-clicks-start="1" class="slidev-vclick-target slidev-vclick-hidden">Ranged</div>',
		);
	});

	it("never registers a click when v-click is false", async () => {
		expect((await renderSlideTitled("Click Order")).states[0]).toContain(
			"<div>Unclicked</div>",
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

	it("renders Monaco code statically when a slide has it", async () => {
		expect((await renderSlideTitled("Code Blocks")).states[0]).toContain(
			'<span class="line">const edited = 1;</span>',
		);
	});

	it("renders a twoslash query's type when a slide has one", async () => {
		expect((await renderSlideTitled("Code Blocks")).states[0]).toMatch(
			/<span class="twoslash-query-persisted"><!--\[--><span>hovered<\/span><!--\]--><!--\[--><span class="twoslash-popup-container[^"]*">.*>hovered<\/span>.*>: <\/span>.*> ?1<\/span><\/code><\/span>/s,
		);
	});

	it("renders each magic-move step at its click when a slide has one", async () => {
		const { states } = await renderSlideTitled("Code Blocks");

		expect({ first: states[0], last: states.at(-1) }).toEqual({
			first: expect.stringMatching(/^(?!.*>after<).*>before</s),
			last: expect.stringMatching(/^(?!.*>before<).*>after</s),
		});
	});

	it("reports an error when a slide has Monaco content it can't export", async () => {
		expect((await renderSlideTitled("Embeds")).problems).toEqual(
			expect.arrayContaining([
				{
					message: "Couldn't export the modified side of a monaco-diff block.",
					severity: "error",
				},
				{
					message: "Couldn't export the output of a monaco-run block.",
					severity: "error",
				},
			]),
		);
	});

	it("reports an error when a slide uses a component Vue can't resolve", async () => {
		expect((await renderSlideTitled("Embeds")).problems).toContainEqual({
			message:
				"Couldn't render the component Unregistered: Vue couldn't resolve it.",
			severity: "error",
		});
	});

	it("reports a v-mark when only a later click shows it", async () => {
		expect((await renderSlideTitled("Switch and Gap")).problems).toEqual([
			{ message: "Couldn't draw a v-mark: Marked later", severity: "warning" },
		]);
	});

	it("renders a Mermaid diagram's container without running Mermaid when a slide has one", async () => {
		expect((await renderSlideTitled("Embeds")).states[0]).toContain(
			'<div class="mermaid"></div>',
		);
	});

	it("renders Toc, Link, and RouterLink entries as slide links without problems when a slide has them", async () => {
		expect(await renderSlideTitled("Navigation")).toEqual(
			expect.objectContaining({
				problems: [],
				states: [
					expect.stringMatching(
						/<a href="#\/22"><!--\[--><div><p>Navigation<\/p><\/div><!--\]--><\/a>.*<a href="#2"><!--\[-->Go to Lists<!--\]--><\/a>.*<a href="#\/3">Go to Colors<\/a>/s,
					),
				],
			}),
		);
	});

	it("counts a code block's clicks after its wrapping v-click when a v-click wraps it", async () => {
		const { states } = await renderSlideTitled("Wrapped Code");

		expect({ count: states.length, first: states[0] }).toEqual({
			count: 6,
			first: expect.stringMatching(
				/<div data-slidev-clicks-start="1" class="slidev-code-wrapper [^"]*slidev-vclick-hidden".*<div data-slidev-clicks-start="4" class="slidev-vclick-target slidev-vclick-hidden">After the code<\/div>/s,
			),
		});
	});

	it("hides a Monaco block until its click when a v-click wraps it", async () => {
		expect((await renderSlideTitled("Wrapped Code")).states[0]).toContain(
			'<div data-slidev-clicks-start="5" class="slidev-code-wrapper relative group slidev-vclick-target slidev-vclick-hidden"><pre class="shiki slidev-code"><code><!--[--><!--[--><!----><span class="line">const wrapped = 1;</span>',
		);
	});

	it("renders one state when clicksStart is past the slide's clicks", async () => {
		expect(await renderSlideTitled("Started Late")).toEqual(
			expect.objectContaining({
				clicksStart: 2,
				states: [expect.stringContaining("<p>Shown from the start</p>")],
			}),
		);
	});

	it("renders what the deck's setup and floating-vue register, at the slide's route, when the setup awaits the router", async () => {
		expect((await renderSlideTitled("Deck Setup")).states[0]).toContain(
			'<p>Registered in setup at /20</p><p class="themed">Themed</p><p><span>Tipped</span></p>',
		);
	});

	it("keeps the states that rendered and reports an error when a click fails", async () => {
		expect(await renderSlideTitled("Late Failure")).toEqual(
			expect.objectContaining({
				problems: [
					{
						click: 1,
						message: "Couldn't render the click: It failed on a click.",
						severity: "error",
					},
				],
				states: [expect.stringContaining("<p>Before the click</p>"), ""],
			}),
		);
	});

	it("sets Slidev's theme variables when the deck has a themeConfig", async () => {
		expect((await renderer.globalCss()).at(-1)).toBe(
			"body{--slidev-theme-primary:#5d8392;}",
		);
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
			for (const file of ["error.ts", "render.ts", "types.ts"]) {
				await fs.copyFile(
					path.join(import.meta.dirname, file),
					path.join(directory, file),
				);
			}

			await fs.symlink(
				path.resolve("node_modules"),
				path.join(directory, "node_modules"),
			);
			const copy = (await import(
				path.join(directory, "render.ts")
			)) as typeof Render;
			copied = await copy.createSlideRenderer(await copy.resolveDeck(entry));
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
