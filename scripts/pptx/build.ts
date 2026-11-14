import { parseRangeString } from "@slidev/parser/core";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Assets } from "./assets.ts";
import type { FontBook } from "./fonts.ts";
import type { Css, Prepared } from "./layout.ts";
import type { Canvas, Deck, ImageItem, Item } from "./model.ts";
import type { RenderedSlide } from "./render.ts";
import type {
	BuildPptxOptions,
	BuildPptxProblem,
	BuildPptxResult,
} from "./types.ts";

import { createAssets, isNativeImage } from "./assets.ts";
import { createCascade } from "./cascade.ts";
import { extractState } from "./extract.ts";
import { createFontBook } from "./fonts.ts";
import { createLayout } from "./layout.ts";
import {
	createSlideRenderer,
	resolveDeck,
	staticGlobalBottomLayers,
} from "./render.ts";
import { transitionInto } from "./transitions.ts";
import { writePptx } from "./write.ts";

type Layout = ReturnType<typeof createLayout>;

interface PreparedSlide {
	css: Css;
	number: number;
	rendered: RenderedSlide;
	states: Prepared[];
}

type Report = (problem: BuildPptxProblem) => void;

/** A problem with the options passed to {@link buildPptx}. */
export class BuildPptxError extends Error {
	override name = "BuildPptxError";
}

export async function buildPptx({
	work,
	...options
}: BuildPptxOptions): Promise<BuildPptxResult> {
	if (work) {
		return build(options, path.resolve(work));
	}

	const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "slidev-pptx-"));
	try {
		return await build(options, temporary);
	} finally {
		await fs.rm(temporary, { force: true, recursive: true });
	}
}

async function build(
	{
		dark,
		entry = "slides.md",
		output,
		range,
		withClicks = false,
	}: Omit<BuildPptxOptions, "work">,
	work: string,
) {
	const deck = await resolveDeck(path.resolve(entry));
	const { config, slides: deckSlides } = deck.data;
	const numbers = slideNumbersOf(range, deckSlides.length);
	await fs.mkdir(path.join(work, "rasters"), { recursive: true });
	const renderer = await createSlideRenderer(deck, path.join(work, "vite"));
	try {
		const problems: BuildPptxProblem[] = [];
		const report: Report = (problem) => {
			if (
				!problems.some(
					(existing) =>
						existing.slide === problem.slide &&
						existing.click === problem.click &&
						existing.message === problem.message,
				)
			) {
				problems.push(problem);
			}
		};

		const canvas: Canvas = {
			height: Math.ceil(config.canvasWidth / config.aspectRatio),
			width: config.canvasWidth,
		};
		const colorScheme =
			(dark ?? config.colorSchema === "dark") ? "dark" : "light";
		const assets = createAssets({
			publicDir: renderer.publicDir,
			root: renderer.root,
			work,
		});

		// Render every slide first, so UnoCSS has seen every class before its CSS is collected.
		const rendered = await eachSlide(
			numbers.map((number) => ({ number })),
			report,
			async ({ number }) => {
				const slide = await renderer.renderSlide(number);
				for (const message of slide.problems) {
					report({ message, severity: "warning", slide: number });
				}

				return { rendered: slide };
			},
		);

		const globalCss = await renderer.globalCss();
		const styled = await eachSlide(rendered, report, async ({ number }) => {
			const sheets = [...globalCss, ...(await renderer.slideCss(number))];
			return {
				css: {
					rules: createCascade(sheets, { colorScheme, viewport: canvas }),
					sheets,
				},
			};
		});

		const fonts = createFontBook({
			assets,
			fonts: config.fonts,
			sheets: [...new Set(styled.flatMap(({ css }) => css.sheets))],
		});
		const layout = createLayout({ assets, canvas, colorScheme });
		const staticLayers = staticGlobalBottomLayers(
			styled.map(({ rendered }) => rendered.globalBottom),
		);

		// Style every state first, so the fonts their text uses load before any layout.
		const prepared: PreparedSlide[] = await eachSlide(
			styled,
			report,
			(slide) => ({
				states: slide.rendered.states.map((html) =>
					layout.prepare(slide.number, html, slide.css, {
						globalBottom: slide.rendered.globalBottom,
						globalTop: slide.rendered.globalTop,
						staticLayers,
						zoom: slide.rendered.zoom,
					}),
				),
			}),
		);
		const first = prepared.at(0);
		if (!first) {
			return { problems, slides: 0 };
		}

		await layout.registerFonts(
			await fonts.load(
				new Set(
					prepared.flatMap(({ states }) =>
						states.flatMap((state) => [...state.fontStacks]),
					),
				),
			),
		);

		const extractor = createStateExtractor({
			assets,
			canvas,
			fonts,
			layout,
			report,
			work,
		});
		const extracted = await eachSlide(prepared, report, async (slide) => {
			const items = [];
			for (const [index, state] of slide.states.entries()) {
				const clicks = slide.rendered.clicksStart + index;
				items.push({
					clicks,
					items: await extractor.extract(slide, clicks, state),
				});
			}

			return { items };
		});

		const deckModel: Deck = {
			aspectRatio: config.aspectRatio,
			author: config.author,
			background: await writeBackground(layout, first, staticLayers, work),
			canvas,
			slides: numbers.map((number) => ({
				notes: (deckSlides[number - 1].note ?? "").trim(),
				number,
				states: extracted.find((slide) => slide.number === number)?.items ?? [
					{ clicks: 0, items: [] },
				],
				transition: transitionInto(number, deckSlides, config),
			})),
			title: config.title,
		};
		await fs.writeFile(
			path.join(work, "model.json"),
			JSON.stringify(deckModel),
		);

		const written = await writePptx({
			deck: deckModel,
			fonts,
			out: output,
			slidePerClick: withClicks,
		});
		for (const family of await fonts.missingFamilies()) {
			report({
				message: `Couldn't find the font ${family}, so its text uses a fallback font.`,
				severity: "warning",
			});
		}

		written.problems.forEach(report);
		return { problems, slides: written.slides };
	} finally {
		await renderer.close();
	}
}

