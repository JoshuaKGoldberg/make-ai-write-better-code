/**
 * The intermediate model between layout and PowerPoint writing: every slide's
 * click states, each a flat list of positioned, styled items in slide pixels
 * (CSS px on the deck's canvas).
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

/** A size in CSS px. */
export interface Canvas {
	height: number;
	width: number;
}

export interface CodeItem extends ItemBase {
	baselines: number[];
	box: Box;
	kind: "code";
	paragraphs: Paragraph[];
	style: TextStyle;
}

export interface Deck {
	/** The canvas slides lay out on, as Slidev renders them (its height rounded up to whole px). */
	canvas: Canvas;
	/** The PowerPoint slide, in canvas px: the canvas at the deck's exact aspect ratio. */
	page: Canvas;
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
	/** The visible frame. */
	box: Box;
	circle: boolean;
	/** Where the whole image is drawn, when the frame shows only part of it (object-fit: cover, background images). */
	crop?: Box;
	/** The image file. */
	file: string;
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
	/** The items' CSS list-style-type, like "disc", "decimal", or a quoted string. */
	marker: string;
	paragraphs: ListParagraph[];
	rotation: number;
	style: TextStyle;
}

export interface ListParagraph extends Paragraph {
	baselines: number[];
	bullet: boolean;
	key: string;
	/** The item's ordinal, for numbered markers. */
	number: number;
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
	/** The rendered element's text, for screen readers; empty when it's decoration. */
	alt: string;
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
	/** Starts a new line within its paragraph where the source forced one, as a line break does. */
	lineBreak?: boolean;
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
	/** Shown capitalized (CSS text-transform: uppercase); the text keeps its source casing. */
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
	/** The Slidev transition into the slide (from the slide before it), if any. */
	transition?: string;
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
	 * For wrapped text, how wide (px) its longest line is in the browser. PowerPoint measures
	 * text a little differently, so wrapping at this width keeps the browser's line breaks.
	 */
	wrapWidth?: number;
}
