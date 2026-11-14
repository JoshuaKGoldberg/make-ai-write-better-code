import type { ComputedStyle } from "../cascade.ts";
import type { Box, Fill, Gradient } from "../model.ts";
import type { ExtractContext, ItemInput } from "./context.ts";
import type { Geometry, Size } from "./geometry.ts";

import { cssUrls, imageSize } from "../assets.ts";
import {
	hasVisibleStop,
	isGradient,
	MIN_VISIBLE_ALPHA,
	parseColor,
	parseLinearGradient,
	transparencyOf,
} from "../color.ts";
import { splitTopLevel } from "../css.ts";
import { pathOf } from "./context.ts";
import {
	edgeBox,
	fitSize,
	geometryOf,
	insetBox,
	intersect,
	positionIn,
	sameBox,
	SIDES,
} from "./geometry.ts";

/** Background tiles within this many px of covering their area show no repeats. */
const TILE_TOLERANCE = 0.5;

const gradientFill = (gradient: Gradient): Fill => ({
	color: gradient.stops[gradient.stops.length - 1].color,
	gradient,
	transparency: 0,
});

export function availableWidthOf(
	context: ExtractContext,
	element: Element,
	x: number,
) {
	for (
		let current: Element | null = element;
		current;
		current = current.parentElement
	) {
		const laidOut = context.boxOf(current);
		const style = laidOut && boxStyle(context, current, 1);
		if (laidOut && style && !context.isInline(current)) {
			const { box, scale } = geometryOf(laidOut);
			const content = insetBox(box, context.contentInsets(current), scale);
			return Math.max(0, content.x + content.width - x);
		}
	}

	return Math.max(0, context.canvas.width - x);
}

export function boxStyle(
	context: ExtractContext,
	element: Element,
	opacity: number,
) {
	const style = context.styleOf(element);
	const color = clipsToText(style)
		? undefined
		: parseColor(style["background-color"]);
	const layers = splitTopLevel(style["background-image"], ",");
	const gradient =
		(!color || color.alpha === 0) && layers.length === 1 && !clipsToText(style)
			? parseLinearGradient(layers[0], opacity)
			: undefined;
	const fill: Fill | undefined =
		gradient && hasVisibleStop(gradient)
			? gradientFill(gradient)
			: color && color.alpha > MIN_VISIBLE_ALPHA
				? {
						color: color.hex,
						transparency: transparencyOf(color.alpha, opacity),
					}
				: undefined;
	const sides = SIDES.flatMap((side) => {
		const width = context.lengthOf(element, `border-${side}-width`);
		const borderColor =
			width > 0
				? parseColor(style[`border-${side}-color`], style.color)
				: undefined;
		return borderColor && borderColor.alpha > MIN_VISIBLE_ALPHA
			? [
					{
						fill: {
							color: borderColor.hex,
							transparency: transparencyOf(borderColor.alpha, opacity),
						},
						side,
						width,
					},
				]
			: [];
	});
	if (!fill && !sides.length) {
		return undefined;
	}

	const uniform =
		sides.length === SIDES.length &&
		sides.every(
			(side) =>
				side.width === sides[0].width &&
				side.fill.color === sides[0].fill.color &&
				side.fill.transparency === sides[0].fill.transparency,
		);
	return {
		border: uniform ? { ...sides[0].fill, width: sides[0].width } : undefined,
		edges: uniform || !sides.length ? undefined : sides,
		fill,
		radius: context.radiusOf(element),
	};
}

export const clipsToText = (style: ComputedStyle) =>
	(style["-webkit-background-clip"] ?? style["background-clip"]).includes(
		"text",
	);

/**
 * An element's own paint, in paint order: its background color, background images,
 * then borders; or undefined when PowerPoint can't draw its backgrounds.
 */
export function paintItems(
	context: ExtractContext,
	element: Element,
	opacity: number,
	geometry: Geometry,
) {
	const style = boxStyle(context, element, opacity);
	const backgrounds = style?.fill?.gradient
		? []
		: backgroundItems(context, element, opacity, geometry);
	if (!backgrounds) {
		return undefined;
	}

	const { box, rotation, scale } = geometry;
	const label = context.labelOf(element);
	const key = pathOf(element);
	const items: ItemInput[] = [];
	if (style?.fill || style?.border) {
		items.push({
			border: style.border && {
				...style.border,
				width: style.border.width * scale,
			},
			box,
			fill: style.fill,
			key: `${key}#box`,
			kind: "box",
			label,
			radius: style.radius * scale,
			rotation,
		});
	}

	items.push(...backgrounds);
	const { edges = [], radius = 0 } = style ?? {};
	for (const edge of edges) {
		items.push({
			...edgeBox(
				box,
				{ side: edge.side, width: edge.width * scale },
				radius * scale,
				rotation,
			),
			fill: edge.fill,
			key: `${key}#border-${edge.side}`,
			kind: "box",
			label: `${edge.side} border of ${label}`,
			radius: 0,
		});
	}

	return items;
}

/**
 * An element's CSS background images and gradients, in paint order (CSS lists the
 * top layer first), as images and boxes; or undefined when they don't draw natively:
 * a radial, conic, or repeating gradient, or an image that tiles.
 */
function backgroundItems(
	context: ExtractContext,
	element: Element,
	opacity: number,
	{ box: border, rotation, scale }: Geometry,
) {
	const style = context.styleOf(element);
	if (clipsToText(style)) {
		return [];
	}

	const layers = splitTopLevel(style["background-image"], ",");
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
	const key = pathOf(element);
	const label = `background of ${context.labelOf(element)}`;
	const resolve = (length: string, base: number) =>
		context.resolve(element, length, base);
	const items: ItemInput[] = [];
	for (const [index, layer] of [...layers.entries()].toReversed()) {
		const at = (list: string[]) => list[index % list.length] ?? "";
		const gradient = parseLinearGradient(layer, opacity);
		if (gradient) {
			if (hasVisibleStop(gradient)) {
				items.push({
					box: border,
					fill: gradientFill(gradient),
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
		if (!url) {
			continue;
		}

		const data = context.assets.get(url);
		const file = context.assets.save(url);
		if (!data || !file) {
			context.problems.push(`Couldn't load the background image ${url}.`);
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
		if (visible.width > 0 && visible.height > 0) {
			items.push({
				alt: "",
				box: visible,
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

function backgroundSize(
	value: string,
	area: Box,
	natural: Size,
	resolve: (length: string, base: number) => number,
) {
	const ratio = natural.width / natural.height;
	if (value === "cover" || value === "contain") {
		return fitSize(value, area, ratio);
	}

	const [widthPart = "auto", heightPart = "auto"] = splitTopLevel(value, " ");
	const length = (part: string, base: number) =>
		part === "auto" ? undefined : resolve(part, base);
	const width = length(widthPart, area.width);
	const height = length(heightPart, area.height);
	return {
		height: height ?? (width === undefined ? natural.height : width / ratio),
		width: width ?? (height === undefined ? natural.width : height * ratio),
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
		(x !== "no-repeat" && !covers(tile.x, tile.width, area.x, area.width)) ||
		(y !== "no-repeat" && !covers(tile.y, tile.height, area.y, area.height))
	);
}
