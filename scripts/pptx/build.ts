/**
 * Builds a native PowerPoint deck from a Slidev deck, with no browser:
 * render (Vite SSR) → lay out (takumi + a static cascade) → extract items → write .pptx.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Canvas, Deck, Item, RasterItem } from "./model.ts";

import { createAssets } from "./assets.ts";
import { createCascade } from "./cascade.ts";
import { extractState, isNativeImage } from "./extract.ts";
import { createFontBook } from "./fonts.ts";
import { createLayout, staticLayerIndexes } from "./layout.ts";
import { createSlideRenderer } from "./render.ts";
import { transitionInto } from "./transitions.ts";
import { writePptx } from "./write.ts";

export interface BuildOptions {
	/** The color scheme to export in; defaults to the deck's `colorSchema` (light unless it's "dark"). */
	colorScheme?: "dark" | "light";
	/** The Slidev entry, relative to `root`. */
	entry?: string;
	/** Output .pptx path. */
	out: string;
	/** Write one static slide per click state instead of animations, for fidelity checks. */
	review?: boolean;
	/** The deck's directory. */
	root?: string;
	/** Only these slide numbers (1-based). */
	slides?: number[];
	/** Directory for intermediate files: the model and rendered images. */
	work?: string;
}

export interface BuildResult {
	/** Layout trees that didn't line up with the DOM, which may mean missing content. */
	problems: string[];
	slides: number;
}

