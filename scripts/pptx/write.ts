import * as csstree from "css-tree";
import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import pptxgen from "pptxgenjs";

import type { FontBook } from "./fonts.ts";
import type {
	Box,
	CodeItem,
	Deck,
	Fill,
	ImageItem,
	Item,
	ListItem,
	ListParagraph,
	Paragraph,
	Run,
	Shadow,
	Slide,
	Stroke,
	TextItem,
	TextStyle,
	Underline,
} from "./model.ts";
import type {
	Gradients,
	Marker,
	ShapeLook,
	SlidePatch,
	Theme,
	TitleLook,
} from "./ooxml.ts";
import type { BuildPptxProblem } from "./types.ts";

import {
	createGradients,
	createNumbering,
	DECORATIVE,
	finishPackage,
	normalizeDegrees,
	UPPERCASE_LANG,
} from "./ooxml.ts";

interface WriteOptions {
	deck: Deck;
	/** The deck's fonts, for their metrics. */
	fonts: FontBook;
	output: string;
	/** Whether to write one static slide per click state instead of animating clicks. */
	withClicks: boolean;
}

/** A model item merged across click states. */
interface Entry {
	anchor: Box;
	item: Item;
	/** What the item looks like, apart from where it is and (for lists) which paragraphs show. */
	look: string;
	/** For lists: the states each paragraph is visible in. */
	paragraphStates?: Set<number>[];
	states: Set<number>;
}

type ItemWriter = ReturnType<typeof createItemWriter>;

type TextParagraph = Paragraph & {
	/** For list items: the marker, and the hanging indent it sits in. */
	bullet?: pptxgen.default.TextPropsOptions["bullet"];
	indentLevel?: number;
	/** pt */
	spaceAfter?: number;
};

