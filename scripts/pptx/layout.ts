/**
 * Lays out a server-rendered slide state without a browser: takumi computes
 * boxes and line runs, the static cascade computes visual styles, and both are
 * keyed back to the same DOM elements through a data attribute.
 */
import type { Font, MeasuredNode, MeasuredTextRun } from "@takumi-rs/core";
import type { Node as TakumiNode } from "@takumi-rs/helpers";

import { Renderer } from "@takumi-rs/core";
import { image } from "@takumi-rs/helpers";
import { fromHtml } from "@takumi-rs/helpers/html";
import { NodeFilter, parseHTML } from "linkedom";

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

/** Entities for the characters takumi's HTML parser needs escaped in attribute values: it ends a tag at the first `>`, even inside quotes. */
const ATTRIBUTE_ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
};

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

interface MultiColumn {
	count: number;
	element: Element;
	gap: string;
}

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

	const imagesOf = async (
		document: Document,
		styles: Map<Element, ComputedStyle>,
	) => {
		const urls = new Set<string>();
		for (const element of document.querySelectorAll("img[src], image")) {
			const src =
				element.getAttribute("src") ??
				element.getAttribute("href") ??
				element.getAttribute("xlink:href");
			if (src) {
				urls.add(src);
			}
		}

		for (const style of styles.values()) {
			for (const url of cssUrls(style["background-image"])) {
				urls.add(url);
			}
		}

		const images = await Promise.all(
			[...urls].map(async (src) => {
				const data = await assets.load(src);
				return data ? [{ data, src }] : [];
			}),
		);
		return images.flat();
	};

	const renderOptions = async (
		{ document, pseudos, styles }: Prepared,
		sheets: string[],
	) => ({
		css: pseudos ? [...sheets, PSEUDO_RESET] : sheets,
		images: await imagesOf(document, styles),
	});

	const renderPng = async (
		document: Document,
		prepared: Prepared,
		sheets: string[],
		pixels: { height: number; width: number },
	) =>
		renderer.render(toTakumi(slideContentOf(document)), {
			...(await renderOptions(prepared, sheets)),
			...pixels,
			devicePixelRatio: 2,
			format: "png",
		});

	async function measureLayout(prepared: Prepared, sheets: string[]) {
		const node = toTakumi(slideContentOf(prepared.document));
		const measured = await renderer.measure(node, {
			...(await renderOptions(prepared, sheets)),
			height: canvas.height,
			width: canvas.width,
		});
		const stylesById = new Map(
			[...prepared.styles].map(([element, style]) => [
				element.getAttribute(ID) ?? "",
				style,
			]),
		);
		return zipLayout(node, measured, (id) => stylesById.get(id));
	}

	function prepare(
		slideNumber: number,
		html: string,
		{ rules }: Pick<Css, "rules">,
		options: LayoutOptions,
	) {
		const document = buildDocument(
			slideNumber,
			html,
			canvas,
			colorScheme,
			options,
		);
		let computed = computeStyles(document, rules, { viewport: canvas });
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

					const element = document.createElement(PSEUDO_TAG);
					element.setAttribute(ID, String(next++));
					element.setAttribute("style", pseudo.css);
					element.textContent = pseudo.text;
					host.setAttribute(`data-pptx-${kind}`, "");
					if (kind === "before") {
						host.prepend(element);
					} else {
						host.append(element);
					}
				}
			}

			computed = computeStyles(document, rules, { viewport: canvas });
		}

		const fontStacks = new Set<string>();
		for (const [element, style] of computed.styles) {
			const hasText = [...element.childNodes].some(
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

	async function applyColumnShims(prepared: Prepared, sheets: string[]) {
		const columns = multiColumns(prepared.document, prepared.styles);
		if (!columns.length) {
			return;
		}

		shimColumnsForMeasure(columns);
		const { boxes } = await measureLayout(prepared, sheets);
		shimColumnsBalanced(columns, (item) => {
			const style = prepared.styles.get(item);
			return (
				(boxes.get(item.getAttribute(ID) ?? "")?.h ?? 0) +
				(parseFloat(style?.["margin-top"] ?? "") || 0) +
				(parseFloat(style?.["margin-bottom"] ?? "") || 0)
			);
		});
	}

	async function layoutState(
		prepared: Prepared,
		{ sheets }: Pick<Css, "sheets">,
	) {
		await applyColumnShims(prepared, sheets);
		return {
			...prepared,
			...(await measureLayout(prepared, sheets)),
			byId: new Map(
				[...prepared.document.querySelectorAll(`[${ID}]`)].map((element) => [
					element.getAttribute(ID) ?? "",
					element,
				]),
			),
		};
	}

	async function rasterize(
		prepared: Prepared,
		{ sheets }: Pick<Css, "sheets">,
		{ box, selector }: { box: Box; selector: string },
	) {
		const { document } = parseHTML(prepared.document.documentElement.outerHTML);
		const target = document.querySelector(selector);
		if (!target) {
			return undefined;
		}

		const content = slideContentOf(document);
		for (const element of content.querySelectorAll("*")) {
			if (element === target || target.contains(element)) {
				continue;
			}

			appendStyle(
				element,
				element.contains(target)
					? "background:transparent !important;box-shadow:none !important;border-color:transparent !important"
					: "visibility:hidden",
			);
		}

		appendStyle(
			content,
			`background:transparent !important;transform:translate(${String(-box.x)}px,${String(-box.y)}px)`,
		);
		return renderPng(document, prepared, sheets, {
			height: box.h * 2,
			width: box.w * 2,
		});
	}

	async function renderBackground(css: Css, options: LayoutOptions) {
		const prepared = prepare(1, "", css, {
			globalBottom: options.globalBottom,
			staticLayers: options.staticLayers,
		});
		const { document, styles } = prepared;
		const elements = [...document.querySelectorAll(".slidev-slide-content *")];
		const kept = elements.filter((element) =>
			isBackgroundOnly(element, styles),
		);
		for (const element of elements) {
			if (
				!kept.some(
					(keep) =>
						element === keep ||
						element.contains(keep) ||
						keep.contains(element),
				)
			) {
				appendStyle(element, "visibility:hidden");
			}
		}

		return renderPng(document, prepared, css.sheets, {
			height: Math.round(canvas.height * 2),
			width: Math.round(canvas.width * 2),
		});
	}

	async function toPng(src: string) {
		const data = await assets.load(src);
		if (!data) {
			return undefined;
		}

		const { h, w } = imageSize(data) ?? { h: canvas.height, w: canvas.width };
		const scale = Math.min(2, 4096 / Math.max(w, h));
		return renderer.render(
			image({ src: data, style: { display: "block", height: h, width: w } }),
			{
				devicePixelRatio: scale,
				format: "png",
				height: Math.round(h * scale),
				width: Math.round(w * scale),
			},
		);
	}

	async function averageColor(png: Buffer) {
		const size = 8;
		const pixels = await renderer.render(
			image({ src: png, style: { height: size, width: size } }),
			{ format: "raw", height: size, width: size },
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

	async function registerFonts(fonts: Font[]) {
		for (const font of fonts) {
			await renderer.registerFont(font);
		}
	}

	return {
		averageColor,
		layoutState,
		prepare,
		rasterize,
		registerFonts,
		renderBackground,
		toPng,
	};
}

export function isBackgroundOnly(
	element: Element,
	styles: Map<Element, ComputedStyle>,
) {
	return (
		element.closest(`[${STATIC}]`) !== null &&
		(styles.get(element)?.filter ?? "none") !== "none"
	);
}

const appendStyle = (element: Element, css: string) => {
	element.setAttribute(
		"style",
		`${element.getAttribute("style") ?? ""};${css}`,
	);
};

const slideContentOf = (document: Document) => {
	const content = document.querySelector("#slide-content");
	if (!content) {
		throw new Error("Slide document has no #slide-content.");
	}

	return content;
};

const toTakumi = (content: Element) => {
	const copy = content.cloneNode(true) as Element;
	for (const element of [copy, ...copy.querySelectorAll("*")]) {
		for (const attribute of element.attributes) {
			attribute.value = attribute.value.replace(
				/[&<>]/g,
				(character) => ATTRIBUTE_ENTITIES[character],
			);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-deprecated -- The only takumi API that keeps each element's attributes, which tie layout back to the DOM. Replace before takumi v3 removes it.
	return fromHtml(copy.outerHTML).node;
};

function buildDocument(
	slideNumber: number,
	html: string,
	canvas: Canvas,
	colorScheme: "dark" | "light",
	{
		globalBottom = "",
		globalTop = "",
		staticLayers = [],
		zoom = 1,
	}: LayoutOptions,
) {
	const page = `position:absolute;left:0;top:0;width:${String(canvas.width / zoom)}px;height:${String(canvas.height / zoom)}px${zoom === 1 ? "" : `;transform:scale(${String(zoom)});transform-origin:0 0`}`;
	const { document } = parseHTML(
		`<html${colorScheme === "dark" ? ' class="dark"' : ""}><head></head><body><div id="app"><div id="page-root"><div id="slide-container"><div id="slide-content" class="slidev-slide-content" style="width:${String(canvas.width)}px;height:${String(canvas.height)}px;position:relative;overflow:hidden">${globalBottom}<div class="slidev-page slidev-page-${String(slideNumber)}" style="${page}">${html}</div>${globalTop}</div></div></div></div></body></html>`,
	);
	const comments = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
	for (let comment = comments.nextNode(); comment;) {
		const next = comments.nextNode();
		comment.parentNode?.removeChild(comment);
		comment = next;
	}

	// takumi has no <wbr>; a zero-width space is the same line-break opportunity.
	for (const wbr of document.querySelectorAll("wbr")) {
		wbr.replaceWith(document.createTextNode("​"));
	}

	const layers = slideContentOf(document).children;
	for (const index of staticLayers) {
		layers[index].setAttribute(STATIC, "");
	}

	let next = 0;
	for (const element of document.querySelectorAll("*")) {
		element.setAttribute(ID, String(next++));
	}

	return document;
}

function multiColumns(document: Document, styles: Map<Element, ComputedStyle>) {
	const columns: MultiColumn[] = [];
	for (const element of document.querySelectorAll("*")) {
		const style = styles.get(element);
		const count = Number(style?.["column-count"]);
		if (count > 1 && element.children.length) {
			columns.push({
				count,
				element,
				gap:
					style?.["column-gap"] && style["column-gap"] !== "normal"
						? style["column-gap"]
						: "1em",
			});
		}
	}

	return columns;
}

function shimColumnsBalanced(
	columns: MultiColumn[],
	heightOf: (item: Element) => number,
) {
	for (const { count, element, gap } of columns) {
		const items = [...element.children].map(heightOf);
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
		let high = items.reduce((total, item) => total + item, 0);
		for (let iteration = 0; iteration < 40; iteration++) {
			const middle = (low + high) / 2;
			if (fits(middle)) {
				high = middle;
			} else {
				low = middle;
			}
		}

		appendStyle(
			element,
			`flex-wrap:wrap;column-gap:${gap};height:${String(Math.ceil(high * 100) / 100)}px;align-content:flex-start`,
		);
	}
}

function shimColumnsForMeasure(columns: MultiColumn[]) {
	for (const { count, element, gap } of columns) {
		appendStyle(element, "display:flex;flex-direction:column;flex-wrap:nowrap");
		for (const child of element.children) {
			appendStyle(
				child,
				`width:calc((100% - ${String(count - 1)} * ${gap}) / ${String(count)});flex-shrink:0`,
			);
		}
	}
}

const idOf = (node: TakumiNode) => node.attributes?.[ID];

function zipLayout(
	node: TakumiNode,
	measured: MeasuredNode,
	styleOf: (id: string) => ComputedStyle | undefined,
) {
	const boxes = new Map<string, LaidOutBox>();
	const runs = new Map<string, LaidOutRuns>();
	const mismatches: Layout["mismatches"] = [];
	const hasStyle = (
		node: TakumiNode,
		test: (style: ComputedStyle) => boolean,
	) => {
		const id = idOf(node);
		const style = id === undefined ? undefined : styleOf(id);
		return style !== undefined && test(style);
	};

	const childrenOf = (node: TakumiNode) =>
		node.type === "container"
			? (node.children ?? []).filter(
					(child) => !hasStyle(child, ({ display }) => display === "none"),
				)
			: [];

	const textSegments = (
		node: TakumiNode,
		owner: string,
		segments: { owner: string; text: string }[] = [],
	) => {
		if (node.type === "text") {
			segments.push({ owner: idOf(node) ?? owner, text: node.text });
		} else {
			for (const child of childrenOf(node)) {
				textSegments(child, idOf(node) ?? owner, segments);
			}
		}

		return segments;
	};

	const assignRuns = (
		node: TakumiNode,
		measured: MeasuredNode,
		owner: string,
	) => {
		const segments = textSegments(node, owner);
		const result: LaidOutRun[] = [];
		let index = 0;
		let offset = 0;
		for (const run of measured.runs) {
			while (
				index < segments.length &&
				!segments[index].text.slice(offset).trim()
			) {
				index++;
				offset = 0;
			}

			result.push({ ...run, owner: segments[index]?.owner ?? owner });
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

	const addRuns = (
		node: TakumiNode,
		measured: MeasuredNode,
		owner: string,
		box: LaidOutBox,
	) => {
		const own = idOf(node);
		runs.set(own ?? `anon-${String(runs.size)}`, {
			anonymous: own === undefined,
			box,
			parent: owner,
			runs: assignRuns(node, measured, owner),
		});
	};

	const zip = (node: TakumiNode, measured: MeasuredNode, owner: string) => {
		const own = idOf(node);
		const id = own ?? owner;
		const [a, b, c, d, e, f] = measured.transform;
		const box: LaidOutBox = {
			h: measured.height,
			matrix: [a, b, c, d],
			w: measured.width,
			x: e,
			y: f,
		};
		if (own !== undefined) {
			boxes.set(own, box);
		}

		if (measured.runs.length) {
			addRuns(node, measured, owner, box);
		}

		const children = childrenOf(node);
		// A list item's ::marker box is measured as its first child.
		const measuredChildren = hasStyle(
			node,
			(style) =>
				style.display === "list-item" && style["list-style-type"] !== "none",
		)
			? measured.children.slice(1)
			: measured.children;
		if (!measuredChildren.length) {
			return;
		}

		if (measuredChildren.length === children.length) {
			children.forEach((child, index) => {
				zip(child, measuredChildren[index], id);
			});
			return;
		}

		// takumi measures inline content beside positioned children as one line box:
		// its runs, then a placeholder per positioned child, then their boxes.
		const positioned = children.filter((child) =>
			hasStyle(child, ({ position }) =>
				/^(?:absolute|fixed)$/.test(position ?? ""),
			),
		);
		const [lines] = measuredChildren;
		if (
			node.type === "container" &&
			positioned.length &&
			measuredChildren.length === 1 &&
			lines.runs.length &&
			lines.children.length === positioned.length * 2
		) {
			addRuns(
				{
					...node,
					children: children.filter((child) => !positioned.includes(child)),
				},
				lines,
				owner,
				box,
			);
			positioned.forEach((child, index) => {
				zip(child, lines.children[positioned.length + index], id);
			});
			return;
		}

		mismatches.push({
			children: children.length,
			id,
			measured: measuredChildren.length,
		});
		children
			.filter((child) => idOf(child) !== undefined)
			.forEach((child, index) => {
				if (index < measuredChildren.length) {
					zip(child, measuredChildren[index], id);
				}
			});
	};

	zip(node, measured, idOf(node) ?? "");
	return { boxes, mismatches, runs };
}