export async function buildPptx({
	colorScheme,
	entry = "slides.md",
	out,
	review = false,
	root = process.cwd(),
	slides: only,
	work = path.join(path.dirname(out), ".pptx"),
}: BuildOptions): Promise<BuildResult> {
	fs.mkdirSync(path.join(work, "rasters"), { recursive: true });

	const renderer = await createSlideRenderer(path.resolve(root, entry));
	try {
		const { config } = renderer;
		const invalid =
			only?.filter(
				(no) => !Number.isInteger(no) || no < 1 || no > renderer.count,
			) ?? [];
		if (only?.length === 0 || invalid.length) {
			throw new Error(
				`Slides must be numbers from 1 to ${String(renderer.count)}; got ${only?.length ? invalid.join(", ") : "none"}.`,
			);
		}

		// Slidev lays slides out on a canvas of whole px; the page keeps the exact aspect ratio.
		const canvas: Canvas = {
			height: Math.ceil(config.canvasWidth / config.aspectRatio),
			width: config.canvasWidth,
		};
		const page: Canvas = {
			height: config.canvasWidth / config.aspectRatio,
			width: config.canvasWidth,
		};
		const scheme =
			colorScheme ?? (config.colorSchema === "dark" ? "dark" : "light");
		const assets = createAssets({
			publicDir: renderer.publicDir,
			root: renderer.root,
			work,
		});

		const numbers = Array.from(
			{ length: renderer.count },
			(_, i) => i + 1,
		).filter((no) => !only || only.includes(no));
		// Render every slide first, so UnoCSS has seen every class before its CSS is collected.
		const rendered = new Map<
			number,
			Awaited<ReturnType<typeof renderer.renderSlide>>
		>();
		for (const no of numbers) {
			rendered.set(no, await renderer.renderSlide(no));
		}

		const globalCss = await renderer.globalCss();
		const cssBySlide = new Map<
			number,
			{ rules: ReturnType<typeof createCascade>; sheets: string[] }
		>();
		for (const no of numbers) {
			const sheets = [...globalCss, ...(await renderer.slideCss(no))];
			cssBySlide.set(no, {
				rules: createCascade(sheets, { colorScheme: scheme, viewport: canvas }),
				sheets,
			});
		}

		const fonts = createFontBook({
			assets,
			fonts: config.fonts,
			sheets: [...cssBySlide.values()].flatMap(({ sheets }) => sheets),
		});
		const layout = createLayout({ assets, canvas, colorScheme: scheme });
		const staticLayers = staticLayerIndexes(
			[...rendered.values()].map((slide) => slide.globalBottom),
		);

		// Style every state first, so the fonts their text uses load before any layout.
		const prepared = new Map<number, ReturnType<typeof layout.prepare>[]>();
		const stacks = new Set<string>();
		for (const [no, slide] of rendered) {
			const options = layerOptions(slide, staticLayers);
			const states = slide.states.map((html) =>
				layout.prepare(no, html, cssBySlide.get(no) ?? emptyCss, options),
			);
			for (const state of states) {
				state.fontStacks.forEach((stack) => stacks.add(stack));
			}

			prepared.set(no, states);
		}

		await layout.registerFonts(await fonts.load(stacks));

		const deck: Deck = { canvas, page, slides: {}, total: renderer.count };
		const problems: string[] = [];
		for (const [no, slide] of rendered) {
			const css = cssBySlide.get(no) ?? emptyCss;
			const options = layerOptions(slide, staticLayers);
			const states = [];
			for (const [clicks, html] of slide.states.entries()) {
				const state = prepared.get(no)?.[clicks];
				if (!state) {
					continue;
				}

				const laidOut = await layout.layoutState(state, css);
				for (const mismatch of laidOut.mismatches) {
					const element = laidOut.byId.get(mismatch.id);
					problems.push(
						`Slide ${String(no)}, click ${String(clicks)}: <${element?.tagName.toLowerCase() ?? "?"}> has ${String(mismatch.children)} children but takumi measured ${String(mismatch.measured)}: ${(element?.textContent ?? "").trim().slice(0, 60)}`,
					);
				}

				const extracted = extractState(laidOut, { assets, canvas, fonts, no });
				let items = extracted.items;
				for (const raster of extracted.rasters) {
					const png = await layout.rasterize(no, html, css, raster, options);
					const owns = (item: Item): item is RasterItem =>
						item.kind === "raster" && item.rasterId === raster.id;
					if (!png) {
						problems.push(
							`Slide ${String(no)}, click ${String(clicks)}: couldn't rasterize ${raster.selector}.`,
						);
						items = items.filter((item) => !owns(item));
						continue;
					}

					const file = writeRaster(work, raster.id, png);
					for (const item of items) {
						if (owns(item)) {
							item.file = file;
						}
					}
				}

				// PowerPoint can't show some formats (like SVG and WebP); they become PNGs.
				for (const item of items) {
					if (
						item.kind !== "image" ||
						isNativeImage(fs.readFileSync(item.file))
					) {
						continue;
					}

					const png = await layout.toPng(item.src);
					if (png) {
						item.file = writeRaster(work, "image", png);
					} else {
						problems.push(
							`Slide ${String(no)}, click ${String(clicks)}: couldn't convert ${item.src} to PNG.`,
						);
					}
				}

				states.push({ clicks, items });
			}

			deck.slides[no] = {
				clicksTotal: slide.total,
				no,
				states,
				transition: transitionInto(no, renderer.slides, config),
			};
		}

		const first = rendered.get(numbers[0]);
		const background = path.join(work, "background.png");
		fs.writeFileSync(
			background,
			await layout.renderBackground(cssBySlide.get(numbers[0]) ?? emptyCss, {
				globalBottom: first?.globalBottom,
				staticLayers,
			}),
		);
		fs.writeFileSync(path.join(work, "model.json"), JSON.stringify(deck));

		const { slides } = await writePptx({
			author: String(renderer.slides[0]?.frontmatter.author ?? ""),
			background,
			deck,
			fonts,
			notes: renderer.slides.map((s) => s.note?.trim() ?? ""),
			out,
			review,
			title: String(renderer.slides[0]?.frontmatter.title ?? ""),
		});
		return { problems, slides };
	} finally {
		await renderer.close();
	}
}

const emptyCss = { rules: [], sheets: [] };

const layerOptions = (
	slide: {
		frontmatter: Record<string, unknown>;
		globalBottom: string;
		globalTop: string;
	},
	staticLayers: number[],
) => ({
	globalBottom: slide.globalBottom,
	globalTop: slide.globalTop,
	staticLayers,
	zoom: Number(slide.frontmatter.zoom ?? 1),
});

/** Writes a rendered PNG, named by content so identical renders share one file (and one shape). */
function writeRaster(work: string, id: string, png: Buffer) {
	const hash = createHash("sha1").update(png).digest("hex").slice(0, 12);
	const file = path.join(work, "rasters", `${id}-${hash}.png`);
	fs.writeFileSync(file, png);
	return file;
}
