/**
 * Builds a native PowerPoint deck from a Slidev deck, with no browser:
 * render (Vite SSR) → lay out (takumi + a static cascade) → extract items → write .pptx.
 */
import { Renderer } from "@takumi-rs/core";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Assets } from "./assets.ts";
import type { FontBook } from "./fonts.ts";
import type { Css, LayoutOptions, Prepared } from "./layout.ts";
import type { Canvas, Deck, ImageItem, Item } from "./model.ts";
import type { RenderedSlide } from "./render.ts";
import type {
	BuildPptxOptions,
	BuildPptxProblem,
	BuildPptxResult,
} from "./types.ts";

import { createAssets } from "./assets.ts";
import { createCascade } from "./cascade.ts";
import { extractState, isNativeImage } from "./extract.ts";
import { createFontBook } from "./fonts.ts";
import { createLayout, staticLayerIndexes } from "./layout.ts";
import { createSlideRenderer } from "./render.ts";
import { transitionInto } from "./transitions.ts";
import { writePptx } from "./write.ts";

type Layout = ReturnType<typeof createLayout>;

/** A slide on its way to the model: rendered, styled, then prepared for layout. */
interface PreparedSlide {
	css: Css;
	number: number;
	options: LayoutOptions;
	rendered: RenderedSlide;
	states: Prepared[];
}

export async function buildPptx({
	work,
	...options
}: BuildPptxOptions): Promise<BuildPptxResult> {
	if (work) {
		return build(options, path.resolve(work), true);
	}

	const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "slidev-pptx-"));
	try {
		return await build(options, temporary, false);
	} finally {
		await fs.rm(temporary, { force: true, recursive: true });
	}
}

async function build(
	{
		colorScheme,
		entry = "slides.md",
		out,
		root = process.cwd(),
		slidePerClick = false,
		slides: selected,
	}: Omit<BuildPptxOptions, "work">,
	work: string,
	keepModel: boolean,
) {
	await fs.mkdir(path.join(work, "rasters"), { recursive: true });
	const renderer = await createSlideRenderer(path.resolve(root, entry));
	try {
		const { config } = renderer;
		const numbers = slideNumbersOf(selected, renderer.count);
		const canvas: Canvas = {
			height: Math.ceil(config.canvasWidth / config.aspectRatio),
			width: config.canvasWidth,
		};
		const scheme =
			colorScheme ?? (config.colorSchema === "dark" ? "dark" : "light");
		const assets = createAssets({
			publicDir: renderer.publicDir,
			root: renderer.root,
			work,
		});

		// Render every slide first, so UnoCSS has seen every class before its CSS is collected.
		const rendered: RenderedSlide[] = [];
		for (const number of numbers) {
			rendered.push(await renderer.renderSlide(number));
		}

		const globalCss = await renderer.globalCss();
		const styled = [];
		for (const [index, number] of numbers.entries()) {
			const sheets = [...globalCss, ...(await renderer.slideCss(number))];
			styled.push({
				css: {
					rules: createCascade(sheets, {
						colorScheme: scheme,
						viewport: canvas,
					}),
					sheets,
				},
				number,
				rendered: rendered[index],
			});
		}

		const fonts = createFontBook({
			assets,
			fonts: config.fonts,
			sheets: styled.flatMap(({ css }) => css.sheets),
		});
		const layout = createLayout({ assets, canvas, colorScheme: scheme });
		const staticLayers = staticLayerIndexes(
			rendered.map(({ globalBottom }) => globalBottom),
		);

		// Style every state first, so the fonts their text uses load before any layout.
		const slides: PreparedSlide[] = styled.map((slide) => {
			const options = {
				globalBottom: slide.rendered.globalBottom,
				globalTop: slide.rendered.globalTop,
				staticLayers,
				zoom: Number(slide.rendered.frontmatter.zoom ?? 1),
			};
			return {
				...slide,
				options,
				states: slide.rendered.states.map((html) =>
					layout.prepare(slide.number, html, slide.css, options),
				),
			};
		});
		await layout.registerFonts(
			await fonts.load(
				new Set(
					slides.flatMap(({ states }) =>
						states.flatMap((state) => [...state.fontStacks]),
					),
				),
			),
		);

		const exporter = createStateExporter({
			assets,
			canvas,
			fonts,
			layout,
			work,
		});
		const deckSlides = [];
		for (const slide of slides) {
			const states = [];
			for (const [clicks, state] of slide.states.entries()) {
				states.push({
					clicks,
					items: await exporter.exportState(slide, clicks, state),
				});
			}

			deckSlides.push({
				notes: slide.rendered.note.trim(),
				number: slide.number,
				states,
				transition: transitionInto(slide.number, renderer.slides, config),
			});
		}

		const deck: Deck = {
			aspectRatio: config.aspectRatio,
			author: config.author,
			background: await writeBackground(layout, slides[0], staticLayers, work),
			canvas,
			slides: deckSlides,
			title: config.title,
		};
		if (keepModel) {
			await fs.writeFile(path.join(work, "model.json"), JSON.stringify(deck));
		}

		const { slides: written } = await writePptx({
			deck,
			fonts,
			out,
			slidePerClick,
		});
		return { problems: exporter.problems, slides: written };
	} finally {
		await renderer.close();
	}
}

