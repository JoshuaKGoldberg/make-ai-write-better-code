import path from "node:path";

import type { Box } from "../model.ts";
import type { ExtractContext, ItemInput } from "./context.ts";
import type { Geometry, Size } from "./geometry.ts";

import { cssUrls, imageSize } from "../assets.ts";
import {
	hasVisibleStop,
	isGradient,
	parseLinearGradient,
	transparencyOf,
} from "../color.ts";
import { splitTopLevel } from "../css.ts";
import { ID } from "../layout.ts";
import { clipsToText } from "./boxes.ts";
import {
	fitSize,
	geometryOf,
	insetBox,
	intersect,
	positionIn,
	sameBox,
} from "./geometry.ts";

/** A filter's blur length is a standard deviation; the blur shows to about this many of them. */
const BLUR_REACH = 3;

/** Room around a raster's element for strokes and antialiasing, beyond its shadows' reach. */
const RASTER_MARGIN = 4;

/** Background tiles within this many px of covering their area show no repeats. */
const TILE_TOLERANCE = 0.5;

/**
 * An element's CSS background images and gradients, bottom layer first, as images and
 * boxes; or undefined when they don't draw natively: a radial, conic, or repeating
 * gradient, or an image that tiles.
 */
export function backgroundItems(
	context: ExtractContext,
	element: Element,
	opacity: number,
	{ box: border, rotation, scale }: Geometry,
) {
	const style = context.styleOf(element);
	if (clipsToText(style)) {
		return [];
	}

	const layers = splitTopLevel(style["background-image"], ",").filter(
		(layer) => layer !== "none",
	);

	if (
		layers.some(
			(layer) => isGradient(layer) && !parseLinearGradient(layer, opacity),
		)
	) {
		return undefined;
	}

	const area = insetBox(border, context.borderInsets(element), scale);
	const sizes = splitTopLevel(style["background-size"], ",");
	const positions = splitTopLevel(style["background-position"], ",");
	const repeats = splitTopLevel(style["background-repeat"], ",");
	const radius = context.radiusOf(element) * scale;
	const key = context.pathOf(element);
	const label = `background of ${context.labelOf(element)}`;
	const resolve = (length: string, base: number) =>
		context.resolve(element, length, base);
	const items: ItemInput[] = [];
	for (const [index, layer] of layers.entries()) {
		const at = (list: string[]) => list[index % list.length] ?? "";
		const gradient = parseLinearGradient(layer, opacity);
		if (gradient) {
			if (hasVisibleStop(gradient)) {
				items.push({
					box: border,
					fill: {
						color: gradient.stops[gradient.stops.length - 1].hex,
						gradient,
						transparency: 0,
					},
					key: `${key}#background-${String(index)}`,
					kind: "box",
					label,
					radius,
					rotation,
				});
			}

			continue;
		}

		const [url] = cssUrls(layer);
		const data = url && context.assets.get(url);
		const file = url && context.assets.save(url);
		if (!url || !data || !file) {
			continue;
		}

		const natural = imageSize(data) ?? area;
		const drawn = positionIn(
			area,
			backgroundSize(at(sizes), area, natural, resolve),
			at(positions),
			resolve,
		);
		if (showsRepeats(at(repeats), drawn, area)) {
			return undefined;
		}

		const visible = intersect(border, drawn);
		if (visible.w > 0 && visible.h > 0) {
			items.push({
				alt: "",
				box: visible,
				circle: false,
				crop: sameBox(visible, drawn) ? undefined : drawn,
				file,
				key: `${key}#background:${url}`,
				kind: "image",
				label,
				radius,
				src: url,
				transparency: transparencyOf(1, opacity),
			});
		}
	}

	return items;
}

export function imageItem(
	context: ExtractContext,
	image: Element,
	opacity: number,
	{ box: border, scale }: Geometry,
) {
	const src = image.getAttribute("src");
	const data = src && context.assets.get(src);
	const file = src && context.assets.save(src);
	if (!src || !data || !file) {
		return;
	}

	const style = context.styleOf(image);
	const box = insetBox(border, context.contentInsets(image), scale);
	const natural = imageSize(data);
	const drawn = natural
		? positionIn(
				box,
				objectSize(style["object-fit"], box, natural, scale),
				style["object-position"],
				(length, free) => context.resolve(image, length, free),
			)
		: box;
	const content = intersect(box, drawn);
	const radius = context.radiusOf(image) * scale;
	context.push({
		alt: image.getAttribute("alt") ?? "",
		box: content,
		circle: radius >= Math.min(border.w, border.h) / 2 - 1,
		crop: sameBox(content, drawn) ? undefined : drawn,
		file,
		key: `${context.pathOf(image)}#img:${src}`,
		kind: "image",
		label: src.startsWith("data:") ? context.labelOf(image) : fileNameOf(src),
		radius,
		src,
		transparency: transparencyOf(1, opacity),
	});
}

