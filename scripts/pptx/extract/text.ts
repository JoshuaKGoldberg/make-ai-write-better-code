import type { LaidOutRun } from "../layout.ts";
import type { Paragraph } from "../model.ts";
import type { ExtractContext, TextRuns } from "./context.ts";

import { lineHeightOf } from "../cascade.ts";
import { availableSpanOf, boxItems, boxStyle } from "./boxes.ts";
import { pathOf } from "./context.ts";
import { geometryOf, insetBox, SIDES } from "./geometry.ts";
import {
	alignOf,
	baselineOf,
	isInvisible,
	isLineFeed,
	isRightToLeft,
	runFrame,
	runsToParagraph,
	runStyle,
	signatureOf,
	startsLine,
} from "./runs.ts";

/** A code block's lines, in order: highlighted lines, twoslash error lines, and twoslash query popups, which show below their token's line. */
const CODE_LINES = ".line, .twoslash-meta-line, .twoslash-popup-container";

export function codeItem(context: ExtractContext, pre: Element) {
	const laidOut = context.boxOf(pre);
	if (!laidOut || !context.ownRunsOf(pre)) {
		return;
	}

	const { box, scale } = geometryOf(laidOut);
	const lineHeight = lineHeightOf(context.styleOf(pre));
	const lines = [...pre.querySelectorAll(CODE_LINES)];
	const lineOf = (run: LaidOutRun, owner: Element) =>
		lines.length
			? lines.findLastIndex((line) => line.contains(owner))
			: Math.round(run.y / lineHeight);
	const placed = [pre, ...pre.querySelectorAll("*")]
		.flatMap((element) => {
			const own = context.ownRunsOf(element);
			return [...(own ? [own] : []), ...context.looseRunsOf(element)];
		})
		.flatMap((laidOutRuns) => {
			const frame = runFrame(context, laidOutRuns);
			return laidOutRuns.runs.flatMap((run) => {
				const owner = context.byId.get(run.owner);
				const index = owner ? lineOf(run, owner) : -1;
				return owner && index >= 0 && !isLineFeed(run)
					? [{ frame, index, owner, run }]
					: [];
			});
		});
	const paragraphs: Paragraph[] = Array.from(
		{ length: Math.max(lines.length, ...placed.map(({ index }) => index + 1)) },
		() => ({ runs: [] }),
	);
	const baselines: (number | undefined)[] = [];
	for (const { frame, index, owner, run } of placed) {
		const style = runStyle(context, owner, context.opacityOf(owner));
		paragraphs[index].runs.push({
			...style,
			text: run.text.replace(/\t/g, "  "),
		});
		baselines[index] ??= baselineOf(context, frame, run, style.font);
	}

	while (paragraphs.at(-1)?.runs.length === 0) {
		paragraphs.pop();
	}

	if (isInvisible(paragraphs)) {
		return;
	}

	const content = insetBox(box, context.contentInsets(pre), scale);
	context.push(pre, {
		baselines: baselines.filter((baseline) => baseline !== undefined),
		box: content,
		key: `${pathOf(pre)}#code:${signatureOf(paragraphs)}`,
		kind: "code",
		paragraphs,
		style: {
			align: "left",
			available: availableSpanOf(context, pre),
			lineHeight: lineHeight * scale,
			nowrap: true,
			rtl: false,
		},
	});
}

/** Inline elements with a background or border ("pills", like inline code) as boxes, one per line they span. */
export function inlinePills(
	context: ExtractContext,
	element: Element,
	entry: TextRuns,
) {
	const { origin, scale } = runFrame(context, entry);
	for (const child of element.querySelectorAll("*")) {
		const style =
			context.styleOf(child).display === "inline"
				? boxStyle(context, child, context.opacityOf(child))
				: undefined;
		if (!style) {
			continue;
		}

		const own = entry.runs.filter((run) => {
			const owner = context.byId.get(run.owner);
			return owner !== undefined && child.contains(owner);
		});
		const lines: {
			bottom: number;
			left: number;
			right: number;
			top: number;
		}[] = [];
		for (const [index, run] of own.entries()) {
			let line = lines.at(-1);
			if (!line || startsLine(own[index - 1], run)) {
				line = {
					bottom: -Infinity,
					left: Infinity,
					right: -Infinity,
					top: Infinity,
				};
				lines.push(line);
			}

			line.left = Math.min(line.left, run.x);
			line.right = Math.max(line.right, run.x + run.width);
			line.top = Math.min(line.top, run.y);
			line.bottom = Math.max(line.bottom, run.y + run.height);
		}

		const insets = context.contentInsets(child);
		const label = context.labelOf(child);
		for (const [index, line] of lines.entries()) {
			const first = index === 0;
			const last = index === lines.length - 1;
			const left = line.left - (first ? insets.left : 0);
			const right = line.right + (last ? insets.right : 0);
			const top = line.top - insets.top;
			context.push(
				child,
				...boxItems(style, {
					box: {
						height: (line.bottom + insets.bottom - top) * scale,
						width: (right - left) * scale,
						x: origin.x + left * scale,
						y: origin.y + top * scale,
					},
					key: `${pathOf(child)}:${String(Math.round(line.left))}`,
					label,
					rotation: 0,
					scale,
					sides: SIDES.filter(
						(side) => (side !== "left" || first) && (side !== "right" || last),
					),
				}),
			);
		}
	}
}

export function textItem(
	context: ExtractContext,
	element: Element,
	entry: TextRuns,
) {
	const { box: entryBox, rotation, scale } = geometryOf(entry.box);
	const box = entry.element
		? insetBox(entryBox, context.contentInsets(entry.element), scale)
		: entryBox;
	const { baselines, runs, wrapRight } = runsToParagraph(
		context,
		entry,
		element,
	);
	const paragraphs = [{ runs }];
	if (isInvisible(paragraphs)) {
		return;
	}

	const style = context.styleOf(element);
	context.push(element, {
		baselines: rotation ? undefined : baselines,
		box,
		heading: /^h[1-6]$/.test(element.localName),
		key: `${pathOf(element)}#${entry.element ? "text" : "loose"}:${signatureOf(paragraphs)}`,
		kind: "text",
		paragraphs,
		rotation,
		style: {
			align: alignOf(context, element),
			available: availableSpanOf(context, element),
			lineHeight: lineHeightOf(style) * scale,
			nowrap:
				/^(?:nowrap|pre)$/.test(style["white-space"]) || Boolean(rotation),
			rtl: isRightToLeft(context, element),
			wrapWidth: wrapRight === undefined ? undefined : wrapRight - box.x,
		},
	});
}
