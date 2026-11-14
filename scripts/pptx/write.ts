/**
 * Writes a native .pptx from the deck model (see model.ts): text boxes, bulleted
 * lists, code, shapes, images, click animations, transitions, and speaker notes.
 */
import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import pptxgen from "pptxgenjs";

import type { FontBook } from "./fonts.ts";
import type {
	Box,
	Canvas,
	CodeItem,
	Deck,
	Fill,
	Item,
	ListItem,
	ListParagraph,
	Paragraph,
	Run,
	Slide,
	Stroke,
	TextItem,
	TextStyle,
} from "./model.ts";
import type { Gradients, SlidePatch } from "./ooxml.ts";

import { unescapeCss } from "./cascade.ts";
import { unquote } from "./css.ts";
import {
	createGradients,
	DECORATIVE,
	finishPackage,
	normalizeDegrees,
	UPPERCASE_LANG,
} from "./ooxml.ts";
import { truncate } from "./text.ts";

export interface WriteOptions {
	deck: Deck;
	/** The deck's fonts, for their metrics and glyph coverage. */
	fonts: FontBook;
	out: string;
	/** Whether to write one static slide per click state instead of animating clicks. */
	slidePerClick: boolean;
}

/** A model item merged across click states. */
interface Entry {
	anchor: Box;
	item: Item;
	/** What the item looks like, apart from where it is and (for lists) which paragraphs show. */
	look: string;
	order: number;
	/** For lists: the states each paragraph is visible in. */
	paragraphStates?: Set<number>[];
	states: Set<number>;
}

type ItemWriter = ReturnType<typeof createItemWriter>;

/** A list's marker in PowerPoint: a character bullet, or automatic numbering. */
type Marker =
	| { code: string; keyword: boolean; kind: "char" }
	| { kind: "number"; style: string };

type TextParagraph = Paragraph & {
	/** For list items: the marker, and the hanging indent it sits in. */
	bullet?: pptxgen.default.TextPropsOptions["bullet"];
	indentLevel?: number;
	/** pt */
	spaceAfter?: number;
};

/** Consecutive numbered list paragraphs at one level, which PowerPoint numbers on from their start. */
interface NumberSequence {
	level: number;
	next: number;
	start: number;
	style: string;
}

/** Converts canvas px to PowerPoint's units. */
interface Units {
	inches: (pixels: number) => number;
	points: (pixels: number) => number;
}

// https://github.com/gitbrent/PptxGenJS/issues/1536
const PptxGenJS = pptxgen as unknown as typeof pptxgen.default;
type Presentation = pptxgen.default;

/** PowerPoint's standard slide height; widths follow the deck's aspect ratio (13.333" for 16:9). */
const PAGE_HEIGHT_INCHES = 7.5;
const PAGE_LAYOUT = "Slidev";
const EMU_PER_INCH = 914400;

/** The font macOS browsers draw symbols the deck's fonts lack (like ✓) in; PowerPoint's own fallback differs. */
const SYMBOL_FONT = "Lucida Grande";

/** Bulleted paragraphs render about 0.035 lines lower in PowerPoint (measured). */
const LIST_LIFT = 0.035;

/** Browsers draw a disc marker about 0.75em left of where each item's text starts. */
const BULLET_GAP = 0.75;

/** PowerPoint shrinks superscripts and subscripts to about 2/3 of their size; 1.12x renders like a browser's 75% superscripts. */
const SCRIPT_SCALE = 1.12;

/** pptxgenjs swaps a zero shadow blur or offset for its defaults, so zero is written as this. */
const NEAR_ZERO = 0.01;

const DEFAULT_FONT_SIZE = 16;
const MIN_ROUNDED_RADIUS = 0.5;
const NAME_LENGTH = 48;
const NO_BREAK_SPACE = "00A0";

const NUMBER_STYLES: Partial<Record<string, string>> = {
	decimal: "arabicPeriod",
	"decimal-leading-zero": "arabicPeriod",
	"lower-alpha": "alphaLcPeriod",
	"lower-latin": "alphaLcPeriod",
	"lower-roman": "romanLcPeriod",
	"upper-alpha": "alphaUcPeriod",
	"upper-latin": "alphaUcPeriod",
	"upper-roman": "romanUcPeriod",
};

