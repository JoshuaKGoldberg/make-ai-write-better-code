/**
 * Turns a laid-out slide state (see layout.ts) into model items (see model.ts):
 * text with styled runs and exact line breaks, lists, code, boxes, images, SVG
 * shapes, and rasters for anything PowerPoint can't represent natively.
 */
import path from "node:path";

import type { Assets } from "./assets.ts";
import type { ComputedStyle } from "./cascade.ts";
import type { FontBook } from "./fonts.ts";
import type { LaidOutBox, LaidOutRun, LaidOutRuns, Layout } from "./layout.ts";
import type {
	Box,
	Canvas,
	ExtractedItem,
	Fill,
	Gradient,
	ListParagraph,
	Paragraph,
	Point,
	Run,
	Stroke,
	TextStyle,
} from "./model.ts";

import { cssUrls, imageFormat, imageSize } from "./assets.ts";
import { INITIAL_STYLE, toPx } from "./cascade.ts";
import { parseColor } from "./color.ts";
import { ID, isBackgroundOnly } from "./layout.ts";
import { truncate } from "./text.ts";

/** Room around a raster's element for strokes and antialiasing, beyond its shadows' reach. */
const RASTER_MARGIN = 4;

type ItemInput = ExtractedItem extends infer T
	? T extends ExtractedItem
		? Omit<T, "order">
		: never
	: never;

/** A shape's paint: its fill (a color, or a gradient whose last stop is the fallback color) and borders. */
interface BoxStyle {
	/** A border drawn on every side alike. */
	border?: Stroke;
	/** Borders on only some sides (or differing by side), each drawn as a thin filled edge. */
	edges?: { fill: Fill; side: Side; width: number }[];
	fill?: Fill;
	radius: number;
}

interface Geometry {
	box: Box;
	rotation: number;
	scale: number;
}

interface Paint {
	a: number;
	gradient?: Gradient;
	hex: string;
}

type Side = "bottom" | "left" | "right" | "top";

/** Image formats PowerPoint shows; build.ts converts others to PNG. */
const NATIVE_FORMATS = new Set(["bmp", "gif", "jpeg", "png"]);

const ALIGNMENTS: Record<string, TextStyle["align"]> = {
	center: "center",
	end: "right",
	justify: "justify",
	left: "left",
	right: "right",
	start: "left",
};
/** Elements with more descendants than this render as one image instead of shapes. */
const DENSE = 400;

/** Elements that render only in a browser, which PowerPoint can't show. */
const UNSUPPORTED_EMBEDS = [
	[".mermaid", "a Mermaid diagram"],
	[".slidev-tweet", "an embedded post"],
	["iframe", "an embedded page"],
	["video", "a video"],
] as const;

export interface ExtractOptions {
	/** Loaded images, by the URLs pages use. */
	assets: Assets;
	canvas: Canvas;
	fonts: FontBook;
}

/** Whether PowerPoint can show an image file as-is. */
export const isNativeImage = (data: Buffer) =>
	NATIVE_FORMATS.has(imageFormat(data) ?? "");

