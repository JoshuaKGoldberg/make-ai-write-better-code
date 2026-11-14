import type { ComputedStyle } from "../cascade.ts";
import type { Color } from "../color.ts";
import type { FontBook } from "../fonts.ts";
import type { LaidOutRun, LaidOutRuns } from "../layout.ts";
import type { Paragraph, Point, Run, TextStyle } from "../model.ts";
import type { ExtractContext } from "./context.ts";

import { isOutOfFlow } from "../cascade.ts";
import {
	parseColor,
	parseLinearGradient,
	parseShadow,
	transparencyOf,
} from "../color.ts";
import { isAtomicInline, ZERO_WIDTH_SPACE } from "../layout.ts";
import { clipsToText } from "./boxes.ts";
import { scaleOf } from "./geometry.ts";

/** Where a text entry's runs sit: takumi reports them in local px from the content box's corner. */
interface RunFrame {
	origin: Point;
	scale: number;
}

const TEXT_ALIGNMENTS: Partial<Record<string, TextStyle["align"]>> = {
	center: "center",
	justify: "justify",
	left: "left",
	right: "right",
};

/** White space that HTML collapses, which leaves out no-break spaces. */
const COLLAPSIBLE_SPACE = /[ \t\n\r\f]+/g;

/** Gaps between runs narrower than this, in px, are kerning rather than spacing. */
const MIN_SPACER_GAP = 0.75;

const NO_BREAK_SPACE = " ";

const PRESERVED_NEWLINES = /^(?:pre|pre-wrap|pre-line|break-spaces)$/;

const PRESERVED_SPACES = /^(?:pre|pre-wrap|break-spaces)$/;

export function alignOf(context: ExtractContext, element: Element) {
	const style = context.styleOf(element);
	const rtl =
		(style.direction ?? element.closest("[dir]")?.getAttribute("dir")) ===
		"rtl";
	const logical: Partial<Record<string, string>> = {
		end: rtl ? "left" : "right",
		start: rtl ? "right" : "left",
	};
	const align = style["text-align"];
	return TEXT_ALIGNMENTS[logical[align] ?? align] ?? "left";
}

export const ascentRatio = (fonts: FontBook, font: string) => {
	const { ascent, descent } = fonts.metrics(font);
	return ascent / (ascent + descent);
};

export const isInvisible = (paragraphs: Paragraph[]) =>
	paragraphs.every(({ runs }) => runs.every((run) => run.transparency >= 100));

export const signatureOf = (paragraphs: Paragraph[]) =>
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

export function runFrame(
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

export const runRect = ({ origin, scale }: RunFrame, run: LaidOutRun) => ({
	height: run.height * scale,
	width: run.width * scale,
	x: origin.x + run.x * scale,
	y: origin.y + run.y * scale,
});

/** Converts takumi's runs (per line, per style) into one paragraph's runs, with baselines and soft breaks for browser wraps. */
export function runsToParagraph(
	context: ExtractContext,
	entry: LaidOutRuns,
	element: Element | undefined,
	opacityOf = context.opacityOf,
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

		const preserved = PRESERVED_SPACES.test(
			context.styleOf(owner)["white-space"],
		);
		const match = matchSource(run.text, preserved);
		const style = runStyle(context, owner, opacityOf(owner));
		const rect = runRect(frame, run);
		right = Math.max(right, rect.x + rect.width);
		const newLine = startsLine(previous, run);
		const gap =
			previous && !newLine
				? (run.x - (previous.x + previous.width)) * frame.scale
				: 0;
		previous = run;
		if (!style.script) {
			const baseline =
				rect.y + rect.height * ascentRatio(context.fonts, style.font);
			if (!baselines.length || newLine) {
				baselines.push(baseline);
			} else {
				baselines[baselines.length - 1] = Math.max(
					baselines[baselines.length - 1],
					baseline,
				);
			}
		}

		const text = sourceCased(
			preserved ? run.text : run.text.replace(COLLAPSIBLE_SPACE, " "),
			style,
			match?.original,
		);
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
					lineBreak: "forced",
					strike: false,
					text: " ",
					underline: false,
				});
			}

			runs.push({
				...style,
				lineBreak: forced ? "forced" : "wrap",
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

export function runStyle(
	context: ExtractContext,
	element: Element,
	opacity: number,
): Omit<Run, "text"> {
	const style = context.styleOf(element);
	const zoom = context.scaleAt(element);
	const color = textColorOf(context, element);
	const gradient =
		!color || color.alpha === 0 ? gradientTextOf(context, element) : undefined;
	const visible = gradient ? { alpha: 1, hex: gradient.stops[0].color } : color;
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
	const decorations = decorationLinesOf(context, element);
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
		pad: false,
		script: scriptOf(style, element),
		shadow,
		size: parseFloat(style["font-size"]) * zoom,
		strike: decorations.some((lines) => lines.includes("line-through")),
		stroke: stroke
			? {
					color:
						parseColor(style["-webkit-text-stroke-color"], style.color)?.hex ??
						"000000",
					width: stroke * zoom,
				}
			: undefined,
		transparency: visible ? transparencyOf(visible.alpha, opacity) : 100,
		underline: decorations.some((lines) => lines.includes("underline")),
		upper: style["text-transform"] === "uppercase",
	};
}

/** Whether a run starts a new line: it jumps back left and down (runs in other fonts, like inline code, sit at other heights on one line). */
export const startsLine = (previous: LaidOutRun | undefined, run: LaidOutRun) =>
	previous !== undefined &&
	run.x < previous.x + previous.width - 1 &&
	run.y + run.height > previous.y + previous.height + 1;

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
	const trimmed = previousText.trimEnd();
	return {
		blankLines: Math.max(0, breaks - 1),
		forced: breaks > 0 || previousText.endsWith(ZERO_WIDTH_SPACE),
		spaced:
			between === undefined
				? !trimmed.endsWith("-") && !trimmed.endsWith(ZERO_WIDTH_SPACE)
				: /\s/.test(between),
	};
}