/** Converts canvas px to PowerPoint's units. */
interface Units {
	emu: (pixels: number) => number;
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
const EMU_PER_POINT = 12700;

/** The master's title when no slide has one: its box as fractions of the slide, and PowerPoint's default alignment and size. */
const DEFAULT_TITLE = {
	align: "ctr",
	height: 0.15,
	size: 4400,
	width: 0.9,
	x: 0.05,
	y: 0.05,
} as const;

/** Bulleted paragraphs render about 0.035 lines lower in PowerPoint (measured). */
const LIST_LIFT = 0.035;

/** Browsers draw a disc marker about 0.75em left of where each item's text starts. */
const BULLET_GAP = 0.75;

/** A number marker's width in em: each digit's, and its period's and gap's. */
const NUMBER_DIGIT_WIDTH = 0.55;
const NUMBER_PERIOD_WIDTH = 0.6;

/** PowerPoint shrinks superscripts and subscripts to about 2/3 of their size; 1.12x renders like a browser's 75% superscripts. */
const SCRIPT_SCALE = 1.12;

/** PowerPoint's single line spacing, as a multiple of the font size. */
const SINGLE_LINE_PITCH = 1.2;

/** pptxgenjs swaps a zero shadow blur or offset for its defaults, so zero is written as this. */
const NEAR_ZERO = 0.01;

/** pptxgenjs swaps a 0° shadow angle for its default and only writes whole degrees up to 359, so 0° is written as this. */
const NEAR_FULL_TURN = 359;

/** Width (px, or a fraction of the box's) one-line text grows by, so PowerPoint's slightly different measuring never wraps it. */
const ONE_LINE_SLACK = { minimum: 10, ratio: 0.06 };

/** Width wrapped text grows by, enough for rounding without PowerPoint's lines taking words the browser wrapped. */
const ROUNDING_SLACK = { minimum: 2, ratio: 0.01 };

/** pt */
const MIN_LINE_WIDTH = 0.25;
const MIN_TEXT_OUTLINE_WIDTH = 0.5;

/** px between code baselines that are a new line rather than rounding, and that a measured pitch may differ from the line height by. */
const MIN_LINE_GAP = 1;
const LINE_PITCH_TOLERANCE = 0.3;

/** px an item may move or resize between click states and still be the same shape. */
const SAME_PLACE_TOLERANCE = 1.5;

const MIN_ROUNDED_RADIUS = 0.5;
const NAME_LENGTH = 48;
const NO_BREAK_SPACE_CODE = "00A0";

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** pptxgenjs's bullets are 4 hex digits, so markers beyond the BMP become a bullet. */
const ASTRAL_MARKER = "2022";

const ALIGNMENTS = {
	center: "ctr",
	justify: "just",
	left: "l",
	right: "r",
} as const;

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

/** The triangles browsers draw for disclosure markers, in the text's font. */
const DISCLOSURE_MARKERS: Partial<Record<string, string>> = {
	"disclosure-closed": "25B8",
	"disclosure-open": "25BE",
};

const UNDERLINE_STYLES = {
	dashed: "dash",
	dotted: "dotted",
	double: "dbl",
	single: "sng",
	wavy: "wavy",
} as const satisfies Record<Underline["style"], string>;

/** Run properties neighboring runs may differ in and still join into one. */
const JOINED_PROPERTIES = ["lineBreak", "text"];

/** Run properties whitespace doesn't show, so runs that differ only in them still join where one is whitespace. */
const UNSEEN_ON_WHITESPACE = [
	...JOINED_PROPERTIES,
	"color",
	"gradient",
	"shadow",
	"stroke",
	"transparency",
	"upper",
];

/** How many roman numerals each decimal digit takes, as in IV or VIII. */
const ROMAN_LENGTHS = [0, 1, 2, 3, 2, 1, 2, 3, 4, 2];

export async function writePptx({
	deck,
	fonts,
	output,
	withClicks,
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

	const inches = (pixels: number) => (pixels * widthInches) / deck.canvas.width;
	const units: Units = {
		emu: (pixels) => Math.round(inches(pixels) * EMU_PER_INCH),
		inches,
		points: (pixels) => inches(pixels) * 72,
	};
	const gradients = createGradients(colorsOf(deck));
	const addItem = createItemWriter({ fonts, gradients, presentation, units });
	const slides = deck.slides.map((slide) => {
		const entries = timeline(slide);
		return {
			entries,
			patches: withClicks
				? writeClickSlides(presentation, slide, entries, addItem)
				: [writeAnimatedSlide(presentation, slide, entries, addItem)],
		};
	});
	const patches = slides.flatMap((slide) => slide.patches);

	const zip = await JSZip.loadAsync(
		await presentation.write({ outputType: "nodebuffer" }),
	);
	const monospace = fonts.spacer().font;
	await fs.mkdir(path.dirname(output), { recursive: true });
	await fs.writeFile(
		output,
		await finishPackage(zip, {
			background: await fs.readFile(deck.background.file),
			gradients,
			monospace,
			slides: patches,
			theme: themeOf({
				deck,
				items: slides.flatMap(({ entries }) => entries.map(({ item }) => item)),
				monospace,
				titles: slides.flatMap(
					(slide) =>
						slide.patches.find(({ title }) => title)?.title?.look ?? [],
				),
				units,
			}),
		}),
	);
	return { problems: numberingProblems(deck), slides: patches.length };
}

function writeAnimatedSlide(
	presentation: Presentation,
	slide: Slide,
	entries: Entry[],
	addItem: ItemWriter,
) {
	const powerPointSlide = presentation.addSlide();
	const patch = slidePatch(slide.notes, slide.transition);
	const used = new Set<string>();
	for (const entry of entries) {
		const name = uniqueName(entry.item, used);
		const shapes = addItem(
			powerPointSlide,
			patch,
			entry.item,
			name,
			entry.paragraphStates?.map((states) => states.size > 0),
		);

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

function writeClickSlides(
	presentation: Presentation,
	slide: Slide,
	entries: Entry[],
	addItem: ItemWriter,
) {
	return slide.states.map(({ clicks }, state) => {
		const powerPointSlide = presentation.addSlide();
		const patch = slidePatch(
			`Slide ${String(slide.number)}, click ${String(clicks)}\n\n${slide.notes}`,
			state === 0 ? slide.transition : undefined,
		);
		const used = new Set<string>();
		for (const entry of entries.filter(({ states }) => states.has(state))) {
			addItem(
				powerPointSlide,
				patch,
				entry.item,
				uniqueName(entry.item, used),
				entry.paragraphStates?.map((states) => states.has(state)),
			);
		}

		return patch;
	});
}

const slidePatch = (
	notes: string,
	transition: string | undefined,
): SlidePatch => ({
	decorative: [],
	effects: [],
	lists: [],
	notes: withoutControlCharacters(notes),
	pictureCorners: [],
	transition,
});

function createItemWriter({
	fonts,
	gradients,
	presentation,
	units,
}: {
	fonts: FontBook;
	gradients: Gradients;
	presentation: Presentation;
	units: Units;
}) {
	const { inches, points } = units;
	const position = (box: Box) => ({
		h: inches(box.height),
		w: inches(box.width),
		x: inches(box.x),
		y: inches(box.y),
	});
	const fillFor = (fill: Fill | undefined): pptxgen.default.ShapeFillProps =>
		!fill
			? { type: "none" }
			: "gradient" in fill
				? { color: gradients.sentinel(fill.gradient) }
				: { color: fill.color, transparency: fill.transparency || undefined };
	const lineFor = (stroke: Stroke | undefined) =>
		stroke && {
			color: stroke.color,
			transparency: stroke.transparency,
			width: Math.max(MIN_LINE_WIDTH, points(stroke.width)),
		};
	const shadowFor = (
		shadow: Shadow | undefined,
	): pptxgen.default.ShadowProps | undefined =>
		shadow && shadow.transparency < 100
			? {
					angle:
						normalizeDegrees(
							Math.round(
								(Math.atan2(shadow.offsetY, shadow.offsetX) * 180) / Math.PI,
							),
						) || NEAR_FULL_TURN,
					blur: Math.max(NEAR_ZERO, points(shadow.blur)),
					color: shadow.color,
					offset: Math.max(
						NEAR_ZERO,
						points(Math.hypot(shadow.offsetX, shadow.offsetY)),
					),
					opacity: 1 - shadow.transparency / 100,
					type: "outer",
				}
			: undefined;

	const textRuns = (
		paragraphs: TextParagraph[],
		{
			code,
			firstRun,
			lineHeight,
			outline,
			rtl,
			wrap,
		}: {
			code: boolean;
			firstRun: Run;
			lineHeight: number;
			/** Whether this is the outlined copy behind a text stroke. */
			outline: boolean;
			rtl: boolean;
			wrap: boolean;
		},
	) =>
		paragraphs.flatMap((paragraph, paragraphIndex) => {
			const last = paragraphIndex === paragraphs.length - 1;
			const pieces = paragraph.runs.length
				? mergeRuns(paragraph.runs, wrap)
				: [blankRun(firstRun)];
			const baseSize = baseSizeOf(pieces);
			const multiple = lineSpacingOf(lineHeight, baseSize);
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
					fontSize: fontSizeOf(
						points(run.script ? SCRIPT_SCALE * baseSize : run.size),
					),
					hyperlink,
					indentLevel: paragraph.indentLevel,
					italic: run.italic,
					lang: run.upper ? UPPERCASE_LANG : undefined,
					lineSpacingMultiple: multiple,
					outline:
						outline && run.stroke
							? {
									color: run.stroke.color,
									size: Math.max(
										MIN_TEXT_OUTLINE_WIDTH,
										points(run.stroke.width),
									),
								}
							: undefined,
					paraSpaceAfter: paragraph.spaceAfter,
					rtlMode: rtl || undefined,
					softBreakBefore: breaksBefore(run, wrap) || undefined,
					strike: run.strike ? "sngStrike" : undefined,
					subscript: run.script === "sub" || undefined,
					superscript: run.script === "super" || undefined,
					transparency: run.transparency || undefined,
					underline: run.underline
						? {
								color: run.underline.color,
								style: UNDERLINE_STYLES[run.underline.style],
							}
						: hyperlink && { style: "none" },
				};
				return {
					options,
					text: withoutControlCharacters(run.text) || (code ? " " : ""),
				};
			});
		});

	const addText = (
		slide: pptxgen.default.Slide,
		patch: SlidePatch,
		item: CodeItem | ListItem | TextItem,
		name: string,
		visibleParagraphs: boolean[] | undefined,
	) => {
		const style =
			item.kind === "code"
				? { ...item.style, lineHeight: codePitch(item) }
				: item.style;
		const rotation = item.kind === "text" ? item.rotation : 0;
		const markerGap =
			item.kind === "list"
				? markerGapOf(item, firstRunOf(item.paragraphs).size)
				: 0;
		const list =
			item.kind === "list"
				? {
						color: item.bulletColor,
						paragraphs: listParagraphs(
							item,
							visibleParagraphs,
							markerGap,
							points,
						),
					}
				: undefined;
		const paragraphs: TextParagraph[] = list?.paragraphs ?? item.paragraphs;
		const firstRun = firstRunOf(paragraphs);
		const { height, top } = verticalPlacement(
			item,
			style,
			rotation,
			firstRun,
			fonts,
		);
		const { left, width } = horizontalPlacement(item.box, style, rotation);
		const box = {
			height,
			width: width + markerGap,
			x: left - markerGap,
			y: top,
		};
		const shadow = paragraphs
			.flatMap(({ runs }) => runs)
			.find((run) => run.shadow)?.shadow;
		const options: pptxgen.default.TextPropsOptions = {
			...position(box),
			align: style.align,
			fit: "none",
			isTextBox: true,
			margin: 0,
			objectName: name,
			rotate: rotation ? normalizeDegrees(rotation) : undefined,
			shadow: shadowFor(shadow),
			valign: "top",
			wrap: !style.nowrap,
		};
		const runOptions = {
			code: item.kind === "code",
			firstRun,
			lineHeight: style.lineHeight,
			rtl: style.rtl,
			wrap: !style.nowrap,
		};
		const names = [name];
		if (paragraphs.some(({ runs }) => runs.some((run) => run.stroke))) {
			// https://github.com/gitbrent/PptxGenJS/issues/1527
			const outlineName = `${name} (outline)`;
			slide.addText(textRuns(paragraphs, { ...runOptions, outline: true }), {
				...structuredClone(options),
				objectName: outlineName,
			});
			names.push(outlineName);
			if (!item.decorative) {
				patch.decorative.push(outlineName);
			}
		}

		slide.addText(
			textRuns(paragraphs, { ...runOptions, outline: false }),
			structuredClone(options),
		);

		if (list) {
			patch.lists.push({
				color: list.color,
				markers: list.paragraphs.map(({ marker }) => marker),
				name,
			});
		}

		const text = plainText(item);
		if (
			item.kind === "text" &&
			item.heading &&
			!item.decorative &&
			text &&
			!patch.title
		) {
			patch.title = {
				look: titleLook(box, style, firstRun, units),
				name,
				text,
			};
		}

		return names;
	};

	const addItem = (
		slide: pptxgen.default.Slide,
		patch: SlidePatch,
		item: Item,
		name: string,
		visibleParagraphs: boolean[] | undefined,
	) => {
		switch (item.kind) {
			case "box": {
				const radius = Math.min(
					item.radius,
					item.box.width / 2,
					item.box.height / 2,
				);
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
						shadow: shadowFor(item.shadow),
					},
				);
				return [name];
			}

			case "code":
			case "list":
			case "text":
				return addText(slide, patch, item, name, visibleParagraphs);
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
					...(crop && {
						h: inches(crop.height),
						sizing: {
							h: inches(item.box.height),
							type: "crop" as const,
							w: inches(item.box.width),
							x: inches(item.box.x - crop.x),
							y: inches(item.box.y - crop.y),
						},
						w: inches(crop.width),
					}),
					altText: item.decorative
						? DECORATIVE
						: withoutControlCharacters(item.alt),
					objectName: name,
					path: item.file,
					rounding: item.kind === "image" && isCircle(item),
					shadow: item.kind === "image" ? shadowFor(item.shadow) : undefined,
					transparency:
						item.kind === "image" ? item.transparency || undefined : undefined,
				});
				if (
					item.kind === "image" &&
					!isCircle(item) &&
					item.radius > MIN_ROUNDED_RADIUS
				) {
					patch.pictureCorners.push({
						adjust: Math.round(
							(item.radius / Math.min(item.box.width, item.box.height)) *
								100000,
						),
						name,
					});
				}

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

	/** Adds an item to a slide, recording the patches it needs; returns the names of the shapes it created. */
	return (
		slide: pptxgen.default.Slide,
		patch: SlidePatch,
		item: Item,
		name: string,
		visibleParagraphs?: boolean[],
	) => {
		const names = addItem(slide, patch, item, name, visibleParagraphs);
		if (item.decorative) {
			patch.decorative.push(...names);
		}

		return names;
	};
}

