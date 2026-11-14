import type { ExtractOptions } from "./extract/context.ts";
import type { LaidOutBox, Layout } from "./layout.ts";

import { isOutOfFlow } from "./cascade.ts";
import { paintItems } from "./extract/boxes.ts";
import { createExtractContext, MIN_OPACITY } from "./extract/context.ts";
import { geometryOf } from "./extract/geometry.ts";
import { imageItem, rasterItem } from "./extract/images.ts";
import { isListElement, isNativeList, listItem } from "./extract/lists.ts";
import { svgItems } from "./extract/svg.ts";
import { codeItem, inlinePills, textItem } from "./extract/text.ts";
import { isAtomicInline, isBackgroundOnly } from "./layout.ts";

/** Elements with more descendants than this render as one image instead of shapes. */
const MAX_NATIVE_DESCENDANTS = 400;

/** Elements drawn as their own items, apart from the text they sit in. */
const REPLACED_ELEMENTS = new Set(["img", "svg"]);

const UNRENDERED_ELEMENTS = new Set(["head", "script", "style", "template"]);

/** Elements that render only in a browser, which PowerPoint can't show. */
const UNSUPPORTED_EMBEDS = [
	[".mermaid", "a Mermaid diagram"],
	[".slidev-tweet", "an embedded post"],
	["iframe", "an embedded page"],
	["video", "a video"],
] as const;

const isMath = (element: Element) => element.classList.contains("katex");

/** Turns a laid-out slide state into model items, and descriptions of what it left out. */
export function extractState(layout: Layout, options: ExtractOptions) {
	const context = createExtractContext(layout, options);
	const { styleOf } = context;

	const isDense = (element: Element) =>
		element.querySelectorAll("*").length > MAX_NATIVE_DESCENDANTS;

	const drawsApart = (element: Element) => {
		const style = styleOf(element);
		return (
			isOutOfFlow(style) ||
			isAtomicInline(style) ||
			REPLACED_ELEMENTS.has(element.localName) ||
			isMath(element)
		);
	};

	const isClippedAway = (element: Element, laidOut: LaidOutBox) => {
		const style = styleOf(element);
		const clips = ["clip", "overflow", "overflow-x", "overflow-y"].some(
			(property) => /\b(?:hidden|clip|rect)\b/.test(style[property] ?? ""),
		);
		return (
			/^inset\(\s*50%\s*\)$/.test(style["clip-path"] ?? "") ||
			(clips &&
				(laidOut.width <= 1 || laidOut.height <= 1) &&
				element.textContent.trim() !== "")
		);
	};

	const walkApart = (element: Element) => {
		for (const child of element.children) {
			if (drawsApart(child)) {
				walk(child);
			} else {
				walkApart(child);
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

		if (isMath(element)) {
			rasterItem(
				context,
				element,
				element.querySelector("annotation")?.textContent.trim(),
			);
			return;
		}

		const laidOut = context.boxOf(element);
		if (!laidOut) {
			if (context.isInline(element)) {
				walkApart(element);
			}

			return;
		}

		if (isClippedAway(element, laidOut)) {
			return;
		}

		const geometry = geometryOf(laidOut);
		const paint = paintItems(context, element, opacity, geometry);
		if (!paint) {
			rasterItem(context, element);
			return;
		}

		for (const item of paint) {
			context.push(element, item);
		}

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
			walkApart(element);
		} else {
			const entry = context.ownRunsOf(element);
			if (entry) {
				inlinePills(context, element, entry);
				textItem(context, element, entry);
				walkApart(element);
				return;
			}

			for (const child of element.children) {
				walk(child);
			}

			for (const loose of context.looseRunsOf(element)) {
				inlinePills(context, element, loose);
				textItem(context, element, loose);
			}
		}
	};

	for (const layer of layout.document.querySelector("#slide-content")
		?.children ?? []) {
		walk(layer);
	}

	return { items: context.items, problems: context.problems };
}
