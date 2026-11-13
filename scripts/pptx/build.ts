/**
 * Builds a native PowerPoint deck from a Slidev deck, with no browser:
 * render (Vite SSR) → lay out (takumi + a static cascade) → extract items → write .pptx.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Deck, Item, RasterItem } from "./model.ts";

import { createCascade } from "./cascade.ts";
import { extractState } from "./extract.ts";
import { createLayout, loadFonts } from "./layout.ts";
import { createSlideRenderer } from "./render.ts";
import { writePptx } from "./write.ts";

export interface BuildOptions {
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
	entry = "slides.md",
	out,
	review = false,
	root = process.cwd(),
	slides: only,
	work = path.join(path.dirname(out), ".pptx"),
}: BuildOptions): Promise<BuildResult> {
	const publicDir = path.join(root, "public");
	const sansFont = path.join(
		root,
		"node_modules/@fontsource-variable/league-spartan/files/league-spartan-latin-wght-normal.woff2",
	);
	fs.mkdirSync(path.join(work, "rasters"), { recursive: true });

	const renderer = await createSlideRenderer(path.resolve(root, entry));
	try {
		const missing = only?.filter((no) => no > renderer.count) ?? [];
		if (missing.length) {
			throw new Error(
				`The deck has ${String(renderer.count)} slides, so it has no slide ${missing.join(", ")}.`,
			);
		}

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
		const layout = await createLayout({ fonts: loadFonts(root), publicDir });

		const deck: Deck = { slides: {}, total: renderer.count };
		const problems: string[] = [];
		for (const [no, slide] of rendered) {
			const sheets = [...globalCss, ...(await renderer.slideCss(no))];
			const css = { rules: createCascade(sheets), sheets };
			const options = {
				globalBottom: slide.globalBottom,
				zoom: Number(slide.frontmatter.zoom ?? 1),
			};
			const states = [];
			for (const [clicks, html] of slide.states.entries()) {
				const laidOut = await layout.layoutState(no, html, css, options);
				for (const mismatch of laidOut.mismatches) {
					const element = laidOut.byId.get(mismatch.id);
					problems.push(
						`Slide ${String(no)}, click ${String(clicks)}: <${element?.tagName.toLowerCase() ?? "?"}> has ${String(mismatch.children)} children but takumi measured ${String(mismatch.measured)}: ${(element?.textContent ?? "").trim().slice(0, 60)}`,
					);
				}

				const extracted = extractState(laidOut, { no, publicDir });
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

					// Named by content, so identical renders across clicks share one file (and one shape).
					const hash = createHash("sha1")
						.update(png)
						.digest("hex")
						.slice(0, 12);
					const file = path.join(work, "rasters", `${raster.id}-${hash}.png`);
					fs.writeFileSync(file, png);
					for (const item of items) {
						if (owns(item)) {
							item.file = file;
						}
					}
				}

				states.push({ clicks, items });
			}

			deck.slides[no] = { clicksTotal: slide.total, no, states };
		}

		const first = rendered.get(numbers[0]);
		const background = path.join(work, "background.png");
		fs.writeFileSync(
			background,
			await layout.renderBackground(first?.globalBottom ?? "", {
				sheets: [...globalCss, ...(await renderer.slideCss(numbers[0]))],
			}),
		);
		fs.writeFileSync(path.join(work, "model.json"), JSON.stringify(deck));

		const { slides } = await writePptx({
			author: String(renderer.slides[0]?.frontmatter.author ?? ""),
			background,
			deck,
			notes: renderer.slides.map((s) => s.note?.trim() ?? ""),
			out,
			publicDir,
			review,
			sansFont,
			title: String(renderer.slides[0]?.frontmatter.title ?? ""),
		});
		return { problems, slides };
	} finally {
		await renderer.close();
	}
}
