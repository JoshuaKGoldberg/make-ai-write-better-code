/**
 * Lays out a server-rendered slide state without a browser: takumi computes
 * boxes and line runs, the static cascade computes visual styles, and both are
 * keyed back to the same DOM elements through a data attribute.
 */
import type { Font, MeasuredNode, MeasuredTextRun } from "@takumi-rs/core";
import type { Node as TakumiNode } from "@takumi-rs/helpers";

import { Renderer } from "@takumi-rs/core";
import { fromHtml } from "@takumi-rs/helpers/html";
import { parseHTML } from "linkedom";

import type { Assets } from "./assets.ts";
import type { CascadeRule, ComputedStyle, ComputedStyles } from "./cascade.ts";
import type { Box, Canvas } from "./model.ts";

import { cssUrls, imageSize } from "./assets.ts";
import { computeStyles } from "./cascade.ts";

/** The attribute that ties takumi's nodes back to DOM elements. */
export const ID = "data-pptx-id";

/** Marks global-bottom layer elements that are the same on every slide. */
const STATIC = "data-pptx-static";

/** The element generated content (::before and ::after) becomes, so it lays out and exports like any other. */
const PSEUDO_TAG = "pptx-pseudo";

/** Stops takumi from also generating the content that became real elements. */
const PSEUDO_RESET = `[data-pptx-before]::before,[data-pptx-after]::after{content:none !important}`;

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

export interface Layout extends Prepared {
	boxes: Map<string, LaidOutBox>;
	byId: Map<string, Element>;
	mismatches: { children: number; id: string; measured: number }[];
	/** Text runs keyed by owning element id (or `anon-N` for anonymous text). */
	runs: Map<string, LaidOutRuns>;
}

export interface LayoutOptions {
	/** HTML of the global-bottom layers, rendered beneath the slide. */
	globalBottom?: string;
	/** HTML of the global-top layers, rendered above the slide. */
	globalTop?: string;
	/** Indexes of the global-bottom layers' top-level elements that are the same on every slide. */
	staticLayers?: number[];
	/** Slidev's per-slide `zoom`. */
	zoom?: number;
}

/** A slide state's document with its styles computed, ready to lay out. */
export interface Prepared extends Omit<ComputedStyles, "pseudos"> {
	document: Document;
	/** The font-family stacks of elements with text. */
	fontStacks: Set<string>;
	/** Whether generated content became elements, so takumi mustn't generate it too. */
	pseudos: boolean;
}

/** Whether an element is decoration painted into the slide background instead of becoming shapes. */
export function isBackgroundOnly(
	el: Element,
	styles: Map<Element, ComputedStyle>,
) {
	// Static global-bottom decoration with filters (like blurred glows), which PowerPoint can't draw.
	return (
		el.closest(`[${STATIC}]`) !== null &&
		(styles.get(el)?.filter ?? "none") !== "none"
	);
}

