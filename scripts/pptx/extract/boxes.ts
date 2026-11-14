import type { ComputedStyle } from "../cascade.ts";
import type { Fill } from "../model.ts";
import type { ExtractContext, ItemInput } from "./context.ts";
import type { Geometry, Side } from "./geometry.ts";

import {
	hasVisibleStop,
	MIN_VISIBLE_ALPHA,
	parseColor,
	parseLinearGradient,
	transparencyOf,
} from "../color.ts";
import { splitTopLevel } from "../css.ts";
import { edgeBox } from "./geometry.ts";
import { backgroundItems } from "./images.ts";

const SIDES: Side[] = ["top", "right", "bottom", "left"];

export function boxStyle(
	context: ExtractContext,
	element: Element,
	opacity: number,
) {
	const style = context.styleOf(element);
	const color = parseColor(style["background-color"]);
	const layers = splitTopLevel(style["background-image"], ",");
	const gradient =
		(!color || color.alpha === 0) && layers.length === 1 && !clipsToText(style)
			? parseLinearGradient(layers[0], opacity)
			: undefined;
	const fill: Fill | undefined =
		gradient && hasVisibleStop(gradient)
			? {
					color: gradient.stops[gradient.stops.length - 1].hex,
					gradient,
					transparency: 0,
				}
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

/** Whether an element's backgrounds paint only its text, as gradient text does. */
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
	const key = context.pathOf(element);
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
