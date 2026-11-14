/**
 * Turns a laid-out slide state (see layout.ts) into model items (see model.ts):
 * text with styled runs and exact line breaks, lists, code, boxes, images, SVG
 * shapes, and rasters for anything PowerPoint can't represent natively.
 */
import type { ExtractOptions } from "./extract/context.ts";
import type { LaidOutBox, Layout } from "./layout.ts";

import { imageFormat } from "./assets.ts";
import { paintItems } from "./extract/boxes.ts";
import { createExtractContext, MIN_OPACITY } from "./extract/context.ts";
import { geometryOf } from "./extract/geometry.ts";
import { imageItem, rasterItem } from "./extract/images.ts";
import { svgItems } from "./extract/svg.ts";
import {
	codeItem,
	inlinePills,
	isListElement,
	isNativeList,
	listItem,
	textItem,
} from "./extract/text.ts";
import { isBackgroundOnly } from "./layout.ts";

/** Image formats PowerPoint shows; build.ts converts others to PNG. */
const NATIVE_FORMATS = new Set(["bmp", "gif", "jpeg", "png"]);

/** Elements with more descendants than this render as one image instead of shapes. */
const MAX_NATIVE_DESCENDANTS = 400;

/** Elements that lay out apart from the text around them. */
const REPLACED_ELEMENTS = new Set(["img", "svg"]);

const UNRENDERED_ELEMENTS = new Set(["head", "script", "style", "template"]);

/** Elements that render only in a browser, which PowerPoint can't show. */
const UNSUPPORTED_EMBEDS = [
	[".mermaid", "a Mermaid diagram"],
	[".slidev-tweet", "an embedded post"],
	["iframe", "an embedded page"],
	["video", "a video"],
] as const;

/** Whether PowerPoint can show an image file as-is. */
export const isNativeImage = (data: Buffer) =>
	NATIVE_FORMATS.has(imageFormat(data) ?? "");

/** Turns a laid-out slide state into model items, and descriptions of what it left out. */
export function extractState(layout: Layout, options: ExtractOptions) {
	const context = createExtractContext(layout, options);
	const { styleOf } = context;

	const isDense = (element: Element) =>
		context.descendantCountOf(element) > MAX_NATIVE_DESCENDANTS;

	const isDetached = (element: Element) =>
		/^(?:absolute|fixed)$/.test(styleOf(element).position ?? "") ||
		REPLACED_ELEMENTS.has(element.localName);

	/** Whether clipping hides an element's text, as with screen-reader-only text. */
	const isClippedAway = (element: Element, laidOut: LaidOutBox) => {
		const style = styleOf(element);
		const clips = ["clip", "overflow", "overflow-x", "overflow-y"].some(
			(property) => /\b(?:hidden|clip|rect)\b/.test(style[property] ?? ""),
		);
		return (
			/^inset\(\s*50%\s*\)$/.test(style["clip-path"] ?? "") ||
			(clips &&
				(laidOut.w <= 1 || laidOut.h <= 1) &&
				element.textContent.trim() !== "")
		);
	};

	/** Walks the descendants of text that lay out apart from it: positioned ones (like ::after decorations) and replaced ones (like icons). */
	const walkDetached = (element: Element) => {
		for (const descendant of element.querySelectorAll("*")) {
			let nested = false;
			for (
				let ancestor = descendant.parentElement;
				ancestor && ancestor !== element;
				ancestor = ancestor.parentElement
			) {
				nested ||= isDetached(ancestor);
			}

			if (isDetached(descendant) && !nested) {
				walk(descendant);
			}
		}
	};

	const walk = (element: Element) => {
		const opacity = context.opacityOf(element);
		if (
			opacity < MIN_OPACITY ||
			UNRENDERED_ELEMENTS.has(element.localName) ||
			isBackgroundOnly(element, layout.styles)
		) {
			return;
		}

		const embed = UNSUPPORTED_EMBEDS.find(([selector]) =>
			element.matches(selector),
		);
		if (embed) {
			const source = element.getAttribute("src");
			context.problems.push(
				`Couldn't export ${embed[1]}${source ? ` (${source})` : ""}.`,
			);
			return;
		}

		const laidOut = context.boxOf(element);
		if (!laidOut || isClippedAway(element, laidOut)) {
			return;
		}

		const geometry = geometryOf(laidOut);
		const paint = paintItems(context, element, opacity, geometry);
		if (!paint) {
			rasterItem(context, element);
			return;
		}

		for (const item of paint) {
			context.push(item);
		}

		const entry = context.ownRunsOf(element);
		if (element.localName === "img") {
			imageItem(context, element, opacity, geometry);
		} else if (element.localName === "svg") {
			svgItems(context, element);
		} else if (element.localName === "pre") {
			codeItem(context, element);
		} else if (
			isDense(element) &&
			[...element.children].filter(isDense).length !== 1
		) {
			rasterItem(context, element);
		} else if (isListElement(element) && isNativeList(context, element)) {
			listItem(context, element, opacity);
			walkDetached(element);
		} else if (entry) {
			inlinePills(context, element, entry, opacity);
			textItem(context, element, entry, opacity);
			walkDetached(element);
		} else {
			for (const child of element.children) {
				walk(child);
			}

			for (const loose of context.looseRunsOf(element)) {
				textItem(context, element, loose, opacity);
			}
		}
	};

	for (const layer of layout.document.querySelector("#slide-content")
		?.children ?? []) {
		walk(layer);
	}

	return { items: context.items, problems: context.problems };
}