/** Lays out slide states with takumi, and renders the parts of slides PowerPoint can't draw. */
export function createLayout({
	assets,
	canvas,
	colorScheme,
}: {
	assets: Assets;
	canvas: Canvas;
	colorScheme: "dark" | "light";
}) {
	const renderer = new Renderer();
	const viewport = { height: canvas.height, width: canvas.width };

	const toTakumi = (document: Document) => {
		const content = document.querySelector("#slide-content");
		if (!content) {
			throw new Error("Slide document has no #slide-content.");
		}

		// eslint-disable-next-line @typescript-eslint/no-deprecated -- The only takumi API that keeps each element's attributes, which tie layout back to the DOM. Replace before takumi v3 removes it.
		return fromHtml(content.outerHTML).node;
	};

	/** Loads the images a document uses: its img and SVG image sources, and its CSS background images. */
	const imagesOf = async (
		document: Document,
		styles: Map<Element, ComputedStyle>,
	) => {
		const urls = new Set<string>();
		for (const el of document.querySelectorAll("img[src], image")) {
			const src =
				el.getAttribute("src") ??
				el.getAttribute("href") ??
				el.getAttribute("xlink:href");
			if (src) {
				urls.add(src);
			}
		}

		for (const style of styles.values()) {
			for (const url of cssUrls(style["background-image"])) {
				urls.add(url);
			}
		}

		const images: { data: Buffer; src: string }[] = [];
		for (const src of urls) {
			const data = await assets.load(src);
			if (data) {
				images.push({ data, src });
			}
		}

		return images;
	};

	const measure = async (
		node: TakumiNode,
		{ document, pseudos, styles }: Prepared,
		sheets: string[],
	) =>
		renderer.measure(node, {
			css: pseudos ? [...sheets, PSEUDO_RESET] : sheets,
			height: canvas.height,
			images: await imagesOf(document, styles),
			width: canvas.width,
		});

	/** Builds a slide state's document and computes its styles, turning generated content into elements. */
	function prepare(
		no: number,
		html: string,
		{ rules }: Pick<Css, "rules">,
		options: LayoutOptions = {},
	): Prepared {
		const document = buildDocument(no, html, canvas, colorScheme, options);
		let computed = computeStyles(document, rules, { viewport });
		const pseudos = computed.pseudos.size > 0;
		if (pseudos) {
			let next = document.querySelectorAll(`[${ID}]`).length;
			for (const [host, { after, before }] of computed.pseudos) {
				for (const [kind, pseudo] of [
					["before", before],
					["after", after],
				] as const) {
					if (!pseudo) {
						continue;
					}

					const el = document.createElement(PSEUDO_TAG);
					el.setAttribute(ID, String(next++));
					el.setAttribute("style", pseudo.css);
					el.textContent = pseudo.text;
					host.setAttribute(`data-pptx-${kind}`, "");
					if (kind === "before") {
						host.prepend(el);
					} else {
						host.append(el);
					}
				}
			}

			computed = computeStyles(document, rules, { viewport });
		}

		const fontStacks = new Set<string>();
		for (const [el, style] of computed.styles) {
			const hasText = [...el.childNodes].some(
				(node) => node.nodeType === node.TEXT_NODE && node.textContent?.trim(),
			);
			if (hasText && style.display !== "none") {
				fontStacks.add(style["font-family"]);
			}
		}

		return {
			document,
			fontStacks,
			markers: computed.markers,
			pseudos,
			styles: computed.styles,
		};
	}

	/** Lays multi-column containers, which takumi doesn't support, out as balanced flex columns. */
	async function applyColumnShims(prepared: Prepared, sheets: string[]) {
		const columns = multiColumns(prepared.document, prepared.styles);
		if (!columns.length) {
			return;
		}

		shimColumnsForMeasure(columns);
		const measured = await measure(
			toTakumi(prepared.document),
			prepared,
			sheets,
		);
		shimColumnsBalanced(
			columns,
			itemHeights(
				toTakumi(prepared.document),
				measured,
				columns,
				prepared.styles,
			),
		);
	}

	async function layoutState(
		prepared: Prepared,
		{ sheets }: Pick<Css, "sheets">,
	): Promise<Layout> {
		const { document, styles } = prepared;
		await applyColumnShims(prepared, sheets);
		const byId = new Map(
			[...document.querySelectorAll(`[${ID}]`)].map((el) => [
				el.getAttribute(ID) ?? "",
				el,
			]),
		);
		const node = toTakumi(document);
		const measured = await measure(node, prepared, sheets);
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
		const outOfFlow = new Set(
			[...styles]
				.filter(([, style]) =>
					/^(?:absolute|fixed)$/.test(style.position ?? ""),
				)
				.map(([element]) => element.getAttribute(ID)),
		);
		return {
			...prepared,
			...zipLayout(
				node,
				measured,
				(id) => withMarkers.has(id),
				(id) => outOfFlow.has(id),
			),
			byId,
		};
	}

	/** Renders just the element `selector` matches (everything else hidden), cropped to `box` in slide px, as a transparent PNG at 2x. */
	async function rasterize(
		no: number,
		html: string,
		css: Css,
		{ box, selector }: { box: Box; selector: string },
		options: LayoutOptions = {},
	) {
		const prepared = prepare(no, html, css, options);
		const { document } = prepared;
		await applyColumnShims(prepared, css.sheets);
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
			appendStyle(
				content,
				`background:transparent !important;transform:translate(${String(-box.x)}px,${String(-box.y)}px)`,
			);
		}

		return renderer.render(toTakumi(document), {
			css: prepared.pseudos ? [...css.sheets, PSEUDO_RESET] : css.sheets,
			devicePixelRatio: 2,
			format: "png",
			height: box.h * 2,
			images: await imagesOf(document, prepared.styles),
			width: box.w * 2,
		});
	}

	/** Renders the slide canvas background, and the global-bottom layer's background-only decoration, to a PNG at 2x. */
	async function renderBackground(css: Css, options: LayoutOptions) {
		const prepared = prepare(1, "", css, {
			globalBottom: options.globalBottom,
			staticLayers: options.staticLayers,
		});
		const { document, styles } = prepared;
		// Everything else in the layer (like a progress bar) varies by slide and becomes shapes.
		const keep = [
			...document.querySelectorAll(".slidev-slide-content *"),
		].filter((el) => isBackgroundOnly(el, styles));
		for (const el of document.querySelectorAll(".slidev-slide-content *")) {
			const related = keep.some(
				(kept) => el === kept || el.contains(kept) || kept.contains(el),
			);
			if (!related) {
				appendStyle(el, "visibility:hidden");
			}
		}

		return renderer.render(toTakumi(document), {
			css: prepared.pseudos ? [...css.sheets, PSEUDO_RESET] : css.sheets,
			devicePixelRatio: 2,
			format: "png",
			height: Math.round(canvas.height * 2),
			images: await imagesOf(document, styles),
			width: Math.round(canvas.width * 2),
		});
	}

	/** Renders an image (like an SVG or WebP, which PowerPoint can't show) to a PNG at up to 2x its natural size. */
	async function toPng(src: string) {
		const data = await assets.load(src);
		if (!data) {
			return undefined;
		}

		const { h, w } = imageSize(data) ?? { h: canvas.height, w: canvas.width };
		const scale = Math.min(2, 4096 / Math.max(w, h));
		const escaped = src.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
		// eslint-disable-next-line @typescript-eslint/no-deprecated -- As in toTakumi.
		const { node } = fromHtml(
			`<img src="${escaped}" style="display:block;width:${String(w)}px;height:${String(h)}px">`,
		);
		return renderer.render(node, {
			devicePixelRatio: scale,
			format: "png",
			height: Math.round(h * scale),
			images: [{ data, src }],
			width: Math.round(w * scale),
		});
	}

	/** Registers fonts for layout and rendering, in order. */
	async function registerFonts(fonts: Font[]) {
		for (const font of fonts) {
			await renderer.registerFont(font);
		}
	}

	return {
		layoutState,
		prepare,
		rasterize,
		registerFonts,
		renderBackground,
		toPng,
	};
}