/** Whether an image's corners round it all the way into an ellipse. */
const isCircle = (image: ImageItem) =>
	image.radius >= Math.min(image.box.width, image.box.height) / 2 - 1;

/** Where a title's box sits and how its first run looks, for the master's title style. */
function titleLook(
	box: Box,
	style: TextStyle,
	run: Run,
	{ emu, points }: Units,
): TitleLook {
	return {
		align: ALIGNMENTS[style.align],
		bold: run.bold,
		color: run.color,
		cx: emu(box.width),
		cy: emu(box.height),
		font: run.font,
		italic: run.italic,
		letterSpacing: Math.round(points(run.letterSpacing) * 100),
		lineSpacing: spacingPercent(lineSpacingOf(style.lineHeight, run.size)),
		size: Math.round(fontSizeOf(points(run.size)) * 100),
		upper: run.upper,
		x: emu(box.x),
		y: emu(box.y),
	};
}

/** The line pitch of a code block, measured from its baselines; blank lines make some gaps span several lines. */
export function codePitch({ baselines, style }: CodeItem) {
	const pitches = baselines
		.slice(1)
		.map((baseline, index) => baseline - baselines[index])
		.filter((gap) => gap > MIN_LINE_GAP)
		.map((gap) => gap / Math.max(1, Math.round(gap / style.lineHeight)))
		.sort((a, b) => a - b);
	const pitch = pitches.at(Math.floor(pitches.length / 2));
	return pitch !== undefined &&
		Math.abs(pitch - style.lineHeight) > LINE_PITCH_TOLERANCE
		? pitch
		: style.lineHeight;
}

