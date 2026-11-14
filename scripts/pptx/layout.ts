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
import {
	computeStyles,
	hasMarker,
	isOutOfFlow,
	laysOutApart,
} from "./cascade.ts";
import { parseDeclarations } from "./css.ts";

/** The attribute that ties takumi's nodes back to DOM elements. */
export const ID = "data-pptx-id";

/** Marks global-bottom layer elements that are the same on every slide. */
const STATIC = "data-pptx-static";

export const ZERO_WIDTH_SPACE = "\u200B";

/** The elements ::before and ::after content becomes. */
export const GENERATED_ELEMENTS = {
	after: "pptx-after",
	before: "pptx-before",
} as const;

/** Stops takumi from also generating the content that became real elements. */
const PSEUDO_RESET = `[data-pptx-before]::before,[data-pptx-after]::after{content:none !important}`;

const SCROLLING_OVERFLOWS = {
	auto: "hidden",
	overlay: "hidden",
	scroll: "hidden",
};

/** Inline values takumi rejects, as the values a static slide shows the same way. */
const STATIC_EQUIVALENTS: Partial<
	Record<string, Partial<Record<string, string>>>
> = {
	overflow: SCROLLING_OVERFLOWS,
	"overflow-x": SCROLLING_OVERFLOWS,
	"overflow-y": SCROLLING_OVERFLOWS,
	position: { sticky: "relative" },
};

/** Whether a run starts past the rest of a text node: past its white space, unless the run is white space too and the text's isn't a line break, which takumi doesn't lay out as a run. */
const startsPast = (rest: string, runText: string) =>
	!rest.trim() && (Boolean(runText.trim()) || rest.includes("\n"));

/** Entities for the characters takumi's HTML parser needs escaped in attribute values: it ends a tag at the first `>`, even inside quotes. */
const ATTRIBUTE_ENTITIES: Record<string, string> = {
	'"': "&quot;",
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
};

export interface Css {
	rules: CascadeRule[];
	sheets: string[];
}

export interface LaidOutBox {
	height: number;
	/** The node's absolute transform: [a, b, c, d] of the CSS matrix. */
	matrix: [number, number, number, number];
	width: number;
	x: number;
	y: number;
}

export interface LaidOutRun extends MeasuredTextRun {
	/** The id of the element whose style this run uses. */
	owner: string;
}

export interface LaidOutRuns {
	box: LaidOutBox;
	runs: LaidOutRun[];
}

export interface Layout extends Prepared {
	boxes: Map<string, LaidOutBox>;
	byId: Map<string, Element>;
	/** Text not wrapped in an element of its own (beside block-level siblings), keyed by its container's id. */
	looseRuns: Map<string, LaidOutRuns[]>;
	mismatches: Mismatch[];
	/** Text runs keyed by the id of the element they're laid out in. */
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
}

/** An element whose children takumi measured a different number of. */
interface Mismatch {
	children: number;
	element: Element;
	id: string;
	measured: number;
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
	const supported = new Map<string, Promise<boolean>>();

	const supports = (declaration: string) => {
		const result =
			supported.get(declaration) ??
			renderer
				.measure(
					takumiNodeOfHtml(
						`<div style="${escapeAttribute(declaration)}"></div>`,
					),
					{
						height: 1,
						width: 1,
					},
				)
				.then(
					() => true,
					() => false,
				);
		supported.set(declaration, result);
		return result;
	};

	/** An inline style with the values takumi rejects mapped to static equivalents, or else dropped, as browsers drop invalid ones. */
	const supportedStyle = async (style: string) => {
		const declarations = await Promise.all(
			parseDeclarations(style).map(async ({ important, property, value }) => {
				const declaration = `${property}:${STATIC_EQUIVALENTS[property]?.[value] ?? value}${important ? " !important" : ""}`;
				return (await supports(declaration)) ? [declaration] : [];
			}),
		);
		return declarations.flat().join(";");
	};