function createStateExtractor({
	assets,
	canvas,
	fonts,
	layout,
	report,
	work,
}: {
	assets: Assets;
	canvas: Canvas;
	fonts: FontBook;
	layout: Layout;
	report: Report;
	work: string;
}) {
	const viewable = new Map<string, Promise<string | undefined>>();
	const viewableFile = (image: ImageItem) => {
		let file = viewable.get(image.src);
		if (!file) {
			file = (async () => {
				if (isNativeImage(await fs.readFile(image.file))) {
					return image.file;
				}

				const png = await layout.toPng(image.src);
				return png && writePng(work, png);
			})();
			viewable.set(image.src, file);
		}

		return file;
	};

	async function extract(slide: PreparedSlide, click: number, state: Prepared) {
		const laidOut = await layout.layoutState(state, slide.css);
		for (const mismatch of laidOut.mismatches) {
			const element = laidOut.byId.get(mismatch.id);
			report({
				click,
				message: `<${element?.tagName.toLowerCase() ?? "?"}> has ${String(mismatch.children)} children but takumi measured ${String(mismatch.measured)}: ${(element?.textContent ?? "").trim().slice(0, 60)}`,
				severity: "warning",
				slide: slide.number,
			});
		}

		const extracted = extractState(laidOut, { assets, canvas, fonts });
		for (const message of extracted.problems) {
			report({ message, severity: "error", slide: slide.number });
		}

		const items: Item[] = [];
		for (const item of extracted.items) {
			if (item.kind === "raster") {
				const { selector, ...raster } = item;
				const png = await layout.rasterize(state, slide.css, item);
				if (png) {
					items.push({ ...raster, file: await writePng(work, png) });
				} else {
					report({
						click,
						message: `Couldn't rasterize ${selector}.`,
						severity: "error",
						slide: slide.number,
					});
				}
			} else if (item.kind === "image") {
				const file = await viewableFile(item);
				if (file) {
					items.push({ ...item, file });
				} else {
					report({
						message: `Couldn't convert ${item.src} to PNG.`,
						severity: "error",
						slide: slide.number,
					});
				}
			} else {
				items.push(item);
			}
		}

		return items;
	}

	return { extract };
}

async function eachSlide<
	Built extends { number: number },
	Stage extends object,
>(
	slides: Built[],
	report: Report,
	run: (slide: Built) => Promise<Stage> | Stage,
) {
	const succeeded: (Built & Stage)[] = [];
	for (const slide of slides) {
		let stage: Stage;
		try {
			stage = await run(slide);
		} catch (error) {
			report({
				message: `Couldn't build the slide: ${error instanceof Error ? error.message : String(error)}`,
				severity: "error",
				slide: slide.number,
			});
			continue;
		}

		succeeded.push({ ...slide, ...stage });
	}

	return succeeded;
}

function slideNumbersOf(range: string | undefined, count: number) {
	const numbers = parseRangeString(count, range);
	if (
		!numbers.length ||
		numbers.some((number) => !Number.isInteger(number) || number < 1)
	) {
		throw new BuildPptxError(
			`Range "${range ?? "all"}" must select slides from 1 to ${String(count)}.`,
		);
	}

	return numbers;
}

async function writeBackground(
	layout: Layout,
	first: PreparedSlide,
	staticLayers: number[],
	work: string,
) {
	const png = await layout.renderBackground(first.css, {
		globalBottom: first.rendered.globalBottom,
		staticLayers,
	});
	const file = path.join(work, "background.png");
	await fs.writeFile(file, png);
	return { color: await layout.averageColor(png), file };
}

async function writePng(work: string, png: Buffer) {
	const hash = createHash("sha1").update(png).digest("hex").slice(0, 12);
	const file = path.join(work, "rasters", `${hash}.png`);
	await fs.writeFile(file, png);
	return file;
}
