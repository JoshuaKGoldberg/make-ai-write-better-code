import type { ComputedStyle } from "../cascade.ts";
import type { Color } from "../color.ts";
import type { LaidOutRun, LaidOutRuns } from "../layout.ts";
import type {
	ListParagraph,
	Paragraph,
	Point,
	Run,
	TextStyle,
} from "../model.ts";
import type { ExtractContext } from "./context.ts";

import { lineHeightOf } from "../cascade.ts";
import {
	parseColor,
	parseLinearGradient,
	parseShadow,
	transparencyOf,
} from "../color.ts";
import { ID } from "../layout.ts";
import { boxStyle, clipsToText } from "./boxes.ts";
import { MIN_OPACITY } from "./context.ts";
import { geometryOf, insetBox, scaleOf } from "./geometry.ts";

/** Where a text entry's runs sit: takumi reports them in local px from the content box's corner. */
interface RunFrame {
	origin: Point;
	scale: number;
}

/** A piece of a list item: some of its text, or a nested list. */
type ItemBlock =
	| { entry: LaidOutRuns; kind: "text"; owner: Element | undefined; y: number }
	| { kind: "list"; list: Element; y: number };

const TEXT_ALIGNMENTS: Partial<Record<string, TextStyle["align"]>> = {
	center: "center",
	end: "right",
	justify: "justify",
	left: "left",
	right: "right",
	start: "left",
};

/** White space that HTML collapses, which leaves out no-break spaces. */
const COLLAPSIBLE_SPACE = /[ \t\n\r\f]+/g;

/** Gaps between runs narrower than this, in px, are kerning rather than spacing. */
const MIN_SPACER_GAP = 0.75;

const NO_BREAK_SPACE = "\u00A0";
const ZERO_WIDTH_SPACE = "\u200B";

const PRESERVED_WHITE_SPACE = /^(?:pre|pre-wrap|pre-line|break-spaces)$/;

export const isListElement = (element: Element) =>
	element.localName === "ul" || element.localName === "ol";

/** Whether a list item draws a marker, as browsers decide. */
const hasMarker = (style: ComputedStyle) =>
	style.display === "list-item" && style["list-style-type"] !== "none";

const isInvisible = (paragraphs: Paragraph[]) =>
	paragraphs.every(({ runs }) => runs.every((run) => run.transparency >= 100));

const signatureOf = (paragraphs: Paragraph[]) =>
	paragraphs
		.map(({ runs }) =>
			runs
				.map(
					(run) =>
						`${run.text}|${run.color}|${String(run.transparency)}|${run.size.toFixed(1)}`,
				)
				.join(""),
		)
		.join("¶");

export function codeItem(context: ExtractContext, pre: Element) {
	const laidOut = context.boxOf(pre);
	const entry = context.ownRunsOf(pre);
	if (!laidOut || !entry) {
		return;
	}

	const { box, scale } = geometryOf(laidOut);
	const frame = runFrame(context, entry, pre);
	const lines = [...pre.querySelectorAll(".line")];
	const paragraphs: Paragraph[] = lines.map(() => ({ runs: [] }));
	const baselines: (number | undefined)[] = [];
	for (const run of entry.runs) {
		const owner = context.byId.get(run.owner);
		const index = owner
			? lines.findIndex((line) => line === owner || line.contains(owner))
			: -1;
		if (!owner || index < 0 || /^\n+$/.test(run.text)) {
			continue;
		}

		const style = runStyle(context, owner, context.opacityOf(owner));
		paragraphs[index].runs.push({
			...style,
			text: run.text.replace(/\t/g, "  "),
		});
		if (baselines[index] === undefined) {
			const rect = runRect(frame, run);
			baselines[index] = rect.y + rect.h * context.ascentRatio(style.font);
		}
	}

	while (paragraphs.at(-1)?.runs.length === 0) {
		paragraphs.pop();
	}

	if (isInvisible(paragraphs)) {
		return;
	}

	context.push({
		baselines: baselines.filter((baseline) => baseline !== undefined),
		box: insetBox(box, context.contentInsets(pre), scale),
		key: `${context.pathOf(pre)}#code:${signatureOf(paragraphs)}`,
		kind: "code",
		paragraphs,
		style: {
			align: "left",
			lineHeight: lineHeightOf(context.styleOf(pre)) * scale,
			nowrap: true,
		},
	});
}

