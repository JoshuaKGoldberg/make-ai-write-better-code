import type { Assets } from "../assets.ts";
import type { FontBook } from "../fonts.ts";
import type { LaidOutRuns, Layout } from "../layout.ts";
import type { Canvas, ExtractedItem } from "../model.ts";
import type { Clip, Insets, Side } from "./geometry.ts";

import {
	INITIAL_STYLE,
	isAtomicInline,
	isOutOfFlow,
	laysOutApart,
	resolveLength,
} from "../cascade.ts";
import { splitTopLevel } from "../css.ts";
import { GENERATED_ELEMENTS, ID } from "../layout.ts";
import {
	clipBox,
	geometryOf,
	insetBox,
	rotatedBounds,
	sameBox,
	scaleOf,
	SIDES,
} from "./geometry.ts";

export type ExtractContext = ReturnType<typeof createExtractContext>;

export interface ExtractOptions {
	/** Loaded images, by the URLs pages use. */
	assets: Assets;
	canvas: Canvas;
	fonts: FontBook;
}

export type ItemInput = WithoutDerived<ExtractedItem>;

/** Laid-out text and the element whose content box it's measured in, which loose text (beside block-level siblings) has none of. */
export interface TextRuns extends LaidOutRuns {
	element?: Element;
}

type WithoutDerived<Item> = Item extends unknown
	? Omit<Item, "decorative">
	: never;

export const MIN_OPACITY = 0.05;

const GENERATED_CONTENT = new Set<string>(Object.values(GENERATED_ELEMENTS));

const SEPARATE_ITEM_ELEMENTS = new Set(["img", "svg"]);

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

/** An item cut to a clip: shapes and pictures to the part inside it, text to the height it shows; undefined when none of it shows. */
function clipItem(item: ItemInput, clip: Clip): ItemInput | undefined {
	const rotation = "rotation" in item ? item.rotation : 0;
	const box = clipBox(item.box, clip);
	const shown = rotation
		? clipBox(rotatedBounds(item.box, rotation), clip)
		: box;
	if (shown.width <= 0 || shown.height <= 0) {
		return undefined;
	}

	if (rotation) {
		return item;
	}

	const fills = sameBox(box, {
		height: clip.bottom - clip.top,
		width: clip.right - clip.left,
		x: clip.left,
		y: clip.top,
	});
	switch (item.kind) {
		case "box":
			return {
				...item,
				box,
				radius: fills ? Math.max(item.radius, clip.radius) : item.radius,
			};
		case "code":
		case "list":
		case "text":
			return {
				...item,
				box: { ...item.box, height: box.y + box.height - item.box.y },
			};
		case "image": {
			const drawn = item.crop ?? item.box;
			return {
				...item,
				box,
				crop: sameBox(box, drawn) ? undefined : drawn,
				radius: fills ? Math.max(item.radius, clip.radius) : item.radius,
			};
		}
		case "raster":
			return { ...item, box };
		default:
			return item;
	}
}

export const isMath = (element: Element) => element.classList.contains("katex");

export function createExtractContext(
	layout: Layout,
	{ assets, canvas, fonts }: ExtractOptions,
) {
	const { boxes, byId, document, looseRuns, markers, runs, styles } = layout;
	const items: ExtractedItem[] = [];
	const problems: string[] = [];
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

	const boxAt = (element: Element) => {
		for (
			let current: Element | null = element;
			current;
			current = current.parentElement
		) {
			const box = boxOf(current);
			if (box) {
				return box;
			}
		}

		return undefined;
	};

	const ownRunsOf = (element: Element): TextRuns | undefined => {
		const entry = runs.get(idOf(element));
		return entry && { ...entry, element };
	};

	const opacityOf = (element: Element) => {
		let product = 1;
		for (
			let current: Element | null = element;
			current && current !== document.documentElement;
			current = current.parentElement
		) {
			const style = styleOf(current);
			if (
				style.display === "none" ||
				(current === element && style.visibility === "hidden")
			) {
				return 0;
			}

			product *= Number(style.opacity);
		}

		return product;
	};

	/** The area overflow clips an element to: its ancestors' (from its containing block up, when it's out of flow), and its own too for its content. */
	const clipOf = (element: Element, ownContent: boolean) => {
		let clip: Clip | undefined;
		let escaping = false;
		for (
			let current: Element | null = element;
			current && current.id !== "slide-content";
			current = current.parentElement
		) {
			const style = styleOf(current);
			const containing = !escaping || (style.position ?? "static") !== "static";
			if (containing && (current !== element || ownContent)) {
				clip = clipWithin(current, clip);
			}

			if (containing) {
				escaping = isOutOfFlow(style);
			}
		}

		return clip;
	};

	const clipWithin = (element: Element, clip: Clip | undefined) => {
		const style = styleOf(element);
		const [overflowX = "visible", overflowY = overflowX] = splitTopLevel(
			style.overflow ?? "visible",
			" ",
		);
		const clipsX = (style["overflow-x"] ?? overflowX) !== "visible";
		const clipsY = (style["overflow-y"] ?? overflowY) !== "visible";
		const laidOut = boxOf(element);
		if (!laidOut || (!clipsX && !clipsY)) {
			return clip;
		}

		const { box, rotation, scale } = geometryOf(laidOut);
		if (rotation) {
			return clip;
		}

		const padding = insetBox(box, borderInsets(element), scale);
		const bounds = clip ?? {
			bottom: Infinity,
			left: -Infinity,
			radius: 0,
			right: Infinity,
			top: -Infinity,
		};
		return {
			bottom: clipsY
				? Math.min(bounds.bottom, padding.y + padding.height)
				: bounds.bottom,
			left: clipsX ? Math.max(bounds.left, padding.x) : bounds.left,
			radius: clip?.radius ?? radiusOf(element) * scale,
			right: clipsX
				? Math.min(bounds.right, padding.x + padding.width)
				: bounds.right,
			top: clipsY ? Math.max(bounds.top, padding.y) : bounds.top,
		};
	};

	const isInline = (element: Element) =>
		styleOf(element).display.startsWith("inline");

	const drawsApart = (element: Element) => {
		const style = styleOf(element);
		const parent = element.parentElement;
		const inLine =
			parent !== null && (isInline(parent) || ownRunsOf(parent) !== undefined);
		return (
			SEPARATE_ITEM_ELEMENTS.has(element.localName) ||
			isMath(element) ||
			(inLine
				? laysOutApart(style)
				: isOutOfFlow(style) || isAtomicInline(style))
		);
	};

	const blocksOf = (element: Element) => {
		const blocks = [""];
		const visit = (parent: Element) => {
			for (const node of parent.childNodes) {
				if (node.nodeType === node.TEXT_NODE) {
					blocks[blocks.length - 1] += node.textContent ?? "";
				} else if (isElement(node) && node.classList.contains("katex-mathml")) {
					continue;
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
		boxAt,
		boxOf,
		byId,
		canvas,
		clipOf,
		contentInsets,
		drawsApart,
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
		ownRunsOf,
		problems,
		push: (element: Element, ...added: ItemInput[]) => {
			const hidden = element.closest('[aria-hidden="true"]') !== null;
			items.push(
				...added.flatMap((item) => {
					const clip = clipOf(element, "paragraphs" in item);
					const clipped = clip ? clipItem(item, clip) : item;
					return clipped
						? [{ ...clipped, decorative: hidden || isDecoration(item) }]
						: [];
				}),
			);
		},
		radiusOf,
		resolve,
		scaleAt: (element: Element) => {
			const box = boxAt(element);
			return box ? scaleOf(box) : 1;
		},
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
