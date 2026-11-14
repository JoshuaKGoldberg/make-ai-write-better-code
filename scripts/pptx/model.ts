/**
 * The intermediate model between layout and PowerPoint writing: every slide's
 * click states, each a flat list of positioned, styled items in slide pixels
 * (CSS px on the deck's canvas).
 */

export interface Box {
	height: number;
	width: number;
	x: number;
	y: number;
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
	/** The PowerPoint slide's width over its height: the deck's exact aspect ratio. */
	aspectRatio: number;
	author: string;
	background: Background;
	/** The canvas slides lay out on, as Slidev renders them (its height rounded up to whole px). */
	canvas: Canvas;
	slides: Slide[];
	title: string;
}

/** What extraction produces: model items, with elements still to be rendered as pictures. */
export type ExtractedItem = Exclude<Item, RasterItem> | RasterRequest;

export interface Fill {
	color: string;
	gradient?: Gradient;
	/** 0-100 */
	transparency: number;
}

export interface Gradient {
	/** CSS angle in degrees: 180 runs top to bottom. */
	angle: number;
	stops: GradientStop[];
}

export interface ImageItem extends ItemBase {
	alt: string;
	/** The visible frame. */
	box: Box;
	/** Where the whole image is drawn, when the frame shows only part of it (object-fit: cover, background images). */
	crop?: Box;
	/** The image file. */
	file: string;
	kind: "image";
	radius: number;
	src: string;
	/** 0-100 */
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

export interface ListItem extends ItemBase {
	box: Box;
	bulletColor?: string;
	kind: "list";
	/** Each list item's paragraphs, then its nested lists' paragraphs. */
	paragraphs: ListParagraph[];
	style: TextStyle;
}

export interface ListParagraph extends Paragraph {
	baselines: number[];
	/** Whether the paragraph shows its item's marker; later paragraphs of an item don't. */
	bullet: boolean;
	/** px from the list's text to the paragraph's text. */
	indent: number;
	/** How deeply the paragraph's list nests, 0 for the outermost. */
	level: number;
	/** The item's CSS list-style-type, like "disc", "decimal", or a quoted string. */
	marker: string;
	/** The item's ordinal, for numbered markers. */
	number: number;
	/** Whether the paragraph's list item shows, rather than being hidden in this click state, as before its v-click. */
	visible: boolean;
}

export interface Paragraph {
	runs: Run[];
}

export interface Point {
	x: number;
	y: number;
}

export interface Run {
	bold: boolean;
	color: string;
	font: string;
	gradient?: Gradient;
	/** The link target, for text inside a link. */
	href?: string;
	italic: boolean;
	/** px */
	letterSpacing: number;
	/** Starts a new line within its paragraph: "forced" where the source forced one, as a br element does, or "wrap" where the browser wrapped, which only boxes that can't wrap break at. */
	lineBreak?: "forced" | "wrap";
	/** Whether the run is a spacer standing in for padding, margins, or borders between runs. */
	pad: boolean;
	/** Raised or lowered, as superscript or subscript. */
	script?: "sub" | "super";
	shadow?: Shadow;
	/** px */
	size: number;
	/** Whether the text is struck through (CSS text-decoration-line: line-through). */
	strike: boolean;
	stroke?: Pick<Stroke, "color" | "width">;
	text: string;
	/** 0-100 */
	transparency: number;
	underline: boolean;
	/** Whether the text shows capitalized (CSS text-transform: uppercase); the text keeps its source casing. */
	upper: boolean;
}

export interface Shadow {
	/** px */
	blur: number;
	color: string;
	/** px */
	offsetX: number;
	/** px */
	offsetY: number;
	/** 0-100 */
	transparency: number;
}

export interface Slide {
	/** The speaker notes, as Markdown. */
	notes: string;
	/** The slide's 1-based number in the Slidev deck. */
	number: number;
	states: SlideState[];
	/** The Slidev transition into the slide (from the slide before it), if any. */
	transition?: string;
}

export interface Stroke {
	color: string;
	/** 0-100 */
	transparency: number;
	/** px */
	width: number;
}

export interface TextItem extends ItemBase {
	/** Line baselines in slide px; omitted for rotated text. */
	baselines?: number[];
	box: Box;
	/** Whether the text is a heading (h1-h6). */
	heading: boolean;
	kind: "text";
	paragraphs: Paragraph[];
	rotation: number;
	style: TextStyle;
}

export interface TextStyle {
	align: "center" | "justify" | "left" | "right";
	/** px from the item's box.x to the content right edge of its nearest block ancestor with a visible box (fill or border), else of the slide's layout (`.slidev-layout`), else the slide edge. */
	availableWidth: number;
	/** px */
	lineHeight: number;
	/** Whether the text can't wrap, as with white-space: nowrap or pre, so PowerPoint mustn't wrap it either. */
	nowrap: boolean;
	/** Whether the text runs right to left (CSS direction: rtl, or a dir="rtl" ancestor). */
	rtl: boolean;

	/**
	 * For wrapped text, how wide (px) its longest line is in the browser. PowerPoint measures
	 * text a little differently, so wrapping at this width keeps the browser's line breaks.
	 */
	wrapWidth?: number;
}

/** The slide background: the canvas and its static decoration, rendered. */
interface Background {
	/** Its average color. */
	color: string;
	/** The PNG file. */
	file: string;
}

interface BoxItem extends ItemBase {
	border?: Stroke;
	box: Box;
	fill?: Fill;
	kind: "box";
	radius: number;
	rotation: number;
}

interface EllipseItem extends ItemBase {
	border?: Stroke;
	box: Box;
	fill?: Fill;
	kind: "ellipse";
}

interface GradientStop {
	color: string;
	/** Position along the gradient, 0-100. */
	position: number;
	/** 0-100 */
	transparency: number;
}

interface ItemBase {
	/** Whether the item is decoration screen readers should skip: inside an aria-hidden subtree, or a shape with no text or alt. */
	decorative: boolean;
	/** Identity across click states: same key in (nearly) the same place is the same object. */
	key: string;
	/** What the item is part of, for its name in PowerPoint's Selection Pane when its own content doesn't say. */
	label?: string;
}

interface PolygonItem extends ItemBase {
	border?: Stroke;
	/** The points' bounds. */
	box: Box;
	fill?: Fill;
	kind: "polygon";
	/** Relative to the box's top left. */
	points: Point[];
}

interface RasterItem extends ItemBase {
	/** The rendered element's text, for screen readers; empty when it's decoration. */
	alt: string;
	box: Box;
	/** The rendered PNG. */
	file: string;
	kind: "raster";
}

/** An element to render as a picture, as extraction finds it. */
interface RasterRequest extends Omit<RasterItem, "file"> {
	/** Selects the element in its slide state's document. */
	selector: string;
}

interface SlideState {
	clicks: number;
	/** In paint order, from the bottom. */
	items: Item[];
}
