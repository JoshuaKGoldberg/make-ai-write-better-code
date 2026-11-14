import type { Assets } from "../assets.ts";
import type { FontBook } from "../fonts.ts";
import type { LaidOutRuns, Layout } from "../layout.ts";
import type { Canvas, ExtractedItem } from "../model.ts";
import type { Insets, Side } from "./geometry.ts";

import { INITIAL_STYLE, resolveLength } from "../cascade.ts";
import { ID } from "../layout.ts";
import { scaleOf } from "./geometry.ts";

export type ExtractContext = ReturnType<typeof createExtractContext>;

export interface ExtractOptions {
	/** Loaded images, by the URLs pages use. */
	assets: Assets;
	canvas: Canvas;
	fonts: FontBook;
}

export type ItemInput = ExtractedItem extends infer Item
	? Item extends ExtractedItem
		? Omit<Item, "order">
		: never
	: never;

/** Below this opacity, elements can't be seen. */
export const MIN_OPACITY = 0.05;

const SIDES: Side[] = ["top", "right", "bottom", "left"];

const insetsOf = (widthOf: (side: Side) => number): Insets => ({
	bottom: widthOf("bottom"),
	left: widthOf("left"),
	right: widthOf("right"),
	top: widthOf("top"),
});

const isElement = (node: Node): node is Element =>
	node.nodeType === node.ELEMENT_NODE;

/** What extracting a slide state's items needs: its layout, styles, and where items go. */
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

	const descendantCounts = new Map<Element, number>();

	const styleOf = (element: Element) => styles.get(element) ?? INITIAL_STYLE;
	const idOf = (element: Element) => element.getAttribute(ID) ?? "";
	const boxOf = (element: Element) => boxes.get(idOf(element));
	const rootFontSize = parseFloat(
		styleOf(document.documentElement)["font-size"],
	);

	/** Resolves a length to px in an element's font size, with percentages of `percentBase`. */
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

	/** An element's corner radius in local px, with percentages of its smaller side. */
	const radiusOf = (element: Element) => {
		const box = boxOf(element);
		return lengthOf(
			element,
			"border-top-left-radius",
			box && Math.min(box.w, box.h),
		);
	};

	const borderInsets = (element: Element) =>
		insetsOf((side) => lengthOf(element, `border-${side}-width`));

	/** How far an element's content sits inside its border box: its borders and padding. */
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
		return box.w - left - right;
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

	/** An element's text, with spaces between its blocks. */
	const textOf = (element: Element) => {
		const visit = (parent: Element): string =>
			[...parent.childNodes]
				.map((node) =>
					node.nodeType === node.TEXT_NODE
						? (node.textContent ?? "")
						: isElement(node)
							? isInline(node)
								? visit(node)
								: ` ${visit(node)} `
							: "",
				)
				.join("");
		return visit(element).replace(/\s+/g, " ").trim();
	};

	/** An element's first block of text, like a card's heading. */
	const firstBlockTextOf = (element: Element) => {
		let text = "";
		const visit = (node: Node): boolean => {
			if (node.nodeType === node.TEXT_NODE) {
				text += node.textContent ?? "";
				return false;
			}

			if (!isElement(node)) {
				return false;
			}

			const block = node !== element && !isInline(node);
			if (block && text.trim()) {
				return true;
			}

			return [...node.childNodes].some(visit) || (block && text.trim() !== "");
		};

		visit(element);
		return text.replace(/\s+/g, " ").trim();
	};

	/** A short description of an element: its first block of text, else its accessible name, first class, or tag. */
	const labelOf = (element: Element) =>
		[
			firstBlockTextOf(element),
			element.getAttribute("aria-label")?.trim(),
			[...(element.closest("[class]")?.classList ?? [])].at(0),
		].find(Boolean) ?? element.localName;

	/** Where an element sits in its slide, as tags and child indexes, so states can match it. */
	const pathOf = (element: Element) => {
		const parts: string[] = [];
		for (
			let current = element;
			current.parentElement && !current.classList.contains("slidev-page");
			current = current.parentElement
		) {
			parts.unshift(
				`${current.localName}${String([...current.parentElement.children].indexOf(current))}`,
			);
		}

		return parts.join("/");
	};

	const descendantCountOf = (element: Element) => {
		let count = descendantCounts.get(element);
		if (count === undefined) {
			count = element.querySelectorAll("*").length;
			descendantCounts.set(element, count);
		}

		return count;
	};

	const ascentRatio = (font: string) => {
		const { ascent, descent } = fonts.metrics(font);
		return ascent / (ascent + descent);
	};

	return {
		ascentRatio,
		assets,
		borderInsets,
		boxOf,
		byId,
		canvas,
		contentInsets,
		descendantCountOf,
		fonts,
		idOf,
		isInline,
		items,
		labelOf,
		lengthOf,
		looseRunsOf: (element: Element) => looseRuns.get(idOf(element)) ?? [],
		markers,
		opacityOf,
		ownRunsOf: (element: Element) => runs.get(idOf(element)),
		pathOf,
		problems,
		push: (item: ItemInput) => {
			items.push({ ...item, order: items.length });
		},
		radiusOf,
		resolve,
		scaleAt,
		styleOf,
		textOf,
	};
}
