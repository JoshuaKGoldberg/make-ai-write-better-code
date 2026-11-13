/**
 * The intermediate model between layout and PowerPoint writing: every slide's
 * click states, each a flat list of positioned, styled items in slide pixels
 * (a 980x552 canvas).
 */

export interface Box {
	h: number;
	w: number;
	x: number;
	y: number;
}

export interface BoxItem extends ItemBase {
	border?: Stroke;
	box: Box;
	fill?: Fill;
	kind: "box";
	radius: number;
	rotation: number;
}

export interface CodeItem extends ItemBase {
	baselines: number[];
	box: Box;
	kind: "code";
	paragraphs: Paragraph[];
	style: TextStyle;
}

export interface Deck {
	slides: Record<number, Slide>;
	total: number;
}

export interface EllipseItem extends ItemBase {
	box: Box;
	fill?: Fill;
	kind: "ellipse";
}

export interface Fill {
	color: string;
	gradient?: Gradient;
	transparency: number;
}

export interface Gradient {
	/** CSS angle in degrees: 180 runs top to bottom. */
	angle: number;
	stops: GradientStop[];
}

export interface GradientStop {
	/** Alpha, 0-1. */
	a?: number;
	hex: string;
	/** Position along the gradient, 0-100. */
	pos: number;
}

export interface ImageItem extends ItemBase {
	alt: string;
	box: Box;
	circle: boolean;
	kind: "image";
	radius: number;
	src: string;
	transparency: number;
}

export type Item =
	| BoxItem
	| CodeItem
	| EllipseItem
	| ImageItem
	| ListItem
	| PolygonItem
	| RasterItem
	| TextItem;

export interface ItemBase {
	/** Identity across click states: same key in (nearly) the same place is the same object. */
	key: string;
	/** What the item is part of, for its name in PowerPoint's Selection Pane when its own content doesn't say. */
	label?: string;
	/** Paint order within a state. */
	order: number;
}

export interface ListItem extends ItemBase {
	box: Box;
	bulletColor?: string;
	indent: number;
	kind: "list";
	paragraphs: ListParagraph[];
	rotation: number;
	style: TextStyle;
}

export interface ListParagraph extends Paragraph {
	baselines: number[];
	bullet: boolean;
	key: string;
	visible: boolean;
}

export interface Paragraph {
	runs: Run[];
}

export interface Point {
	x: number;
	y: number;
}

export interface PolygonItem extends ItemBase {
	border?: Stroke;
	fill?: Fill;
	kind: "polygon";
	points: Point[];
}

export interface RasterItem extends ItemBase {
	box: Box;
	/** The rendered PNG, set once the raster is rendered. */
	file?: string;
	kind: "raster";
	rasterId: string;
	reason: string;
}

export interface Run {
	bold: boolean;
	color: string;
	font: string;
	gradient?: Gradient;
	italic: boolean;
	/** The link target, for text inside a link. */
	href?: string;
	/** px */
	letterSpacing: number;
	/** A spacer run standing in for padding, margins, or borders between runs. */
	pad?: boolean;
	shadow?: Shadow;
	/** px */
	size: number;
	/** Starts a new line within its paragraph, where the browser wrapped; only boxes that can't wrap break there. */
	softBreak?: boolean;
	stroke?: { color: string; width: number };
	superscript: boolean;
	text: string;
	/** 0-100 */
	transparency: number;
	underline: boolean;
	upper: boolean;
}

export interface Shadow {
	blur: number;
	color: string;
	dx: number;
	dy: number;
	opacity: number;
}

export interface Slide {
	clicksTotal: number;
	no: number;
	states: SlideState[];
}

export interface SlideState {
	clicks: number;
	items: Item[];
}

export interface Stroke {
	color: string;
	transparency: number;
	width: number;
}

export interface TextItem extends ItemBase {
	/** Line baselines in slide px; omitted for rotated text. */
	baselines?: number[];
	box: Box;
	kind: "text";
	paragraphs: Paragraph[];
	rotation: number;
	style: TextStyle;
}

export interface TextStyle {
	align: "center" | "justify" | "left" | "right";
	/** px */
	lineHeight: number;
	nowrap: boolean;

	/**
	 * Where the browser's longest wrapped line ends, in slide px, for wrapped text. PowerPoint
	 * measures text a little differently, so wrapping there keeps the browser's line breaks.
	 */
	wrapRight?: number;
}

/** The slide canvas Slidev renders at, in CSS px. */
export const SLIDE = { height: 552, width: 980 };
