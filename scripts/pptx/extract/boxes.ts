import type { ComputedStyle } from "../cascade.ts";
import type { Box, Canvas, Fill, Shadow } from "../model.ts";
import type { ExtractContext, ItemInput } from "./context.ts";
import type { Geometry, Side } from "./geometry.ts";

import { cssUrls, imageSize } from "../assets.ts";
import {
	colorDistance,
	hasVisibleStop,
	isGradient,
	MIN_VISIBLE_ALPHA,
	parseColor,
	parseLinearGradient,
	parseShadows,
	transparencyOf,
} from "../color.ts";
import { splitTopLevel } from "../css.ts";
import { pathOf, showsShadow } from "./context.ts";
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

const TILE_COVERAGE_TOLERANCE = 0.5;

type BoxStyle = NonNullable<ReturnType<typeof boxStyle>>;

export function availableSpanOf(context: ExtractContext, element: Element) {
	const contentSpan = (current: Element) => {
		const laidOut = context.boxOf(current);
		if (!laidOut) {
			return undefined;
		}

		const { box, scale } = geometryOf(laidOut);
		const content = insetBox(box, context.contentInsets(current), scale);
		return { left: content.x, right: content.x + content.width };
	};

	for (
		let current: Element | null = element;
		current;
		current = current.parentElement
	) {
		const span =
			!context.isInline(current) && boxStyle(context, current, 1)
				? contentSpan(current)
				: undefined;
		if (span) {
			return span;
		}
	}

	const layoutRoot = element.closest(".slidev-layout");
	return (
		(layoutRoot && contentSpan(layoutRoot)) ?? {
			left: 0,
			right: context.canvas.width,
		}
	);
}

export function boxItems(
	style: BoxStyle,
	{
		backgrounds = [],
		box,
		key,
		label,
		rotation,
		scale,
		sides = SIDES,
	}: Geometry & {
		backgrounds?: ItemInput[];
		key: string;
		label: string;
		sides?: Side[];
	},
) {
	const radius = style.radius * scale;
	const border = style.border && {
		...style.border,
		width: style.border.width * scale,
	};
	const layered = backgrounds.length > 0;
	const shape = { box, kind: "box", label, radius, rotation } as const;
	const items: ItemInput[] = [];
	if (style.fill || (border && !layered)) {
		items.push({
			...shape,
			border: layered ? undefined : border,
			fill: style.fill,
			key: `${key}#box`,
			shadow:
				style.shadow && showsShadow(style.fill)
					? scaledShadow(style.shadow, scale)
					: undefined,
		});
	}

	items.push(...backgrounds);
	if (border && layered) {
		items.push({ ...shape, border, key: `${key}#border` });
	}

	for (const edge of style.edges ?? []) {
		if (sides.includes(edge.side)) {
			items.push({
				...edgeBox(
					box,
					{ side: edge.side, width: edge.width * scale },
					radius,
					rotation,
				),
				fill: edge.fill,
				key: `${key}#border-${edge.side}`,
				kind: "box",
				label: `${edge.side} border of ${label}`,
				radius: 0,
			});
		}
	}

	return items;
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
			? parseLinearGradient(
					layers[0],
					opacity,
					paintedSizeOf(context, element),
					style.color,
				)
			: undefined;
	const fill: Fill | undefined =
		gradient && hasVisibleStop(gradient)
			? { gradient }
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
		shadow: boxShadowOf(context, element, opacity),
	};
}

/** An element's most visible outer box-shadow layer, faded by an opacity: the one whose color stands out most from the slide's background for its alpha, then the one reaching farthest. */
export function boxShadowOf(
	context: ExtractContext,
	element: Element,
	opacity: number,
) {
	const visibilityOf = ({ color, transparency }: Shadow) =>
		(1 - transparency / 100) * colorDistance(color, context.backdrop);
	const reachOf = ({ blur, offsetX, offsetY }: Shadow) =>
		blur + Math.hypot(offsetX, offsetY);
	const shadow = shadowLayersOf(context, element)
		.flatMap(({ shadow }) =>
			shadow.blur || shadow.offsetX || shadow.offsetY ? [shadow] : [],
		)
		.toSorted(
			(first, second) =>
				visibilityOf(second) - visibilityOf(first) ||
				reachOf(second) - reachOf(first),
		)
		.at(0);
	return shadow && fadedShadow(shadow, opacity);
}