const KEYWORD_MARKERS: Partial<Record<string, string>> = {
	circle: "25CB",
	disc: "25CF",
	square: "25A0",
};

/** How many roman numerals each decimal digit takes, as in IV or VIII. */
const ROMAN_LENGTHS = [0, 1, 2, 3, 2, 1, 2, 3, 4, 2];

export async function writePptx({
	deck,
	fonts,
	out,
	slidePerClick,
}: WriteOptions) {
	const presentation = new PptxGenJS();
	const widthInches = PAGE_HEIGHT_INCHES * deck.aspectRatio;
	presentation.defineLayout({
		height: PAGE_HEIGHT_INCHES,
		name: PAGE_LAYOUT,
		width: widthInches,
	});
	presentation.layout = PAGE_LAYOUT;
	presentation.author = deck.author;
	presentation.company = "";
	presentation.subject = "";
	presentation.title = deck.title;

	const theme = themeOf(deck);
	if (theme.bodyFont) {
		presentation.theme = {
			bodyFontFace: theme.bodyFont,
			headFontFace: theme.headingFont ?? theme.bodyFont,
		};
	}

	const units: Units = {
		inches: (pixels) => (pixels * widthInches) / deck.canvas.width,
		points: (pixels) => ((pixels * widthInches) / deck.canvas.width) * 72,
	};
	const gradients = createGradients(colorsOf(deck));
	const addItem = createItemWriter({
		bodyFont: theme.bodyFont ?? "Arial",
		canvas: deck.canvas,
		fonts,
		gradients,
		presentation,
		units,
	});
	const patches = deck.slides.flatMap((slide) =>
		slidePerClick
			? writeClickSlides(presentation, slide, addItem)
			: [writeAnimatedSlide(presentation, slide, addItem)],
	);

	const zip = await JSZip.loadAsync(
		await presentation.write({ outputType: "nodebuffer" }),
	);
	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(
		out,
		await finishPackage(zip, {
			background: await fs.readFile(deck.background.file),
			emuPerPixel: EMU_PER_INCH * units.inches(1),
			gradients,
			monospace: fonts.spacer().font,
			slides: patches,
			theme: {
				background: deck.background.color,
				link: theme.link,
				text: theme.text ?? "000000",
			},
		}),
	);
	return { slides: patches.length };
}

/** Writes a slide with its click states as animations. */
function writeAnimatedSlide(
	presentation: Presentation,
	slide: Slide,
	addItem: ItemWriter,
) {
	const powerPointSlide = presentation.addSlide();
	powerPointSlide.addNotes(withoutControlCharacters(slide.notes));
	const patch = emptyPatch(slide);
	const used = new Set<string>();
	for (const entry of timeline(slide)) {
		const name = uniqueName(entry.item, used);
		const shapes = addItem(powerPointSlide, entry.item, name);
		describeShape(patch, entry.item, name);

		for (let click = 1; click < slide.states.length; click++) {
			const now = entry.states.has(click);
			const before = entry.states.has(click - 1);
			if (now !== before) {
				for (const shape of shapes) {
					patch.effects.push({
						click,
						name: shape,
						type: now ? "entr" : "exit",
					});
				}
			}

			entry.paragraphStates?.forEach((states, paragraph) => {
				if (now && before && states.has(click) !== states.has(click - 1)) {
					patch.effects.push({
						click,
						name,
						paragraph,
						type: states.has(click) ? "entr" : "exit",
					});
				}
			});
		}
	}

	return patch;
}

/** Writes one static slide per click state. */
function writeClickSlides(
	presentation: Presentation,
	slide: Slide,
	addItem: ItemWriter,
) {
	const entries = timeline(slide);
	return slide.states.map((_, click) => {
		const powerPointSlide = presentation.addSlide();
		powerPointSlide.addNotes(
			withoutControlCharacters(
				`Slide ${String(slide.number)}, click ${String(click)}\n\n${slide.notes}`,
			),
		);
		const patch = emptyPatch(slide);
		const used = new Set<string>();
		for (const entry of entries.filter(({ states }) => states.has(click))) {
			const name = uniqueName(entry.item, used);
			addItem(
				powerPointSlide,
				entry.item,
				name,
				entry.paragraphStates?.map((states) => states.has(click)),
			);
			describeShape(patch, entry.item, name);
		}

		return patch;
	});
}

