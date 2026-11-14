/**
 * Writes a native .pptx from the deck model (see model.ts): text boxes, bulleted
 * lists, code, shapes, images, click animations, transitions, and speaker notes.
 */
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import pptxgen from "pptxgenjs";

import type { FontBook } from "./fonts.ts";
import type {
	Box,
	CodeItem,
	Deck,
	Item,
	ListItem,
	Paragraph,
	Run,
	Slide,
	TextItem,
} from "./model.ts";
import type { Effect, SlidePatch } from "./ooxml.ts";

import { unescapeCss } from "./cascade.ts";
import {
	DECORATIVE,
	GradientRegistry,
	patchSlide,
	tidyPackage,
	UPPERCASE_LANG,
} from "./ooxml.ts";
import { truncate } from "./text.ts";

export interface WriteOptions {
	/** The deck's author, for the file's properties. */
	author?: string;
	/** Full-slide background image. */
	background: string;
	deck: Deck;

	/**
	 * The font Chrome falls back to for symbols the deck's fonts lack (e.g. ✓),
	 * named explicitly because PowerPoint's fallback differs.
	 */
	fallbackFont?: string;
	/** The deck's fonts, for their metrics and glyph coverage. */
	fonts: FontBook;
	notes: string[];
	out: string;
	/** Write one static slide per click state instead of animations, for fidelity checks. */
	review?: boolean;
	title?: string;
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

type TextParagraph = Paragraph & {
	bullet?: boolean;
	hidden?: boolean;
	number?: number;
	spaceAfter?: number;
};

/** Converts canvas px to PowerPoint's units. */
interface Units {
	inches: (px: number) => number;
	pixels: (pt: number) => number;
	points: (px: number) => number;
}

/** A list's marker in PowerPoint: a character bullet, or automatic numbering. */
type Marker =
	{ code?: string; kind: "char" } | { kind: "number"; style: string };

// pptxgenjs's types describe its CommonJS build, but Node loads its ES build, whose
// default export is the class itself.
const PptxGenJS = pptxgen as unknown as typeof pptxgen.default;
type Presentation = pptxgen.default;

/** PowerPoint's standard slide height; widths follow the deck's aspect ratio (13.333" for 16:9). */
const PAGE_HEIGHT_INCHES = 7.5;
const EMU_PER_INCH = 914400;
/** A rotation in [0, 360), as PowerPoint writes them. */
const degrees = (rotation: number) => ((rotation % 360) + 360) % 360;

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

/** The PowerPoint marker for a CSS list-style-type. */
function markerFor(listStyle: string): Marker {
	switch (listStyle) {
		case "circle":
			return { code: "25CB", kind: "char" };
		case "disc":
			return { kind: "char" };
		case "square":
			return { code: "25A0", kind: "char" };
	}

	const quoted = /^(["'])(.*)\1$/s.exec(listStyle)?.[2];
	const text = quoted === undefined ? undefined : unescapeCss(quoted).trim();
	if (text !== undefined) {
		const code = text.codePointAt(0) ?? 0x2022;
		return code <= 0xffff
			? { code: code.toString(16).toUpperCase().padStart(4, "0"), kind: "char" }
			: { kind: "char" };
	}

	return { kind: "number", style: NUMBER_STYLES[listStyle] ?? "arabicPeriod" };
}

/** Bulleted paragraphs render about 0.035 lines lower in PowerPoint (measured). */
const LIST_LIFT = 0.035;

/** Browsers draw a disc marker about 0.75em left of where each item's text starts. */
const BULLET_GAP = 0.75;

/** PowerPoint shrinks superscripts to about 2/3 of their size; 1.12x renders like a browser's 75% &lt;sup>. */
const SUPERSCRIPT_SCALE = 1.12;

/** The slide layout every slide uses, carrying the deck's background. */
const SLIDE_LAYOUT = "Slidev";

export async function writePptx({
	author = "",
	background,
	deck,
	fallbackFont = "Lucida Grande",
	fonts,
	notes,
	out,
	review = false,
	title = "",
}: WriteOptions) {
	const pres = new PptxGenJS();
	const widthInches = (PAGE_HEIGHT_INCHES * deck.page.width) / deck.page.height;
	pres.defineLayout({
		height: PAGE_HEIGHT_INCHES,
		name: SLIDE_LAYOUT,
		width: widthInches,
	});
	pres.layout = SLIDE_LAYOUT;
	pres.title = title;
	pres.author = author;
	pres.subject = "";
	const units: Units = {
		inches: (px) => (px * widthInches) / deck.canvas.width,
		pixels: (pt) => (pt / 72 / widthInches) * deck.canvas.width,
		points: (px) => ((px * widthInches) / deck.canvas.width) * 72,
	};
	const gradients = new GradientRegistry();
	// New text and new slides in PowerPoint start from the deck's font and background.
	const family = fonts.theme();
	if (family) {
		pres.theme = { bodyFontFace: family, headFontFace: family };
	}

	pres.defineSlideMaster({
		background: { path: path.resolve(background) },
		title: SLIDE_LAYOUT,
	});
	const writer = createItemWriter({
		deck,
		fallbackFont,
		fonts,
		gradients,
		pres,
		units,
	});
	const patches: SlidePatch[] = [];

	for (const slide of Object.values(deck.slides).sort((a, b) => a.no - b.no)) {
		const entries = timeline(slide);
		const note = notes[slide.no - 1] ?? "";
		for (const only of review
			? slide.states.map((_, state) => state)
			: [undefined]) {
			const pptSlide = pres.addSlide({ masterName: SLIDE_LAYOUT });
			pptSlide.addNotes(
				only === undefined
					? note
					: `Slide ${String(slide.no)}, click ${String(only)}\n\n${note}`,
			);
			const patch: SlidePatch = {
				bullets: [],
				effects: new Map(),
				pictureCorners: [],
				transition: slide.transition,
			};
			const add = (click: number, effect: Effect) => {
				patch.effects.set(click, [...(patch.effects.get(click) ?? []), effect]);
			};

			const used = new Set<string>();
			for (const entry of entries) {
				if (only !== undefined && !entry.states.has(only)) {
					continue;
				}

				const name = uniqueName(entry.item, used);
				const visibleParagraphs =
					only !== undefined && entry.paragraphStates
						? entry.paragraphStates.map((set) => set.has(only))
						: undefined;
				const names = writer.add(pptSlide, entry.item, name, visibleParagraphs);
				if (
					entry.item.kind === "image" &&
					!entry.item.circle &&
					entry.item.radius > 0.5
				) {
					patch.pictureCorners.push({ name, radius: entry.item.radius });
				}

				if (entry.item.kind === "list" && entry.item.bulletColor) {
					patch.bullets.push({ color: entry.item.bulletColor, name });
				}

				if (only !== undefined) {
					continue;
				}

				for (let click = 1; click < slide.states.length; click++) {
					const now = entry.states.has(click);
					const before = entry.states.has(click - 1);
					for (const shape of names) {
						if (now !== before) {
							add(click, { name: shape, type: now ? "entr" : "exit" });
						}
					}

					entry.paragraphStates?.forEach((set, paragraph) => {
						if (now && before && set.has(click) !== set.has(click - 1)) {
							add(click, {
								name,
								paragraph,
								type: set.has(click) ? "entr" : "exit",
							});
						}
					});
				}
			}

			patches.push(patch);
		}
	}

	const data = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
	const zip = await JSZip.loadAsync(data);
	for (const [i, patch] of patches.entries()) {
		const file = zip.file(`ppt/slides/slide${String(i + 1)}.xml`);
		if (file) {
			zip.file(
				`ppt/slides/slide${String(i + 1)}.xml`,
				patchSlide(
					await file.async("string"),
					patch,
					gradients,
					EMU_PER_INCH * units.inches(1),
				),
			);
		}
	}

	await tidyPackage(zip, { monoFont: fonts.spacer().font });
	fs.mkdirSync(path.dirname(out), { recursive: true });
	fs.writeFileSync(
		out,
		await zip.generateAsync({ compression: "DEFLATE", type: "nodebuffer" }),
	);
	return { slides: patches.length };
}

function createItemWriter({
	deck,
	fallbackFont,
	fonts,
	gradients,
	pres,
	units,
}: {
	deck: Deck;
	fallbackFont: string;
	fonts: FontBook;
	gradients: GradientRegistry;
	pres: Presentation;
	units: Units;
}) {
	const { inches, pixels, points } = units;

	/**
	 * PowerPoint rounds exact line spacing to whole points, so text uses multiples: a
	 * line's pitch is multiple × 1.2 × its largest font size, and its baseline sits a
	 * font's fraction of the way down that pitch (see fonts.ts).
	 */
	const baselineRatio = (font = "") => fonts.metrics(font).baseline;
	const position = (box: Box) => ({
		h: inches(box.h),
		w: inches(box.w),
		x: inches(box.x),
		y: inches(box.y),
	});
	const emptyRun = (code: boolean): Run => ({
		bold: false,
		color: "ffffff",
		font: (code ? fonts.spacer().font : fonts.theme()) ?? "Arial",
		italic: false,
		letterSpacing: 0,
		size: 16,
		superscript: false,
		text: "",
		transparency: 100,
		underline: false,
		upper: false,
	});

	const fillFor = (
		fill:
			| undefined
			| {
					color: string;
					gradient?: Parameters<GradientRegistry["sentinel"]>[0];
					transparency: number;
			  },
	): pptxgen.default.ShapeFillProps =>
		fill
			? {
					color: fill.gradient ? gradients.sentinel(fill.gradient) : fill.color,
					transparency: fill.gradient
						? undefined
						: fill.transparency || undefined,
				}
			: { type: "none" };
	const lineFor = (
		stroke: undefined | { color: string; transparency: number; width: number },
	): pptxgen.default.ShapeLineProps =>
		stroke
			? {
					color: stroke.color,
					transparency: stroke.transparency,
					width: Math.max(0.25, points(stroke.width)),
				}
			: { type: "none" };

	// Characters a font lacks: Chrome falls back to a system font for symbols like ✓,
	// while PowerPoint picks something else, so name the fallback explicitly. Emoji are left alone.
	const splitFallback = (run: Run): Run[] => {
		if (run.pad || fonts.covers(run.font, 0x61) === undefined) {
			return [run];
		}

		const pieces: Run[] = [];
		for (const ch of run.text) {
			// Emoji and invisible format characters (like zero-width spaces) need no fallback.
			const missing =
				fonts.covers(run.font, ch.codePointAt(0) ?? 0) === false &&
				!/[\p{Extended_Pictographic}\p{Cf}]/u.test(ch);
			const font = missing ? fallbackFont : run.font;
			const last = pieces.at(-1);
			if (last?.font === font) {
				last.text += ch;
			} else {
				pieces.push({
					...run,
					bold: missing ? /(?:SemiBold|Bold|Black)$/.test(run.font) : run.bold,
					font,
					lineBreak: pieces.length ? undefined : run.lineBreak,
					softBreak: pieces.length ? undefined : run.softBreak,
					text: ch,
				});
			}
		}

		return pieces.length ? pieces : [run];
	};

	const textRuns = (
		paragraphs: TextParagraph[],
		{
			code = false,
			indent = 0,
			lineHeight = 0,
			marker,
			strokeLayer = false,
			wrap = true,
		}: {
			code?: boolean;
			indent?: number;
			lineHeight?: number;
			/** For lists: their marker, and its numbering start if it numbers consecutively. */
			marker?: Marker & { start?: number };
			strokeLayer?: boolean;
			wrap?: boolean;
		},
	): pptxgen.default.TextProps[] => {
		const runs: pptxgen.default.TextProps[] = [];
		const first = paragraphs.flatMap((p) => p.runs).at(0);
		paragraphs.forEach((paragraph, i) => {
			const last = i === paragraphs.length - 1;
			const pieces: Run[] = paragraph.runs.length
				? mergeRuns(paragraph.runs.flatMap(splitFallback), wrap)
				: [{ ...(first ?? emptyRun(code)), text: "", transparency: 100 }];
			const surrounding =
				pieces.find((run) => !run.superscript)?.size ?? pieces[0].size;
			const multiple = lineHeight
				? Math.round((lineHeight / (1.2 * surrounding)) * 1000) / 1000
				: undefined;
			pieces.forEach((run, j) => {
				const options: pptxgen.default.TextPropsOptions = {
					bold: run.bold,
					breakLine: !last && j === pieces.length - 1,
					charSpacing: run.letterSpacing
						? Math.round(points(run.letterSpacing) * 100) / 100
						: undefined,
					color: run.gradient ? gradients.sentinel(run.gradient) : run.color,
					fontFace: run.font,
					fontSize:
						Math.round(
							points(
								run.superscript ? SUPERSCRIPT_SCALE * surrounding : run.size,
							) * 10,
						) / 10,
					// Spacer runs stand in for padding, so they don't link anywhere.
					hyperlink: run.href && !run.pad ? { url: run.href } : undefined,
					italic: run.italic,
					// pptxgenjs can't write cap="all", so mark the run for ooxml.ts to.
					lang: run.upper ? UPPERCASE_LANG : undefined,
					lineSpacingMultiple: multiple,
					paraSpaceAfter: paragraph.spaceAfter
						? Math.round(points(paragraph.spaceAfter) * 10) / 10
						: undefined,
					// Wrapping boxes rewrap as their text is edited; others keep the browser's lines.
					softBreakBefore:
						run.lineBreak === true || (!wrap && run.softBreak === true)
							? true
							: undefined,
					superscript: run.superscript || undefined,
					transparency: run.transparency || undefined,
					underline: run.underline ? { style: "sng" } : undefined,
				};
				// CSS paints text strokes behind the fill (paint-order); `add` stacks an outlined
				// copy behind an unoutlined one to match, so only the back copy has the outline.
				if (run.stroke && strokeLayer) {
					options.outline = {
						color: run.stroke.color,
						size: Math.max(0.5, points(run.stroke.width)),
					};
				}

				if (marker) {
					const hanging = Math.max(1, points(indent));
					// A hidden paragraph (review decks) keeps its indent but shows no bullet.
					options.bullet = !paragraph.bullet
						? false
						: paragraph.hidden
							? { characterCode: "00A0", indent: hanging }
							: marker.kind === "number"
								? {
										indent: hanging,
										// Consecutive numbers share their list's start; others each start at their own.
										numberStartAt: marker.start ?? paragraph.number ?? 1,
										style: marker.style,
										type: "number",
									}
								: marker.code
									? { characterCode: marker.code, indent: hanging }
									: { indent: hanging };
				}

				runs.push({ options, text: run.text || (code ? " " : "") });
			});
		});
		return runs;
	};

	const addText = (
		slide: pptxgen.default.Slide,
		item: CodeItem | ListItem | TextItem,
		name: string,
		visibleParagraphs?: boolean[],
	) => {
		const names = [name];
		const { box } = item;
		const style = { ...item.style };
		const rotation = item.kind === "code" ? 0 : item.rotation;
		let paragraphs: TextParagraph[] = item.paragraphs;
		const baselines =
			item.kind === "list"
				? item.paragraphs.find((p) => p.baselines.length)?.baselines
				: item.baselines;
		if (item.kind === "code" && item.baselines.length > 1) {
			// Blank lines make some gaps span several lines; divide each by its line count.
			const pitches = item.baselines
				.slice(1)
				.map((y, i) => y - item.baselines[i])
				.filter((d) => d > 1)
				.map((d) => d / Math.max(1, Math.round(d / style.lineHeight)))
				.sort((a, b) => a - b);
			const pitch = pitches[Math.floor(pitches.length / 2)];
			if (Math.abs(pitch - style.lineHeight) > 0.3) {
				style.lineHeight = pitch;
			}
		}

		if (item.kind === "list") {
			// PowerPoint renders paragraph spacing in whole points, so round each gap to whole
			// points while keeping the running total exact: errors never add up down a list.
			let exact = 0;
			let written = 0;
			paragraphs = item.paragraphs.map((paragraph, i) => {
				const next = item.paragraphs.at(i + 1);
				const last = paragraph.baselines.at(-1);
				if (!next?.baselines.length || last === undefined) {
					return paragraph;
				}

				exact += points(
					Math.max(0, next.baselines[0] - (last + style.lineHeight)),
				);
				const spaceAfter = Math.round(exact) - written;
				written += spaceAfter;
				return { ...paragraph, spaceAfter: pixels(spaceAfter) };
			});
		}

		if (visibleParagraphs) {
			paragraphs = paragraphs.map((paragraph, i) =>
				visibleParagraphs[i]
					? paragraph
					: {
							...paragraph,
							hidden: true,
							runs: paragraph.runs.map((run) => ({
								...run,
								transparency: 100,
							})),
						},
			);
		}

		// Place the box so PowerPoint's first baseline lands on the browser's.
		const firstRun = paragraphs.find((p) => p.runs.length)?.runs[0];
		let top = box.y;
		let height = box.h;
		if (rotation && style.lineHeight) {
			// Rotated text has no measured baselines; CSS centers the font's ascent and descent
			// in its line.
			const size = firstRun?.size ?? 16;
			const { ascent, descent } = fonts.metrics(firstRun?.font ?? "");
			top =
				box.y +
				(style.lineHeight - (ascent + descent) * size) / 2 +
				ascent * size -
				baselineRatio(firstRun?.font) * style.lineHeight;
			height = box.h + (box.y - top);
		} else if (baselines?.length && style.lineHeight) {
			top =
				baselines[0] -
				(baselineRatio(firstRun?.font) +
					(item.kind === "list" ? LIST_LIFT : 0)) *
					style.lineHeight;
			height = Math.max(
				box.h + (box.y - top),
				baselines[baselines.length - 1] - baselines[0] + style.lineHeight,
			);
		}

		// Text the browser wrapped gets just enough slack for rounding, so PowerPoint's lines
		// don't take words the browser wrapped; one-line text gets more, so PowerPoint's
		// slightly different measuring never wraps it. Rotated boxes turn about their
		// centers, so they keep the browser's exact size.
		const slack =
			style.nowrap || rotation
				? 0
				: style.wrapWidth === undefined
					? Math.max(10, box.w * 0.06)
					: Math.max(2, box.w * 0.01);
		// Wrapped left-aligned text wraps where the browser's longest line ended.
		const width =
			style.wrapWidth !== undefined && style.align === "left" && !rotation
				? Math.min(box.w, style.wrapWidth)
				: box.w;
		// One-line text gets room to grow, but only as far as the slide's edges allow, on the
		// side(s) its alignment grows it toward.
		const roomLeft = Math.max(0, box.x);
		const roomRight = Math.max(0, deck.page.width - (box.x + box.w));
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
		const marker = item.kind === "list" ? markerFor(item.marker) : undefined;
		const numbers =
			item.kind === "list" ? item.paragraphs.map((p) => p.number) : [];
		// Numbers sit in the hanging indent: room for the widest one and its period.
		const bulletGap =
			item.kind !== "list"
				? 0
				: marker?.kind === "number"
					? (String(Math.max(...numbers.map(Math.abs))).length * 0.55 + 0.6) *
						(firstRun?.size ?? 16)
					: BULLET_GAP * (firstRun?.size ?? 16);
		const consecutive =
			!visibleParagraphs?.includes(false) &&
			numbers.every((n, i) => n === numbers[0] + i);
		const shift =
			style.align === "center"
				? (slack + extra) / 2
				: style.align === "right"
					? slack + extra
					: 0;
		const shadow = paragraphs
			.flatMap((p) => p.runs)
			.find((run) => run.shadow)?.shadow;
		const options: pptxgen.default.TextPropsOptions = {
			align: style.align,
			fit: "none",
			h: inches(height),
			isTextBox: true,
			margin: 0,
			objectName: name,
			rotate: rotation ? degrees(rotation) : undefined,
			shadow: shadow && {
				angle: Math.round((Math.atan2(shadow.dy, shadow.dx) * 180) / Math.PI),
				blur: Math.max(0, points(shadow.blur)),
				color: shadow.color,
				offset: points(Math.hypot(shadow.dx, shadow.dy)),
				opacity: shadow.opacity,
				type: "outer",
			},
			valign: "top",
			w: inches(width + slack + extra + bulletGap),
			wrap: !style.nowrap,
			x: inches(box.x - bulletGap - shift),
			y: inches(top),
		};
		const runOptions = {
			code: item.kind === "code",
			indent: bulletGap,
			lineHeight: style.lineHeight,
			marker: marker && {
				...marker,
				start: consecutive ? numbers[0] : undefined,
			},
			wrap: !style.nowrap,
		};
		if (paragraphs.some((p) => p.runs.some((run) => run.stroke))) {
			// pptxgenjs mutates option objects, so never share one between calls.
			slide.addText(
				textRuns(paragraphs, { ...runOptions, strokeLayer: true }),
				{ ...structuredClone(options), objectName: `${name} (outline)` },
			);
			names.push(`${name} (outline)`);
		}

		slide.addText(textRuns(paragraphs, runOptions), structuredClone(options));
		return names;
	};

	return {
		/** Adds an item to a slide; returns the names of the shapes it created. */
		add(
			slide: pptxgen.default.Slide,
			item: Item,
			name: string,
			visibleParagraphs?: boolean[],
		): string[] {
			switch (item.kind) {
				case "box": {
					const radius = Math.min(item.radius, item.box.w / 2, item.box.h / 2);
					slide.addShape(
						radius > 0.5 ? pres.ShapeType.roundRect : pres.ShapeType.rect,
						{
							...position(item.box),
							fill: fillFor(item.fill),
							line: lineFor(item.border),
							objectName: name,
							rectRadius: radius > 0.5 ? inches(radius) : undefined,
							rotate: item.rotation ? degrees(item.rotation) : undefined,
						},
					);
					return [name];
				}
				case "code":
				case "list":
				case "text":
					return addText(slide, item, name, visibleParagraphs);
				case "ellipse":
					slide.addShape(pres.ShapeType.ellipse, {
						...position(item.box),
						fill: fillFor(item.fill),
						line: { type: "none" },
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
						altText: item.alt || DECORATIVE,
						objectName: name,
						path: path.resolve(item.file ?? ""),
						rounding: item.kind === "image" && item.circle ? true : undefined,
						transparency:
							item.kind === "image" && item.transparency
								? item.transparency
								: undefined,
					});
					return [name];
				}
				case "polygon": {
					const xs = item.points.map((p) => p.x);
					const ys = item.points.map((p) => p.y);
					const x = Math.min(...xs);
					const y = Math.min(...ys);
					// pptxgenjs supports custom geometry but its types don't list the shape type.
					slide.addShape(
						Reflect.get(
							pres.ShapeType,
							"custGeom",
						) as pptxgen.default.ShapeType,
						{
							...position({
								h: Math.max(...ys) - y,
								w: Math.max(...xs) - x,
								x,
								y,
							}),
							fill: fillFor(item.fill),
							line: lineFor(item.border),
							objectName: name,
							points: [
								...item.points.map((p, i) => ({
									x: inches(p.x - x),
									y: inches(p.y - y),
									...(i === 0 ? { moveTo: true } : {}),
								})),
								{ close: true as const },
							],
						},
					);
					return [name];
				}
			}
		},
	};
}

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
		const breaks = run.lineBreak === true || (!wrap && run.softBreak === true);
		if (previous && !breaks && format(previous) === format(run)) {
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
	// A polygon's points count by their shape, relative to its first point.
	const origin = item.kind === "polygon" ? item.points[0] : undefined;
	return JSON.stringify(
		item.kind === "polygon" && origin
			? {
					...item,
					points: item.points.map((point) => ({
						x: point.x - origin.x,
						y: point.y - origin.y,
					})),
				}
			: item,
		(name, value: unknown) =>
			ignored.has(name)
				? undefined
				: typeof value === "number"
					? Math.round(value * 10) / 10
					: value,
	);
}

/** Merges a slide's click states into items, each with the states it's visible in. */
function timeline(slide: Slide): Entry[] {
	const byKey = new Map<string, Entry[]>();
	slide.states.forEach((state, index) => {
		for (const item of state.items) {
			// Same content looking the same in (nearly) the same place is the same object;
			// anything that moved, resized, or restyled between clicks becomes a new object
			// that crossfades in.
			const anchor: Box =
				"box" in item
					? item.box
					: {
							h: 0,
							w: 0,
							x: item.points[0]?.x ?? 0,
							y: item.points[0]?.y ?? 0,
						};
			const look = appearanceOf(item);
			const candidates = byKey.get(item.key) ?? [];
			let entry = candidates.find(
				(candidate) =>
					!candidate.states.has(index) &&
					candidate.look === look &&
					(["h", "w", "x", "y"] as const).every(
						(k) => Math.abs(candidate.anchor[k] - anchor[k]) < 1.5,
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
			// Lists take their geometry from the state showing the most items: hidden items
			// can sit out of place (v-click's hidden transform, for one).
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
				item.paragraphs.forEach((paragraph, i) => {
					if (paragraph.visible) {
						sets[i]?.add(index);
					}
				});
			}
		}
	});
	return [...byKey.values()].flat().sort((a, b) => a.order - b.order);
}

/** A readable, unique name for PowerPoint's Selection Pane. */
function uniqueName(item: Item, used: Set<string>) {
	const text =
		item.kind === "image"
			? item.alt || (item.label ?? "")
			: "paragraphs" in item
				? item.paragraphs
						.map((p) => p.runs.map((run) => run.text).join(""))
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
	const full = `${label}${text ? `: ${text}` : ""}`
		.replace(/\p{Cf}/gu, "")
		.replace(/\s+/g, " ")
		.trim();
	const base = truncate(full, 48).trimEnd();
	let name = base;
	for (let n = 2; used.has(name); n++) {
		name = `${base} (${String(n)})`;
	}

	used.add(name);
	return name;
}