/** Turns a laid-out slide state into model items, and descriptions of what it left out. */
export function extractState(
	layout: Layout,
	{ assets, canvas, fonts }: ExtractOptions,
) {
	const { boxes, byId, document, markers, runs, styles } = layout;
	const items: ExtractedItem[] = [];
	const problems: string[] = [];
	let order = 0;
	const push = (item: ItemInput) => {
		items.push({ ...item, order: order++ });
	};

	const ascentRatio = (font: string) => {
		const { ascent, descent } = fonts.metrics(font);
		return ascent / (ascent + descent);
	};

	const styleOf = (el: Element): ComputedStyle =>
		styles.get(el) ?? INITIAL_STYLE;
	const px = (el: Element, prop: string) =>
		parseFloat(styleOf(el)[prop] ?? "") || 0;
	const idOf = (el: Element) => el.getAttribute(ID) ?? "";
	const boxOf = (el: Element) => boxes.get(idOf(el));
	// An element's text as the browser lays it out: collapsible white space as single
	// spaces, and preserved newlines and <br>s as "\n".
	const sourceTextOf = (root: Element | undefined) => {
		let out = "";
		const visit = (node: Node) => {
			if (node.nodeType === node.TEXT_NODE) {
				const parent = node.parentElement;
				const preserved =
					parent !== null &&
					/^(?:pre|pre-wrap|pre-line|break-spaces)$/.test(
						styleOf(parent)["white-space"],
					);
				out += (node.textContent ?? "").replace(
					preserved ? /[ \t]+/g : /\s+/g,
					" ",
				);
			} else if (node.nodeName === "BR") {
				out += "\n";
			} else {
				node.childNodes.forEach(visit);
			}
		};

		if (root) {
			visit(root);
		}

		return out;
	};

	// A short description of an element: its text, else its accessible name or first class.
	const labelOf = (el: Element) =>
		[
			truncate(textOf(el), 40),
			el.getAttribute("aria-label")?.trim(),
			el.closest("[class]")?.getAttribute("class")?.trim().split(/\s+/)[0],
			el.tagName.toLowerCase(),
		].find(Boolean);
	// An SVG shape's label: its own class (like "bug"), else its drawing's label.
	const shapeLabelOf = (shape: Element) =>
		[
			shape.getAttribute("class")?.trim().split(/\s+/)[0],
			shape.closest("[aria-label]")?.getAttribute("aria-label")?.trim(),
		].find(Boolean) ?? labelOf(shape);
	// Text with spaces between blocks, so "<p>a</p><p>b</p>" reads "a b".
	const textOf = (el: Element): string => {
		const visit = (parent: Element): string =>
			[...parent.childNodes]
				.map((node) => {
					if (node.nodeType === node.TEXT_NODE) {
						return node.textContent ?? "";
					}

					if (node.nodeType !== node.ELEMENT_NODE) {
						return "";
					}

					const child = node as Element;
					const text = visit(child);
					return styleOf(child).display.startsWith("inline")
						? text
						: ` ${text} `;
				})
				.join("");
		return visit(el).replace(/\s+/g, " ").trim();
	};

	const opacityOf = (el: Element) => {
		let product = 1;
		for (
			let e: Element | null = el;
			e && e.tagName !== "HTML";
			e = e.parentElement
		) {
			const style = styles.get(e);
			if (!style) {
				continue;
			}

			if (style.display === "none" || style.visibility === "hidden") {
				return 0;
			}

			product *= Number(style.opacity);
		}

		return product;
	};

	const pathOf = (el: Element) => {
		const parts: string[] = [];
		let e = el;
		while (e.parentElement && !e.classList.contains("slidev-page")) {
			parts.unshift(
				`${e.tagName.toLowerCase()}${String([...e.parentElement.children].indexOf(e))}`,
			);
			e = e.parentElement;
		}

		return parts.join("/");
	};

	// Effective scale (e.g. Slidev's per-slide zoom) from the nearest laid-out element.
	const scaleOf = (el: Element) => {
		for (let e: Element | null = el; e; e = e.parentElement) {
			const box = boxOf(e);
			if (box) {
				return Math.hypot(box.matrix[0], box.matrix[1]);
			}
		}

		return 1;
	};

	const contentBox = (el: Element, box: Box, scale = 1): Box => {
		const left = (px(el, "padding-left") + px(el, "border-left-width")) * scale;
		const right =
			(px(el, "padding-right") + px(el, "border-right-width")) * scale;
		const top = (px(el, "padding-top") + px(el, "border-top-width")) * scale;
		const bottom =
			(px(el, "padding-bottom") + px(el, "border-bottom-width")) * scale;
		return {
			h: box.h - top - bottom,
			w: box.w - left - right,
			x: box.x + left,
			y: box.y + top,
		};
	};

	const gradientText = (el: Element) => {
		for (
			let e: Element | null = el;
			e && e.tagName !== "HTML";
			e = e.parentElement
		) {
			const style = styles.get(e);
			if (
				style &&
				(style["-webkit-background-clip"] ?? style["background-clip"]).includes(
					"text",
				) &&
				style["background-image"].includes("gradient")
			) {
				return linearGradient(style["background-image"], 1);
			}
		}

		return undefined;
	};

	const runStyle = (el: Element, opacity: number): Run => {
		const s = styleOf(el);
		const zoom = scaleOf(el);
		const fill = s["-webkit-text-fill-color"];
		let color = parseColor(fill && fill !== "currentcolor" ? fill : s.color);
		const gradient = !color || color.a === 0 ? gradientText(el) : undefined;
		if (gradient) {
			color = { a: 1, hex: gradient.stops[0].hex };
		}

		const { bold, font } = fonts.resolve(
			s["font-family"],
			Number(s["font-weight"]),
			s["font-style"] === "italic",
		);
		const stroke = parseFloat(s["-webkit-text-stroke-width"]) || 0;
		const shadow = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(\S.*)$/.exec(
			s["text-shadow"],
		);
		const shadowColor = shadow ? parseColor(shadow[4]) : undefined;
		const href = el.closest("a[href]")?.getAttribute("href") ?? "";
		return {
			bold,
			color: color?.hex ?? "ffffff",
			font,
			gradient: gradient && {
				angle: gradient.angle,
				stops: gradient.stops.map((stop) => ({
					hex: stop.hex,
					position: stop.position,
					transparency: 0,
				})),
			},
			href: /^(?:https?|mailto):/i.test(href) ? href : undefined,
			italic: s["font-style"] === "italic",
			letterSpacing:
				s["letter-spacing"] === "normal"
					? 0
					: (parseFloat(s["letter-spacing"]) || 0) * zoom,
			shadow:
				shadow && shadowColor
					? {
							blur: Number(shadow[3]),
							color: shadowColor.hex,
							offsetX: Number(shadow[1]),
							offsetY: Number(shadow[2]),
							transparency: (1 - shadowColor.a) * 100,
						}
					: undefined,
			size: parseFloat(s["font-size"]) * zoom,
			stroke: stroke
				? {
						color:
							parseColor(s["-webkit-text-stroke-color"], s.color)?.hex ??
							"000000",
						width: stroke * zoom,
					}
				: undefined,
			// The Tailwind reset positions <sup> relatively instead of with vertical-align.
			superscript:
				s["vertical-align"] === "super" || el.closest("sup") !== null,
			text: "",
			transparency: (1 - (color?.a ?? 1) * opacity) * 100,
			underline: s["text-decoration-line"].includes("underline"),
			upper: s["text-transform"] === "uppercase",
		};
	};

	// takumi reports run positions relative to the element's content box, in its local
	// (unscaled) units; these map them to slide coordinates.
	const runScale = (entry: LaidOutRuns) =>
		Math.hypot(entry.box.matrix[0], entry.box.matrix[1]);
	const runOrigin = (entry: LaidOutRuns, el?: Element): Point => {
		const k = runScale(entry);
		if (entry.anonymous || !el) {
			return { x: entry.box.x, y: entry.box.y };
		}

		return {
			x:
				entry.box.x +
				k * (px(el, "padding-left") + px(el, "border-left-width")),
			y: entry.box.y + k * (px(el, "padding-top") + px(el, "border-top-width")),
		};
	};

	const runRect = (
		entry: LaidOutRuns,
		el: Element | undefined,
		run: LaidOutRun,
	): Box => {
		const k = runScale(entry);
		const origin = runOrigin(entry, el);
		return {
			h: run.height * k,
			w: run.width * k,
			x: origin.x + run.x * k,
			y: origin.y + run.y * k,
		};
	};

	/** Converts takumi's runs (per line, per style) into paragraphs with baselines and soft breaks. */
	const runsToParagraphs = (
		entry: LaidOutRuns,
		opacityFor: (owner: Element) => number,
		el?: Element,
	) => {
		const k = runScale(entry);
		// One paragraph; browser line wraps become soft breaks within it.
		const paragraph: Run[] = [];
		const baselines: number[] = [];
		let previous: LaidOutRun | undefined;
		let right = -Infinity;
		let wrapped = false;
		// takumi drops whatever the browser broke a line at, so read it from the DOM text.
		const sourceText = sourceTextOf(el ?? byId.get(entry.parent));
		const source = sourceText.toLowerCase();
		let cursor = 0;
		let newlineRun = false;
		const spacer = fonts.spacer();
		for (const run of entry.runs) {
			const owner = byId.get(run.owner);
			if (!owner || /^\n+$/.test(run.text)) {
				newlineRun ||= run.text.includes("\n");
				continue;
			}

			const needle = run.text.replace(/\s+/g, " ").trim().toLowerCase();
			const found = needle ? source.indexOf(needle, cursor) : -1;
			const between = found < 0 ? undefined : source.slice(cursor, found);
			if (found >= 0) {
				cursor = found + needle.length;
			}

			const style = runStyle(owner, opacityFor(owner));
			const rect = runRect(entry, el, run);
			right = Math.max(right, rect.x + rect.w);
			const baseline = rect.y + rect.h * ascentRatio(style.font);
			// A new line starts where a run jumps back left and down; runs in other fonts
			// (inline code) sit at different heights on the same line.
			const newLine =
				previous !== undefined &&
				run.x < previous.x + previous.width - 1 &&
				run.y + run.height > previous.y + previous.height + 1;
			const gap =
				previous && !newLine ? (run.x - (previous.x + previous.width)) * k : 0;
			previous = run;
			if (!style.superscript) {
				if (!baselines.length || newLine) {
					baselines.push(baseline);
				} else {
					baselines[baselines.length - 1] = Math.max(
						baselines[baselines.length - 1],
						baseline,
					);
				}
			}

			// Uppercase text keeps its source casing (takumi reports it transformed), and
			// PowerPoint capitalizes it (cap="all").
			let text = run.text.replace(/\s+/g, " ");
			const core = text.trim();
			if (style.upper && found >= 0 && core.length === needle.length) {
				const original = sourceText.slice(found, found + needle.length);
				text = text.replace(core, () => original);
			}

			// Gaps between runs on a line (padding, margins, borders of inline elements) become
			// spacer runs: a monospaced no-break space widened to the gap with letter-spacing.
			if (gap > 0.75 && paragraph.length) {
				paragraph.push({
					...style,
					bold: false,
					font: spacer.font,
					gradient: undefined,
					letterSpacing: gap - spacer.advance * style.size,
					pad: true,
					stroke: undefined,
					text: " ",
					transparency: 100,
				});
			}

			if (newLine) {
				// A forced break (<br>, or a newline in preserved white space) stays a line
				// break; a wrap keeps the space it wrapped at, if any, so PowerPoint can rewrap.
				const newlines = between ? between.split("\n").length - 1 : 0;
				const breaks = Math.max(newlineRun ? 1 : 0, newlines);
				// PowerPoint can't break at a zero-width space (and the text drops them), so a
				// wrap there is kept as a line break.
				const atZeroWidth = (paragraph.at(-1)?.text ?? "").endsWith("\u200B");
				const forced = breaks > 0 || atZeroWidth;
				const spaced =
					between === undefined
						? !/[-\u200B]$/.test(paragraph.at(-1)?.text.trimEnd() ?? "")
						: /\s/.test(between);
				wrapped ||= !forced;
				const last = paragraph.at(-1);
				if (last && !last.pad) {
					last.text = last.text.trimEnd() + (spaced && !forced ? " " : "");
				}

				// Each break past the first (as in "<br><br>") holds an empty line.
				for (let extra = 1; extra < breaks; extra++) {
					// A plain space, so text typed on the blank line looks like its neighbors.
					paragraph.push({
						...style,
						href: undefined,
						lineBreak: true,
						text: " ",
						underline: false,
					});
				}

				paragraph.push({
					...style,
					...(forced ? { lineBreak: true } : { softBreak: true }),
					text: text.trimStart(),
				});
			} else {
				paragraph.push({ ...style, text });
			}

			newlineRun = false;
		}

		if (paragraph.length) {
			if (!paragraph[0].pad) {
				paragraph[0].text = paragraph[0].text.trimStart();
			}

			const last = paragraph[paragraph.length - 1];
			if (!last.pad) {
				last.text = last.text.trimEnd();
			}

			paragraph[0].softBreak = undefined;
			paragraph[0].lineBreak = undefined;
			for (const run of paragraph) {
				run.text = run.text.replace(/\u200B/g, "");
			}
		}

		return {
			baselines,
			paragraphs: [
				{ runs: paragraph.filter((run) => run.text.length) },
			] as Paragraph[],
			right,
			wrapRight: wrapped ? right : undefined,
		};
	};

	const boxStyle = (el: Element, opacity: number): BoxStyle | undefined => {
		const s = styleOf(el);
		let fill = parseColor(s["background-color"]);
		let gradient: Gradient | undefined;
		if (
			(!fill || fill.a === 0) &&
			s["background-image"].startsWith("linear-gradient") &&
			splitList(s["background-image"]).length === 1 &&
			!(s["-webkit-background-clip"] ?? s["background-clip"]).includes("text")
		) {
			gradient = linearGradient(s["background-image"], opacity);
			if (gradient?.stops.some((stop) => stop.transparency < 99.6)) {
				fill = { a: 1, hex: gradient.stops[gradient.stops.length - 1].hex };
			} else {
				gradient = undefined;
			}
		}

		const sides = (["top", "right", "bottom", "left"] as const).flatMap(
			(side) => {
				const width = px(el, `border-${side}-width`);
				const color =
					width > 0
						? parseColor(s[`border-${side}-color`], s.color)
						: undefined;
				return color && color.a > 0.01
					? [
							{
								fill: {
									color: color.hex,
									transparency: (1 - color.a * opacity) * 100,
								},
								side,
								width,
							},
						]
					: [];
			},
		);
		const uniform =
			sides.length === 4 &&
			sides.every(
				(side) =>
					side.width === sides[0].width &&
					side.fill.color === sides[0].fill.color &&
					side.fill.transparency === sides[0].fill.transparency,
			);
		const visibleFill = fill && fill.a > 0.004 ? fill : undefined;
		if (!visibleFill && !sides.length) {
			return undefined;
		}

		return {
			border: uniform ? { ...sides[0].fill, width: sides[0].width } : undefined,
			edges: uniform || !sides.length ? undefined : sides,
			fill: visibleFill && {
				color: visibleFill.hex,
				gradient,
				transparency: gradient ? 0 : (1 - visibleFill.a * opacity) * 100,
			},
			radius: px(el, "border-top-left-radius"),
		};
	};

	const lineHeightOf = (el: Element) =>
		parseFloat(styleOf(el)["line-height-px"]);
	const alignOf = (el: Element) =>
		ALIGNMENTS[styleOf(el)["text-align"]] ?? "left";
	const nowrapOf = (el: Element) =>
		/^(?:nowrap|pre)$/.test(styleOf(el)["white-space"]);
	const signatureOf = (paragraphs: Paragraph[]) =>
		paragraphs
			.map((p) =>
				p.runs
					.map(
						(r) =>
							`${r.text}|${r.color}|${String(r.transparency)}|${r.size.toFixed(1)}`,
					)
					.join(""),
			)
			.join("¶");
	const isInvisible = (paragraphs: Paragraph[]) =>
		paragraphs.every(({ runs }) =>
			runs.every((run) => run.transparency >= 100),
		);

	const textItem = (el: Element, entry: LaidOutRuns, opacity: number) => {
		const { box: rawBox, rotation, scale } = geometry(entry.box);
		const box = entry.anonymous ? rawBox : contentBox(el, rawBox, scale);
		const { baselines, paragraphs, wrapRight } = runsToParagraphs(
			entry,
			(owner) => (entry.anonymous ? opacity : opacityOf(owner)),
			entry.anonymous ? undefined : el,
		);
		if (isInvisible(paragraphs)) {
			return;
		}

		push({
			baselines: rotation ? undefined : baselines,
			box,
			heading:
				!entry.anonymous && /^h[1-6]$/i.test(el.tagName) ? true : undefined,
			key: `${pathOf(el)}#${entry.anonymous ? "loose" : "text"}:${signatureOf(paragraphs)}`,
			kind: "text",
			paragraphs,
			rotation,
			style: {
				align: alignOf(el),
				lineHeight: lineHeightOf(el) * scale,
				nowrap: nowrapOf(el) || Boolean(rotation),
				wrapWidth: wrapRight === undefined ? undefined : wrapRight - box.x,
			},
		});
	};

	const codeItem = (pre: Element) => {
		const laidOut = boxOf(pre);
		if (!laidOut) {
			return;
		}

		const { box: preBox, scale } = geometry(laidOut);
		const entry = runs.get(idOf(pre));
		const lines = [...pre.querySelectorAll(".line")];
		const paragraphs: Paragraph[] = lines.map(() => ({ runs: [] }));
		const baselines: (number | undefined)[] = [];
		for (const run of entry?.runs ?? []) {
			const owner = byId.get(run.owner);
			const index = owner
				? lines.findIndex((line) => line === owner || line.contains(owner))
				: -1;
			if (!entry || !owner || index < 0 || /^\n+$/.test(run.text)) {
				continue;
			}

			const style = runStyle(owner, opacityOf(owner));
			paragraphs[index].runs.push({
				...style,
				text: run.text.replace(/\t/g, "  "),
			});
			if (baselines[index] === undefined) {
				const rect = runRect(entry, pre, run);
				baselines[index] = rect.y + rect.h * ascentRatio(style.font);
			}
		}

		while (
			paragraphs.length &&
			!paragraphs[paragraphs.length - 1].runs.length
		) {
			paragraphs.pop();
		}

		if (isInvisible(paragraphs)) {
			return;
		}

		const signature = paragraphs
			.map((p) =>
				p.runs
					.map((r) => `${r.text}|${r.color}|${String(r.transparency)}`)
					.join(""),
			)
			.join("¶");
		push({
			baselines: baselines.filter((baseline) => baseline !== undefined),
			box: contentBox(pre, preBox, scale),
			key: `${pathOf(pre)}#code:${signature}`,
			kind: "code",
			paragraphs,
			style: {
				align: "left",
				lineHeight: lineHeightOf(pre) * scale,
				nowrap: true,
			},
		});
	};

	const listItem = (list: Element, opacity: number) => {
		const laidOut = boxOf(list);
		if (!laidOut) {
			return;
		}

		const { box: listBox, scale } = geometry(laidOut);
		const lis = [...list.children].filter((li) => li.tagName === "LI");
		const listStyle = styleOf(list)["list-style-type"];
		let right = -Infinity;
		const wraps: boolean[] = [];
		// Ordinals, as a browser numbers items: from the list's start, or an item's value.
		const reversed = list.hasAttribute("reversed");
		let ordinal =
			Number(list.getAttribute("start") ?? NaN) || (reversed ? lis.length : 1);
		const numbers = lis.map((li) => {
			const value = Number(li.getAttribute("value") ?? NaN);
			const current = Number.isInteger(value) ? value : ordinal;
			ordinal = current + (reversed ? -1 : 1);
			return current;
		});
		const paragraphs: ListParagraph[] = lis.map((li, index) => {
			const entry = runs.get(idOf(li));
			const converted = entry
				? runsToParagraphs(entry, () => opacity, li)
				: {
						baselines: [],
						paragraphs: [{ runs: [] }],
						right: -Infinity,
						wrapRight: undefined,
					};
			right = Math.max(right, converted.right);
			wraps.push(converted.wrapRight !== undefined);

			return {
				baselines: converted.baselines,
				bullet:
					styleOf(li)["list-style-type"] !== "none" && listStyle !== "none",
				number: numbers[index],
				runs: converted.paragraphs.flatMap((p) => p.runs),
				visible: opacityOf(li) > 0.05,
			};
		});
		if (isInvisible(paragraphs)) {
			return;
		}

		const first = lis.at(0);
		const marker = first ? markers.get(first) : undefined;
		const box = contentBox(list, listBox, scale);
		push({
			box,
			bulletColor: marker ? parseColor(marker.color)?.hex : undefined,
			key: `${pathOf(list)}#list`,
			kind: "list",
			marker: (first && styleOf(first)["list-style-type"]) ?? listStyle,
			paragraphs,
			style: {
				align: alignOf(first ?? list),
				lineHeight: lineHeightOf(first ?? list) * scale,
				nowrap: false,
				// The longest line of any item, wrapped or not, once any item wrapped.
				wrapWidth: wraps.includes(true) ? right - box.x : undefined,
			},
		});
	};

	const imageItem = (img: Element, opacity: number) => {
		const laidOut = boxOf(img);
		const src = img.getAttribute("src");
		const data = src ? assets.get(src) : undefined;
		const file = src ? assets.save(src) : undefined;
		if (!laidOut || !src || !data || !file) {
			return;
		}

		const { box, scale } = geometry(laidOut);
		const style = styleOf(img);
		const natural = imageSize(data);
		const fit = style["object-fit"];
		let content = box;
		let crop: Box | undefined;
		if (natural && fit !== "fill") {
			// The image's drawn size, positioned in its box by object-position.
			const ratio = natural.w / natural.h;
			const contain =
				box.w / box.h > ratio
					? { h: box.h, w: box.h * ratio }
					: { h: box.w / ratio, w: box.w };
			const cover =
				box.w / box.h > ratio
					? { h: box.w / ratio, w: box.w }
					: { h: box.h, w: box.h * ratio };
			const own = { h: natural.h * scale, w: natural.w * scale };
			const size =
				fit === "contain"
					? contain
					: fit === "cover"
						? cover
						: fit === "none"
							? own
							: own.w > contain.w
								? contain
								: own;
			const drawn = positionIn(box, size, style["object-position"], img);
			content = intersect(box, drawn);
			crop = sameBox(content, drawn) ? undefined : drawn;
		}

		const radiusValue = style["border-top-left-radius"];
		const radius = px(img, "border-top-left-radius") * scale;
		push({
			alt: img.getAttribute("alt") ?? "",
			box: content,
			circle: radiusValue.endsWith("%")
				? parseFloat(radiusValue) >= 50
				: radius >= Math.min(box.w, box.h) / 2 - 1,
			crop,
			file,
			key: `${pathOf(img)}#img:${src}`,
			kind: "image",
			label: src.startsWith("data:")
				? labelOf(img)
				: decodeURIComponent(path.basename(src.replace(/[?#].*$/, ""))),
			radius,
			src,
			transparency: (1 - opacity) * 100,
		});
	};

	/** An element's CSS background images and layered gradients, bottom layer first, as images and boxes. */
	const backgroundItems = (el: Element, opacity: number) => {
		const s = styleOf(el);
		const layers = splitList(s["background-image"]);
		if (
			layers.length < 2 &&
			!layers.some((layer) => layer.startsWith("url("))
		) {
			return;
		}

		const laidOut = boxOf(el);
		if (!laidOut) {
			return;
		}

		const { box: border, rotation, scale } = geometry(laidOut);
		const area: Box = {
			h:
				border.h -
				(px(el, "border-top-width") + px(el, "border-bottom-width")) * scale,
			w:
				border.w -
				(px(el, "border-left-width") + px(el, "border-right-width")) * scale,
			x: border.x + px(el, "border-left-width") * scale,
			y: border.y + px(el, "border-top-width") * scale,
		};
		const sizes = splitList(s["background-size"]);
		const positions = splitList(s["background-position"]);
		const radius = px(el, "border-top-left-radius") * scale;
		layers.forEach((layer, index) => {
			const at = (list: string[]) => list[index % list.length] ?? "";
			const url = layer.startsWith("url(") ? cssUrls(layer)[0] : undefined;
			if (url) {
				const data = assets.get(url);
				const file = assets.save(url);
				if (!data || !file) {
					return;
				}

				const natural = imageSize(data) ?? { h: area.h, w: area.w };
				const drawn = positionIn(
					area,
					backgroundSize(at(sizes), area, natural, el),
					at(positions),
					el,
				);
				const visible = intersect(border, drawn);
				if (visible.w <= 0 || visible.h <= 0) {
					return;
				}

				push({
					alt: "",
					box: visible,
					circle: false,
					crop: sameBox(visible, drawn) ? undefined : drawn,
					file,
					key: `${pathOf(el)}#background:${url}`,
					kind: "image",
					label: `background of ${labelOf(el) ?? "element"}`,
					radius,
					src: url,
					transparency: (1 - opacity) * 100,
				});
			} else if (layer.startsWith("linear-gradient")) {
				const gradient = linearGradient(layer, opacity);
				if (!gradient?.stops.some((stop) => stop.transparency < 99.6)) {
					return;
				}

				push({
					box: border,
					fill: {
						color: gradient.stops[gradient.stops.length - 1].hex,
						gradient,
						transparency: 0,
					},
					key: `${pathOf(el)}#background-${String(index)}`,
					kind: "box",
					label: `background of ${labelOf(el) ?? "element"}`,
					radius,
					rotation,
				});
			}
		});
	};

	/** Where an image of `size` sits in `area`, by a CSS position (object-position or background-position). */
	const positionIn = (
		area: Box,
		size: { h: number; w: number },
		position: string,
		el: Element,
	): Box => {
		const parts = position.trim().split(/\s+/).filter(Boolean);
		let horizontal = parts.find((part) => /^(?:left|right)$/.test(part));
		let vertical = parts.find((part) => /^(?:top|bottom)$/.test(part));
		const rest = parts.filter(
			(part) => part !== horizontal && part !== vertical,
		);
		horizontal ??= rest.shift() ?? "center";
		vertical ??= rest.shift() ?? "center";
		const offset = (value: string, free: number) => {
			switch (value) {
				case "bottom":
				case "right":
					return free;
				case "center":
					return free / 2;
				case "left":
				case "top":
					return 0;
				default:
					return toPx(value, px(el, "font-size"), rootFontSize, free, canvas);
			}
		};

		return {
			h: size.h,
			w: size.w,
			x: area.x + offset(horizontal, area.w - size.w),
			y: area.y + offset(vertical, area.h - size.h),
		};
	};

	const backgroundSize = (
		value: string,
		area: Box,
		natural: { h: number; w: number },
		el: Element,
	) => {
		const ratio = natural.w / natural.h;
		const wider = area.w / area.h > ratio;
		if (value === "cover") {
			return wider
				? { h: area.w / ratio, w: area.w }
				: { h: area.h, w: area.h * ratio };
		}

		if (value === "contain") {
			return wider
				? { h: area.h, w: area.h * ratio }
				: { h: area.w / ratio, w: area.w };
		}

		const [width = "auto", height = "auto"] = value.trim().split(/\s+/);
		const length = (part: string, base: number) =>
			part === "auto"
				? undefined
				: toPx(part, px(el, "font-size"), rootFontSize, base, canvas);
		const w = length(width, area.w);
		const h = length(height, area.h);
		return {
			h: h ?? (w === undefined ? natural.h : w / ratio),
			w: w ?? (h === undefined ? natural.w : h * ratio),
		};
	};

	// The whole-pixel area covering an element and everything inside it, or the whole
	// slide when anything is rotated (its unrotated boxes don't bound what it paints).
	const rasterBox = (el: Element): Box => {
		const slide = { h: canvas.height, w: canvas.width, x: 0, y: 0 };
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		for (const node of [el, ...el.querySelectorAll("*")]) {
			const laidOut = boxOf(node);
			if (!laidOut) {
				continue;
			}

			const { box, rotation } = geometry(laidOut);
			if (Math.abs(rotation) > 0.01) {
				return slide;
			}

			left = Math.min(left, box.x);
			top = Math.min(top, box.y);
			right = Math.max(right, box.x + box.w);
			bottom = Math.max(bottom, box.y + box.h);
		}

		if (!Number.isFinite(left)) {
			return slide;
		}

		const margin = RASTER_MARGIN + paintOverflowOf(el);
		const x = Math.max(0, Math.floor(left - margin));
		const y = Math.max(0, Math.floor(top - margin));
		return {
			h: Math.min(canvas.height, Math.ceil(bottom + margin)) - y,
			w: Math.min(canvas.width, Math.ceil(right + margin)) - x,
			x,
			y,
		};
	};

	// How far shadows and filters may paint past an element or its descendants: at most
	// the sum of their lengths (offsets, blur, spread), which bounds each shadow's reach.
	const rootFontSize =
		parseFloat(styleOf(document.documentElement)["font-size"]) || 16;
	const paintOverflowOf = (el: Element) =>
		Math.max(
			0,
			...[el, ...el.querySelectorAll("*")].map((node) => {
				const style = styleOf(node);
				const fontSize = parseFloat(style["font-size"]) || 16;
				return Math.max(
					...["box-shadow", "filter", "text-shadow"].map(
						(property) =>
							[
								...(style[property] ?? "").matchAll(/-?[\d.]+(?:px|r?em)\b/g),
							].reduce(
								(sum, [length]) =>
									sum +
									Math.abs(toPx(length, fontSize, rootFontSize, 0, canvas)),
								0,
							) *
							// A filter's blur length is a standard deviation; it shows to about 3x.
							(property === "filter" ? 3 : 1),
					),
				);
			}),
		);

	const rasterItem = (el: Element) => {
		const box = rasterBox(el);
		if (box.w <= 0 || box.h <= 0) {
			return;
		}

		push({
			alt: textOf(el),
			box,
			key: `${pathOf(el)}#raster`,
			kind: "raster",
			label: labelOf(el),
			selector: `[${ID}="${idOf(el)}"]`,
		});
	};

	const svgItems = (svg: Element) => {
		const laidOut = boxOf(svg);
		if (!laidOut) {
			return;
		}

		const shapes = [...svg.querySelectorAll("*")];
		if (
			shapes.some((shape) =>
				[
					"foreignobject",
					"image",
					"line",
					"path",
					"polyline",
					"rect",
					"use",
				].includes(shape.tagName.toLowerCase()),
			)
		) {
			rasterItem(svg);
			return;
		}

		const svgBox = geometry(laidOut).box;
		const [vx, vy, vw, vh] = (
			svg.getAttribute("viewBox") ??
			svg.getAttribute("viewbox") ??
			`0 0 ${String(svgBox.w)} ${String(svgBox.h)}`
		)
			.split(/[\s,]+/)
			.map(Number);
		// preserveAspectRatio="xMidYMid meet", the SVG default.
		const k = Math.min(svgBox.w / vw, svgBox.h / vh);
		const ox = svgBox.x + (svgBox.w - vw * k) / 2 - vx * k;
		const oy = svgBox.y + (svgBox.h - vh * k) / 2 - vy * k;
		const toSlide = (x: number, y: number): Point => ({
			x: ox + x * k,
			y: oy + y * k,
		});

		const paint = (
			shape: Element,
			prop: "fill" | "stroke",
		): Paint | undefined => {
			const fromCss = styleOf(shape)[prop];
			const value =
				fromCss && fromCss !== (prop === "fill" ? "black" : "none")
					? fromCss
					: (shape.getAttribute(prop) ?? fromCss);
			const url = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/.exec(value);
			if (url) {
				return svgGradient(svg, url[1], styles);
			}

			return value === "none"
				? undefined
				: parseColor(value, styleOf(shape).color);
		};

		const strokeOf = (shape: Element, shapeOpacity: number) => {
			const stroke = paint(shape, "stroke");
			return stroke && stroke.a > 0.01
				? {
						color: stroke.hex,
						transparency: (1 - stroke.a * shapeOpacity) * 100,
						width:
							toPx(
								styleOf(shape)["stroke-width"] ??
									shape.getAttribute("stroke-width") ??
									"1",
								16,
							) * k,
					}
				: undefined;
		};

		for (const shape of shapes) {
			const shapeOpacity =
				opacityOf(shape) * Number(shape.getAttribute("opacity") ?? 1);
			if (shapeOpacity < 0.05) {
				continue;
			}

			const key = pathOf(shape);
			const tag = shape.tagName.toLowerCase();
			if (tag === "polygon") {
				const numbers = (shape.getAttribute("points") ?? "")
					.trim()
					.split(/[\s,]+/)
					.map(Number);
				const points: Point[] = [];
				for (let i = 0; i + 1 < numbers.length; i += 2) {
					points.push(toSlide(numbers[i], numbers[i + 1]));
				}

				const xs = points.map((point) => point.x);
				const ys = points.map((point) => point.y);
				const x = Math.min(...xs);
				const y = Math.min(...ys);
				const fill = paint(shape, "fill");
				push({
					border: strokeOf(shape, shapeOpacity),
					box: { h: Math.max(...ys) - y, w: Math.max(...xs) - x, x, y },
					fill: fill && {
						color: fill.hex,
						gradient: fill.gradient && {
							...fill.gradient,
							stops: fill.gradient.stops.map((stop) => ({
								...stop,
								transparency: 100 - (100 - stop.transparency) * shapeOpacity,
							})),
						},
						transparency: (1 - fill.a * shapeOpacity) * 100,
					},
					key: `${key}#polygon`,
					kind: "polygon",
					label: shapeLabelOf(shape),
					points: points.map((point) => ({ x: point.x - x, y: point.y - y })),
				});
			} else if (tag === "circle") {
				const fill = paint(shape, "fill");
				const center = toSlide(
					Number(shape.getAttribute("cx")),
					Number(shape.getAttribute("cy")),
				);
				const r = Number(shape.getAttribute("r")) * k;
				push({
					border: strokeOf(shape, shapeOpacity),
					box: { h: r * 2, w: r * 2, x: center.x - r, y: center.y - r },
					fill: fill && {
						color: fill.hex,
						transparency: (1 - fill.a * shapeOpacity) * 100,
					},
					key: `${key}#circle`,
					kind: "ellipse",
					label: shapeLabelOf(shape),
				});
			} else if (tag === "text") {
				const s = styleOf(shape);
				const fill = paint(shape, "fill");
				const size = toPx(s["font-size"], 16) * k;
				const text = shape.textContent.trim();
				const anchor = s["text-anchor"];
				const at = toSlide(
					Number(shape.getAttribute("x") ?? 0),
					Number(shape.getAttribute("y") ?? 0),
				);
				const style = runStyle(shape, shapeOpacity);
				// dominant-baseline: central centers the font's ascent and descent on y.
				const { ascent, descent } = fonts.metrics(style.font);
				const baseline = /central|middle/.test(s["dominant-baseline"] ?? "")
					? at.y + size * (ascent - (ascent + descent) / 2)
					: at.y;
				const width = Math.max(40, text.length * size * 0.7);
				const run = {
					...style,
					color: fill?.hex ?? "ffffff",
					size,
					text,
					transparency: (1 - (fill?.a ?? 1) * shapeOpacity) * 100,
				};
				push({
					baselines: [baseline],
					box: {
						h: size * 1.2,
						w: width,
						x:
							anchor === "middle"
								? at.x - width / 2
								: anchor === "end"
									? at.x - width
									: at.x,
						y: baseline - size * 0.9,
					},
					key: `${key}#svgtext:${text}`,
					kind: "text",
					paragraphs: [{ runs: [run] }],
					rotation: 0,
					style: {
						align:
							anchor === "middle"
								? "center"
								: anchor === "end"
									? "right"
									: "left",
						lineHeight: size * 1.2,
						nowrap: true,
					},
				});
			}
		}
	};

	// Inline elements with a background or border ("pills", e.g. inline code) get their own boxes.
	const inlinePills = (el: Element, entry: LaidOutRuns, opacity: number) => {
		const k = runScale(entry);
		for (const child of el.querySelectorAll("*")) {
			const style = boxStyle(child, opacity);
			if (
				!style ||
				!(style.fill || style.border) ||
				!styleOf(child).display.startsWith("inline")
			) {
				continue;
			}

			const own = entry.runs.filter(
				(run) =>
					run.owner === idOf(child) ||
					byId.get(run.owner)?.closest(`[${ID}="${idOf(child)}"]`),
			);
			// One pill per line the element spans.
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

			const padX = px(child, "padding-left");
			const padY = px(child, "padding-top");
			const origin = runOrigin(entry, el);
			const { border, fill, radius } = style;
			for (const line of lines) {
				push({
					border: border && { ...border, width: border.width * k },
					box: {
						h: (line.bottom - line.top + padY * 2) * k,
						w: (line.right - line.left + padX * 2) * k,
						x: origin.x + (line.left - padX) * k,
						y: origin.y + (line.top - padY) * k,
					},
					fill,
					key: `${pathOf(child)}#pill:${String(Math.round(line.left))}`,
					kind: "box",
					label: labelOf(child),
					radius: radius * k,
					rotation: 0,
				});
			}
		}
	};

	const isDense = (el: Element) => el.querySelectorAll("*").length > DENSE;
	const isInlineOnly = (el: Element) => runs.get(idOf(el))?.anonymous === false;

	const walk = (el: Element) => {
		const opacity = opacityOf(el);
		const tag = el.tagName.toLowerCase();
		if (
			opacity < 0.05 ||
			["head", "script", "style", "template"].includes(tag) ||
			isBackgroundOnly(el, styles)
		) {
			return;
		}

		const embed = UNSUPPORTED_EMBEDS.find(([selector]) => el.matches(selector));
		if (embed) {
			const source = el.getAttribute("src");
			problems.push(
				`Couldn't export ${embed[1]}${source ? ` (${source})` : ""}.`,
			);
			return;
		}

		const laidOut = boxOf(el);
		if (!laidOut) {
			return;
		}

		// Paint order: background color, background images, then borders.
		const box = tag === "img" ? undefined : boxStyle(el, opacity);
		const { box: b, rotation, scale } = geometry(laidOut);
		const label = labelOf(el);
		if (box) {
			const shape = { border: box.border, fill: box.fill, radius: box.radius };
			if (shape.fill || shape.border) {
				push({
					...shape,
					border: shape.border && {
						...shape.border,
						width: shape.border.width * scale,
					},
					box: b,
					key: `${pathOf(el)}#box`,
					kind: "box",
					label,
					radius: shape.radius * scale,
					rotation,
				});
			}
		}

		if (tag !== "img") {
			backgroundItems(el, opacity);
		}

		for (const edge of box?.edges ?? []) {
			push({
				...edgeBox(b, edge, (box?.radius ?? 0) * scale, scale, rotation),
				fill: edge.fill,
				key: `${pathOf(el)}#border-${edge.side}`,
				kind: "box",
				label: `${edge.side} border${label ? ` of ${label}` : ""}`,
				radius: 0,
			});
		}

		if (tag === "img") {
			imageItem(el, opacity);
		} else if (tag === "svg") {
			svgItems(el);
		} else if (tag === "pre") {
			codeItem(el);
		} else if (isDense(el) && [...el.children].filter(isDense).length !== 1) {
			rasterItem(el);
		} else if (
			(tag === "ul" || tag === "ol") &&
			[...el.children].every(
				(li) => li.tagName !== "LI" || isInlineOnly(li) || !li.children.length,
			)
		) {
			listItem(el, opacity);
		} else if (isInlineOnly(el)) {
			const entry = runs.get(idOf(el));
			if (entry) {
				inlinePills(el, entry, opacity);
				textItem(el, entry, opacity);
			}

			// Positioned descendants (like ::after decorations) lay out as boxes of their own.
			const positioned = (e: Element) =>
				/^(?:absolute|fixed)$/.test(styleOf(e).position ?? "");
			for (const child of el.querySelectorAll("*")) {
				let nested = false;
				for (let e = child.parentElement; e && e !== el; e = e.parentElement) {
					nested ||= positioned(e);
				}

				if (positioned(child) && !nested) {
					walk(child);
				}
			}
		} else {
			for (const child of el.children) {
				walk(child);
			}

			// Text beside block-level siblings lays out as its own anonymous line box.
			for (const entry of runs.values()) {
				if (entry.anonymous && entry.parent === idOf(el)) {
					textItem(el, entry, opacity);
				}
			}
		}
	};

	// Global-bottom layers, the slide, then global-top layers, in paint order.
	for (const child of document.querySelector("#slide-content")?.children ??
		[]) {
		walk(child);
	}

	return { items, problems };
}

/** The overlap of two boxes. */
function intersect(a: Box, b: Box): Box {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	return {
		h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
		w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
		x,
		y,
	};
}

const sameBox = (a: Box, b: Box) =>
	(["h", "w", "x", "y"] as const).every((k) => Math.abs(a[k] - b[k]) < 0.01);

/** Splits a comma-separated CSS list (like background layers) outside parentheses. */
function splitList(value: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of value) {
		if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			depth--;
		}

		if (ch === "," && depth === 0) {
			out.push(current.trim());
			current = "";
		} else {
			current += ch;
		}
	}

	if (current.trim()) {
		out.push(current.trim());
	}

	return out;
}

/**
 * One side's border as its own thin rectangle. Rounded corners shorten it by the radius
 * at each end, and a rotated element's edges turn with it about the element's center.
 */
function edgeBox(
	box: Box,
	edge: { side: Side; width: number },
	radius: number,
	scale: number,
	rotation: number,
): { box: Box; rotation: number } {
	const thickness = edge.width * scale;
	const vertical = edge.side === "left" || edge.side === "right";
	const inset = Math.min(radius, (vertical ? box.h : box.w) / 2);
	const local: Box = vertical
		? {
				h: box.h - inset * 2,
				w: thickness,
				x: edge.side === "right" ? box.x + box.w - thickness : box.x,
				y: box.y + inset,
			}
		: {
				h: thickness,
				w: box.w - inset * 2,
				x: box.x + inset,
				y: edge.side === "bottom" ? box.y + box.h - thickness : box.y,
			};
	if (!rotation) {
		return { box: local, rotation: 0 };
	}

	const angle = (rotation * Math.PI) / 180;
	const dx = local.x + local.w / 2 - (box.x + box.w / 2);
	const dy = local.y + local.h / 2 - (box.y + box.h / 2);
	const cx = box.x + box.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle);
	const cy = box.y + box.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle);
	return {
		box: { ...local, x: cx - local.w / 2, y: cy - local.h / 2 },
		rotation,
	};
}