const emptyPatch = (slide: Slide): SlidePatch => ({
	effects: [],
	lists: [],
	pictureCorners: [],
	transition: slide.transition,
});

function createItemWriter({
	bodyFont,
	canvas,
	fonts,
	gradients,
	presentation,
	units: { inches, points },
}: {
	bodyFont: string;
	canvas: Canvas;
	fonts: FontBook;
	gradients: Gradients;
	presentation: Presentation;
	units: Units;
}) {
	const position = (box: Box) => ({
		h: inches(box.h),
		w: inches(box.w),
		x: inches(box.x),
		y: inches(box.y),
	});
	const fillFor = (fill: Fill | undefined): pptxgen.default.ShapeFillProps =>
		fill
			? {
					color: fill.gradient ? gradients.sentinel(fill.gradient) : fill.color,
					transparency: fill.gradient
						? undefined
						: fill.transparency || undefined,
				}
			: { type: "none" };
	const lineFor = (
		stroke: Stroke | undefined,
	): pptxgen.default.ShapeLineProps =>
		stroke
			? {
					color: stroke.color,
					transparency: stroke.transparency,
					width: Math.max(0.25, points(stroke.width)),
				}
			: { type: "none" };

	const splitFallback = (run: Run): Run[] => {
		if (run.pad) {
			return [run];
		}

		const pieces: Run[] = [];
		for (const character of run.text) {
			const missing =
				fonts.covers(run.font, character.codePointAt(0) ?? 0) === false &&
				!/[\p{Extended_Pictographic}\p{Cf}]/u.test(character);
			const font = missing ? SYMBOL_FONT : run.font;
			const last = pieces.at(-1);
			if (last?.font === font) {
				last.text += character;
			} else {
				pieces.push({
					...run,
					bold: missing ? /(?:SemiBold|Bold|Black)$/.test(run.font) : run.bold,
					font,
					lineBreak: pieces.length ? undefined : run.lineBreak,
					softBreak: pieces.length ? undefined : run.softBreak,
					text: character,
				});
			}
		}

		return pieces.length ? pieces : [run];
	};

	const textRuns = (
		paragraphs: TextParagraph[],
		{
			code,
			firstRun,
			lineHeight,
			outline,
			wrap,
		}: {
			code: boolean;
			firstRun: Run | undefined;
			lineHeight: number;
			/** Whether this is the outlined copy behind a text stroke. */
			outline: boolean;
			wrap: boolean;
		},
	) =>
		paragraphs.flatMap((paragraph, paragraphIndex) => {
			const last = paragraphIndex === paragraphs.length - 1;
			const pieces: Run[] = paragraph.runs.length
				? mergeRuns(paragraph.runs.flatMap(splitFallback), wrap)
				: [
						blankRun(
							firstRun ?? emptyRun(code ? fonts.spacer().font : bodyFont),
						),
					];
			const baseSize =
				pieces.find((run) => !run.script)?.size ?? pieces[0].size;
			const multiple = lineHeight
				? Math.round((lineHeight / (1.2 * baseSize)) * 1000) / 1000
				: undefined;
			return pieces.map((run, runIndex) => {
				const hyperlink = run.href && !run.pad ? { url: run.href } : undefined;
				const options: pptxgen.default.TextPropsOptions = {
					bold: run.bold,
					breakLine: !last && runIndex === pieces.length - 1,
					bullet: paragraph.bullet,
					charSpacing: run.letterSpacing
						? Math.round(points(run.letterSpacing) * 100) / 100
						: undefined,
					color: run.gradient ? gradients.sentinel(run.gradient) : run.color,
					fontFace: run.font,
					fontSize:
						Math.round(
							points(run.script ? SCRIPT_SCALE * baseSize : run.size) * 10,
						) / 10,
					hyperlink,
					indentLevel: paragraph.indentLevel,
					italic: run.italic,
					lang: run.upper ? UPPERCASE_LANG : undefined,
					lineSpacingMultiple: multiple,
					outline:
						outline && run.stroke
							? {
									color: run.stroke.color,
									size: Math.max(0.5, points(run.stroke.width)),
								}
							: undefined,
					paraSpaceAfter: paragraph.spaceAfter,
					softBreakBefore: breaksBefore(run, wrap) || undefined,
					subscript: run.script === "sub" || undefined,
					superscript: run.script === "super" || undefined,
					transparency: run.transparency || undefined,
					underline: run.underline
						? { style: "sng" }
						: hyperlink && { style: "none" },
				};
				return {
					options,
					text: withoutControlCharacters(run.text) || (code ? " " : ""),
				};
			});
		});

	/** The line pitch of a code block, measured from its baselines; blank lines make some gaps span several lines. */
	const codePitch = (item: CodeItem) => {
		const { baselines, style } = item;
		const pitches = baselines
			.slice(1)
			.map((baseline, index) => baseline - baselines[index])
			.filter((gap) => gap > 1)
			.map((gap) => gap / Math.max(1, Math.round(gap / style.lineHeight)))
			.sort((a, b) => a - b);
		const pitch = pitches.at(Math.floor(pitches.length / 2));
		return pitch !== undefined && Math.abs(pitch - style.lineHeight) > 0.3
			? pitch
			: style.lineHeight;
	};

	/**
	 * A list's paragraphs, each with the space after it in whole points (PowerPoint rounds
	 * paragraph spacing to them), keeping the running total exact so errors never add up.
	 */
	const spacedListParagraphs = (
		item: ListItem,
	): (ListParagraph & { spaceAfter?: number })[] => {
		let exact = 0;
		let written = 0;
		return item.paragraphs.map((paragraph, index) => {
			const next = item.paragraphs.at(index + 1);
			const last = paragraph.baselines.at(-1);
			if (!next?.baselines.length || last === undefined) {
				return paragraph;
			}

			exact += points(
				Math.max(0, next.baselines[0] - (last + item.style.lineHeight)),
			);
			const spaceAfter = Math.round(exact) - written;
			written += spaceAfter;
			return { ...paragraph, spaceAfter: spaceAfter || undefined };
		});
	};

	/**
	 * A list's paragraphs with their markers, each hanging before its text. Hidden
	 * paragraphs and later paragraphs of an item keep their place unmarked.
	 */
	const listParagraphs = (
		item: ListItem,
		visibleParagraphs: boolean[] | undefined,
		markerGap: number,
	): TextParagraph[] => {
		let sequence: NumberSequence | undefined;
		return spacedListParagraphs(item).map((paragraph, index) => {
			const { level, number } = paragraph;
			const visible = visibleParagraphs?.[index] ?? true;
			const marker =
				paragraph.bullet && visible ? markerFor(paragraph.marker) : undefined;
			const indent = Math.max(
				1,
				points((markerGap + paragraph.indent) / (level + 1)),
			);
			const start =
				marker?.kind === "number" &&
				sequence?.level === level &&
				sequence.style === marker.style &&
				sequence.next === number
					? sequence.start
					: number;
			sequence =
				marker?.kind === "number"
					? { level, next: number + 1, start, style: marker.style }
					: undefined;
			return {
				bullet:
					marker === undefined
						? { characterCode: NO_BREAK_SPACE, indent }
						: marker.kind === "number"
							? {
									indent,
									numberStartAt: start,
									style: marker.style,
									type: "number",
								}
							: { characterCode: marker.code, indent },
				indentLevel: level || undefined,
				runs: visible
					? paragraph.runs
					: paragraph.runs.map((run) => ({ ...run, transparency: 100 })),
				spaceAfter: paragraph.spaceAfter,
			};
		});
	};

	/** Where the box's top goes so PowerPoint's first baseline lands on the browser's, and how tall it is. */
	const verticalPlacement = (
		item: CodeItem | ListItem | TextItem,
		style: TextStyle,
		rotation: number,
		firstRun: Run | undefined,
	) => {
		const { box } = item;
		const baselines =
			item.kind === "list"
				? item.paragraphs.find((paragraph) => paragraph.baselines.length)
						?.baselines
				: item.baselines;
		const size = firstRun?.size ?? DEFAULT_FONT_SIZE;
		const { ascent, baseline, descent } = fonts.metrics(firstRun?.font ?? "");
		if (rotation && style.lineHeight) {
			const top =
				box.y +
				(style.lineHeight - (ascent + descent) * size) / 2 +
				ascent * size -
				baseline * style.lineHeight;
			return { height: box.h + (box.y - top), top };
		}

		if (baselines?.length && style.lineHeight) {
			const top =
				baselines[0] -
				(baseline + (item.kind === "list" ? LIST_LIFT : 0)) * style.lineHeight;
			return {
				height: Math.max(
					box.h + (box.y - top),
					baselines[baselines.length - 1] - baselines[0] + style.lineHeight,
				),
				top,
			};
		}

		return { height: box.h, top: box.y };
	};

	/**
	 * How wide the box is and where it starts. Wrapped text gets just enough slack for
	 * rounding, so PowerPoint's lines don't take words the browser wrapped; one-line text
	 * gets more, so PowerPoint's slightly different measuring never wraps it, as far as the
	 * slide's edges allow on the side(s) its alignment grows it toward.
	 */
	const horizontalPlacement = (
		box: Box,
		style: TextStyle,
		rotation: number,
	) => {
		const slack =
			style.nowrap || rotation
				? 0
				: style.wrapWidth === undefined
					? Math.max(10, box.w * 0.06)
					: Math.max(2, box.w * 0.01);
		const width =
			style.wrapWidth !== undefined && style.align === "left" && !rotation
				? Math.min(box.w, style.wrapWidth)
				: box.w;
		const roomLeft = Math.max(0, box.x);
		const roomRight = Math.max(0, canvas.width - (box.x + box.w));
		const extra =
			style.nowrap && !rotation
				? Math.min(
						Math.max(8, box.w * 0.08),
						style.align === "center"
							? 2 * Math.min(roomLeft, roomRight)
							: style.align === "right"
								? roomLeft
								: roomRight,
					)
				: 0;
		const grown = slack + extra;
		const shift =
			style.align === "center"
				? grown / 2
				: style.align === "right"
					? grown
					: 0;
		return { left: box.x - shift, width: width + grown };
	};

	const addText = (
		slide: pptxgen.default.Slide,
		item: CodeItem | ListItem | TextItem,
		name: string,
		visibleParagraphs?: boolean[],
	) => {
		const style =
			item.kind === "code"
				? { ...item.style, lineHeight: codePitch(item) }
				: item.style;
		const rotation = item.kind === "text" ? item.rotation : 0;
		const markerGap =
			item.kind === "list"
				? markerGapOf(
						item,
						firstRunOf(item.paragraphs)?.size ?? DEFAULT_FONT_SIZE,
					)
				: 0;
		const paragraphs: TextParagraph[] =
			item.kind === "list"
				? listParagraphs(item, visibleParagraphs, markerGap)
				: item.paragraphs;
		const firstRun = firstRunOf(paragraphs);
		const { height, top } = verticalPlacement(item, style, rotation, firstRun);
		const { left, width } = horizontalPlacement(item.box, style, rotation);
		const shadow = paragraphs
			.flatMap(({ runs }) => runs)
			.find((run) => run.shadow)?.shadow;
		const options: pptxgen.default.TextPropsOptions = {
			align: style.align,
			fit: "none",
			h: inches(height),
			isTextBox: true,
			margin: 0,
			objectName: name,
			rotate: rotation ? normalizeDegrees(rotation) : undefined,
			shadow: shadow && {
				angle: normalizeDegrees(
					Math.round(
						(Math.atan2(shadow.offsetY, shadow.offsetX) * 180) / Math.PI,
					),
				),
				blur: Math.max(NEAR_ZERO, points(shadow.blur)),
				color: shadow.color,
				offset: Math.max(
					NEAR_ZERO,
					points(Math.hypot(shadow.offsetX, shadow.offsetY)),
				),
				opacity: 1 - shadow.transparency / 100,
				type: "outer",
			},
			valign: "top",
			w: inches(width + markerGap),
			wrap: !style.nowrap,
			x: inches(left - markerGap),
			y: inches(top),
		};
		const runOptions = {
			code: item.kind === "code",
			firstRun,
			lineHeight: style.lineHeight,
			wrap: !style.nowrap,
		};
		const names = [name];
		if (paragraphs.some(({ runs }) => runs.some((run) => run.stroke))) {
			// CSS paints text strokes behind the fill, so an outlined copy goes behind an unoutlined one.
			// pptxgenjs mutates option objects, so never share one between calls.
			slide.addText(textRuns(paragraphs, { ...runOptions, outline: true }), {
				...structuredClone(options),
				objectName: `${name} (outline)`,
			});
			names.push(`${name} (outline)`);
		}

		slide.addText(
			textRuns(paragraphs, { ...runOptions, outline: false }),
			structuredClone(options),
		);
		return names;
	};

	/** Adds an item to a slide; returns the names of the shapes it created. */
	return (
		slide: pptxgen.default.Slide,
		item: Item,
		name: string,
		visibleParagraphs?: boolean[],
	) => {
		switch (item.kind) {
			case "box": {
				const radius = Math.min(item.radius, item.box.w / 2, item.box.h / 2);
				const rounded = radius > MIN_ROUNDED_RADIUS;
				slide.addShape(
					rounded
						? presentation.ShapeType.roundRect
						: presentation.ShapeType.rect,
					{
						...position(item.box),
						fill: fillFor(item.fill),
						line: lineFor(item.border),
						objectName: name,
						rectRadius: rounded ? inches(radius) : undefined,
						rotate: item.rotation ? normalizeDegrees(item.rotation) : undefined,
					},
				);
				return [name];
			}

			case "code":
			case "list":
			case "text":
				return addText(slide, item, name, visibleParagraphs);
			case "ellipse":
				slide.addShape(presentation.ShapeType.ellipse, {
					...position(item.box),
					fill: fillFor(item.fill),
					line: lineFor(item.border),
					objectName: name,
				});
				return [name];
			case "image":
			case "raster": {
				const crop = item.kind === "image" ? item.crop : undefined;
				slide.addImage({
					...position(item.box),
					// pptxgenjs crops from the whole image's size to the frame's.
					...(crop && {
						h: inches(crop.h),
						sizing: {
							h: inches(item.box.h),
							type: "crop" as const,
							w: inches(item.box.w),
							x: inches(item.box.x - crop.x),
							y: inches(item.box.y - crop.y),
						},
						w: inches(crop.w),
					}),
					// pptxgenjs falls back to the file path for empty alt text; mark it decorative instead.
					altText: withoutControlCharacters(item.alt) || DECORATIVE,
					objectName: name,
					path: item.file,
					rounding: item.kind === "image" && item.circle,
					transparency:
						item.kind === "image" ? item.transparency || undefined : undefined,
				});
				return [name];
			}

			case "polygon":
				// https://github.com/gitbrent/PptxGenJS/issues/1328
				slide.addShape("custGeom" as pptxgen.default.SHAPE_NAME, {
					...position(item.box),
					fill: fillFor(item.fill),
					line: lineFor(item.border),
					objectName: name,
					points: [
						...item.points.map((point, index) => ({
							x: inches(point.x),
							y: inches(point.y),
							...(index === 0 ? { moveTo: true } : {}),
						})),
						{ close: true as const },
					],
				});
				return [name];
		}
	};
}