/** Inline elements with a background or border ("pills", like inline code) as boxes, one per line they span. */
export function inlinePills(
	context: ExtractContext,
	element: Element,
	entry: LaidOutRuns,
	opacity: number,
) {
	const { origin, scale } = runFrame(context, entry, element);
	for (const child of element.querySelectorAll("*")) {
		const style = boxStyle(context, child, opacity);
		if (!(style?.fill || style?.border) || !context.isInline(child)) {
			continue;
		}

		const id = context.idOf(child);
		const own = entry.runs.filter(
			(run) =>
				run.owner === id ||
				context.byId.get(run.owner)?.closest(`[${ID}="${id}"]`),
		);
		const lines: {
			bottom: number;
			left: number;
			right: number;
			top: number;
		}[] = [];
		for (const run of own) {
			let line = lines.at(-1);
			if (!line || run.x < line.right - 1) {
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
		const { border, fill, radius } = style;
		for (const line of lines) {
			context.push({
				border: border && { ...border, width: border.width * scale },
				box: {
					h: (line.bottom - line.top + paddingY * 2) * scale,
					w: (line.right - line.left + paddingX * 2) * scale,
					x: origin.x + (line.left - paddingX) * scale,
					y: origin.y + (line.top - paddingY) * scale,
				},
				fill,
				key: `${context.pathOf(child)}#pill:${String(Math.round(line.left))}`,
				kind: "box",
				label: context.labelOf(child),
				radius: radius * scale,
				rotation: 0,
			});
		}
	}
}

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
	const style = context.styleOf(first ?? list);
	context.push({
		box,
		bulletColor: marker && parseColor(marker.color)?.hex,
		key: `${context.pathOf(list)}#list`,
		kind: "list",
		paragraphs,
		style: {
			align: TEXT_ALIGNMENTS[style["text-align"]] ?? "left",
			lineHeight: lineHeightOf(style) * scale,
			nowrap: false,
			wrapWidth: converted.some(({ wrapped }) => wrapped)
				? Math.max(...converted.map(({ right }) => right)) - box.x
				: undefined,
		},
	});
}

/** List item ordinals, as browsers number them: from the list's start, or an item's value. */
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

export function runStyle(
	context: ExtractContext,
	element: Element,
	opacity: number,
): Run {
	const style = context.styleOf(element);
	const zoom = context.scaleAt(element);
	const color = textColorOf(context, element);
	const gradient =
		!color || color.alpha === 0 ? gradientTextOf(context, element) : undefined;
	const visible = gradient ? { alpha: 1, hex: gradient.stops[0].hex } : color;
	const { bold, font } = context.fonts.resolve(
		style["font-family"],
		Number(style["font-weight"]),
		style["font-style"] === "italic",
	);
	const stroke = context.lengthOf(element, "-webkit-text-stroke-width");
	const href = element.closest("a[href]")?.getAttribute("href") ?? "";
	const shadow = parseShadow(
		style["text-shadow"],
		(length) => context.resolve(element, length),
		style.color,
	);
	return {
		bold,
		color: visible?.hex ?? "ffffff",
		font,
		gradient: gradient && {
			angle: gradient.angle,
			stops: gradient.stops.map((stop) => ({ ...stop, transparency: 0 })),
		},
		href: /^(?:https?|mailto):/i.test(href) ? href : undefined,
		italic: style["font-style"] === "italic",
		letterSpacing: context.lengthOf(element, "letter-spacing") * zoom,
		script: scriptOf(style, element),
		shadow,
		size: parseFloat(style["font-size"]) * zoom,
		stroke: stroke
			? {
					color:
						parseColor(style["-webkit-text-stroke-color"], style.color)?.hex ??
						"000000",
					width: stroke * zoom,
				}
			: undefined,
		text: "",
		transparency: visible ? transparencyOf(visible.alpha, opacity) : 100,
		underline: style["text-decoration-line"].includes("underline"),
		upper: style["text-transform"] === "uppercase",
	};
}

export function textItem(
	context: ExtractContext,
	element: Element,
	entry: LaidOutRuns,
	opacity: number,
) {
	const owner = entry.anonymous ? undefined : element;
	const { box: entryBox, rotation, scale } = geometryOf(entry.box);
	const box = owner
		? insetBox(entryBox, context.contentInsets(owner), scale)
		: entryBox;
	const { baselines, runs, wrapRight } = runsToParagraph(
		context,
		entry,
		(runOwner) => (owner ? context.opacityOf(runOwner) : opacity),
		owner,
	);
	const paragraphs = [{ runs }];
	if (isInvisible(paragraphs)) {
		return;
	}

	const style = context.styleOf(element);
	context.push({
		baselines: rotation ? undefined : baselines,
		box,
		heading: owner && /^h[1-6]$/.test(element.localName) ? true : undefined,
		key: `${context.pathOf(element)}#${owner ? "text" : "loose"}:${signatureOf(paragraphs)}`,
		kind: "text",
		paragraphs,
		rotation,
		style: {
			align: TEXT_ALIGNMENTS[style["text-align"]] ?? "left",
			lineHeight: lineHeightOf(style) * scale,
			nowrap:
				/^(?:nowrap|pre)$/.test(style["white-space"]) || Boolean(rotation),
			wrapWidth: wrapRight === undefined ? undefined : wrapRight - box.x,
		},
	});
}

/** Converts takumi's runs (per line, per style) into one paragraph's runs, with baselines and soft breaks for browser wraps. */
function runsToParagraph(
	context: ExtractContext,
	entry: LaidOutRuns,
	opacityFor: (owner: Element) => number,
	element: Element | undefined,
) {
	const frame = runFrame(context, entry, element);
	const runs: Run[] = [];
	const baselines: number[] = [];
	const spacer = context.fonts.spacer();
	const matchSource = sourceMatcher(
		sourceTextOf(context, element ?? context.byId.get(entry.parent)),
	);
	let previous: LaidOutRun | undefined;
	let right = -Infinity;
	let wrapped = false;
	let afterNewline = false;
	for (const run of entry.runs) {
		const owner = context.byId.get(run.owner);
		if (!owner || /^\n+$/.test(run.text)) {
			afterNewline ||= run.text.includes("\n");
			continue;
		}

		const match = matchSource(run.text);
		const style = runStyle(context, owner, opacityFor(owner));
		const rect = runRect(frame, run);
		right = Math.max(right, rect.x + rect.w);
		const newLine = startsLine(previous, run);
		const gap =
			previous && !newLine
				? (run.x - (previous.x + previous.width)) * frame.scale
				: 0;
		previous = run;
		if (!style.script) {
			const baseline = rect.y + rect.h * context.ascentRatio(style.font);
			if (!baselines.length || newLine) {
				baselines.push(baseline);
			} else {
				baselines[baselines.length - 1] = Math.max(
					baselines[baselines.length - 1],
					baseline,
				);
			}
		}

		const text = sourceCased(run.text, style, match?.original);
		if (gap > MIN_SPACER_GAP && runs.length) {
			runs.push({
				...style,
				bold: false,
				font: spacer.font,
				gradient: undefined,
				letterSpacing: gap - spacer.advance * style.size,
				pad: true,
				stroke: undefined,
				text: NO_BREAK_SPACE,
				transparency: 100,
			});
		}

		if (newLine) {
			const last = runs.at(-1);
			const { blankLines, forced, spaced } = breakBefore(
				last?.text ?? "",
				match?.between,
				afterNewline,
			);
			wrapped ||= !forced;
			if (last && !last.pad) {
				last.text = last.text.trimEnd() + (spaced && !forced ? " " : "");
			}

			for (let line = 0; line < blankLines; line++) {
				runs.push({
					...style,
					href: undefined,
					lineBreak: true,
					text: " ",
					underline: false,
				});
			}

			runs.push({
				...style,
				...(forced ? { lineBreak: true } : { softBreak: true }),
				text: text.trimStart(),
			});
		} else {
			runs.push({ ...style, text });
		}

		afterNewline = false;
	}

	return {
		baselines,
		left: frame.origin.x,
		right,
		runs: trimRuns(runs),
		wrapRight: wrapped ? right : undefined,
	};
}

/**
 * How a run that starts a new line breaks from the text before it. A br element or a
 * newline in preserved white space forces a break, as does a wrap at a zero-width space, which
 * PowerPoint can't break at; any other wrap keeps the space it wrapped at, if any.
 */
function breakBefore(
	previousText: string,
	between: string | undefined,
	afterNewline: boolean,
) {
	const newlines = between ? between.split("\n").length - 1 : 0;
	const breaks = Math.max(afterNewline ? 1 : 0, newlines);
	return {
		blankLines: Math.max(0, breaks - 1),
		forced: breaks > 0 || previousText.endsWith(ZERO_WIDTH_SPACE),
		spaced:
			between === undefined
				? !/[-\u200b]$/.test(previousText.trimEnd())
				: /\s/.test(between),
	};
}

function gradientTextOf(context: ExtractContext, element: Element) {
	for (
		let current: Element | null = element;
		current && current.localName !== "html";
		current = current.parentElement
	) {
		const style = context.styleOf(current);
		if (clipsToText(style)) {
			const gradient = parseLinearGradient(style["background-image"], 1);
			if (gradient) {
				return gradient;
			}
		}
	}

	return undefined;
}

/** A list item's text and nested lists, top to bottom. */
function itemBlocks(context: ExtractContext, item: Element): ItemBlock[] {
	const own = context.ownRunsOf(item);
	if (own) {
		return [{ entry: own, kind: "text", owner: item, y: own.box.y }];
	}

	return [
		...context.looseRunsOf(item).map((entry): ItemBlock => ({
			entry,
			kind: "text",
			owner: undefined,
			y: entry.box.y,
		})),
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

/** A list's items as paragraphs, each item's nested lists' paragraphs after it, a level deeper. */
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

			const { baselines, left, right, runs, wrapRight } = runsToParagraph(
				context,
				block.entry,
				() => opacity,
				block.owner,
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

function runFrame(
	context: ExtractContext,
	entry: LaidOutRuns,
	element: Element | undefined,
) {
	const scale = scaleOf(entry.box);
	const { left, top } = element
		? context.contentInsets(element)
		: { left: 0, top: 0 };
	return {
		origin: { x: entry.box.x + scale * left, y: entry.box.y + scale * top },
		scale,
	};
}

const runRect = ({ origin, scale }: RunFrame, run: LaidOutRun) => ({
	h: run.height * scale,
	w: run.width * scale,
	x: origin.x + run.x * scale,
	y: origin.y + run.y * scale,
});

/** Raised or lowered text: by vertical-align, or inside sup or sub, which the Tailwind reset positions relatively instead. */
function scriptOf(style: ComputedStyle, element: Element) {
	if (style["vertical-align"] === "super" || element.closest("sup")) {
		return "super";
	}

	if (style["vertical-align"] === "sub" || element.closest("sub")) {
		return "sub";
	}

	return undefined;
}

/** An element's text color; an invalid one falls back to its parent's, as browsers drop invalid declarations. */
function textColorOf(
	context: ExtractContext,
	element: Element,
): Color | undefined {
	const style = context.styleOf(element);
	const fill = style["-webkit-text-fill-color"];
	const value = fill && fill !== "currentcolor" ? fill : style.color;
	return value.trim().toLowerCase() === "transparent"
		? { alpha: 0, hex: "000000" }
		: (parseColor(value) ??
				(element.parentElement
					? textColorOf(context, element.parentElement)
					: undefined));
}

/** Uppercase text in its source casing (takumi reports it transformed), which PowerPoint capitalizes. */
function sourceCased(text: string, style: Run, original: string | undefined) {
	const collapsed = text.replace(COLLAPSIBLE_SPACE, " ");
	const core = collapsed.trim();
	return style.upper && core.length === original?.length
		? collapsed.replace(core, () => original)
		: collapsed;
}

/**
 * Finds each run's text in turn in the source text, which keeps what takumi drops: the
 * casing before text-transform, and the white space or newlines lines broke at.
 */
function sourceMatcher(sourceText: string) {
	const source = sourceText.toLowerCase();
	let cursor = 0;
	return (text: string) => {
		const needle = text.replace(COLLAPSIBLE_SPACE, " ").trim().toLowerCase();
		const found = needle ? source.indexOf(needle, cursor) : -1;
		if (found < 0) {
			return undefined;
		}

		const between = source.slice(cursor, found);
		cursor = found + needle.length;
		return { between, original: sourceText.slice(found, cursor) };
	};
}

/** An element's text as browsers lay it out: collapsible white space as single spaces, and preserved newlines and br elements as "\n". */
function sourceTextOf(context: ExtractContext, root: Element | undefined) {
	let text = "";
	const visit = (node: Node) => {
		if (node.nodeType === node.TEXT_NODE) {
			const parent = node.parentElement;
			const preserved =
				parent !== null &&
				PRESERVED_WHITE_SPACE.test(context.styleOf(parent)["white-space"]);
			text += (node.textContent ?? "").replace(
				preserved ? /[ \t]+/g : COLLAPSIBLE_SPACE,
				" ",
			);
		} else if (node.nodeName === "BR") {
			text += "\n";
		} else {
			node.childNodes.forEach(visit);
		}
	};

	if (root) {
		visit(root);
	}

	return text;
}

/** Whether a run starts a new line: it jumps back left and down (runs in other fonts, like inline code, sit at other heights on one line). */
const startsLine = (previous: LaidOutRun | undefined, run: LaidOutRun) =>
	previous !== undefined &&
	run.x < previous.x + previous.width - 1 &&
	run.y + run.height > previous.y + previous.height + 1;

/** A paragraph's runs without the white space around its text, the zero-width spaces PowerPoint shows, or empty runs. */
function trimRuns(runs: Run[]) {
	const first = runs.at(0);
	const last = runs.at(-1);
	if (first && !first.pad) {
		first.text = first.text.trimStart();
	}

	if (last && !last.pad) {
		last.text = last.text.trimEnd();
	}

	if (first) {
		first.softBreak = undefined;
		first.lineBreak = undefined;
	}

	return runs
		.map((run) => ({ ...run, text: run.text.replaceAll(ZERO_WIDTH_SPACE, "") }))
		.filter((run) => run.text.length);
}
