/**
 * Turns a laid-out slide state (see layout.ts) into model items (see model.ts):
 * text with styled runs and exact line breaks, lists, code, boxes, images, SVG
 * shapes, and rasters for anything PowerPoint can't represent natively.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ComputedStyle } from "./cascade.ts";
import type { LaidOutBox, LaidOutRun, LaidOutRuns, Layout } from "./layout.ts";
import type {
	Box,
	Fill,
	Gradient,
	Item,
	ListParagraph,
	Paragraph,
	Point,
	Run,
	Stroke,
	TextStyle,
} from "./model.ts";

import { INITIAL_STYLE, parseColor, toPx } from "./cascade.ts";
import { BACKGROUND_ONLY, ID } from "./layout.ts";
import { SLIDE } from "./model.ts";
import { truncate } from "./text.ts";

export interface Raster {
	/** The slide area to render, in slide px: the element and its descendants, with room for glows. */
	box: Box;
	id: string;
	selector: string;
}

/** Room around a raster's element for strokes and antialiasing, beyond its shadows' reach. */
const RASTER_MARGIN = 4;

type ItemInput = Item extends infer T
	? T extends Item
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

/** Ascent as a fraction of the glyph box takumi reports for a run (ascent + descent). */
const ASCENT_RATIOS: [RegExp, number][] = [
	[/league spartan/i, 0.7 / 0.92],
	[/impact/i, 1.0088 / 1.2197],
];

/** Menlo's, the monospace font used for code; close enough for most other fonts. */
const DEFAULT_ASCENT_RATIO = 0.928 / 1.164;

const ALIGNMENTS: Record<string, TextStyle["align"]> = {
	center: "center",
	end: "right",
	justify: "justify",
	left: "left",
	right: "right",
	start: "left",
};
const WEIGHT_NAMES: Record<number, string> = {
	100: "Thin",
	200: "ExtraLight",
	300: "Light",
	400: "",
	500: "Medium",
	600: "SemiBold",
	700: "Bold",
	800: "ExtraBold",
	900: "Black",
};

/** Menlo's advance, which is also the no-break space width spacer runs build on. */
const MONO_ADVANCE = 0.602;

/** Elements with more descendants than this render as one image instead of shapes. */
const DENSE = 400;

const sizes = new Map<string, undefined | { h: number; w: number }>();