/** Records what post-processing a shape needs: rounded picture corners, list markers, or being the slide's title. */
function describeShape(patch: SlidePatch, item: Item, name: string) {
	if (
		item.kind === "image" &&
		!item.circle &&
		item.radius > MIN_ROUNDED_RADIUS
	) {
		patch.pictureCorners.push({ name, radius: item.radius });
	}

	if (item.kind === "list") {
		const first = item.paragraphs.at(0);
		const marker = first && markerFor(first.marker);
		patch.lists.push({
			color: item.bulletColor,
			keyword: marker?.kind === "char" && marker.keyword,
			name,
		});
	}

	if (item.kind === "text" && item.heading) {
		patch.title ??= name;
	}
}

/** The PowerPoint marker for a CSS list-style-type. */
function markerFor(listStyle: string): Marker {
	const keyword = KEYWORD_MARKERS[listStyle];
	if (keyword) {
		return { code: keyword, keyword: true, kind: "char" };
	}

	if (/^["']/.test(listStyle)) {
		const code = unescapeCss(unquote(listStyle)).trim().codePointAt(0);
		return {
			code:
				code === undefined
					? NO_BREAK_SPACE
					: code <= 0xffff
						? code.toString(16).toUpperCase().padStart(4, "0")
						: "2022",
			keyword: false,
			kind: "char",
		};
	}

	return { kind: "number", style: NUMBER_STYLES[listStyle] ?? "arabicPeriod" };
}

/** Room for a list's outermost markers in their hanging indent: for its widest number and period, or for a bullet. */
function markerGapOf(list: ListItem, size: number) {
	const outermost = list.paragraphs.filter(({ level }) => level === 0);
	const first = outermost.at(0);
	return first && markerFor(first.marker).kind === "number"
		? (Math.max(
				...outermost.map(({ marker, number }) => numberLength(number, marker)),
			) *
				0.55 +
				0.6) *
				size
		: BULLET_GAP * size;
}

/** How many characters a number marker shows before its period, in a list-style-type. */
function numberLength(number: number, listStyle: string) {
	const digits = String(Math.abs(number));
	if (listStyle.endsWith("roman")) {
		return Array.from(digits, (digit) => ROMAN_LENGTHS[Number(digit)]).reduce(
			(sum, length) => sum + length,
		);
	}

	if (/(?:alpha|latin)$/.test(listStyle)) {
		let letters = 0;
		for (let rest = number; rest > 0; rest = Math.floor((rest - 1) / 26)) {
			letters++;
		}

		return letters;
	}

	return digits.length;
}

const emptyRun = (font: string): Run => ({
	bold: false,
	color: "ffffff",
	font,
	italic: false,
	letterSpacing: 0,
	size: DEFAULT_FONT_SIZE,
	text: "",
	transparency: 0,
	underline: false,
	upper: false,
});

/** A blank paragraph's run, styled like its text so text typed into it matches. */
const blankRun = (style: Run): Run => ({
	...style,
	href: undefined,
	lineBreak: undefined,
	softBreak: undefined,
	text: "",
	underline: false,
});

const firstRunOf = (paragraphs: Paragraph[]) =>
	paragraphs.find(({ runs }) => runs.length)?.runs[0];

const breaksBefore = (run: Run, wrap: boolean) =>
	run.lineBreak === true || (!wrap && run.softBreak === true);

/**
 * Joins neighboring runs that look alike (as takumi splits text per line), so each
 * link, word, or phrase is one run to edit, except where a line break is kept.
 */
function mergeRuns(runs: Run[], wrap: boolean) {
	const breakAndText = new Set(["lineBreak", "softBreak", "text"]);
	const format = (run: Run) =>
		JSON.stringify(run, (name, value: unknown) =>
			breakAndText.has(name) ? undefined : value,
		);
	const merged: Run[] = [];
	for (const run of runs) {
		const previous = merged.at(-1);
		if (
			previous &&
			!breaksBefore(run, wrap) &&
			format(previous) === format(run)
		) {
			previous.text += run.text;
		} else {
			merged.push({ ...run });
		}
	}

	return merged;
}

const visibleCount = (list: ListItem) =>
	list.paragraphs.filter((paragraph) => paragraph.visible).length;

/** A fingerprint of an item's appearance, ignoring identity, naming, position, and list paragraph visibility. */
function appearanceOf(item: Item) {
	const ignored = new Set([
		"baselines",
		"box",
		"key",
		"label",
		"order",
		"visible",
	]);
	return JSON.stringify(item, (name, value: unknown) =>
		ignored.has(name)
			? undefined
			: typeof value === "number"
				? Math.round(value * 10) / 10
				: value,
	);
}

/**
 * Merges a slide's click states into items, each with the states it's visible in. Anything
 * that moved, resized, or restyled between clicks becomes a new item that crossfades in.
 */
function timeline(slide: Slide) {
	const byKey = new Map<string, Entry[]>();
	slide.states.forEach((state, index) => {
		for (const item of state.items) {
			const anchor = item.box;
			const look = appearanceOf(item);
			const candidates = byKey.get(item.key) ?? [];
			let entry = candidates.find(
				(candidate) =>
					!candidate.states.has(index) &&
					candidate.look === look &&
					(["h", "w", "x", "y"] as const).every(
						(side) => Math.abs(candidate.anchor[side] - anchor[side]) < 1.5,
					),
			);
			if (!entry) {
				entry = {
					anchor,
					item,
					look,
					order: item.order + index * 0.001,
					states: new Set(),
				};
				candidates.push(entry);
				byKey.set(item.key, candidates);
			}

			entry.states.add(index);
			// Hidden list items can sit out of place (v-click's hidden transform, for one).
			if (
				item.kind === "list" &&
				entry.item.kind === "list" &&
				visibleCount(item) > visibleCount(entry.item)
			) {
				entry.item = item;
			}

			if (item.kind === "list") {
				const sets = (entry.paragraphStates ??= item.paragraphs.map(
					() => new Set<number>(),
				));
				item.paragraphs.forEach((paragraph, paragraphIndex) => {
					if (paragraph.visible) {
						sets[paragraphIndex]?.add(index);
					}
				});
			}
		}
	});
	return [...byKey.values()].flat().sort((a, b) => a.order - b.order);
}

/** A readable, unique name for PowerPoint's Selection Pane, cut at a word if it's long. */
function uniqueName(item: Item, used: Set<string>) {
	const text =
		item.kind === "image"
			? item.alt || (item.label ?? "")
			: "paragraphs" in item
				? item.paragraphs
						.map(({ runs }) => runs.map((run) => run.text).join(""))
						.join(" ")
				: (item.label ?? "");
	const label = (
		{
			box: "Box",
			code: "Code",
			ellipse: "Dot",
			image: "Image",
			list: "List",
			polygon: "Shape",
			raster: "Rendered",
			text: "Text",
		} satisfies Record<Item["kind"], string>
	)[item.kind];
	const full = withoutControlCharacters(`${label}${text ? `: ${text}` : ""}`)
		.replace(/\p{Cf}/gu, "")
		.replace(/\s+/g, " ")
		.trim();
	const cut = truncate(full, NAME_LENGTH);
	const space = cut.lastIndexOf(" ");
	const base =
		cut === full
			? full
			: `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
	let name = base;
	for (let count = 2; used.has(name); count++) {
		name = `${base} (${String(count)})`;
	}

	used.add(name);
	return name;
}

/** Text without the control characters XML can't hold (tabs and newlines stay). */
const withoutControlCharacters = (text: string) =>
	text.replace(/(?![\t\n\r])\p{Cc}/gu, "");

/** The colors the deck itself uses, which gradient placeholders must not be. */
function colorsOf(deck: Deck) {
	const colors = new Set<string>();
	JSON.stringify(deck.slides, (key, value: unknown) => {
		if (
			(key === "color" || key === "bulletColor") &&
			typeof value === "string"
		) {
			colors.add(value.toUpperCase());
		}

		return value;
	});
	return colors;
}

function mostUsed(runs: Run[], property: (run: Run) => string) {
	const usage = new Map<string, number>();
	for (const run of runs) {
		const value = property(run);
		usage.set(value, (usage.get(value) ?? 0) + run.text.length);
	}

	return [...usage].sort(([, a], [, b]) => b - a).at(0)?.[0];
}

/** The deck's most used text and link colors, and its most used body and heading fonts, by characters. */
function themeOf(deck: Deck) {
	const texts = deck.slides.flatMap(({ states }) =>
		states.flatMap(({ items }) =>
			items.flatMap((item) =>
				item.kind === "list" || item.kind === "text" ? [item] : [],
			),
		),
	);
	const runsOf = (items: (ListItem | TextItem)[]) =>
		items.flatMap(({ paragraphs }) =>
			paragraphs.flatMap(({ runs }) => runs.filter((run) => !run.pad)),
		);
	const runs = runsOf(texts);
	const headings = texts.filter((item) => item.kind === "text" && item.heading);
	return {
		bodyFont: mostUsed(
			runsOf(texts.filter((item) => !headings.includes(item))),
			(run) => run.font,
		),
		headingFont: mostUsed(runsOf(headings), (run) => run.font),
		link: mostUsed(
			runs.filter((run) => run.href),
			(run) => run.color,
		),
		text: mostUsed(runs, (run) => run.color),
	};
}
