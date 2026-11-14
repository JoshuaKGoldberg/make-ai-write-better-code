import type { Color } from "../color.ts";
import type { Canvas, Fill, Gradient, Point, TextStyle } from "../model.ts";
import type { ExtractContext } from "./context.ts";

import { MIN_VISIBLE_ALPHA, parseColor, transparencyOf } from "../color.ts";
import { availableSpanOf } from "./boxes.ts";
import { MIN_OPACITY, pathOf } from "./context.ts";
import { geometryOf } from "./geometry.ts";
import { rasterItem } from "./images.ts";
import { isRightToLeft, runStyle } from "./runs.ts";

interface DrawnShape {
	box: Canvas;
	scale: number;
	shape: Element;
	svg: Element;
}

type Paint = Color & { gradient?: Gradient };

/** Elements drawn as native shapes and text; an SVG with any other element renders as a picture. */
const NATIVE_ELEMENTS = new Set([
	"circle",
	"defs",
	"desc",
	"ellipse",
	"g",
	"lineargradient",
	"polygon",
	"stop",
	"text",
	"title",
	"tspan",
]);

const POSITIONING_ATTRIBUTES = ["dx", "dy", "x", "y"];

/** SVG text sizes guessed from its font size, as its box isn't laid out. */
const SVG_TEXT = {
	ascent: 0.9,
	characterWidth: 0.7,
	lineHeight: 1.2,
	minWidth: 40,
};

const ANCHORS: Partial<Record<string, TextStyle["align"]>> = {
	end: "right",
	middle: "center",
	start: "left",
};

export function svgItems(context: ExtractContext, svg: Element) {
	const laidOut = context.boxOf(svg);
	if (!laidOut) {
		return;
	}

	const shapes = [...svg.querySelectorAll("*")];
	const { box, rotation } = geometryOf(laidOut);
	if (rotation || !shapes.every((shape) => isNative(context, shape))) {
		rasterItem(context, svg);
		return;
	}

	const [viewX, viewY, viewWidth, viewHeight] = (
		svg.getAttribute("viewBox") ??
		`0 0 ${String(laidOut.width)} ${String(laidOut.height)}`
	)
		.split(/[\s,]+/)
		.map(Number);
	const scale = Math.min(box.width / viewWidth, box.height / viewHeight);
	const originX = box.x + (box.width - viewWidth * scale) / 2 - viewX * scale;
	const originY = box.y + (box.height - viewHeight * scale) / 2 - viewY * scale;
	const toSlide = (x: number, y: number): Point => ({
		x: originX + x * scale,
		y: originY + y * scale,
	});
	const numberOf = (shape: Element, attribute: string) =>
		Number(shape.getAttribute(attribute) ?? 0);

	for (const shape of shapes) {
		const opacity = context.opacityOf(shape);
		if (opacity < MIN_OPACITY || shape.closest("defs")) {
			continue;
		}

		switch (shape.localName) {
			case "circle":
			case "ellipse": {
				const center = toSlide(numberOf(shape, "cx"), numberOf(shape, "cy"));
				const radiusX =
					numberOf(shape, shape.localName === "circle" ? "r" : "rx") * scale;
				const radiusY =
					numberOf(shape, shape.localName === "circle" ? "r" : "ry") * scale;
				const box = {
					height: radiusY * 2,
					width: radiusX * 2,
					x: center.x - radiusX,
					y: center.y - radiusY,
				};
				context.push(shape, {
					...shapePaint(context, { box, scale, shape, svg }, opacity),
					box,
					key: `${pathOf(shape)}#${shape.localName}`,
					kind: "ellipse",
					label: shapeLabelOf(context, shape),
				});
				break;
			}

			case "polygon": {
				const numbers = (shape.getAttribute("points") ?? "")
					.trim()
					.split(/[\s,]+/)
					.map(Number);
				const points: Point[] = [];
				for (let index = 0; index + 1 < numbers.length; index += 2) {
					points.push(toSlide(numbers[index], numbers[index + 1]));
				}

				const xs = points.map((point) => point.x);
				const ys = points.map((point) => point.y);
				const x = Math.min(...xs);
				const y = Math.min(...ys);
				const box = {
					height: Math.max(...ys) - y,
					width: Math.max(...xs) - x,
					x,
					y,
				};
				context.push(shape, {
					...shapePaint(context, { box, scale, shape, svg }, opacity),
					box,
					key: `${pathOf(shape)}#polygon`,
					kind: "polygon",
					label: shapeLabelOf(context, shape),
					points: points.map((point) => ({ x: point.x - x, y: point.y - y })),
				});
				break;
			}

			case "text": {
				const style = context.styleOf(shape);
				const size = parseFloat(style["font-size"]) * scale;
				const text = shape.textContent.trim();
				const align = ANCHORS[style["text-anchor"]] ?? "left";
				const at = toSlide(numberOf(shape, "x"), numberOf(shape, "y"));
				const run = runStyle(context, shape, opacity);
				const { ascent, descent } = context.fonts.metrics(run.font);
				const baseline = /central|middle/.test(style["dominant-baseline"] ?? "")
					? at.y + size * (ascent - (ascent + descent) / 2)
					: at.y;
				const width = Math.max(
					SVG_TEXT.minWidth,
					text.length * size * SVG_TEXT.characterWidth,
				);
				const x =
					align === "center"
						? at.x - width / 2
						: align === "right"
							? at.x - width
							: at.x;
				const box = {
					height: size * SVG_TEXT.lineHeight,
					width,
					x,
					y: baseline - size * SVG_TEXT.ascent,
				};
				const fill = paintOf(context, { box, shape, svg }, "fill");
				if (!fill) {
					break;
				}

				context.push(shape, {
					baselines: [baseline],
					box,
					heading: false,
					key: `${pathOf(shape)}#svgtext:${text}`,
					kind: "text",
					paragraphs: [
						{
							runs: [
								{
									...run,
									color: fill.hex,
									size,
									text,
									transparency: transparencyOf(fill.alpha, opacity),
								},
							],
						},
					],
					rotation: 0,
					style: {
						align,
						available: availableSpanOf(context, shape),
						lineHeight: size * SVG_TEXT.lineHeight,
						nowrap: true,
						rtl: isRightToLeft(context, shape),
					},
				});
				break;
			}
		}
	}
}