export const scaledShadow = (shadow: Shadow, scale: number) => ({
	...shadow,
	blur: shadow.blur * scale,
	offsetX: shadow.offsetX * scale,
	offsetY: shadow.offsetY * scale,
});

const fadedShadow = (shadow: Shadow, opacity: number) => ({
	...shadow,
	transparency: transparencyOf(1 - shadow.transparency / 100, opacity),
});

const shadowLayersOf = (context: ExtractContext, element: Element) => {
	const style = context.styleOf(element);
	return parseShadows(
		style["box-shadow"] ?? "none",
		(length) => context.resolve(element, length),
		style.color,
	);
};

export const clipsToText = (style: ComputedStyle) =>
	(style["-webkit-background-clip"] ?? style["background-clip"]).includes(
		"text",
	);

export const paintedSizeOf = (context: ExtractContext, element: Element) =>
	context.boxAt(element) ?? context.canvas;

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
	const backgrounds =
		style?.fill && "gradient" in style.fill
			? []
			: backgroundItems(context, element, opacity, geometry);
	if (!backgrounds) {
		return undefined;
	}

	const shadow = showsShadow(style?.fill)
		? undefined
		: boxShadowOf(context, element, opacity);
	if (shadow) {
		context.clipShadows.set(element, scaledShadow(shadow, geometry.scale));
	}

	return [
		...ringItems(context, element, opacity, geometry),
		...(style
			? boxItems(style, {
					...geometry,
					backgrounds,
					key: pathOf(element),
					label: context.labelOf(element),
				})
			: backgrounds),
	];
}

/** An element's spread-only box-shadow layers, as Tailwind's ring utilities draw, as outlines around its border box, bottom first. */
function ringItems(
	context: ExtractContext,
	element: Element,
	opacity: number,
	{ box, rotation, scale }: Geometry,
) {
	const radius = context.radiusOf(element) * scale;
	return shadowLayersOf(context, element)
		.filter(
			({ shadow, spread }) =>
				spread > 0 && !shadow.blur && !shadow.offsetX && !shadow.offsetY,
		)
		.toReversed()
		.map(({ shadow, spread }, index): ItemInput => {
			const width = spread * scale;
			const { color, transparency } = fadedShadow(shadow, opacity);
			return {
				border: { color, transparency, width },
				box: {
					height: box.height + width,
					width: box.width + width,
					x: box.x - width / 2,
					y: box.y - width / 2,
				},
				key: `${pathOf(element)}#ring-${String(index)}`,
				kind: "box",
				label: `ring of ${context.labelOf(element)}`,
				radius: radius && radius + width / 2,
				rotation,
			};
		});
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
	const size = paintedSizeOf(context, element);
	if (
		layers.some(
			(layer) =>
				isGradient(layer) &&
				!parseLinearGradient(layer, opacity, size, style.color),
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
		const gradient = parseLinearGradient(layer, opacity, size, style.color);
		if (gradient) {
			if (hasVisibleStop(gradient)) {
				items.push({
					box: border,
					fill: { gradient },
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
	natural: Canvas,
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
		start <= areaStart + TILE_COVERAGE_TOLERANCE &&
		start + size >= areaStart + areaSize - TILE_COVERAGE_TOLERANCE;
	return (
		(x !== "no-repeat" && !covers(tile.x, tile.width, area.x, area.width)) ||
		(y !== "no-repeat" && !covers(tile.y, tile.height, area.y, area.height))
	);
}
