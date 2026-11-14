import type { LaidOutRun, LaidOutRuns } from "../layout.ts";
import type { Box, Paragraph } from "../model.ts";
import type { ExtractContext } from "./context.ts";

import { lineHeightOf } from "../cascade.ts";
import { availableWidthOf, boxStyle } from "./boxes.ts";
import { pathOf } from "./context.ts";
import { edgeBox, geometryOf, insetBox } from "./geometry.ts";
import {
	alignOf,
	ascentRatio,
	isInvisible,
	runFrame,
	runRect,
	runsToParagraph,
	runStyle,
	signatureOf,
	startsLine,
} from "./runs.ts";

export function codeItem(context: ExtractContext, pre: Element) {
	const laidOut = context.boxOf(pre);
	const entry = context.ownRunsOf(pre);
	if (!laidOut || !entry) {
		return;
	}

	const { box, scale } = geometryOf(laidOut);
	const frame = runFrame(context, entry, pre);
	const lineHeight = lineHeightOf(context.styleOf(pre));
	const lines = [...pre.querySelectorAll(".line")];
	const lineOf = (run: LaidOutRun, owner: Element) =>
		lines.length
			? lines.findIndex((line) => line.contains(owner))
			: Math.round(run.y / lineHeight);
	const placed = entry.runs.flatMap((run) => {
		const owner = context.byId.get(run.owner);
		const index = owner ? lineOf(run, owner) : -1;
		return owner && index >= 0 && !/^\n+$/.test(run.text)
			? [{ index, owner, run }]
			: [];
	});
	const paragraphs: Paragraph[] = Array.from(
		{ length: Math.max(lines.length, ...placed.map(({ index }) => index + 1)) },
		() => ({ runs: [] }),
	);
	const baselines: (number | undefined)[] = [];
	for (const { index, owner, run } of placed) {
		const style = runStyle(context, owner, context.opacityOf(owner));
		paragraphs[index].runs.push({
			...style,
			text: run.text.replace(/\t/g, "  "),
		});
		if (baselines[index] === undefined) {
			const rect = runRect(frame, run);
			baselines[index] =
				rect.y + rect.height * ascentRatio(context.fonts, style.font);
		}
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
			availableWidth: availableWidthOf(context, pre, content.x),
			lineHeight: lineHeight * scale,
			nowrap: true,
		},
	});
}

/** Inline elements with a background or border ("pills", like inline code) as boxes, one per line they span. */
export function inlinePills(
	context: ExtractContext,
	element: Element,
	entry: LaidOutRuns,
) {
	const { origin, scale } = runFrame(
		context,
		entry,
		entry.anonymous ? undefined : element,
	);
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

		const paddingX = context.lengthOf(child, "padding-left");
		const paddingY = context.lengthOf(child, "padding-top");
		const { border, edges = [], fill, radius } = style;
		const key = pathOf(child);
		const label = context.labelOf(child);
		for (const [index, line] of lines.entries()) {
			const box: Box = {
				height: (line.bottom - line.top + paddingY * 2) * scale,
				width: (line.right - line.left + paddingX * 2) * scale,
				x: origin.x + (line.left - paddingX) * scale,
				y: origin.y + (line.top - paddingY) * scale,
			};
			const at = String(Math.round(line.left));
			if (fill || border) {
				context.push(child, {
					border: border && { ...border, width: border.width * scale },
					box,
					fill,
					key: `${key}#pill:${at}`,
					kind: "box",
					label,
					radius: radius * scale,
					rotation: 0,
				});
			}

			for (const edge of edges.filter(
				({ side }) =>
					(side !== "left" || index === 0) &&
					(side !== "right" || index === lines.length - 1),
			)) {
				context.push(child, {
					...edgeBox(
						box,
						{ side: edge.side, width: edge.width * scale },
						radius * scale,
						0,
					),
					fill: edge.fill,
					key: `${key}#pill-border-${edge.side}:${at}`,
					kind: "box",
					label: `${edge.side} border of ${label}`,
					radius: 0,
				});
			}
		}
	}
}

export function textItem(
	context: ExtractContext,
	element: Element,
	entry: LaidOutRuns,
) {
	const owner = entry.anonymous ? undefined : element;
	const { box: entryBox, rotation, scale } = geometryOf(entry.box);
	const box = owner
		? insetBox(entryBox, context.contentInsets(owner), scale)
		: entryBox;
	const { baselines, runs, wrapRight } = runsToParagraph(context, entry, owner);
	const paragraphs = [{ runs }];
	if (isInvisible(paragraphs)) {
		return;
	}

	const style = context.styleOf(element);
	context.push(element, {
		baselines: rotation ? undefined : baselines,
		box,
		heading: /^h[1-6]$/.test(element.localName),
		key: `${pathOf(element)}#${owner ? "text" : "loose"}:${signatureOf(paragraphs)}`,
		kind: "text",
		paragraphs,
		rotation,
		style: {
			align: alignOf(context, element),
			availableWidth: availableWidthOf(context, element, box.x),
			lineHeight: lineHeightOf(style) * scale,
			nowrap:
				/^(?:nowrap|pre)$/.test(style["white-space"]) || Boolean(rotation),
			wrapWidth: wrapRight === undefined ? undefined : wrapRight - box.x,
		},
	});
}
