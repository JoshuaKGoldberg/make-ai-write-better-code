import type { Assets } from "../assets.ts";
import type { FontBook } from "../fonts.ts";
import type { LaidOutRuns, Layout } from "../layout.ts";
import type { Canvas, ExtractedItem } from "../model.ts";
import type { Insets, Side } from "./geometry.ts";

import { INITIAL_STYLE, resolveLength } from "../cascade.ts";
import { ID } from "../layout.ts";
import { scaleOf, SIDES } from "./geometry.ts";

export type ExtractContext = ReturnType<typeof createExtractContext>;

export interface ExtractOptions {
	/** Loaded images, by the URLs pages use. */
	assets: Assets;
	canvas: Canvas;
	fonts: FontBook;
}

export type ItemInput = WithoutDerived<ExtractedItem>;

type WithoutDerived<Item> = Item extends unknown
	? Omit<Item, "decorative">
	: never;

export const MIN_OPACITY = 0.05;

const GENERATED_CONTENT = new Set(["pptx-after", "pptx-before"]);

const insetsOf = (widthOf: (side: Side) => number): Insets => ({
	bottom: widthOf("bottom"),
	left: widthOf("left"),
	right: widthOf("right"),
	top: widthOf("top"),
});

const isElement = (node: Node): node is Element =>
	node.nodeType === node.ELEMENT_NODE;

const isDecoration = (item: ItemInput) =>
	!("paragraphs" in item) && !("alt" in item && item.alt.trim());

export function createExtractContext(
	layout: Layout,
	{ assets, canvas, fonts }: ExtractOptions,
) {
	const { boxes, byId, document, markers, runs, styles } = layout;
	const items: ExtractedItem[] = [];
	const problems: string[] = [];
	const looseRuns = new Map<string, LaidOutRuns[]>();
	for (const entry of runs.values()) {
		if (entry.anonymous) {
			looseRuns.set(entry.parent, [
				...(looseRuns.get(entry.parent) ?? []),
				entry,
			]);
		}
	}

	const styleOf = (element: Element) => styles.get(element) ?? INITIAL_STYLE;
	const idOf = (element: Element) => element.getAttribute(ID) ?? "";
	const boxOf = (element: Element) => boxes.get(idOf(element));
	const rootFontSize = parseFloat(
		styleOf(document.documentElement)["font-size"],
	);

	const resolve = (
		element: Element,
		length: string | undefined,
		percentBase = 0,
	) =>
		resolveLength(length, {
			fontSize: parseFloat(styleOf(element)["font-size"]),
			percentBase,
			rootFontSize,
			viewport: canvas,
		});

	const lengthOf = (element: Element, property: string, percentBase = 0) =>
		resolve(element, styleOf(element)[property], percentBase);

	const radiusOf = (element: Element) => {
		const box = boxOf(element);
		return lengthOf(
			element,
			"border-top-left-radius",
			box && Math.min(box.width, box.height),
		);
	};

	const borderInsets = (element: Element) =>
		insetsOf((side) => lengthOf(element, `border-${side}-width`));

	const contentInsets = (element: Element): Insets => {
		const style = styleOf(element);
		const percentBase = SIDES.some((side) =>
			style[`padding-${side}`].endsWith("%"),
		)
			? containingWidth(element)
			: 0;
		const borders = borderInsets(element);
		return insetsOf(
			(side) =>
				borders[side] + lengthOf(element, `padding-${side}`, percentBase),
		);
	};

	/** The width an element's padding percentages resolve against: its parent's content width. */
	const containingWidth = (element: Element) => {
		const parent = element.parentElement;
		const box = parent && boxOf(parent);
		if (!parent || !box) {
			return 0;
		}

		const { left, right } = contentInsets(parent);
		return box.width - left - right;
	};

	/** The scale (like Slidev's per-slide zoom) of an element's nearest laid-out ancestor. */
	const scaleAt = (element: Element) => {
		for (
			let current: Element | null = element;
			current;
			current = current.parentElement
		) {
			const box = boxOf(current);
			if (box) {
				return scaleOf(box);
			}
		}

		return 1;
	};

	const opacityOf = (element: Element) => {
		let product = 1;
		for (
			let current: Element | null = element;
			current && current !== document.documentElement;
			current = current.parentElement
		) {
			const style = styleOf(current);
			if (style.display === "none" || style.visibility === "hidden") {
				return 0;
			}

			product *= Number(style.opacity);
		}

		return product;
	};

	const isInline = (element: Element) =>
		styleOf(element).display.startsWith("inline");

	const blocksOf = (element: Element) => {
		const blocks = [""];
		const visit = (parent: Element) => {
			for (const node of parent.childNodes) {
				if (node.nodeType === node.TEXT_NODE) {
					blocks[blocks.length - 1] += node.textContent ?? "";
				} else if (isElement(node) && isInline(node)) {
					visit(node);
				} else if (isElement(node)) {
					blocks.push("");
					visit(node);
					blocks.push("");
				}
			}
		};

		visit(element);
		return blocks
			.map((block) => block.replace(/\s+/g, " ").trim())
			.filter(Boolean);
	};

	return {
		assets,
		borderInsets,
		boxOf,
		byId,
		canvas,
		contentInsets,
		fonts,
		idOf,
		isInline,
		items,
		labelOf: (element: Element) =>
			[
				blocksOf(element).at(0),
				element.getAttribute("aria-label")?.trim(),
				[...(element.closest("[class]")?.classList ?? [])].at(0),
			].find(Boolean) ?? element.localName,
		lengthOf,
		looseRunsOf: (element: Element) => looseRuns.get(idOf(element)) ?? [],
		markers,
		opacityOf,
		ownRunsOf: (element: Element) => runs.get(idOf(element)),
		problems,
		push: (element: Element, item: ItemInput) => {
			items.push({
				...item,
				decorative:
					element.closest('[aria-hidden="true"]') !== null ||
					isDecoration(item),
			});
		},
		radiusOf,
		resolve,
		scaleAt,
		styleOf,
		textOf: (element: Element) => blocksOf(element).join(" "),
	};
}

export function pathOf(element: Element) {
	const parts: string[] = [];
	for (
		let current = element;
		current.parentElement && !current.classList.contains("slidev-page");
		current = current.parentElement
	) {
		parts.unshift(
			GENERATED_CONTENT.has(current.localName)
				? current.localName
				: `${current.localName}${String(
						[...current.parentElement.children]
							.filter((sibling) => !GENERATED_CONTENT.has(sibling.localName))
							.indexOf(current),
					)}`,
		);
	}

	return parts.join("/");
}