/** A list's paragraphs, with the space after each in the whole points PowerPoint rounds to, keeping their running total exact. */
function spacedListParagraphs(
	item: ListItem,
	points: Units["points"],
): (ListParagraph & { spaceAfter?: number })[] {
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
}

/** A list's paragraphs with their markers hanging before their text; hidden paragraphs and an item's later paragraphs keep their place unmarked. */
function listParagraphs(
	item: ListItem,
	visibleParagraphs: boolean[] | undefined,
	markerGap: number,
	points: Units["points"],
): (TextParagraph & { marker?: Marker["kind"] })[] {
	const numbering = createNumbering();
	return spacedListParagraphs(item, points).map((paragraph, index) => {
		const { level, number } = paragraph;
		const visible = visibleParagraphs?.[index] ?? true;
		const marker =
			paragraph.bullet && visible ? markerFor(paragraph.marker) : undefined;
		const indent = Math.max(
			1,
			points((markerGap + paragraph.indent) / (level + 1)),
		);
		const start = numbering(
			level,
			number,
			marker?.kind === "number" ? marker.style : undefined,
		);
		return {
			bullet:
				marker === undefined
					? { characterCode: NO_BREAK_SPACE_CODE, indent }
					: marker.kind === "number"
						? {
								indent,
								numberStartAt: Math.max(1, start),
								style: marker.style,
								type: "number",
							}
						: { characterCode: marker.code, indent },
			indentLevel: level || undefined,
			marker: marker?.kind,
			runs: visible
				? paragraph.runs
				: paragraph.runs.map((run) => ({ ...run, transparency: 100 })),
			spaceAfter: paragraph.spaceAfter,
		};
	});
}

