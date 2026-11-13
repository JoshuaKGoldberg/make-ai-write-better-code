/**
 * Lays out a server-rendered slide state without a browser: takumi computes
 * boxes and line runs, the static cascade computes visual styles, and both are
 * keyed back to the same DOM elements through a data attribute.
 */
import type { MeasuredNode, MeasuredTextRun } from "@takumi-rs/core";
import type { Node as TakumiNode } from "@takumi-rs/helpers";

import { Renderer } from "@takumi-rs/core";
import { fromHtml } from "@takumi-rs/helpers/html";
import { parseHTML } from "linkedom";
import fs from "node:fs";
import path from "node:path";

import type { CascadeRule, ComputedStyle } from "./cascade.ts";

import { computeStyles } from "./cascade.ts";
import { SLIDE } from "./model.ts";

/** The attribute that ties takumi's nodes back to DOM elements. */
export const ID = "data-pptx-id";

export interface Css {
	rules: CascadeRule[];
	sheets: string[];
}

export interface LaidOutBox {
	h: number;
	/** The node's absolute transform: [a, b, c, d] of the CSS matrix. */
	matrix: [number, number, number, number];
	w: number;
	x: number;
	y: number;
}

export interface LaidOutRun extends MeasuredTextRun {
	/** The id of the element whose style this run uses. */
	owner: string;
}

export interface LaidOutRuns {
	/** Text that isn't wrapped in its own element (beside block-level siblings). */
	anonymous: boolean;
	box: LaidOutBox;
	/** The id of the element the text belongs to. */
	parent: string;
	runs: LaidOutRun[];
}

export interface Layout {
	boxes: Map<string, LaidOutBox>;
	byId: Map<string, Element>;
	document: Document;
	markers: Map<Element, ComputedStyle>;
	mismatches: { children: number; id: string; measured: number }[];
	/** Text runs keyed by owning element id (or `anon-N` for anonymous text). */
	runs: Map<string, LaidOutRuns>;
	styles: Map<Element, ComputedStyle>;
}

export interface LayoutOptions {
	/** HTML of the deck's global-bottom layer, rendered beneath the slide. */
	globalBottom?: string;
	/** Slidev's per-slide `zoom`. */
	zoom?: number;
}

type FontInput = Parameters<Renderer["registerFont"]>[0];