/** The slides to build, in deck order. */
function slideNumbersOf(selected: number[] | undefined, count: number) {
	const all = Array.from({ length: count }, (_, index) => index + 1);
	if (!selected) {
		return all;
	}

	const invalid = selected.filter(
		(number) => !Number.isInteger(number) || number < 1 || number > count,
	);
	if (!selected.length || invalid.length) {
		throw new Error(
			`Slides must be numbers from 1 to ${String(count)}; got ${selected.length ? invalid.join(", ") : "none"}.`,
		);
	}

	return all.filter((number) => selected.includes(number));
}

/** Lays out and extracts slide states, rendering what PowerPoint can't draw, and collects their problems. */
function createStateExporter({
	assets,
	canvas,
	fonts,
	layout,
	work,
}: {
	assets: Assets;
	canvas: Canvas;
	fonts: FontBook;
	layout: Layout;
	work: string;
}) {
	const problems: BuildPptxProblem[] = [];
	const report = (problem: BuildPptxProblem) => {
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

	// PowerPoint can't show some formats (like SVG and WebP); they become PNGs.
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

	async function exportState(
		slide: PreparedSlide,
		click: number,
		state: Prepared,
	) {
		const laidOut = await layout.layoutState(state, slide.css);
		for (const mismatch of laidOut.mismatches) {
			const element = laidOut.byId.get(mismatch.id);
			report({
				click,
				message: `<${element?.tagName.toLowerCase() ?? "?"}> has ${String(mismatch.children)} children but takumi measured ${String(mismatch.measured)}: ${(element?.textContent ?? "").trim().slice(0, 60)}`,
				slide: slide.number,
			});
		}

		const extracted = extractState(laidOut, { assets, canvas, fonts });
		for (const message of extracted.problems) {
			report({ message, slide: slide.number });
		}

		const items: Item[] = [];
		for (const item of extracted.items) {
			if (item.kind === "raster") {
				const { selector, ...raster } = item;
				const png = await layout.rasterize(
					slide.number,
					slide.rendered.states[click],
					slide.css,
					item,
					slide.options,
				);
				if (png) {
					items.push({ ...raster, file: await writePng(work, png) });
				} else {
					report({
						click,
						message: `Couldn't rasterize ${selector}.`,
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
						slide: slide.number,
					});
				}
			} else {
				items.push(item);
			}
		}

		return items;
	}

	return { exportState, problems };
}

/** Renders the slide background, and finds its average color for the theme. */
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
	return { color: await averageColor(png), file };
}

/** The average color of a PNG, over white where it's transparent. */
async function averageColor(png: Buffer) {
	const size = 8;
	const pixels = await new Renderer().render(
		`<img src="png" style="width:${String(size)}px;height:${String(size)}px">`,
		{
			format: "raw",
			height: size,
			images: [{ data: png, src: "png" }],
			width: size,
		},
	);
	const count = pixels.length / 4;
	return [0, 1, 2]
		.map((channel) => {
			let sum = 0;
			for (let index = 0; index < pixels.length; index += 4) {
				const alpha = pixels[index + 3] / 255;
				sum += pixels[index + channel] * alpha + 255 * (1 - alpha);
			}

			return Math.round(sum / count)
				.toString(16)
				.padStart(2, "0");
		})
		.join("");
}

/** Writes a rendered PNG, named by content so identical renders share one file (and one shape). */
async function writePng(work: string, png: Buffer) {
	const hash = createHash("sha1").update(png).digest("hex").slice(0, 12);
	const file = path.join(work, "rasters", `${hash}.png`);
	await fs.writeFile(file, png);
	return file;
}