/** Where the box's top goes so PowerPoint's first baseline lands on the browser's, and how tall it is. */
function verticalPlacement(
	item: CodeItem | ListItem | TextItem,
	style: TextStyle,
	rotation: number,
	{ font, size }: Run,
	fonts: FontBook,
) {
	const { box } = item;
	const baselines =
		item.kind === "list"
			? item.paragraphs.find((paragraph) => paragraph.baselines.length)
					?.baselines
			: item.baselines;
	const { ascent, baseline, descent } = fonts.metrics(font);
	if (rotation && style.lineHeight) {
		const top =
			box.y +
			(style.lineHeight - (ascent + descent) * size) / 2 +
			ascent * size -
			baseline * style.lineHeight;
		return { height: box.height + (box.y - top), top };
	}

	if (baselines?.length && style.lineHeight) {
		const top =
			baselines[0] -
			(baseline + (item.kind === "list" ? LIST_LIFT : 0)) * style.lineHeight;
		return {
			height: Math.max(
				box.height + (box.y - top),
				baselines[baselines.length - 1] - baselines[0] + style.lineHeight,
			),
			top,
		};
	}

	return { height: box.height, top: box.y };
}

/** How wide the box is and where it starts, with slack toward the side(s) its alignment grows it, within the room its container leaves; text that can't wrap needs none. */
export function horizontalPlacement(
	box: Box,
	style: TextStyle,
	rotation: number,
) {
	const width =
		style.wrapWidth !== undefined && style.align === "left" && !rotation
			? Math.min(box.width, style.wrapWidth)
			: box.width;
	const roomLeft = Math.max(0, box.x - style.available.left);
	const roomRight = Math.max(0, style.available.right - (box.x + box.width));
	const room =
		style.align === "center"
			? 2 * Math.min(roomLeft, roomRight)
			: style.align === "right"
				? roomLeft
				: roomRight;
	const slackOf = ({ minimum, ratio }: typeof ONE_LINE_SLACK) =>
		Math.max(minimum, box.width * ratio);
	const grown =
		rotation || style.nowrap
			? 0
			: style.wrapWidth === undefined
				? Math.max(
						slackOf(ROUNDING_SLACK),
						Math.min(slackOf(ONE_LINE_SLACK), room),
					)
				: slackOf(ROUNDING_SLACK);
	const shift =
		style.align === "center" ? grown / 2 : style.align === "right" ? grown : 0;
	return { left: box.x - shift, width: width + grown };
}

