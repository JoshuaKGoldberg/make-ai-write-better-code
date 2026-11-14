import type { LaidOutRuns } from "../layout.ts";
import type { ListParagraph } from "../model.ts";
import type { ExtractContext } from "./context.ts";

import { lineHeightOf } from "../cascade.ts";
import { parseColor } from "../color.ts";
import { hasMarker } from "../layout.ts";
import { availableWidthOf } from "./boxes.ts";
import { MIN_OPACITY, pathOf } from "./context.ts";
import { geometryOf, insetBox } from "./geometry.ts";
import { alignOf, isInvisible, runsToParagraph } from "./runs.ts";

/** A piece of a list item: some of its text, or a nested list. */
type ItemBlock =
	| { entry: LaidOutRuns; kind: "text"; owner?: Element; y: number }
	| { kind: "list"; list: Element; y: number };

export const isListElement = (element: Element) =>
	element.localName === "ul" || element.localName === "ol";

/** Whether a list exports as native paragraphs: its items hold only text, paragraphs, and lists that do too. */
export function isNativeList(context: ExtractContext, list: Element): boolean {
	return [...list.children].every(
		(item) =>
			item.localName !== "li" ||
			context.ownRunsOf(item) !== undefined ||
			[...item.children].every((child) =>
				isListElement(child)
					? isNativeList(context, child)
					: context.isInline(child) || context.ownRunsOf(child) !== undefined,
			),
	);
}

export function listItem(
	context: ExtractContext,
	list: Element,
	opacity: number,
) {
	const laidOut = context.boxOf(list);
	if (!laidOut) {
		return;
	}

	const { box: listBox, scale } = geometryOf(laidOut);
	const box = insetBox(listBox, context.contentInsets(list), scale);
	const converted = listParagraphs(context, list, 0, box.x, opacity);
	const paragraphs = converted.map(({ paragraph }) => paragraph);
	if (isInvisible(paragraphs)) {
		return;
	}

	const first = [...list.children].find((child) => child.localName === "li");
	const marker = first && context.markers.get(first);
	const styled = first ?? list;
	context.push(list, {
		box,
		bulletColor: marker && parseColor(marker.color)?.hex,
		key: `${pathOf(list)}#list`,
		kind: "list",
		paragraphs,
		style: {
			align: alignOf(context, styled),
			availableWidth: availableWidthOf(context, list, box.x),
			lineHeight: lineHeightOf(context.styleOf(styled)) * scale,
			nowrap: false,
			wrapWidth: converted.some(({ wrapped }) => wrapped)
				? Math.max(...converted.map(({ right }) => right)) - box.x
				: undefined,
		},
	});
}

export function ordinalsOf(list: Element, items: Element[]) {
	const reversed = list.hasAttribute("reversed");
	const start = Number(list.getAttribute("start") ?? NaN);
	let ordinal = Number.isInteger(start) ? start : reversed ? items.length : 1;
	return items.map((item) => {
		const value = Number(item.getAttribute("value") ?? NaN);
		const current = Number.isInteger(value) ? value : ordinal;
		ordinal = current + (reversed ? -1 : 1);
		return current;
	});
}

function itemBlocks(context: ExtractContext, item: Element): ItemBlock[] {
	const own = context.ownRunsOf(item);
	if (own) {
		return [{ entry: own, kind: "text", owner: item, y: own.box.y }];
	}

	return [
		...context
			.looseRunsOf(item)
			.map((entry): ItemBlock => ({ entry, kind: "text", y: entry.box.y })),
		...[...item.children].flatMap((child): ItemBlock[] => {
			const box = context.boxOf(child);
			const entry = context.ownRunsOf(child);
			return isListElement(child) && box
				? [{ kind: "list", list: child, y: box.y }]
				: entry
					? [{ entry, kind: "text", owner: child, y: entry.box.y }]
					: [];
		}),
	].toSorted((first, second) => first.y - second.y);
}

function listParagraphs(
	context: ExtractContext,
	list: Element,
	level: number,
	textLeft: number,
	opacity: number,
): { paragraph: ListParagraph; right: number; wrapped: boolean }[] {
	const items = [...list.children].filter((child) => child.localName === "li");
	const numbers = ordinalsOf(list, items);
	return items.flatMap((item, index) => {
		const style = context.styleOf(item);
		const shared = {
			level,
			marker: style["list-style-type"],
			number: numbers[index],
			visible: context.opacityOf(item) > MIN_OPACITY,
		};
		const blocks = itemBlocks(context, item);
		let bullet = hasMarker(style);
		const converted = [];
		if (blocks[0]?.kind !== "text") {
			converted.push({
				paragraph: { ...shared, baselines: [], bullet, indent: 0, runs: [] },
				right: -Infinity,
				wrapped: false,
			});
			bullet = false;
		}

		for (const block of blocks) {
			if (block.kind === "list") {
				converted.push(
					...listParagraphs(context, block.list, level + 1, textLeft, opacity),
				);
				continue;
			}

			// Hidden items keep the list's opacity, so states that reveal them match.
			const { baselines, left, right, runs, wrapRight } = runsToParagraph(
				context,
				block.entry,
				block.owner,
				shared.visible ? context.opacityOf : () => opacity,
			);
			converted.push({
				paragraph: {
					...shared,
					baselines,
					bullet,
					indent: left - textLeft,
					runs,
				},
				right,
				wrapped: wrapRight !== undefined,
			});
			bullet = false;
		}

		return converted;
	});
}