export function rasterItem(context: ExtractContext, element: Element) {
	const box = rasterBox(context, element);
	if (box.w <= 0 || box.h <= 0) {
		return;
	}

	context.push({
		alt: context.textOf(element),
		box,
		key: `${context.pathOf(element)}#raster`,
		kind: "raster",
		label: context.labelOf(element),
		selector: `[${ID}="${context.idOf(element)}"]`,
	});
}

function backgroundSize(
	value: string,
	area: Box,
	natural: Size,
	resolve: (length: string, base: number) => number,
) {
	const ratio = natural.w / natural.h;
	if (value === "cover" || value === "contain") {
		return fitSize(value, area, ratio);
	}

	const [width = "auto", height = "auto"] = splitTopLevel(value, " ");
	const length = (part: string, base: number) =>
		part === "auto" ? undefined : resolve(part, base);
	const w = length(width, area.w);
	const h = length(height, area.h);
	return {
		h: h ?? (w === undefined ? natural.h : w / ratio),
		w: w ?? (h === undefined ? natural.w : h * ratio),
	};
}

/** An image's file name from its URL, decoded where it's percent-encoded. */
export function fileNameOf(src: string) {
	const name = path.posix.basename(src.replace(/[?#].*$/, ""));
	try {
		return decodeURIComponent(name);
	} catch {
		return name;
	}
}

/** The size an image element draws at in its box, by its object-fit. */
function objectSize(fit: string, box: Box, natural: Size, scale: number) {
	const contain = fitSize("contain", box, natural.w / natural.h);
	const own = { h: natural.h * scale, w: natural.w * scale };
	const sizes: Partial<Record<string, Size>> = {
		contain,
		cover: fitSize("cover", box, natural.w / natural.h),
		none: own,
		"scale-down": own.w > contain.w ? contain : own,
	};
	return sizes[fit] ?? box;
}

/** How far shadows and filters may paint past an element or its descendants: at most the sum of their lengths. */
function paintOverflowOf(context: ExtractContext, element: Element) {
	return Math.max(
		0,
		...[element, ...element.querySelectorAll("*")].map((node) => {
			const style = context.styleOf(node);
			return Math.max(
				...["box-shadow", "filter", "text-shadow"].map(
					(property) =>
						[
							...(style[property] ?? "").matchAll(/-?[\d.]+(?:px|r?em)\b/g),
						].reduce(
							(sum, [length]) => sum + Math.abs(context.resolve(node, length)),
							0,
						) * (property === "filter" ? BLUR_REACH : 1),
				),
			);
		}),
	);
}

/** The whole-pixel area covering an element and everything inside it, or the whole slide when anything is rotated. */
function rasterBox(context: ExtractContext, element: Element) {
	const { canvas } = context;
	const slide = { h: canvas.height, w: canvas.width, x: 0, y: 0 };
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const node of [element, ...element.querySelectorAll("*")]) {
		const laidOut = context.boxOf(node);
		if (!laidOut) {
			continue;
		}

		const { box, rotation } = geometryOf(laidOut);
		if (rotation) {
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

	const margin = RASTER_MARGIN + paintOverflowOf(context, element);
	const x = Math.max(0, Math.floor(left - margin));
	const y = Math.max(0, Math.floor(top - margin));
	return {
		h: Math.min(canvas.height, Math.ceil(bottom + margin)) - y,
		w: Math.min(canvas.width, Math.ceil(right + margin)) - x,
		x,
		y,
	};
}

/** Whether a background tile repeats into view: it repeats along an axis it doesn't cover. */
function showsRepeats(repeat: string, tile: Box, area: Box) {
	const [first = "repeat", second] = splitTopLevel(repeat, " ");
	const [x, y] = second
		? [first, second]
		: first === "repeat-x"
			? ["repeat", "no-repeat"]
			: first === "repeat-y"
				? ["no-repeat", "repeat"]
				: [first, first];
	const covers = (
		start: number,
		size: number,
		areaStart: number,
		areaSize: number,
	) =>
		start <= areaStart + TILE_TOLERANCE &&
		start + size >= areaStart + areaSize - TILE_TOLERANCE;
	return (
		(x !== "no-repeat" && !covers(tile.x, tile.w, area.x, area.w)) ||
		(y !== "no-repeat" && !covers(tile.y, tile.h, area.y, area.h))
	);
}