/** The PowerPoint marker for a CSS list-style-type, if it shows one. */
export function markerFor(listStyle: string): Marker | undefined {
	if (listStyle === "none") {
		return undefined;
	}

	const keyword = KEYWORD_MARKERS[listStyle];
	if (keyword) {
		return { code: keyword, kind: "keyword" };
	}

	const disclosure = DISCLOSURE_MARKERS[listStyle];
	if (disclosure) {
		return { code: disclosure, kind: "string" };
	}

	if (/^["']/.test(listStyle)) {
		const code = csstree.string.decode(listStyle).trim().codePointAt(0);
		return code === undefined
			? undefined
			: {
					code:
						code <= 0xffff
							? code.toString(16).toUpperCase().padStart(4, "0")
							: ASTRAL_MARKER,
					kind: "string",
				};
	}

	return { kind: "number", style: NUMBER_STYLES[listStyle] ?? "arabicPeriod" };
}

/** Room for a list's outermost markers in their hanging indent: for its widest number and period, or for a bullet. */
function markerGapOf(list: ListItem, size: number) {
	const outermost = list.paragraphs.filter(({ level }) => level === 0);
	const first = outermost.at(0);
	return first && markerFor(first.marker)?.kind === "number"
		? (Math.max(
				...outermost.map(({ marker, number }) => numberLength(number, marker)),
			) *
				NUMBER_DIGIT_WIDTH +
				NUMBER_PERIOD_WIDTH) *
				size
		: BULLET_GAP * size;
}

/** How many characters a number marker shows before its period, in a list-style-type. */
export function numberLength(number: number, listStyle: string) {
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

/** Lists PowerPoint can't number as the browser does: it numbers from 1 at the lowest. */
function numberingProblems(deck: Deck): BuildPptxProblem[] {
	return deck.slides.flatMap((slide) =>
		slide.states.some(({ items }) =>
			items.some(
				(item) =>
					item.kind === "list" &&
					item.paragraphs.some(
						(paragraph) =>
							paragraph.bullet &&
							paragraph.number < 1 &&
							markerFor(paragraph.marker)?.kind === "number",
					),
			),
		)
			? [
					{
						message:
							"PowerPoint can't number list items below 1, so a list here is numbered from 1.",
						severity: "warning" as const,
						slide: slide.number,
					},
				]
			: [],
	);
}

/** A blank paragraph's run, styled like its text so text typed into it matches. */
const blankRun = (style: Run): Run => ({
	...style,
	href: undefined,
	lineBreak: undefined,
	text: "",
	underline: undefined,
});

function firstRunOf(paragraphs: Paragraph[]) {
	const run = paragraphs.find(({ runs }) => runs.length)?.runs[0];
	if (!run) {
		throw new Error("Text items need at least one run.");
	}

	return run;
}

const baseSizeOf = (runs: Run[]) =>
	(runs.find((run) => !run.script) ?? runs[0]).size;

/** A paragraph's line spacing, as a multiple of single spacing. */
const lineSpacingOf = (lineHeight: number, baseSize: number) =>
	lineHeight
		? Math.round((lineHeight / (SINGLE_LINE_PITCH * baseSize)) * 1000) / 1000
		: undefined;

const fontSizeOf = (points: number) => Math.round(points * 10) / 10;

/** A line spacing multiple in PowerPoint's 1000ths of a percent. */
const spacingPercent = (multiple: number | undefined) =>
	multiple === undefined ? undefined : Math.round(multiple * 100000);

const breaksBefore = (run: Run, wrap: boolean) =>
	run.lineBreak === "forced" || (!wrap && run.lineBreak === "wrap");

/** Joins neighboring runs that look alike (as takumi splits text per line), or that differ only where whitespace between them can't show it, into one run to edit, except where a line break is kept. */
function mergeRuns(runs: Run[], wrap: boolean) {
	const lookOf = (run: Run, ignored: string[]) =>
		JSON.stringify(
			Object.fromEntries(
				Object.entries(run).filter(([name]) => !ignored.includes(name)),
			),
		);
	const isBlank = (run: Run) => !run.text.trim();
	const merged: Run[] = [];
	for (const run of runs) {
		const previous = merged.at(-1);
		const joins =
			previous &&
			!breaksBefore(run, wrap) &&
			(lookOf(previous, JOINED_PROPERTIES) === lookOf(run, JOINED_PROPERTIES) ||
				((isBlank(previous) || isBlank(run)) &&
					lookOf(previous, UNSEEN_ON_WHITESPACE) ===
						lookOf(run, UNSEEN_ON_WHITESPACE)));
		if (!joins) {
			merged.push({ ...run });
		} else if (isBlank(previous) && !isBlank(run)) {
			merged[merged.length - 1] = {
				...run,
				lineBreak: previous.lineBreak,
				text: previous.text + run.text,
			};
		} else {
			previous.text += run.text;
		}
	}

	return merged;
}

const visibleCount = (list: ListItem) =>
	list.paragraphs.filter((paragraph) => paragraph.visible).length;

/** A fingerprint of an item's appearance, ignoring identity, naming, position, and list paragraph visibility. */
function appearanceOf(item: Item) {
	const ignored = new Set(["baselines", "box", "key", "label", "visible"]);
	return JSON.stringify(item, (name, value: unknown) =>
		ignored.has(name)
			? undefined
			: typeof value === "number"
				? Math.round(value * 10) / 10
				: value,
	);
}

/** Merges a slide's click states into items in paint order, each with the states it's visible in; anything that moves, resizes, or restyles becomes a new item. */
export function timeline(slide: Slide) {
	const entries: Entry[] = [];
	const paintOrders = slide.states.map((state, index) =>
		state.items.map((item) => {
			const look = appearanceOf(item);
			let entry = entries.find(
				(candidate) =>
					candidate.item.key === item.key &&
					!candidate.states.has(index) &&
					candidate.look === look &&
					(["height", "width", "x", "y"] as const).every(
						(side) =>
							Math.abs(candidate.anchor[side] - item.box[side]) <
							SAME_PLACE_TOLERANCE,
					),
			);
			if (!entry) {
				entry = { anchor: item.box, item, look, states: new Set() };
				entries.push(entry);
			}

			entry.states.add(index);
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
						sets[paragraphIndex].add(index);
					}
				});
			}

			return entry;
		}),
	);
	return paintOrder(entries, paintOrders);
}