/** Turns a laid-out slide state into model items, plus the elements that need rasterizing. */
export function extractState(
	layout: Layout,
	{ no, publicDir }: { no: number; publicDir: string },
): { items: Item[]; rasters: Raster[] } {
	const { boxes, byId, document, markers, runs, styles } = layout;
	const items: Item[] = [];
	const rasters: Raster[] = [];
	let order = 0;
	const push = (item: ItemInput) => {
		items.push({ ...item, order: order++ });
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
	// An SVG shape's label: what its drawing is labeled as, else its own description.
	const shapeLabelOf = (shape: Element) =>
		truncate(
			shape.closest("[aria-label]")?.getAttribute("aria-label")?.trim() ?? "",
			40,
		) || labelOf(shape);
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

		const font = pptFont(s["font-family"], s["font-weight"]);
		const stroke = parseFloat(s["-webkit-text-stroke-width"]) || 0;
		const shadow = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(\S.*)$/.exec(
			s["text-shadow"],
		);
		const shadowColor = shadow ? parseColor(shadow[4]) : undefined;
		const href = el.closest("a[href]")?.getAttribute("href") ?? "";
		return {
			bold:
				!font.startsWith("League Spartan") && Number(s["font-weight"]) >= 600,
			color: color?.hex ?? "ffffff",
			font,
			gradient: gradient && {
				angle: gradient.angle,
				stops: gradient.stops.map((stop) => ({ hex: stop.hex, pos: stop.pos })),
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
							dx: Number(shadow[1]),
							dy: Number(shadow[2]),
							opacity: shadowColor.a,
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
			transparency: Math.round((1 - (color?.a ?? 1) * opacity) * 100),
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
				text = text.replace(
					core,
					sourceText.slice(found, found + needle.length),
				);
			}

			// Gaps between runs on a line (padding, margins, borders of inline elements) become
			// spacer runs: a Menlo no-break space widened to the gap with letter-spacing.
			if (gap > 0.75 && paragraph.length) {
				paragraph.push({
					...style,
					bold: false,
					font: "Menlo",
					gradient: undefined,
					letterSpacing: gap - MONO_ADVANCE * style.size,
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
				const atZeroWidth = (paragraph.at(-1)?.text ?? "").endsWith("​");
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
					paragraph.push({
						...style,
						lineBreak: true,
						text: " ",
						transparency: 100,
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
			!(s["-webkit-background-clip"] ?? s["background-clip"]).includes("text")
		) {
			gradient = linearGradient(s["background-image"], opacity);
			if (gradient?.stops.some((stop) => (stop.a ?? 1) > 0.004)) {
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
									transparency: Math.round((1 - color.a * opacity) * 100),
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
				transparency: gradient
					? 0
					: Math.round((1 - visibleFill.a * opacity) * 100),
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

	const textItem = (el: Element, entry: LaidOutRuns, opacity: number) => {
		const { box: rawBox, rotation, scale } = geometry(entry.box);
		const box = entry.anonymous ? rawBox : contentBox(el, rawBox, scale);
		const { baselines, paragraphs, wrapRight } = runsToParagraphs(
			entry,
			(owner) => (entry.anonymous ? opacity : opacityOf(owner)),
			entry.anonymous ? undefined : el,
		);
		if (!paragraphs.some((p) => p.runs.length)) {
			return;
		}

		push({
			baselines: rotation ? undefined : baselines,
			box,
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
		const paragraphs: ListParagraph[] = lis.map((li) => {
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

			const liRuns = converted.paragraphs.flatMap((p) => p.runs);
			return {
				baselines: converted.baselines,
				bullet:
					styleOf(li)["list-style-type"] !== "none" && listStyle !== "none",
				key: `${pathOf(li)}:${liRuns.map((r) => r.text).join("")}`,
				runs: liRuns,
				visible: opacityOf(li) > 0.05,
			};
		});
		const first = lis.at(0);
		const marker = first ? markers.get(first) : undefined;
		const box = contentBox(list, listBox, scale);
		push({
			box,
			bulletColor: marker ? parseColor(marker.color)?.hex : undefined,
			indent: px(list, "padding-left") * scale,
			key: `${pathOf(list)}#list`,
			kind: "list",
			paragraphs,
			rotation: 0,
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
		if (!laidOut || !src) {
			return;
		}

		const { box } = geometry(laidOut);
		const natural = imageSize(
			path.join(publicDir, decodeURIComponent(src.replace(/^\//, ""))),
		);
		let content = box;
		if (styleOf(img)["object-fit"] === "contain" && natural) {
			const ratio = natural.w / natural.h;
			content =
				box.w / box.h > ratio
					? { ...box, w: box.h * ratio, x: box.x + (box.w - box.h * ratio) / 2 }
					: {
							...box,
							h: box.w / ratio,
							y: box.y + (box.h - box.w / ratio) / 2,
						};
		}

		const radiusValue = styleOf(img)["border-top-left-radius"];
		const radius = px(img, "border-top-left-radius");
		push({
			alt: img.getAttribute("alt") ?? "",
			box: content,
			circle: radiusValue.endsWith("%")
				? parseFloat(radiusValue) >= 50
				: radius >= Math.min(box.w, box.h) / 2 - 1,
			key: `${pathOf(img)}#img:${src}`,
			kind: "image",
			label: decodeURIComponent(path.basename(src)),
			radius,
			src,
			transparency: Math.round((1 - opacity) * 100),
		});
	};

	// The whole-pixel area covering an element and everything inside it, or the whole
	// slide when anything is rotated (its unrotated boxes don't bound what it paints).
	const rasterBox = (el: Element): Box => {
		const slide = { h: SLIDE.height, w: SLIDE.width, x: 0, y: 0 };
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
			h: Math.min(SLIDE.height, Math.ceil(bottom + margin)) - y,
			w: Math.min(SLIDE.width, Math.ceil(right + margin)) - x,
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
									sum + Math.abs(toPx(length, fontSize, rootFontSize)),
								0,
							) *
							// A filter's blur length is a standard deviation; it shows to about 3x.
							(property === "filter" ? 3 : 1),
					),
				);
			}),
		);

	const rasterItem = (el: Element, reason: string) => {
		// Identified by the element, so its renders in different click states line up.
		const id = `r${String(no)}-${createHash("sha1").update(pathOf(el)).digest("hex").slice(0, 8)}`;
		const box = rasterBox(el);
		if (box.w <= 0 || box.h <= 0) {
			return;
		}

		rasters.push({ box, id, selector: `[${ID}="${idOf(el)}"]` });
		push({
			alt: textOf(el),
			box,
			key: `${pathOf(el)}#raster`,
			kind: "raster",
			label: labelOf(el),
			rasterId: id,
			reason,
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
			rasterItem(svg, "svg");
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

				const fill = paint(shape, "fill");
				const stroke = paint(shape, "stroke");
				const strokeWidth =
					toPx(
						styleOf(shape)["stroke-width"] ??
							shape.getAttribute("stroke-width") ??
							"1",
						16,
					) * k;
				push({
					border:
						stroke && stroke.a > 0.01
							? {
									color: stroke.hex,
									transparency: Math.round((1 - stroke.a * shapeOpacity) * 100),
									width: strokeWidth,
								}
							: undefined,
					fill: fill && {
						color: fill.hex,
						gradient: fill.gradient && {
							...fill.gradient,
							stops: fill.gradient.stops.map((stop) => ({
								...stop,
								a: (stop.a ?? 1) * shapeOpacity,
							})),
						},
						transparency: Math.round((1 - fill.a * shapeOpacity) * 100),
					},
					key: `${key}#polygon`,
					kind: "polygon",
					label: shapeLabelOf(shape),
					points,
				});
			} else if (tag === "circle") {
				const fill = paint(shape, "fill");
				const center = toSlide(
					Number(shape.getAttribute("cx")),
					Number(shape.getAttribute("cy")),
				);
				const r = Number(shape.getAttribute("r")) * k;
				push({
					box: { h: r * 2, w: r * 2, x: center.x - r, y: center.y - r },
					fill: fill && {
						color: fill.hex,
						transparency: Math.round((1 - fill.a * shapeOpacity) * 100),
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
				// dominant-baseline: central centers the em box (0.7 ascent, 0.92 tall) on y.
				const baseline = /central|middle/.test(s["dominant-baseline"] ?? "")
					? at.y + size * (0.7 - 0.46)
					: at.y;
				const width = Math.max(40, text.length * size * 0.7);
				const run = {
					...runStyle(shape, shapeOpacity),
					color: fill?.hex ?? "ffffff",
					size,
					text,
					transparency: Math.round((1 - (fill?.a ?? 1) * shapeOpacity) * 100),
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
					border,
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
			el.matches(BACKGROUND_ONLY)
		) {
			return;
		}

		const laidOut = boxOf(el);
		if (!laidOut) {
			return;
		}

		const box = boxStyle(el, opacity);
		if (box && tag !== "img") {
			const { box: b, rotation, scale } = geometry(laidOut);
			const { edges, ...shape } = box;
			const label = labelOf(el);
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

			for (const edge of edges ?? []) {
				push({
					...edgeBox(b, edge, box.radius * scale, scale, rotation),
					fill: edge.fill,
					key: `${pathOf(el)}#border-${edge.side}`,
					kind: "box",
					label: `${edge.side} border${label ? ` of ${label}` : ""}`,
					radius: 0,
				});
			}
		}

		if (tag === "img") {
			imageItem(el, opacity);
		} else if (tag === "svg") {
			svgItems(el);
		} else if (tag === "pre") {
			codeItem(el);
		} else if (isDense(el) && [...el.children].filter(isDense).length !== 1) {
			rasterItem(el, "dense");
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

	const page = document.querySelector(".slidev-page");
	const content = document.querySelector("#slide-content");
	for (const child of content?.children ?? []) {
		if (child !== page) {
			walk(child);
		}
	}

	if (page) {
		walk(page);
	}

	return { items, rasters };
}

/** Reads an image's natural size from its header (PNG, GIF, or JPEG). */
function imageSize(file: string): undefined | { h: number; w: number } {
	if (!sizes.has(file)) {
		sizes.set(file, readImageSize(file));
	}

	return sizes.get(file);
}

const ascentRatio = (font: string) =>
	ASCENT_RATIOS.find(([pattern]) => pattern.test(font))?.[1] ??
	DEFAULT_ASCENT_RATIO;

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
				a: color.a * opacity,
				hex: color.hex,
				pos: position
					? Number(position[1])
					: (i / Math.max(1, parts.length - 1)) * 100,
			};
		}),
	};
}

/** Maps a CSS font stack and weight to the font name PowerPoint should use. */
function pptFont(family: string, weight: string) {
	const first = family.split(",")[0].replace(/["']/g, "").trim();
	if (/league spartan/i.test(first)) {
		// PowerPoint resolves the variable font's named instances, e.g. "League Spartan Light".
		const name = WEIGHT_NAMES[Math.round(Number(weight) / 100) * 100] ?? "";
		return name ? `League Spartan ${name}` : "League Spartan";
	}

	if (/mono|menlo|courier|consolas/i.test(first)) {
		return "Menlo";
	}

	if (/impact/i.test(first)) {
		return "Impact";
	}

	return first;
}

function readImageSize(file: string): undefined | { h: number; w: number } {
	let data: Buffer;
	try {
		data = fs.readFileSync(file);
	} catch {
		return undefined;
	}

	if (data.readUInt32BE(0) === 0x89504e47) {
		return { h: data.readUInt32BE(20), w: data.readUInt32BE(16) };
	}

	if (data.toString("ascii", 0, 3) === "GIF") {
		return { h: data.readUInt16LE(8), w: data.readUInt16LE(6) };
	}

	if (data[0] === 0xff && data[1] === 0xd8) {
		for (let i = 2; i + 9 < data.length;) {
			const marker = data[i + 1];
			if (
				marker >= 0xc0 &&
				marker <= 0xcf &&
				![0xc4, 0xc8, 0xcc].includes(marker)
			) {
				return { h: data.readUInt16BE(i + 5), w: data.readUInt16BE(i + 7) };
			}

			i += 2 + data.readUInt16BE(i + 2);
		}
	}

	return undefined;
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
			a: color.a * Number(stop.getAttribute("stop-opacity") ?? 1),
			hex: color.hex,
			pos: parseFloat(offset) * (offset.includes("%") ? 1 : 100),
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
		a: stops.reduce((sum, stop) => sum + stop.a, 0) / stops.length,
		gradient: { angle, stops },
		hex: [0, 2, 4]
			.map((i) => average(i).toString(16).padStart(2, "0"))
			.join(""),
	};
}