/** The unrotated box, rotation (degrees), and scale of a node from takumi's absolute transform. */
function geometry(box: LaidOutBox): Geometry {
	const [a, b, c, d] = box.matrix;
	const rotation = (Math.atan2(b, a) * 180) / Math.PI;
	const scale = Math.hypot(a, b);
	const w = box.w * scale;
	const h = box.h * Math.hypot(c, d);
	if (Math.abs(rotation) < 0.05) {
		return { box: { h, w, x: box.x, y: box.y }, rotation: 0, scale };
	}

	const cx = box.x + a * (box.w / 2) + c * (box.h / 2);
	const cy = box.y + b * (box.w / 2) + d * (box.h / 2);
	return { box: { h, w, x: cx - w / 2, y: cy - h / 2 }, rotation, scale };
}

function linearGradient(value: string, opacity: number): Gradient | undefined {
	const match = /linear-gradient\((.*)\)\s*$/.exec(value);
	if (!match) {
		return undefined;
	}

	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of match[1]) {
		if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			depth--;
		}

		if (ch === "," && depth === 0) {
			parts.push(current.trim());
			current = "";
		} else {
			current += ch;
		}
	}

	parts.push(current.trim());
	let angle = 180;
	if (parts[0].endsWith("deg")) {
		angle = parseFloat(parts.shift() ?? "180");
	} else if (parts[0].startsWith("to ")) {
		angle =
			(
				{
					"to bottom": 180,
					"to left": 270,
					"to right": 90,
					"to top": 0,
				} as Record<string, number>
			)[parts.shift() ?? ""] ?? 180;
	}

	return {
		angle,
		stops: parts.map((part, i) => {
			const position = /\s([\d.]+)%$/.exec(part);
			const color = parseColor(
				position ? part.slice(0, position.index) : part,
			) ?? { a: 0, hex: "000000" };
			return {
				hex: color.hex,
				position: position
					? Number(position[1])
					: (i / Math.max(1, parts.length - 1)) * 100,
				transparency: (1 - color.a * opacity) * 100,
			};
		}),
	};
}