/** Entries ordered so every state paints its own in its order, as far as the states agree; ties go to the entry that showed first. */
function paintOrder(entries: Entry[], paintOrders: Entry[][]) {
	const above = entries.map(() => new Set<number>());
	const beneathCounts = entries.map(() => 0);
	for (const order of paintOrders) {
		const indices = order.map((entry) => entries.indexOf(entry));
		indices.slice(1).forEach((upper, position) => {
			const lower = indices[position];
			if (!above[lower].has(upper)) {
				above[lower].add(upper);
				beneathCounts[upper]++;
			}
		});
	}

	const remaining = entries.map((_, index) => index);
	const ordered: Entry[] = [];
	while (remaining.length) {
		const next =
			remaining.find((index) => !beneathCounts[index]) ?? remaining[0];
		remaining.splice(remaining.indexOf(next), 1);
		ordered.push(entries[next]);
		for (const upper of above[next]) {
			beneathCounts[upper]--;
		}
	}

	return ordered;
}

/** An item's text, or what it's labeled as, on one line. */
function plainText(item: Item) {
	const text =
		item.kind === "image"
			? item.alt || (item.label ?? "")
			: "paragraphs" in item
				? item.paragraphs
						.map(({ runs }) => runs.map((run) => run.text).join(""))
						.join(" ")
				: (item.label ?? "");
	return withoutControlCharacters(text)
		.replace(/\p{Cf}/gu, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** A readable, unique name for PowerPoint's Selection Pane, cut at a word if it's long. */
function uniqueName(item: Item, used: Set<string>) {
	const text = plainText(item);
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
	const full = text ? `${label}: ${text}` : label;
	const cut = [...graphemes.segment(full)]
		.slice(0, NAME_LENGTH)
		.map(({ segment }) => segment)
		.join("");
	const space = cut.lastIndexOf(" ");
	const base =
		cut === full
			? full
			: `${(space > label.length + 1 ? cut.slice(0, space) : cut).trimEnd()}…`;
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
			colors.add(value);
		}

		return value;
	});
	return colors;
}

/** Values by how much they're used, most first; ties keep their first use's order. */
function ranked<T, Value>(
	items: T[],
	value: (item: T) => undefined | Value,
	weight: (item: T) => number = () => 1,
) {
	const usage = new Map<Value, number>();
	for (const item of items) {
		const key = value(item);
		if (key !== undefined) {
			usage.set(key, (usage.get(key) ?? 0) + weight(item));
		}
	}

	return [...usage].sort(([, a], [, b]) => b - a).map(([key]) => key);
}

const characters = (run: Run) => run.text.length;

/** Runs with text, rather than spacers. */
const contentRunsOf = (items: (ListItem | TextItem)[]) =>
	items.flatMap(({ paragraphs }) =>
		paragraphs.flatMap(({ runs }) => runs.filter((run) => !run.pad)),
	);

const isHeading = (item: Item) => item.kind === "text" && item.heading;

/** The deck's theme: its most used colors, fonts, body text, title look, and box look. */
function themeOf({
	deck,
	items,
	monospace,
	titles,
	units,
}: {
	deck: Deck;
	/** Each slide's items, once across its click states. */
	items: Item[];
	monospace: string;
	/** Each slide's title, once across its click states. */
	titles: TitleLook[];
	units: Units;
}): Theme {
	const texts = items.filter(
		(item) => item.kind === "list" || item.kind === "text",
	);
	const runs = contentRunsOf(texts);
	const text = ranked(runs, (run) => run.color, characters).at(0) ?? "000000";
	const fonts = fontsOf(items, monospace);
	const title =
		titleLookOf(titles) ??
		defaultTitle(deck, { color: text, font: fonts.majorFont }, units);
	const background = deck.background.color;
	return {
		...bodyStyleOf(
			texts.filter((item) => !isHeading(item)),
			units,
		),
		...fonts,
		accents: accentsOf(items, new Set([background, text, title.color])),
		background,
		link: ranked(
			runs.filter((run) => run.href),
			(run) => run.color,
			characters,
		).at(0),
		name: deck.title,
		shape: shapeLookOf(items, units),
		text,
		title,
	};
}

