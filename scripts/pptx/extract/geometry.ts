import type { LaidOutBox } from "../layout.ts";
import type { Box } from "../model.ts";

import { splitTopLevel } from "../css.ts";

export interface Geometry {
	box: Box;
	rotation: number;
	scale: number;
}

/** How far each side's content sits inside a box, in px. */
export interface Insets {
	bottom: number;
	left: number;
	right: number;
	top: number;
}

export type Side = keyof Insets;

export type Size = Pick<Box, "h" | "w">;

/** How far along its free space each position keyword puts an image. */
const POSITION_KEYWORDS: Partial<Record<string, number>> = {
	bottom: 1,
	center: 0.5,
	left: 0,
	right: 1,
	top: 0,
};

/** Rotations smaller than this, in degrees, are rounding noise. */
const MIN_ROTATION = 0.05;

/**
 * One side's border as its own thin rectangle. Rounded corners shorten it by the radius
 * at each end, and a rotated element's edges turn with it about the element's center.
 */
export function edgeBox(
	box: Box,
	{ side, width }: { side: Side; width: number },
	radius: number,
	rotation: number,
) {
	const vertical = side === "left" || side === "right";
	const inset = Math.min(radius, (vertical ? box.h : box.w) / 2);
	const local: Box = vertical
		? {
				h: box.h - inset * 2,
				w: width,
				x: side === "right" ? box.x + box.w - width : box.x,
				y: box.y + inset,
			}
		: {
				h: width,
				w: box.w - inset * 2,
				x: box.x + inset,
				y: side === "bottom" ? box.y + box.h - width : box.y,
			};
	if (!rotation) {
		return { box: local, rotation: 0 };
	}

	const angle = (rotation * Math.PI) / 180;
	const dx = local.x + local.w / 2 - (box.x + box.w / 2);
	const dy = local.y + local.h / 2 - (box.y + box.h / 2);
	const centerX =
		box.x + box.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle);
	const centerY =
		box.y + box.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle);
	return {
		box: { ...local, x: centerX - local.w / 2, y: centerY - local.h / 2 },
		rotation,
	};
}

/** The size an image of `ratio` (width over height) draws at to contain or cover `area`. */
export function fitSize(fit: "contain" | "cover", area: Size, ratio: number) {
	return area.w / area.h > ratio === (fit === "contain")
		? { h: area.h, w: area.h * ratio }
		: { h: area.w / ratio, w: area.w };
}

/** The unrotated box, rotation (degrees), and scale of a node from takumi's absolute transform. */
export function geometryOf(laidOut: LaidOutBox) {
	const [a, b, c, d] = laidOut.matrix;
	const rotation = (Math.atan2(b, a) * 180) / Math.PI;
	const scale = scaleOf(laidOut);
	const w = laidOut.w * scale;
	const h = laidOut.h * Math.hypot(c, d);
	if (Math.abs(rotation) < MIN_ROTATION) {
		return { box: { h, w, x: laidOut.x, y: laidOut.y }, rotation: 0, scale };
	}

	const centerX = laidOut.x + a * (laidOut.w / 2) + c * (laidOut.h / 2);
	const centerY = laidOut.y + b * (laidOut.w / 2) + d * (laidOut.h / 2);
	return {
		box: { h, w, x: centerX - w / 2, y: centerY - h / 2 },
		rotation,
		scale,
	};
}

/** A box shrunk by insets in local px, scaled to slide px. */
export function insetBox(box: Box, insets: Insets, scale: number) {
	return {
		h: box.h - (insets.top + insets.bottom) * scale,
		w: box.w - (insets.left + insets.right) * scale,
		x: box.x + insets.left * scale,
		y: box.y + insets.top * scale,
	};
}

/** The overlap of two boxes. */
export function intersect(first: Box, second: Box) {
	const x = Math.max(first.x, second.x);
	const y = Math.max(first.y, second.y);
	return {
		h: Math.max(0, Math.min(first.y + first.h, second.y + second.h) - y),
		w: Math.max(0, Math.min(first.x + first.w, second.x + second.w) - x),
		x,
		y,
	};
}

/**
 * Where an image of `size` sits in `area`, by a CSS position (object-position or
 * background-position). `resolve` turns a length into px against the free space.
 */
export function positionIn(
	area: Box,
	size: Size,
	position: string,
	resolve: (length: string, free: number) => number,
) {
	const parts = splitTopLevel(position, " ");
	let horizontal = parts.find((part) => /^(?:left|right)$/.test(part));
	let vertical = parts.find((part) => /^(?:top|bottom)$/.test(part));
	const rest = parts.filter((part) => part !== horizontal && part !== vertical);
	horizontal ??= rest.shift() ?? "center";
	vertical ??= rest.shift() ?? "center";
	const offset = (value: string, free: number) => {
		const fraction = POSITION_KEYWORDS[value];
		return fraction === undefined ? resolve(value, free) : fraction * free;
	};

	return {
		h: size.h,
		w: size.w,
		x: area.x + offset(horizontal, area.w - size.w),
		y: area.y + offset(vertical, area.h - size.h),
	};
}

export const sameBox = (first: Box, second: Box) =>
	(["h", "w", "x", "y"] as const).every(
		(side) => Math.abs(first[side] - second[side]) < 0.01,
	);

/** The scale of a node's absolute transform. */
export const scaleOf = ({ matrix }: LaidOutBox) =>
	Math.hypot(matrix[0], matrix[1]);