const appendStyle = (el: Element, css: string) => {
	el.setAttribute("style", `${el.getAttribute("style") ?? ""};${css}`);
};

/** Builds the document a slide state renders in, mirroring Slidev's ancestors, with every element tagged. */
function buildDocument(
	no: number,
	html: string,
	canvas: Canvas,
	colorScheme: "dark" | "light",
	{
		globalBottom = "",
		globalTop = "",
		staticLayers = [],
		zoom = 1,
	}: LayoutOptions = {},
): Document {
	// Slidev zooms a slide by scaling .slidev-page from the top left, at 100%/zoom size.
	const page = `position:absolute;left:0;top:0;width:${String(canvas.width / zoom)}px;height:${String(canvas.height / zoom)}px${zoom === 1 ? "" : `;transform:scale(${String(zoom)});transform-origin:0 0`}`;
	const { document } = parseHTML(
		`<html${colorScheme === "dark" ? ' class="dark"' : ""}><head></head><body><div id="app"><div id="page-root"><div id="slide-container"><div id="slide-content" class="slidev-slide-content" style="width:${String(canvas.width)}px;height:${String(canvas.height)}px;position:relative;overflow:hidden">${globalBottom}<div class="slidev-page slidev-page-${String(no)}" style="${page}">${html}</div>${globalTop}</div></div></div></div></body></html>`,
	);
	// takumi has no <wbr>; a zero-width space is the same line-break opportunity.
	for (const wbr of document.querySelectorAll("wbr")) {
		wbr.replaceWith(document.createTextNode("\u200B"));
	}

	const content = document.querySelector("#slide-content");
	const layers = [...(content?.children ?? [])];
	layers
		.slice(
			0,
			layers.findIndex((el) => el.classList.contains("slidev-page")),
		)
		.forEach((el, index) => {
			if (staticLayers.includes(index)) {
				el.setAttribute(STATIC, "");
			}
		});

	let next = 0;
	for (const el of document.querySelectorAll("*")) {
		el.setAttribute(ID, String(next++));
	}

	return document;
}

/** Indexes of a global-bottom layer's top-level elements that are the same in every slide's render. */
export function staticLayerIndexes(renders: string[]) {
	const tops = renders.map((html) =>
		[
			...parseHTML(`<html><body>${html}</body></html>`).document.body.children,
		].map((el) => el.outerHTML),
	);
	const first = tops[0] ?? [];
	return first.flatMap((html, index) =>
		tops.every(
			(other) => other.length === first.length && other[index] === html,
		)
			? [index]
			: [],
	);
}

/** A container laid out in CSS columns. */
interface MultiColumn {
	count: number;
	el: Element;
	gap: string;
}

/** Margin-box heights of multi-column items, from a measured tree. */
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

/** Finds containers laid out in CSS columns, which takumi doesn't support. */
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
	isOutOfFlow: (id: string) => boolean,
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

		// Inline content beside absolutely positioned children measures as one anonymous
		// line box: its runs, then a placeholder for each positioned child, then their boxes.
		const positioned = children.filter((child) => {
			const childId = idOf(child);
			return childId !== undefined && isOutOfFlow(childId);
		});
		const [lines] = measuredChildren;
		if (
			n.type === "container" &&
			positioned.length &&
			measuredChildren.length === 1 &&
			lines.runs.length &&
			lines.children.length === positioned.length * 2
		) {
			const inline: TakumiNode = {
				...n,
				children: children.filter((child) => !positioned.includes(child)),
			};
			runs.set(own === undefined ? `anon-${String(runs.size)}` : id, {
				anonymous: own === undefined,
				box,
				parent: owner,
				runs: assignRuns(inline, lines, owner),
			});
			positioned.forEach((child, i) => {
				zip(child, lines.children[positioned.length + i], id);
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