/** Every font the slides use, and the most used heading and body fonts. */
function fontsOf(items: Item[], monospace: string) {
	const texts = items.filter(
		(item) => item.kind === "list" || item.kind === "text",
	);
	const mostUsedFont = (textItems: (ListItem | TextItem)[]) =>
		ranked(contentRunsOf(textItems), (run) => run.font, characters).at(0);
	const headingFont = mostUsedFont(texts.filter(isHeading));
	const minorFont =
		mostUsedFont(texts.filter((item) => !isHeading(item))) ??
		headingFont ??
		monospace;
	return {
		fonts: [
			...new Set([
				...items.flatMap((item) =>
					"paragraphs" in item
						? item.paragraphs.flatMap(({ runs }) => runs.map((run) => run.font))
						: [],
				),
				monospace,
			]),
		].sort(),
		majorFont: headingFont ?? minorFont,
		minorFont,
	};
}

/** Body text's most used line spacing and size. */
function bodyStyleOf(body: (ListItem | TextItem)[], { points }: Units) {
	const lines = body.flatMap((item) =>
		item.paragraphs.map(({ runs }) => ({
			lineHeight: item.style.lineHeight,
			runs,
		})),
	);
	return {
		bodyLineSpacing: ranked(
			lines,
			({ lineHeight, runs }) =>
				runs.length
					? spacingPercent(lineSpacingOf(lineHeight, baseSizeOf(runs)))
					: undefined,
			({ runs }) => runs.reduce((sum, run) => sum + characters(run), 0),
		).at(0),
		bodySize: ranked(
			contentRunsOf(body).filter((run) => !run.script),
			(run) => Math.round(fontSizeOf(points(run.size)) * 100),
			characters,
		).at(0),
	};
}

/** The master's title for a deck whose slides have none. */
function defaultTitle(
	{ canvas }: Deck,
	{ color, font }: Pick<TitleLook, "color" | "font">,
	{ emu }: Units,
): TitleLook {
	return {
		align: DEFAULT_TITLE.align,
		bold: false,
		color,
		cx: emu(canvas.width * DEFAULT_TITLE.width),
		cy: emu(canvas.height * DEFAULT_TITLE.height),
		font,
		italic: false,
		letterSpacing: 0,
		size: DEFAULT_TITLE.size,
		upper: false,
		x: emu(canvas.width * DEFAULT_TITLE.x),
		y: emu(canvas.height * DEFAULT_TITLE.y),
	};
}

/** The slides' most common title style, at its most common place (the topmost, when places tie). */
function titleLookOf(looks: TitleLook[]) {
	const styleOf = (look: TitleLook) =>
		JSON.stringify({ ...look, cy: undefined, y: undefined });
	const style = ranked(looks, styleOf).at(0);
	const group = looks.filter((look) => styleOf(look) === style);
	const y = ranked(
		group.toSorted((a, b) => a.y - b.y),
		(look) => look.y,
	).at(0);
	return group.find((look) => look.y === y);
}

/** The look of the deck's most common box with a solid fill, for new shapes. */
function shapeLookOf(items: Item[], { points }: Units) {
	const looks = items.flatMap((item): ShapeLook[] =>
		item.kind === "box" && item.fill && !("gradient" in item.fill)
			? [
					{
						fill: {
							color: item.fill.color,
							transparency: item.fill.transparency,
						},
						line: item.border && {
							color: item.border.color,
							transparency: item.border.transparency,
							width: Math.round(
								Math.max(MIN_LINE_WIDTH, points(item.border.width)) *
									EMU_PER_POINT,
							),
						},
					},
				]
			: [],
	);
	const top = ranked(looks, (look) => JSON.stringify(look)).at(0);
	return looks.find((look) => JSON.stringify(look) === top);
}

/** The colors the deck uses most for shapes, borders, markers, and text, other than its text and background colors. */
function accentsOf(items: Item[], excluded: Set<string>) {
	const solid = (paint: undefined | { color: string; transparency: number }) =>
		paint && paint.transparency < 50 ? [paint.color] : [];
	const uses = items.flatMap((item) => [
		...("fill" in item && item.fill && !("gradient" in item.fill)
			? solid(item.fill)
			: []),
		...("border" in item ? solid(item.border) : []),
		...(item.kind === "list" && item.bulletColor ? [item.bulletColor] : []),
		...("paragraphs" in item
			? new Set(
					item.paragraphs.flatMap(({ runs }) =>
						runs.flatMap((run) => (run.gradient ? [] : solid(run))),
					),
				)
			: []),
	]);
	return ranked(
		uses.filter((color) => !excluded.has(color)),
		(color) => color,
	).slice(0, 6);
}