	const takumiNodeOf = async (content: Element) => {
		const copy = content.cloneNode(true) as Element;
		for (const image of copy.querySelectorAll("img:not([src]), img[src='']")) {
			image.remove();
		}

		for (const element of [copy, ...copy.querySelectorAll("[style]")]) {
			const style = element.getAttribute("style");
			if (style) {
				element.setAttribute("style", await supportedStyle(style));
			}
		}

		for (const element of [copy, ...copy.querySelectorAll("*")]) {
			for (const attribute of element.attributes) {
				attribute.value = escapeAttribute(attribute.value);
			}
		}

		return takumiNodeOfHtml(copy.outerHTML);
	};

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
		{ document, styles }: Prepared,
		sheets: string[],
	) => ({
		css: [...sheets, PSEUDO_RESET],
		images: await imagesOf(document, styles),
	});

	const renderPng = async (
		document: Document,
		prepared: Prepared,
		sheets: string[],
		pixels: { height: number; width: number },
	) =>
		renderer.render(await takumiNodeOf(slideContentOf(document)), {
			...(await renderOptions(prepared, sheets)),
			...pixels,
			devicePixelRatio: 2,
			format: "png",
		});

	async function measureLayout(prepared: Prepared, sheets: string[]) {
		const node = await takumiNodeOf(slideContentOf(prepared.document));
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
		if (computed.pseudos.size) {
			let next = document.querySelectorAll(`[${ID}]`).length;
			for (const [host, { after, before }] of computed.pseudos) {
				for (const [kind, pseudo] of [
					["before", before],
					["after", after],
				] as const) {
					if (!pseudo) {
						continue;
					}

					const element = document.createElement(GENERATED_ELEMENTS[kind]);
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
				(boxes.get(item.getAttribute(ID) ?? "")?.height ?? 0) +
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
		const byId = new Map(
			[...prepared.document.querySelectorAll(`[${ID}]`)].map((element) => [
				element.getAttribute(ID) ?? "",
				element,
			]),
		);
		const { mismatches, ...measured } = await measureLayout(prepared, sheets);
		return {
			...prepared,
			...measured,
			byId,
			mismatches: mismatches.flatMap((mismatch): Mismatch[] => {
				const element = byId.get(mismatch.id);
				return element ? [{ ...mismatch, element }] : [];
			}),
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
			height: box.height * 2,
			width: box.width * 2,
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

		const { height, width } = imageSize(data) ?? canvas;
		const scale = Math.min(2, 4096 / Math.max(width, height));
		return renderer.render(
			image({ src: data, style: { display: "block", height, width } }),
			{
				devicePixelRatio: scale,
				format: "png",
				height: Math.round(height * scale),
				width: Math.round(width * scale),
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

const escapeAttribute = (value: string) =>
	value.replace(/["&<>]/g, (character) => ATTRIBUTE_ENTITIES[character]);

const takumiNodeOfHtml = (html: string) =>
	// eslint-disable-next-line @typescript-eslint/no-deprecated -- The only takumi API that keeps each element's attributes, which tie layout back to the DOM. Replace before takumi v3 removes it.
	fromHtml(html).node;

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
		wbr.replaceWith(document.createTextNode(ZERO_WIDTH_SPACE));
	}

	for (const hidden of document.querySelectorAll(
		"details:not([open]) > :not(summary)",
	)) {
		hidden.remove();
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

const laidOutBox = ({
	height,
	transform: [a, b, c, d, x, y],
	width,
}: MeasuredNode): LaidOutBox => ({
	height,
	matrix: [a, b, c, d],
	width,
	x,
	y,
});

function zipLayout(
	node: TakumiNode,
	measured: MeasuredNode,
	styleOf: (id: string) => ComputedStyle | undefined,
) {
	const boxes = new Map<string, LaidOutBox>();
	const runs = new Map<string, LaidOutRuns>();
	const looseRuns = new Map<string, LaidOutRuns[]>();
	const mismatches: Omit<Mismatch, "element">[] = [];
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

	const isApart = (node: TakumiNode) =>
		node.type === "image" || hasStyle(node, laysOutApart);

	const displayOf = (node: TakumiNode) => {
		const id = idOf(node);
		return id === undefined ? "inline" : styleOf(id)?.display;
	};

	const isInlineLevel = (node: TakumiNode) =>
		displayOf(node)?.startsWith("inline") === true;

	const isTable = (node: TakumiNode) =>
		/^(?:inline-)?table$/.test(displayOf(node) ?? "");

	const apartOf = (nodes: TakumiNode[]): TakumiNode[] =>
		nodes.flatMap((child) =>
			isApart(child)
				? [child]
				: isInlineLevel(child)
					? apartOf(childrenOf(child))
					: [],
		);

	const segmentsOf = (children: TakumiNode[]) => {
		const segments: (TakumiNode | TakumiNode[])[] = [];
		let inline: TakumiNode[] = [];
		const endInline = () => {
			const hasContent = inline.some(
				(child) =>
					isInlineLevel(child) &&
					!(
						child.type === "text" &&
						idOf(child) === undefined &&
						!child.text.trim()
					),
			);
			if (hasContent) {
				segments.push(inline);
			} else {
				segments.push(...inline.filter((child) => !isInlineLevel(child)));
			}

			inline = [];
		};

		for (const child of children) {
			if (isInlineLevel(child) || hasStyle(child, isOutOfFlow)) {
				inline.push(child);
			} else {
				endInline();
				segments.push(child);
			}
		}

		endInline();
		return segments;
	};

	const ownedTexts = (
		node: TakumiNode,
		parentId: string,
		texts: { owner: string; text: string }[] = [],
	) => {
		if (node.type === "text") {
			texts.push({ owner: idOf(node) ?? parentId, text: node.text });
		} else {
			for (const child of childrenOf(node).filter((child) => !isApart(child))) {
				ownedTexts(child, idOf(node) ?? parentId, texts);
			}
		}

		return texts;
	};

	const assignRuns = (
		node: TakumiNode,
		measuredRuns: MeasuredTextRun[],
		parentId: string,
	) => {
		const texts = ownedTexts(node, parentId);
		const result: LaidOutRun[] = [];
		let index = 0;
		let offset = 0;
		for (const run of measuredRuns) {
			while (
				index < texts.length &&
				startsPast(texts[index].text.slice(offset), run.text)
			) {
				index++;
				offset = 0;
			}

			result.push({
				...run,
				owner: texts.at(index)?.owner ?? idOf(node) ?? parentId,
			});
			let remaining = run.text.replace(/\s/g, "").length;
			while (remaining > 0 && index < texts.length) {
				const text = texts[index].text;
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

	const mismatch = (id: string, children: number, measured: number) => {
		mismatches.push({ children, id, measured });
	};

	// takumi measures an inline formatting context's boxes after its runs: each box
	// laid out apart from the text, sometimes after a placeholder per out-of-flow box.
	const zipInline = (
		nodes: TakumiNode[],
		measuredChildren: MeasuredNode[],
		id: string,
	) => {
		const apart = apartOf(nodes);
		const placeholders = measuredChildren.length - apart.length;
		if (
			placeholders !== 0 &&
			placeholders !==
				apart.filter((child) => hasStyle(child, isOutOfFlow)).length
		) {
			return false;
		}

		apart.forEach((child, index) => {
			zip(child, measuredChildren[placeholders + index], id);
		});
		return true;
	};

	const zipLines = (
		node: TakumiNode,
		lines: Pick<MeasuredNode, "children" | "runs">,
		parentId: string,
		box: LaidOutBox,
	) => {
		const own = idOf(node);
		const id = own ?? parentId;
		if (lines.runs.length) {
			const entry = { box, runs: assignRuns(node, lines.runs, parentId) };
			if (own === undefined) {
				looseRuns.set(parentId, [...(looseRuns.get(parentId) ?? []), entry]);
			} else {
				runs.set(own, entry);
			}
		}

		const children = childrenOf(node);
		if (!zipInline(children, lines.children, id)) {
			mismatch(id, children.length, lines.children.length);
		}
	};

	const zip = (node: TakumiNode, measured: MeasuredNode, parentId: string) => {
		const own = idOf(node);
		const id = own ?? parentId;
		const box = laidOutBox(measured);
		if (own !== undefined) {
			boxes.set(own, box);
		}

		// A list item's ::marker is measured as its first child, or inside its text as its first run.
		const inside = hasStyle(
			node,
			(style) => style["list-style-position"] === "inside",
		);
		const marker = hasStyle(node, hasMarker) ? 1 : 0;
		const lines = {
			children: measured.children.slice(inside ? 0 : marker),
			runs: measured.runs.slice(inside ? marker : 0),
		};
		if (lines.runs.length) {
			zipLines(node, lines, parentId, box);
			return;
		}

		if (node.type !== "container") {
			// Bare text in a flex or grid container lays out as one anonymous item.
			if (node.type === "text" && lines.children.length === 1) {
				zip({ text: node.text, type: "text" }, lines.children[0], id);
			}

			return;
		}

		const children = childrenOf(node);
		if (
			isTable(node) &&
			lines.children.length === 1 &&
			children.every((child) => displayOf(child) === "table-row")
		) {
			// takumi measures a table's rows outside a row group inside an anonymous one.
			zip({ children, type: "container" }, lines.children[0], id);
			return;
		}

		const segments = segmentsOf(children);
		const [first] = segments;
		if (
			segments.length === 1 &&
			Array.isArray(first) &&
			!ownedTexts({ children: first, type: "container" }, "").some(({ text }) =>
				text.trim(),
			) &&
			zipInline(first, lines.children, id)
		) {
			return;
		}

		if (segments.length !== lines.children.length) {
			mismatch(id, children.length, lines.children.length);
		}

		const ownsLine =
			segments.length === 1 &&
			!hasStyle(node, ({ display }) => /flex|grid/.test(display));
		segments.slice(0, lines.children.length).forEach((segment, index) => {
			const child = lines.children[index];
			if (!Array.isArray(segment)) {
				zip(segment, child, id);
			} else if (ownsLine) {
				zipLines(node, child, parentId, box);
			} else {
				zipLines(
					{ children: segment, type: "container" },
					child,
					id,
					laidOutBox(child),
				);
			}
		});
	};

	zip(node, measured, idOf(node) ?? "");
	return { boxes, looseRuns, mismatches, runs };
}