/** A gradient an SVG shape references, averaged to a color for consumers without gradients. */
function svgGradient(
	svg: Element,
	id: string,
	styles: Map<Element, ComputedStyle>,
): Paint | undefined {
	const gradient = svg.querySelector(`[id="${id}"]`);
	if (!gradient) {
		return undefined;
	}

	const stops = [...gradient.querySelectorAll("stop")].map((stop) => {
		const color = parseColor(
			stop.getAttribute("stop-color") ?? styles.get(stop)?.["stop-color"],
		) ?? { a: 1, hex: "000000" };
		const offset = stop.getAttribute("offset") ?? "0";
		return {
			hex: color.hex,
			position: parseFloat(offset) * (offset.includes("%") ? 1 : 100),
			transparency:
				(1 - color.a * Number(stop.getAttribute("stop-opacity") ?? 1)) * 100,
		};
	});
	if (!stops.length) {
		return undefined;
	}

	// Coordinates are fractions of the bounding box, or percentages of it.
	const coordinate = (attribute: string, fallback: number) => {
		const value = gradient.getAttribute(attribute)?.trim();
		const parsed = value
			? parseFloat(value) / (value.endsWith("%") ? 100 : 1)
			: fallback;
		return Number.isFinite(parsed) ? parsed : fallback;
	};

	const angle =
		(Math.atan2(
			coordinate("y2", 0) - coordinate("y1", 0),
			coordinate("x2", 1) - coordinate("x1", 0),
		) *
			180) /
			Math.PI +
		90;
	const average = (i: number) =>
		Math.round(
			stops.reduce(
				(sum, stop) => sum + parseInt(stop.hex.slice(i, i + 2), 16),
				0,
			) / stops.length,
		);
	return {
		a:
			1 -
			stops.reduce((sum, stop) => sum + stop.transparency, 0) /
				stops.length /
				100,
		gradient: { angle, stops },
		hex: [0, 2, 4]
			.map((i) => average(i).toString(16).padStart(2, "0"))
			.join(""),
	};
}