/** The decoration lines drawn on an element's text: its own and its ancestors', which propagate into inline content but not into inline blocks or out-of-flow elements. */
function decorationLinesOf(context: ExtractContext, element: Element) {
	const lines: string[] = [];
	for (
		let current: Element | null = element;
		current && current.localName !== "html";
		current = current.parentElement
	) {
		const style = context.styleOf(current);
		lines.push(style["text-decoration-line"]);
		if (isAtomicInline(style) || isOutOfFlow(style)) {
			break;
		}
	}

	return lines;
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

/** Uppercase text in its source casing (takumi reports it transformed), which PowerPoint capitalizes. */
function sourceCased(
	text: string,
	style: Pick<Run, "upper">,
	original: string | undefined,
) {
	const core = text.trim();
	return style.upper && core.length === original?.length
		? text.replace(core, () => original)
		: text;
}

/**
 * Finds each run's text in turn in the source text, which keeps what takumi drops: the
 * casing before text-transform, and the white space or newlines lines broke at.
 */
function sourceMatcher(sourceText: string) {
	const source = sourceText.toLowerCase();
	let cursor = 0;
	return (text: string, preserved: boolean) => {
		const needle = (preserved ? text : text.replace(COLLAPSIBLE_SPACE, " "))
			.trim()
			.toLowerCase();
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
			const whiteSpace = node.parentElement
				? context.styleOf(node.parentElement)["white-space"]
				: "normal";
			const content = node.textContent ?? "";
			text += PRESERVED_SPACES.test(whiteSpace)
				? content
				: content.replace(
						PRESERVED_NEWLINES.test(whiteSpace) ? /[ \t]+/g : COLLAPSIBLE_SPACE,
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

/** An element's text color; an invalid one falls back to its parent's, as browsers drop invalid declarations. */
function textColorOf(
	context: ExtractContext,
	element: Element,
): Color | undefined {
	const style = context.styleOf(element);
	const fill = style["-webkit-text-fill-color"];
	const value = fill && fill !== "currentcolor" ? fill : style.color;
	return (
		parseColor(value) ??
		(element.parentElement
			? textColorOf(context, element.parentElement)
			: undefined)
	);
}

function trimRuns(runs: Run[]) {
	const first = runs.at(0);
	const last = runs.at(-1);
	if (first) {
		delete first.lineBreak;
		if (!first.pad) {
			first.text = first.text.trimStart();
		}
	}

	if (last && !last.pad) {
		last.text = last.text.trimEnd();
	}

	return runs
		.map((run) => ({ ...run, text: run.text.replaceAll(ZERO_WIDTH_SPACE, "") }))
		.filter((run) => run.text.length);
}