/** Whether an SVG element draws natively: an allowed element, untransformed, and (for a tspan) not positioned on its own. */
function isNative(context: ExtractContext, element: Element) {
	return (
		NATIVE_ELEMENTS.has(element.localName) &&
		!element.hasAttribute("transform") &&
		context.styleOf(element).transform === "none" &&
		!(
			element.localName === "tspan" &&
			POSITIONING_ATTRIBUTES.some((attribute) =>
				element.hasAttribute(attribute),
			)
		)
	);
}

function paintOf(
	context: ExtractContext,
	{ box, shape, svg }: Omit<DrawnShape, "scale">,
	property: "fill" | "stroke",
): Paint | undefined {
	const style = context.styleOf(shape);
	const value = style[property];
	const id = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/.exec(value)?.[1];
	if (id) {
		return svgGradient(context, svg, id, box);
	}

	return value === "none" ? undefined : parseColor(value, style.color);
}

function shapeLabelOf(context: ExtractContext, shape: Element) {
	return (
		[
			[...shape.classList].at(0),
			shape.closest("[aria-label]")?.getAttribute("aria-label")?.trim(),
		].find(Boolean) ?? context.labelOf(shape)
	);
}

function shapePaint(
	context: ExtractContext,
	drawn: DrawnShape,
	opacity: number,
) {
	const fill = paintOf(context, drawn, "fill");
	const stroke = paintOf(context, drawn, "stroke");
	return {
		border:
			stroke && stroke.alpha > MIN_VISIBLE_ALPHA
				? {
						color: stroke.hex,
						transparency: transparencyOf(stroke.alpha, opacity),
						width:
							context.resolve(
								drawn.shape,
								context.styleOf(drawn.shape)["stroke-width"] ?? "1",
							) * drawn.scale,
					}
				: undefined,
		fill:
			fill &&
			((fill.gradient
				? {
						gradient: {
							...fill.gradient,
							stops: fill.gradient.stops.map((stop) => ({
								...stop,
								transparency: 100 - (100 - stop.transparency) * opacity,
							})),
						},
					}
				: {
						color: fill.hex,
						transparency: transparencyOf(fill.alpha, opacity),
					}) satisfies Fill),
	};
}

/** A gradient an SVG shape references, averaged to a color for consumers without gradients. */
function svgGradient(
	context: ExtractContext,
	svg: Element,
	id: string,
	{ height, width }: Canvas,
) {
	const gradient = svg.querySelector(`[id="${id}"]`);
	if (!gradient) {
		return undefined;
	}

	const stops = [...gradient.querySelectorAll("stop")].flatMap((stop) => {
		const style = context.styleOf(stop);
		const color = parseColor(style["stop-color"] ?? "black", style.color);
		if (!color) {
			return [];
		}

		const offset = stop.getAttribute("offset") ?? "0";
		return {
			color: color.hex,
			position: parseFloat(offset) * (offset.includes("%") ? 1 : 100),
			transparency: transparencyOf(
				color.alpha,
				Number(style["stop-opacity"] ?? 1),
			),
		};
	});
	if (!stops.length) {
		return undefined;
	}

	const coordinate = (attribute: string, fallback: number) => {
		const value = gradient.getAttribute(attribute)?.trim();
		const parsed = value
			? parseFloat(value) / (value.endsWith("%") ? 100 : 1)
			: fallback;
		return Number.isFinite(parsed) ? parsed : fallback;
	};

	const [unitWidth, unitHeight] =
		gradient.getAttribute("gradientUnits") === "userSpaceOnUse"
			? [1, 1]
			: [width, height];
	const angle =
		(Math.atan2(
			(coordinate("y2", 0) - coordinate("y1", 0)) * unitWidth,
			(coordinate("x2", 1) - coordinate("x1", 0)) * unitHeight,
		) *
			180) /
			Math.PI +
		90;
	const average = (index: number) =>
		Math.round(
			stops.reduce(
				(sum, stop) => sum + parseInt(stop.color.slice(index, index + 2), 16),
				0,
			) / stops.length,
		);
	return {
		alpha:
			1 -
			stops.reduce((sum, stop) => sum + stop.transparency, 0) /
				stops.length /
				100,
		gradient: { angle, stops },
		hex: [0, 2, 4]
			.map((index) =>
				average(index).toString(16).toUpperCase().padStart(2, "0"),
			)
			.join(""),
	};
}