/** Fonts for layout: the deck's League Spartan, plus monospace, Impact, and emoji from the system when available. */
export async function createLayout({
	fonts,
	publicDir,
}: {
	fonts: FontInput[];
	publicDir: string;
}) {
	const renderer = new Renderer();
	for (const font of fonts) {
		await renderer.registerFont(font);
	}

	const images = new Map<string, Buffer | undefined>();
	const imageData = (src: string) => {
		if (!images.has(src)) {
			const file = path.join(
				publicDir,
				decodeURIComponent(src.replace(/^\//, "")),
			);
			images.set(src, fs.existsSync(file) ? fs.readFileSync(file) : undefined);
		}

		return images.get(src);
	};

	const imagesIn = (html: string) =>
		[
			...new Set([...html.matchAll(/src="(\/[^"]+)"/g)].map((m) => m[1])),
		].flatMap((src) => {
			const data = imageData(src);
			return data ? [{ data, src }] : [];
		});

	const toTakumi = (document: Document) => {
		const content = document.querySelector("#slide-content");
		if (!content) {
			throw new Error("Slide document has no #slide-content.");
		}

		// eslint-disable-next-line @typescript-eslint/no-deprecated -- The only takumi API that keeps each element's attributes, which tie layout back to the DOM. Replace before takumi v3 removes it.
		return fromHtml(content.outerHTML).node;
	};

	const measure = (node: TakumiNode, sheets: string[], html: string) =>
		renderer.measure(node, {
			css: sheets,
			height: SLIDE.height,
			images: imagesIn(html),
			width: SLIDE.width,
		});

	/** Lays out multi-column containers, which takumi doesn't support, as balanced flex columns. */
	async function applyColumnShims(
		document: Document,
		styles: Map<Element, ComputedStyle>,
		sheets: string[],
		html: string,
	) {
		const columns = multiColumns(document, styles);
		if (!columns.length) {
			return;
		}

		shimColumnsForMeasure(columns);
		const measured = await measure(toTakumi(document), sheets, html);
		shimColumnsBalanced(
			columns,
			itemHeights(toTakumi(document), measured, columns, styles),
		);
	}

	async function layoutState(
		no: number,
		html: string,
		{ rules, sheets }: Css,
		options: LayoutOptions = {},
	): Promise<Layout> {
		const document = buildDocument(no, html, options);
		const { markers, styles } = computeStyles(document, rules);
		await applyColumnShims(document, styles, sheets, html);
		const byId = new Map(
			[...document.querySelectorAll(`[${ID}]`)].map((el) => [
				el.getAttribute(ID) ?? "",
				el,
			]),
		);
		const node = toTakumi(document);
		const measured = await measure(node, sheets, html);
		// takumi measures a ::marker box only for list items that draw one.
		const withMarkers = new Set(
			[...styles]
				.filter(
					([, style]) =>
						style.display === "list-item" &&
						style["list-style-type"] !== "none",
				)
				.map(([element]) => element.getAttribute(ID)),
		);
		return {
			...zipLayout(node, measured, (id) => withMarkers.has(id)),
			byId,
			document,
			markers,
			styles,
		};
	}

	/** Renders one element of a slide state (everything else hidden) to a full-slide transparent PNG at 2x. */
	async function rasterize(
		no: number,
		html: string,
		{ rules, sheets }: Css,
		selector: string,
		options: LayoutOptions = {},
	) {
		const document = buildDocument(no, html, options);
		const { styles } = computeStyles(document, rules);
		await applyColumnShims(document, styles, sheets, html);
		const target = document.querySelector(selector);
		if (!target) {
			return undefined;
		}

		for (const el of document.querySelectorAll("#slide-content *")) {
			if (el === target || target.contains(el)) {
				continue;
			}

			// Hide everything but the target; clear its ancestors' paint so only it shows.
			appendStyle(
				el,
				el.contains(target)
					? "background:transparent !important;box-shadow:none !important;border-color:transparent !important"
					: "visibility:hidden",
			);
		}

		const content = document.querySelector("#slide-content");
		if (content) {
			appendStyle(content, "background:transparent !important");
		}

		return renderer.render(toTakumi(document), {
			css: sheets,
			devicePixelRatio: 2,
			format: "png",
			height: SLIDE.height * 2,
			images: imagesIn(html),
			width: SLIDE.width * 2,
		});
	}

	/** Renders the slide canvas background, and the deck's global-bottom layer, to a PNG at 2x. */
	async function renderBackground(
		globalBottom: string,
		{ sheets }: Pick<Css, "sheets">,
	) {
		const document = buildDocument(1, "", { globalBottom });
		return renderer.render(toTakumi(document), {
			css: sheets,
			devicePixelRatio: 2,
			format: "png",
			height: SLIDE.height * 2,
			width: SLIDE.width * 2,
		});
	}

	return { layoutState, rasterize, renderBackground };
}

export function loadFonts(root: string): FontInput[] {
	const fonts: FontInput[] = [
		{
			data: fs.readFileSync(
				path.join(
					root,
					"node_modules/@fontsource-variable/league-spartan/files/league-spartan-latin-wght-normal.woff2",
				),
			),
			name: "League Spartan Variable",
		},
	];
	const optional: {
		files: string[];
		generic?: "emoji" | "ui-monospace";
		name: string;
	}[] = [
		// Chrome renders ui-monospace with SF Mono on macOS; Menlo and DejaVu Sans Mono share its 0.602em advance.
		{
			files: [
				"/System/Library/Fonts/Menlo.ttc",
				"/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
			],
			generic: "ui-monospace",
			name: "ui-monospace",
		},
		{
			files: [
				"/System/Library/Fonts/Supplemental/Impact.ttf",
				"/usr/share/fonts/truetype/msttcorefonts/Impact.ttf",
			],
			name: "Impact",
		},
		// Emoji advances (1em in Chrome) only come from a real emoji font.
		{
			files: [
				"/System/Library/Fonts/Apple Color Emoji.ttc",
				"/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
			],
			generic: "emoji",
			name: "Apple Color Emoji",
		},
	];
	for (const font of optional) {
		const file = font.files.find((f) => fs.existsSync(f));
		if (file) {
			fonts.push({
				data: fs.readFileSync(file),
				generic: font.generic,
				name: font.name,
			});
		}
	}

	return fonts;
}

const appendStyle = (el: Element, css: string) => {
	el.setAttribute("style", `${el.getAttribute("style") ?? ""};${css}`);
};

/** Builds the document a slide state renders in, mirroring Slidev's ancestors, with every element tagged. */
function buildDocument(
	no: number,
	html: string,
	{ globalBottom = "", zoom = 1 }: LayoutOptions = {},
): Document {
	// Slidev zooms a slide by scaling .slidev-page from the top left, at 100%/zoom size.
	const page = `position:absolute;left:0;top:0;width:${String(SLIDE.width / zoom)}px;height:${String(SLIDE.height / zoom)}px${zoom === 1 ? "" : `;transform:scale(${String(zoom)});transform-origin:0 0`}`;
	const { document } = parseHTML(
		`<html class="dark"><head></head><body><div id="app"><div id="page-root"><div id="slide-container"><div id="slide-content" class="slidev-slide-content" style="width:${String(SLIDE.width)}px;height:${String(SLIDE.height)}px;position:relative;overflow:hidden">${globalBottom}<div class="slidev-page slidev-page-${String(no)}" style="${page}">${html}</div></div></div></div></div></body></html>`,
	);
	let next = 0;
	for (const el of document.querySelectorAll("*")) {
		el.setAttribute(ID, String(next++));
	}

	return document;
}

/** Margin-box heights of multi-column items, from a measured tree. */
interface MultiColumn {
	count: number;
	el: Element;
	gap: string;
}

function itemHeights(
	node: TakumiNode,
	measured: MeasuredNode,
	columns: MultiColumn[],
	styles: Map<Element, ComputedStyle>,
) {
	const wanted = new Set(
		columns.flatMap(({ el }) =>
			[...el.children].map((child) => child.getAttribute(ID)),
		),
	);
	const found = new Map<string, number>();
	const walk = (n: TakumiNode, m: MeasuredNode) => {
		const id = idOf(n);
		if (id && wanted.has(id)) {
			found.set(id, m.height);
		}

		const children = childrenOf(n);
		if (m.children.length === children.length) {
			children.forEach((child, i) => {
				walk(child, m.children[i]);
			});
		}
	};

	walk(node, measured);
	const heights = new Map<Element, number>();
	for (const { el } of columns) {
		for (const child of el.children) {
			const style = styles.get(child);
			heights.set(
				child,
				(found.get(child.getAttribute(ID) ?? "") ?? 0) +
					(parseFloat(style?.["margin-top"] ?? "") || 0) +
					(parseFloat(style?.["margin-bottom"] ?? "") || 0),
			);
		}
	}

	return heights;
}

function multiColumns(
	document: Document,
	styles: Map<Element, ComputedStyle>,
): MultiColumn[] {
	const out: MultiColumn[] = [];
	for (const el of document.querySelectorAll("*")) {
		const style = styles.get(el);
		const count = Number(style?.["column-count"]);
		if (count > 1 && el.children.length) {
			out.push({
				count,
				el,
				gap:
					style?.["column-gap"] && style["column-gap"] !== "normal"
						? style["column-gap"]
						: "1em",
			});
		}
	}

	return out;
}

/** Lays multi-column items out in one column of column width, to measure them. */
function shimColumnsForMeasure(columns: MultiColumn[]) {
	for (const { count, el, gap } of columns) {
		appendStyle(el, "display:flex;flex-direction:column;flex-wrap:nowrap");
		for (const child of el.children) {
			appendStyle(
				child,
				`width:calc((100% - ${String(count - 1)} * ${gap}) / ${String(count)});flex-shrink:0`,
			);
		}
	}
}

/**
 * Wraps multi-column items into columns at the smallest height that fits them into
 * N columns in order, which is how CSS balances columns of unbreakable items.
 */
function shimColumnsBalanced(
	columns: MultiColumn[],
	heights: Map<Element, number>,
) {
	for (const { count, el, gap } of columns) {
		const items = [...el.children].map((child) => heights.get(child) ?? 0);
		const fits = (height: number) => {
			let used = 0;
			let columnsUsed = 1;
			for (const item of items) {
				if (used > 0 && used + item > height + 0.01) {
					columnsUsed++;
					used = 0;
				}

				used += item;
			}

			return columnsUsed <= count;
		};

		let low = Math.max(...items);
		let high = items.reduce((a, b) => a + b, 0);
		for (let i = 0; i < 40; i++) {
			const mid = (low + high) / 2;
			if (fits(mid)) {
				high = mid;
			} else {
				low = mid;
			}
		}

		appendStyle(
			el,
			`flex-wrap:wrap;column-gap:${gap};height:${String(Math.ceil(high * 100) / 100)}px;align-content:flex-start`,
		);
	}
}

const childrenOf = (n: TakumiNode): TakumiNode[] =>
	n.type === "container" ? (n.children ?? []) : [];
const idOf = (n: TakumiNode): string | undefined => n.attributes?.[ID];

/**
 * Zips takumi's input tree with its measured tree. Containers with block-level
 * children measure 1:1 with their children; inline-only containers measure as one
 * node whose runs cover all their text, each run tied to the element styling it.
 */
function zipLayout(
	node: TakumiNode,
	measured: MeasuredNode,
	hasMarker: (id: string) => boolean,
): Pick<Layout, "boxes" | "mismatches" | "runs"> {
	const boxes = new Map<string, LaidOutBox>();
	const runs = new Map<string, LaidOutRuns>();
	const mismatches: Layout["mismatches"] = [];

	// A node's descendant text, in order, each with the element whose style it uses.
	const textSegments = (
		n: TakumiNode,
		owner: string,
		out: { owner: string; text: string }[] = [],
	) => {
		if (n.type === "text") {
			out.push({ owner: idOf(n) ?? owner, text: n.text });
		} else {
			for (const child of childrenOf(n)) {
				textSegments(child, idOf(n) ?? owner, out);
			}
		}

		return out;
	};

	const assignRuns = (
		n: TakumiNode,
		m: MeasuredNode,
		owner: string,
	): LaidOutRun[] => {
		const segments = textSegments(n, owner);
		const result: LaidOutRun[] = [];
		let index = 0;
		let offset = 0;
		for (const run of m.runs) {
			// Skip segment text the run doesn't start with (collapsed whitespace, newlines).
			while (
				index < segments.length &&
				!segments[index].text.slice(offset).trim()
			) {
				index++;
				offset = 0;
			}

			result.push({ ...run, owner: segments[index]?.owner ?? owner });
			// Consume the run's non-whitespace characters from the segments.
			let remaining = run.text.replace(/\s/g, "").length;
			while (remaining > 0 && index < segments.length) {
				const text = segments[index].text;
				while (offset < text.length && remaining > 0) {
					if (!/\s/.test(text[offset])) {
						remaining--;
					}

					offset++;
				}

				if (offset >= text.length) {
					index++;
					offset = 0;
				}
			}
		}

		return result;
	};

	const zip = (n: TakumiNode, m: MeasuredNode, owner: string) => {
		const own = idOf(n);
		const id = own ?? owner;
		const [a, b, c, d, e, f] = m.transform;
		const box: LaidOutBox = {
			h: m.height,
			matrix: [a, b, c, d],
			w: m.width,
			x: e,
			y: f,
		};
		if (own !== undefined && !boxes.has(own)) {
			boxes.set(own, box);
		}

		if (m.runs.length) {
			runs.set(own === undefined ? `anon-${String(runs.size)}` : id, {
				anonymous: own === undefined,
				box,
				parent: owner,
				runs: assignRuns(n, m, owner),
			});
		}

		const children = childrenOf(n);
		// A list item's ::marker box is measured as its first child.
		const measuredChildren =
			own !== undefined && hasMarker(own) ? m.children.slice(1) : m.children;
		// Inline content is measured as the runs of its block, not as children.
		if (!measuredChildren.length) {
			return;
		}

		if (measuredChildren.length === children.length) {
			children.forEach((child, i) => {
				zip(child, measuredChildren[i], id);
			});
			return;
		}

		mismatches.push({
			children: children.length,
			id,
			measured: measuredChildren.length,
		});
		children
			.filter((child) => child.type !== "text")
			.forEach((child, i) => {
				if (i < measuredChildren.length) {
					zip(child, measuredChildren[i], id);
				}
			});
	};

	zip(node, measured, idOf(node) ?? "");
	return { boxes, mismatches, runs };
}
