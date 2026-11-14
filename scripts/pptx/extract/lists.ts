import type { ListParagraph } from "../model.ts";
import type { ExtractContext, TextRuns } from "./context.ts";

import { hasMarker, lineHeightOf } from "../cascade.ts";
import { parseColor } from "../color.ts";
import { availableSpanOf } from "./boxes.ts";
import { MIN_OPACITY, pathOf } from "./context.ts";
import { geometryOf, insetBox } from "./geometry.ts";
import {
	alignOf,
	isInvisible,
	isRightToLeft,
	runsToParagraph,
} from "./runs.ts";
import { inlinePills } from "./text.ts";

/** A piece of a list item: some of its text, or a nested list. */
type ItemBlock =
	| { entry: TextRuns; kind: "text"; y: number }
	| { kind: "list"; list: Element; y: number };

export const isListElement = (element: Element) =>
	element.localName === "ul" || element.localName === "ol";

/** Whether a list item's child draws apart from its list's text: a block with no text of its own, like a code block, an image's paragraph, or a component. */
export const isListAside = (context: ExtractContext, child: Element) =>
	child.parentElement?.localName === "li" &&
	!isListElement(child) &&
	!context.isInline(child) &&
	context.ownRunsOf(child) === undefined;

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
	const content = insetBox(listBox, context.contentInsets(list), scale);
	const first = [...list.children].find((child) => child.localName === "li");
	const marker = first && context.markers.get(first);
	const markerColor = marker && parseColor(marker.color)?.hex;
	const styled = first ?? list;
	const columns = columnsOf(context, list);
	for (const [index, { items, left, right }] of columns.entries()) {
		const x = content.x + left - columns[0].left;
		const box =
			columns.length > 1 ? { ...content, width: right - x, x } : content;
		const converted = listParagraphs(context, list, 0, box.x, opacity, items);
		const paragraphs = converted.map(({ paragraph }) => paragraph);
		if (isInvisible(paragraphs)) {
			continue;
		}

		context.push(list, {
			box,
			bulletColor: paragraphs.some(({ bullet, runs }) => {
				const color = runs.find((run) => !run.pad)?.color;
				return bullet && color !== undefined && color !== markerColor;
			})
				? markerColor
				: undefined,
			key: `${pathOf(list)}#list${index ? `-${String(index)}` : ""}`,
			kind: "list",
			paragraphs,
			style: {
				align: alignOf(context, styled),
				available:
					columns.length > 1
						? { left: x, right }
						: availableSpanOf(context, list),
				lineHeight: lineHeightOf(context.styleOf(styled)) * scale,
				nowrap: false,
				rtl: isRightToLeft(context, styled),
				wrapWidth: converted.some(({ wrapped }) => wrapped)
					? Math.max(...converted.map(({ right }) => right)) - box.x
					: undefined,
			},
		});
	}
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

/** A list's items in the columns they lay out in (CSS columns), each column's items with its left and right edges. */
function columnsOf(context: ExtractContext, list: Element) {
	const columns: { items: Element[]; left: number; right: number }[] = [];
	for (const item of itemsOf(list)) {
		const laidOut = context.boxOf(item);
		const box = laidOut && geometryOf(laidOut).box;
		const column = columns.at(-1);
		if (column && (!box || Math.abs(box.x - column.left) < 1)) {
			column.items.push(item);
		} else if (box) {
			columns.push({ items: [item], left: box.x, right: box.x + box.width });
		}
	}

	return columns;
}

const itemsOf = (list: Element) =>
	[...list.children].filter((child) => child.localName === "li");

function itemBlocks(context: ExtractContext, item: Element): ItemBlock[] {
	const own = context.ownRunsOf(item);
	if (own) {
		return [{ entry: own, kind: "text", y: own.box.y }];
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
				: entry && !context.drawsApart(child)
					? [{ entry, kind: "text", y: entry.box.y }]
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
	shown = itemsOf(list),
): { paragraph: ListParagraph; right: number; wrapped: boolean }[] {
	const items = itemsOf(list);
	const numbers = ordinalsOf(list, items);
	return items.flatMap((item, index) => {
		if (!shown.includes(item)) {
			return [];
		}

		const style = context.styleOf(item);
		const shared = {
			level,
			marker: style["list-style-type"],
			number: numbers[index],
			visible: context.opacityOf(item) >= MIN_OPACITY,
		};
		const blocks = itemBlocks(context, item);
		const startsApart = blocks[0]?.kind !== "text";
		const converted = blocks.flatMap((block, blockIndex) => {
			if (block.kind === "list") {
				return listParagraphs(
					context,
					block.list,
					level + 1,
					textLeft,
					opacity,
				);
			}

			inlinePills(context, block.entry.element ?? item, block.entry);
			const { baselines, left, right, runs, wrapRight } = runsToParagraph(
				context,
				block.entry,
				item,
				shared.visible ? context.opacityOf : () => opacity,
			);
			return [
				{
					paragraph: {
						...shared,
						baselines,
						bullet: blockIndex === 0 && hasMarker(style),
						indent: left - textLeft,
						runs,
					},
					right,
					wrapped: wrapRight !== undefined,
				},
			];
		});
		if (!startsApart) {
			return converted;
		}

		const lineHeight = lineHeightOf(style) * context.scaleAt(item);
		const baseline = Math.min(
			strutBaselineOf(context, item, lineHeight),
			(converted.at(0)?.paragraph.baselines.at(0) ?? Infinity) - lineHeight,
		);
		return [
			{
				paragraph: {
					...shared,
					baselines: Number.isFinite(baseline) ? [baseline] : [],
					bullet: hasMarker(style),
					indent: 0,
					runs: [],
				},
				right: -Infinity,
				wrapped: false,
			},
			...converted,
		];
	});
}

/** Where a list item's first line's baseline sits when no text starts it: on a line of its own font at the top of its content box. */
function strutBaselineOf(
	context: ExtractContext,
	item: Element,
	lineHeight: number,
) {
	const laidOut = context.boxOf(item);
	if (!laidOut) {
		return Infinity;
	}

	const { box, scale } = geometryOf(laidOut);
	const style = context.styleOf(item);
	const { font } = context.fonts.resolve(
		style["font-family"],
		Number(style["font-weight"]),
		style["font-style"] === "italic",
	);
	const { ascent, descent } = context.fonts.metrics(font);
	const size = parseFloat(style["font-size"]) * scale;
	return (
		box.y +
		context.contentInsets(item).top * scale +
		(lineHeight - (ascent + descent) * size) / 2 +
		ascent * size
	);
}
