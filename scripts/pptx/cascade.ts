/**
 * A small static CSS cascade. It resolves the computed values PowerPoint export
 * needs (colors, fonts, spacing, borders, transforms, ...) for every element of
 * a parsed document, without a browser: selector matching, specificity, cascade
 * order, !important, inheritance, custom properties, and length units.
 */
import * as csstree from "css-tree";

import type { Declaration } from "./css.ts";

import { declarationsOf, parseDeclarations, splitTopLevel } from "./css.ts";

export interface CascadeOptions {
	/** Which `prefers-color-scheme` media queries match. */
	colorScheme: "dark" | "light";
	viewport: Viewport;
}

export interface CascadeRule {
	declarations: Declaration[];
	/** The rule's cascade layer's precedence: higher wins for normal declarations, lower for !important. */
	layer: number;
	order: number;
	/** The pseudo-element the rule styles, if any. */
	pseudo?: Pseudo;
	selector: string;
	specificity: number;
}

/** A ::before or ::after pseudo-element with generated content. */
interface PseudoElement {
	/** Its declarations (variables resolved), in cascade order, as an inline style. */
	css: string;
	style: ComputedStyle;
	text: string;
}

/** Values by property name, any of which may be missing. */
export type StyleMap = Partial<Record<string, string>>;

/** Computed values: properties with initial values are always present; others may be missing. */
export type ComputedStyle = Record<KnownProperty, string> & StyleMap;

export interface ComputedStyles {
	/** Each list item's ::marker style. */
	markers: Map<Element, ComputedStyle>;
	/** Elements' ::before and ::after pseudo-elements that generate content. */
	pseudos: Map<Element, Partial<Record<"after" | "before", PseudoElement>>>;
	styles: Map<Element, ComputedStyle>;
}

/** What lengths resolve against, in px. */
export interface LengthContext {
	/** The font size `em` resolves against. */
	fontSize: number;
	/** The size percentages resolve against. */
	percentBase?: number;
	/** The root element's font size, which `rem` resolves against. */
	rootFontSize: number;
	viewport: Viewport;
}

/** The viewport lengths resolve against: the slide canvas, as Slidev exports it. */
export interface Viewport {
	height: number;
	width: number;
}

type KnownProperty = keyof typeof INITIAL;

type Pseudo = "after" | "before" | "marker";

const INHERITED = new Set([
	"-webkit-text-fill-color",
	"-webkit-text-stroke-color",
	"-webkit-text-stroke-width",
	"color",
	"dominant-baseline",
	"fill",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"letter-spacing",
	"line-height",
	"list-style-type",
	"stroke",
	"stroke-width",
	"text-align",
	"text-anchor",
	"text-shadow",
	"text-transform",
	"visibility",
	"white-space",
]);

const INITIAL = {
	"-webkit-text-stroke-width": "0px",
	"background-clip": "border-box",
	"background-color": "transparent",
	"background-image": "none",
	"background-position": "0% 0%",
	"background-repeat": "repeat",
	"background-size": "auto",
	"border-bottom-color": "currentcolor",
	"border-bottom-style": "none",
	"border-bottom-width": "0px",
	"border-left-color": "currentcolor",
	"border-left-style": "none",
	"border-left-width": "0px",
	"border-right-color": "currentcolor",
	"border-right-style": "none",
	"border-right-width": "0px",
	"border-top-color": "currentcolor",
	"border-top-left-radius": "0px",
	"border-top-style": "none",
	"border-top-width": "0px",
	color: "#000000",
	display: "inline",
	fill: "black",
	filter: "none",
	"font-family": "serif",
	"font-size": "16px",
	"font-style": "normal",
	"font-weight": "400",
	"letter-spacing": "normal",
	"line-height": "normal",
	"list-style-type": "disc",
	"margin-bottom": "0px",
	"margin-left": "0px",
	"margin-right": "0px",
	"margin-top": "0px",
	"object-fit": "fill",
	"object-position": "50% 50%",
	opacity: "1",
	"padding-bottom": "0px",
	"padding-left": "0px",
	"padding-right": "0px",
	"padding-top": "0px",
	stroke: "none",
	"text-align": "start",
	"text-anchor": "start",
	"text-decoration-line": "none",
	"text-shadow": "none",
	"text-transform": "none",
	transform: "none",
	"vertical-align": "baseline",
	visibility: "visible",
	"white-space": "normal",
	zoom: "1",
} as const satisfies Record<string, string>;

const INITIAL_VALUES: StyleMap = INITIAL;

const BORDER_WIDTHS: StyleMap = { medium: "3px", thick: "5px", thin: "1px" };

/** Lengths normalized to px once an element's font size is known. */
const LENGTHS = [
	"-webkit-text-stroke-width",
	"border-bottom-width",
	"border-left-width",
	"border-right-width",
	"border-top-left-radius",
	"border-top-width",
	"margin-bottom",
	"margin-left",
	"margin-right",
	"margin-top",
	"padding-bottom",
	"padding-left",
	"padding-right",
	"padding-top",
] as const satisfies readonly KnownProperty[];

/** User-agent defaults for the elements decks commonly use. */
const USER_AGENT_CSS = `
html, body, div, p, h1, h2, h3, h4, h5, h6, ul, ol, li, pre, section, header, footer, main, nav, article, blockquote, figure, table { display: block }
li { display: list-item }
head, script, style, template, title, meta, link { display: none }
h1 { font-size: 2em; font-weight: bold }
h2 { font-size: 1.5em; font-weight: bold }
h3 { font-size: 1.17em; font-weight: bold }
strong, b { font-weight: bolder }
em, i { font-style: italic }
code, pre, kbd, samp { font-family: monospace }
pre { white-space: pre }
sup { vertical-align: super; font-size: smaller }
sub { vertical-align: sub; font-size: smaller }
a { text-decoration-line: underline }
ul { list-style-type: disc }
ol { list-style-type: decimal }
img, svg, video, canvas { display: inline-block }
`;

const BORDER_STYLES = new Set([
	"dashed",
	"dotted",
	"double",
	"groove",
	"hidden",
	"inset",
	"none",
	"outset",
	"ridge",
	"solid",
]);
const CSS_WIDE_KEYWORDS = new Set([
	"initial",
	"revert",
	"revert-layer",
	"unset",
]);
const KEYWORD_SIZES: Partial<Record<string, number>> = {
	large: 18,
	medium: 16,
	small: 13,
	"x-large": 24,
	"x-small": 10,
	"xx-large": 32,
};
const RELATIVE_SIZES: Partial<Record<string, number>> = {
	larger: 1.2,
	smaller: 0.833,
};
const NORMAL_LINE_HEIGHT = 1.2;
const SIDES = ["top", "right", "bottom", "left"] as const;
const UNITLESS = /^[\d.]+$/;

/** Elements that can't have ::before or ::after content. */
const REPLACED = new Set([
	"br",
	"canvas",
	"hr",
	"iframe",
	"img",
	"input",
	"select",
	"textarea",
	"video",
]);

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** SVG attributes that set the CSS property of the same name, below every author rule. */
const PRESENTATION_ATTRIBUTES = [
	"display",
	"dominant-baseline",
	"fill",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"opacity",
	"stop-color",
	"stop-opacity",
	"stroke",
	"stroke-width",
	"text-anchor",
	"visibility",
];

const LEGACY_PSEUDO_ELEMENTS = new Set([
	"after",
	"before",
	"first-letter",
	"first-line",
]);

const CONDITIONAL_RULES = new Set(["container", "media", "supports"]);
const SCREEN_MEDIA_TYPES = new Set(["all", "screen"]);

const COMPARISONS: Record<string, (left: number, right: number) => boolean> = {
	"<": (left, right) => left < right,
	"<=": (left, right) => left <= right,
	"=": (left, right) => left === right,
	">": (left, right) => left > right,
	">=": (left, right) => left >= right,
};

const ID_WEIGHT = 1e6;
const CLASS_WEIGHT = 1e3;
const TYPE_WEIGHT = 1;

const ABSOLUTE_UNITS: Partial<Record<string, number>> = {
	"": 1,
	cm: 96 / 2.54,
	in: 96,
	mm: 96 / 25.4,
	pc: 16,
	pt: 96 / 72,
	px: 1,
	q: 96 / 101.6,
};
const FONT_UNITS: Partial<Record<string, number>> = {
	cap: 0.7,
	ch: 0.6,
	em: 1,
	ex: 0.5,
};
const VIEWPORT_UNITS: Record<string, (viewport: Viewport) => number> = {
	vb: ({ height }) => height,
	vh: ({ height }) => height,
	vi: ({ width }) => width,
	vmax: ({ height, width }) => Math.max(width, height),
	vmin: ({ height, width }) => Math.min(width, height),
	vw: ({ width }) => width,
};

const LENGTH_SOURCE = String.raw`(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(rem|em|ex|ch|cap|px|pt|pc|in|cm|mm|q|%|[sld]?v(?:min|max|[whib]))?`;
const LENGTH = new RegExp(`^${LENGTH_SOURCE}$`, "i");
const LENGTHS_IN_TEXT = new RegExp(LENGTH_SOURCE, "gi");
const MATH_FUNCTION = /^(?:calc|min|max|clamp)\(/;
const VAR = /var\(\s*(--[\w-]+)\s*(?:,((?:[^()]|\([^()]*\))*))?\)/g;

const isPseudo = (value: string): value is Pseudo =>
	value === "after" || value === "before" || value === "marker";

const isLength = (value: string) =>
	LENGTH.test(value) || MATH_FUNCTION.test(value);

const isPseudoElement = (
	node: csstree.CssNode,
): node is csstree.PseudoClassSelector | csstree.PseudoElementSelector =>
	node.type === "PseudoElementSelector" ||
	(node.type === "PseudoClassSelector" &&
		LEGACY_PSEUDO_ELEMENTS.has(node.name));

const pixels = (value: number) => `${String(value)}px`;

/** The computed style of an element no rule applies to. */
export const INITIAL_STYLE: ComputedStyle = INITIAL;

/** Parses stylesheets (after the user-agent defaults) into an ordered rule list. */
export function createCascade(sheets: string[], environment: CascadeOptions) {
	const rules: (Omit<CascadeRule, "layer"> & { layerName: string })[] = [];
	let order = 0;
	const layers: string[] = [];
	let anonymous = 0;
	const declareLayer = (name: string) => {
		const parts = name.split(".");
		for (let index = 1; index <= parts.length; index++) {
			const prefix = parts.slice(0, index).join(".");
			if (!layers.includes(prefix)) {
				layers.push(prefix);
			}
		}
	};

	const visitRule = (rule: csstree.Rule, layerName: string, scope?: string) => {
		const declarations = declarationsOf(rule.block.children);
		if (!declarations.length || rule.prelude.type !== "SelectorList") {
			return;
		}

		rule.prelude.children.forEach((selector) => {
			if (selector.type !== "Selector") {
				return;
			}

			const nodes = selector.children.toArray();
			const pseudoElement = nodes.find(isPseudoElement);
			const pseudo = pseudoElement?.name;
			if (pseudo !== undefined && !isPseudo(pseudo)) {
				return;
			}

			const base =
				nodes
					.filter((node) => node !== pseudoElement)
					.map((node) => csstree.generate(node))
					.join("")
					.trim() || "*";
			rules.push({
				declarations,
				layerName,
				order: order++,
				pseudo,
				selector: scope ? scoped(base, scope) : base,
				specificity: specificity(selector),
			});
		});
	};

	const visitBlock = (
		children: csstree.List<csstree.CssNode>,
		layerName: string,
		scope?: string,
	) => {
		children.forEach((node) => {
			if (node.type === "Rule") {
				visitRule(node, layerName, scope);
				return;
			}

			if (node.type !== "Atrule") {
				return;
			}

			const name = node.name.toLowerCase();
			if (name === "layer") {
				const names = splitTopLevel(
					node.prelude ? csstree.generate(node.prelude) : "",
					",",
				).map((part) => (layerName ? `${layerName}.${part}` : part));
				if (!node.block) {
					names.forEach(declareLayer);
					return;
				}

				const nested =
					names[0] ??
					`${layerName ? `${layerName}.` : ""}<anonymous ${String(anonymous++)}>`;
				declareLayer(nested);
				visitBlock(node.block.children, nested, scope);
				return;
			}

			if (
				!node.block ||
				(name === "media" && !mediaMatches(node.prelude, environment))
			) {
				return;
			}

			if (name === "scope") {
				visitBlock(
					node.block.children,
					layerName,
					scopeRoot(node.prelude) ?? scope,
				);
			} else if (CONDITIONAL_RULES.has(name)) {
				visitBlock(node.block.children, layerName, scope);
			}
		});
	};

	for (const sheet of [USER_AGENT_CSS, ...sheets]) {
		const ast = csstree.parse(sheet, {
			parseCustomProperty: false,
			parseValue: false,
		});
		if (ast.type === "StyleSheet") {
			visitBlock(ast.children, "");
		}
	}

	const ranked = layers.toSorted((first, second) => {
		const firstParts = first.split(".");
		const secondParts = second.split(".");
		for (
			let index = 0;
			index < Math.min(firstParts.length, secondParts.length);
			index++
		) {
			if (firstParts[index] !== secondParts[index]) {
				return (
					layers.indexOf(firstParts.slice(0, index + 1).join(".")) -
					layers.indexOf(secondParts.slice(0, index + 1).join("."))
				);
			}
		}

		return secondParts.length - firstParts.length;
	});
	return rules.map(({ layerName, ...rule }) => ({
		...rule,
		layer: layerName ? ranked.indexOf(layerName) : ranked.length,
	}));
}

/** Computes styles for every element of `document`. */
export function computeStyles(
	document: Document,
	rules: CascadeRule[],
	{ viewport }: { viewport: Viewport },
) {
	const styles = new Map<Element, ComputedStyle>();
	const markers = new Map<Element, ComputedStyle>();
	const pseudos: ComputedStyles["pseudos"] = new Map();
	const supported = rules.filter((rule) =>
		isSupported(document, rule.selector),
	);
	const rulesFor = (pseudo: Pseudo | undefined) =>
		supported.filter((rule) => rule.pseudo === pseudo);
	const elementRules = rulesFor(undefined);
	const pseudoRules = {
		after: rulesFor("after"),
		before: rulesFor("before"),
		marker: rulesFor("marker"),
	};
	let rootFontSize = 16;
	const length = (value: string, fontSize: number, percentBase = 0) =>
		resolveLength(value, { fontSize, percentBase, rootFontSize, viewport });
	const matching = (element: Element, candidates: CascadeRule[]) =>
		candidates.filter((rule) => element.matches(rule.selector));
	const byPrecedence =
		(layerOrder: -1 | 1) => (first: CascadeRule, second: CascadeRule) =>
			layerOrder * (first.layer - second.layer) ||
			first.specificity - second.specificity ||
			first.order - second.order;

	const resolve = (
		element: Element,
		parent: StyleMap,
		applying: CascadeRule[],
		pseudo = false,
	) => {
		const style: StyleMap = {};
		for (const [key, value] of Object.entries(parent)) {
			if (INHERITED.has(key) || key.startsWith("--")) {
				style[key] = value;
			}
		}

		const inlineStyle = pseudo ? null : element.getAttribute("style");
		const inline = inlineStyle ? parseDeclarations(inlineStyle) : [];
		const ordered = [
			...(pseudo ? [] : presentationHints(element)),
			...applying
				.toSorted(byPrecedence(1))
				.flatMap((rule) =>
					rule.declarations.filter((declaration) => !declaration.important),
				),
			...inline.filter((declaration) => !declaration.important),
			...applying
				.toSorted(byPrecedence(-1))
				.flatMap((rule) =>
					rule.declarations.filter((declaration) => declaration.important),
				),
			...inline.filter((declaration) => declaration.important),
		];

		for (const { property, value } of ordered) {
			if (property.startsWith("--")) {
				style[property] = value;
			}
		}

		for (const [key, value] of Object.entries(style)) {
			if (key.startsWith("--") && value !== undefined) {
				style[key] = resolveVars(value, style);
			}
		}

		const declared: Declaration[] = [];
		const raw: StyleMap = {};
		for (const declaration of ordered) {
			if (!declaration.property.startsWith("--")) {
				const value = resolveVars(declaration.value, style) ?? "unset";
				Object.assign(raw, expand(declaration.property, value));
				declared.push({ ...declaration, value });
			}
		}

		for (const [key, value = ""] of Object.entries(raw)) {
			const inherits =
				value === "inherit" ||
				(INHERITED.has(key) && (value === "unset" || value === "revert"));
			style[key] = inherits
				? (parent[key] ?? INITIAL_VALUES[key])
				: CSS_WIDE_KEYWORDS.has(value)
					? INITIAL_VALUES[key]
					: value;
		}

		const parentSize = parseFloat(parent["font-size"] ?? INITIAL["font-size"]);
		const fontSize = resolveFontSize(
			style["font-size"] ?? INITIAL["font-size"],
			parentSize,
			(value) => length(value, parentSize, parentSize),
		);
		style["font-size"] = pixels(fontSize);
		style["font-weight"] = resolveWeight(
			style["font-weight"] ?? INITIAL["font-weight"],
			Number(parent["font-weight"] ?? INITIAL["font-weight"]),
		);

		const letterSpacing = style["letter-spacing"];
		if (letterSpacing !== undefined && letterSpacing !== "normal") {
			style["letter-spacing"] = pixels(length(letterSpacing, fontSize));
		}

		const lineHeight = style["line-height"];
		if (
			lineHeight !== undefined &&
			lineHeight !== "normal" &&
			!UNITLESS.test(lineHeight)
		) {
			style["line-height"] = pixels(length(lineHeight, fontSize, fontSize));
		}

		const computed: ComputedStyle = { ...INITIAL, ...style };

		if (
			(/flex|grid/.test(parent.display ?? "") ||
				/^(?:absolute|fixed)$/.test(computed.position ?? "") ||
				(computed.float ?? "none") !== "none") &&
			computed.display.startsWith("inline")
		) {
			computed.display =
				computed.display === "inline"
					? "block"
					: computed.display.replace("inline-", "");
		}

		for (const key of LENGTHS) {
			const value = computed[key];
			computed[key] =
				BORDER_WIDTHS[value] ??
				(value.endsWith("%") || value === "auto"
					? value
					: pixels(length(value, fontSize)));
		}

		for (const side of SIDES) {
			if (["hidden", "none"].includes(computed[`border-${side}-style`])) {
				computed[`border-${side}-width`] = "0px";
			}
		}

		return { declared, style: computed };
	};

	const walk = (element: Element, parent: StyleMap) => {
		const { style } = resolve(element, parent, matching(element, elementRules));
		styles.set(element, style);
		if (element === document.documentElement) {
			rootFontSize = parseFloat(style["font-size"]);
		}

		if (element.localName === "li") {
			markers.set(
				element,
				resolve(element, style, matching(element, pseudoRules.marker), true)
					.style,
			);
		}

		if (
			style.display !== "none" &&
			!REPLACED.has(element.localName) &&
			element.namespaceURI !== SVG_NAMESPACE
		) {
			for (const kind of ["before", "after"] as const) {
				const applying = matching(element, pseudoRules[kind]);
				if (!applying.length) {
					continue;
				}

				const { declared, style: pseudoStyle } = resolve(
					element,
					style,
					applying,
					true,
				);
				const text = contentText(pseudoStyle.content, element);
				if (text !== undefined && pseudoStyle.display !== "none") {
					const css = declared
						.filter(({ property }) => property !== "content")
						.map(({ property, value }) => `${property}:${value}`)
						.join(";");
					pseudos.set(element, {
						...pseudos.get(element),
						[kind]: { css, style: pseudoStyle, text },
					});
				}
			}
		}

		for (const child of element.children) {
			walk(child, style);
		}
	};

	walk(document.documentElement, {});
	return { markers, pseudos, styles };
}

/** An element's line height in px, from its computed font size and line height. */
export function lineHeightOf(style: ComputedStyle) {
	const fontSize = parseFloat(style["font-size"]);
	const lineHeight = style["line-height"];
	return lineHeight === "normal"
		? fontSize * NORMAL_LINE_HEIGHT
		: UNITLESS.test(lineHeight)
			? Number(lineHeight) * fontSize
			: parseFloat(lineHeight);
}

/** Resolves a length, or a `calc()`, `min()`, `max()`, or `clamp()` expression, to px. */
export function resolveLength(
	value: string | undefined,
	{ fontSize, percentBase = 0, rootFontSize, viewport }: LengthContext,
) {
	const text = (value ?? "").trim().toLowerCase();
	if (!text || ["auto", "none", "normal"].includes(text)) {
		return 0;
	}

	const toPixels = (amount: string, unit: string) => {
		const number = Number(amount);
		const absolute = ABSOLUTE_UNITS[unit];
		const relative = FONT_UNITS[unit];
		return absolute !== undefined
			? number * absolute
			: relative !== undefined
				? number * relative * fontSize
				: unit === "rem"
					? number * rootFontSize
					: unit === "%"
						? (number / 100) * percentBase
						: (number / 100) *
							VIEWPORT_UNITS[unit.replace(/^[sld]/, "")](viewport);
	};

	if (MATH_FUNCTION.test(text) || /[+*/]|\s-\s/.test(text)) {
		const expression = text.replace(
			LENGTHS_IN_TEXT,
			(_: string, amount: string, unit?: string) =>
				String(toPixels(amount, unit ?? "")),
		);
		return /^(?:[\d\s.e+\-*/(),]|calc|min|max|clamp)+$/.test(expression)
			? evaluateArithmetic(expression)
			: 0;
	}

	const match = LENGTH.exec(text);
	return match ? toPixels(match[1], match.at(2) ?? "") : 0;
}

/** Unescapes a CSS string's escapes, like "\\2192 " for an arrow. */
export function unescapeCss(value: string) {
	return value.replace(
		/\\(?:([\da-f]{1,6})\s?|(\n)|(.))/gi,
		(_, hex?: string, newline?: string, character?: string) =>
			hex
				? String.fromCodePoint(parseInt(hex, 16))
				: newline
					? ""
					: (character ?? ""),
	);
}

function conditionMatches(
	condition: csstree.Condition,
	environment: CascadeOptions,
): boolean {
	const terms = condition.children.toArray();
	const operator = terms.find(
		(term): term is csstree.Identifier => term.type === "Identifier",
	)?.name;
	const results = terms
		.filter((term) => term.type !== "Identifier")
		.map((term) => termMatches(term, environment));
	return operator === "not"
		? !results[0]
		: operator === "or"
			? results.some(Boolean)
			: results.every(Boolean);
}

/** The text a pseudo-element's `content` generates, or undefined when it generates none. */
function contentText(value: string | undefined, element: Element) {
	const content = value?.trim() ?? "";
	if (!content || content === "none" || content === "normal") {
		return undefined;
	}

	let text = "";
	for (const [token] of content.matchAll(
		/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[\w-]+\([^)]*\)|open-quote|close-quote|\//g,
	)) {
		if (token === "/") {
			break;
		}

		if (token.startsWith('"') || token.startsWith("'")) {
			text += unescapeCss(token.slice(1, -1));
		} else if (token.startsWith("attr(")) {
			const name = token.slice(5, -1).trim().split(/[\s,]/)[0];
			text += element.getAttribute(name) ?? "";
		} else if (token === "open-quote") {
			text += "“";
		} else if (token === "close-quote") {
			text += "”";
		}
	}

	return text;
}

/** Evaluates + - * /, parentheses, and calc(), min(), max(), and clamp() over numbers. */
function evaluateArithmetic(expression: string) {
	const tokens =
		expression.match(
			/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|calc|min|max|clamp|[+\-*/(),]/g,
		) ?? [];
	let index = 0;
	const args = (): number[] => {
		index++;
		const values = [sum()];
		while (tokens[index] === ",") {
			index++;
			values.push(sum());
		}

		index++;
		return values;
	};

	const factor = (): number => {
		const token = tokens[index];
		switch (token) {
			case "(": {
				index++;
				const value = sum();
				index++;
				return value;
			}
			case "-":
				index++;
				return -factor();
			case "calc":
				index++;
				return args()[0] ?? 0;
			case "clamp": {
				index++;
				const [low = 0, value = 0, high = 0] = args();
				return Math.max(low, Math.min(value, high));
			}
			case "max":
				index++;
				return Math.max(...args());
			case "min":
				index++;
				return Math.min(...args());
			default:
				index++;
				return Number(token);
		}
	};

	const product = (): number => {
		let value = factor();
		while (tokens[index] === "*" || tokens[index] === "/") {
			value = tokens[index++] === "*" ? value * factor() : value / factor();
		}

		return value;
	};

	const sum = (): number => {
		let value = product();
		while (tokens[index] === "+" || tokens[index] === "-") {
			value = tokens[index++] === "+" ? value + product() : value - product();
		}

		return value;
	};

	const result = sum();
	return Number.isFinite(result) ? result : 0;
}

/** Expands the shorthands decks commonly use into the longhands the exporter reads. */
function expand(property: string, value: string): StyleMap {
	switch (property) {
		case "-webkit-text-stroke": {
			const [width, color = "currentcolor"] = splitTopLevel(value, " ");
			return {
				"-webkit-text-stroke-color": color,
				"-webkit-text-stroke-width": width,
			};
		}
		case "background":
			return expandBackground(value);
		case "border":
			return Object.fromEntries(
				SIDES.flatMap((side) =>
					Object.entries(expandBorder(`border-${side}`, value)),
				),
			);
		case "border-bottom":
		case "border-left":
		case "border-right":
		case "border-top":
			return expandBorder(property, value);
		case "border-color":
		case "border-style":
		case "border-width":
			return expandSides(property.replace("-", "-*-"), value);
		case "border-radius":
			return {
				"border-top-left-radius": splitTopLevel(
					splitTopLevel(value, "/")[0] ?? "",
					" ",
				)[0],
			};
		case "columns": {
			const count = splitTopLevel(value, " ").find((part) =>
				/^\d+$/.test(part),
			);
			return count ? { "column-count": count } : {};
		}
		case "font":
			return expandFont(value);
		case "inset":
			return expandSides("*", value);
		case "list-style":
			return {
				"list-style-type":
					splitTopLevel(value, " ").find(
						(part) => !/^(?:inside|outside|url\()/.test(part),
					) ?? "disc",
			};
		case "margin":
		case "padding":
			return expandSides(`${property}-*`, value);
		case "text-decoration":
			return { "text-decoration-line": splitTopLevel(value, " ")[0] };
		default:
			return { [property]: value };
	}
}

/** Expands the `background` shorthand's layers into their images, positions, sizes, repeats, and color. */
function expandBackground(value: string) {
	const images: string[] = [];
	const positions: string[] = [];
	const sizes: string[] = [];
	const repeats: string[] = [];
	let color = "transparent";
	for (const layer of splitTopLevel(value, ",")) {
		let image = "none";
		const position: string[] = [];
		const size: string[] = [];
		const repeat: string[] = [];
		let afterSlash = false;
		const spaced = splitTopLevel(layer, "/").join(" / ");
		for (const part of splitTopLevel(spaced, " ")) {
			if (part === "/") {
				afterSlash = true;
			} else if (
				/^(?:url|image-set|(?:repeating-)?(?:linear|radial|conic)-gradient)\(/i.test(
					part,
				) ||
				part === "none"
			) {
				image = part;
			} else if (/^(?:repeat(?:-[xy])?|no-repeat|space|round)$/.test(part)) {
				repeat.push(part);
			} else if (
				/^(?:left|right|top|bottom|center|cover|contain|auto)$/.test(part) ||
				/^(?:-?[\d.]|calc\()/.test(part)
			) {
				(afterSlash ? size : position).push(part);
			} else if (
				!/^(?:scroll|fixed|local|(?:border|padding|content)-box|text)$/.test(
					part,
				)
			) {
				color = part;
			}
		}

		images.push(image);
		positions.push(position.join(" ") || "0% 0%");
		sizes.push(size.join(" ") || "auto");
		repeats.push(repeat.join(" ") || "repeat");
	}

	return {
		"background-color": color,
		"background-image": images.every((image) => image === "none")
			? "none"
			: images.join(", "),
		"background-position": positions.join(", "),
		"background-repeat": repeats.join(", "),
		"background-size": sizes.join(", "),
	};
}

/** Expands one side's border shorthand (e.g. `border-top`) into its width, style, and color. */
function expandBorder(prefix: string, value: string) {
	const longhands: StyleMap = {
		[`${prefix}-color`]: "currentcolor",
		[`${prefix}-style`]: "none",
		[`${prefix}-width`]: "medium",
	};
	for (const part of splitTopLevel(value, " ")) {
		if (BORDER_STYLES.has(part)) {
			longhands[`${prefix}-style`] = part;
		} else if (isLength(part) || part in BORDER_WIDTHS) {
			longhands[`${prefix}-width`] = part;
		} else {
			longhands[`${prefix}-color`] = part;
		}
	}

	return longhands;
}

function expandFont(value: string): StyleMap {
	const parts = splitTopLevel(splitTopLevel(value, "/").join(" / "), " ");
	const sizeIndex = parts.findIndex(
		(part) => isLength(part) || part in KEYWORD_SIZES || part in RELATIVE_SIZES,
	);
	if (sizeIndex < 0) {
		return {};
	}

	const modifiers = parts.slice(0, sizeIndex);
	const lineHeight =
		parts[sizeIndex + 1] === "/" ? parts[sizeIndex + 2] : undefined;
	return {
		"font-family": parts
			.slice(sizeIndex + (lineHeight === undefined ? 1 : 3))
			.join(" "),
		"font-size": parts[sizeIndex],
		"font-style":
			modifiers.find((part) => /^(?:italic|oblique)$/.test(part)) ?? "normal",
		"font-weight":
			modifiers.find((part) => /^(?:bold|bolder|lighter|\d+)$/.test(part)) ??
			"normal",
		"line-height": lineHeight ?? "normal",
	};
}

function expandSides(pattern: string, value: string) {
	const [top, right = top, bottom = top, left = right] = splitTopLevel(
		value,
		" ",
	);
	return Object.fromEntries(
		[top, right, bottom, left].map((side, index) => [
			pattern.replace("*", SIDES[index]),
			side,
		]),
	);
}

function featureMatches(
	{ name, value }: csstree.Feature,
	{ colorScheme, viewport }: CascadeOptions,
) {
	const text = value ? csstree.generate(value) : undefined;
	switch (name) {
		case "orientation":
			return (
				text === (viewport.width >= viewport.height ? "landscape" : "portrait")
			);
		case "prefers-color-scheme":
			return text === colorScheme;
		case "prefers-reduced-motion":
			return text !== "reduce";
	}

	const [, bound, dimension] =
		/^(?:(min|max)-)?(width|height)$/.exec(name) ?? [];
	if (!dimension || text === undefined) {
		return true;
	}

	const size = dimension === "width" ? viewport.width : viewport.height;
	const limit = mediaLength(text, viewport);
	return bound === "min"
		? size >= limit
		: bound === "max"
			? size <= limit
			: size === limit;
}

function isSupported(document: Document, selector: string) {
	try {
		document.documentElement.matches(selector);
		return true;
	} catch {
		return false;
	}
}

function mediaLength(value: string, viewport: Viewport) {
	return resolveLength(value, { fontSize: 16, rootFontSize: 16, viewport });
}

function mediaMatches(
	prelude: csstree.AtrulePrelude | csstree.Raw | null,
	environment: CascadeOptions,
) {
	if (!prelude) {
		return true;
	}

	const list = prelude.type === "AtrulePrelude" ? prelude.children.first : null;
	return (
		list?.type === "MediaQueryList" &&
		list.children
			.toArray()
			.some(
				(query) =>
					query.type === "MediaQuery" && queryMatches(query, environment),
			)
	);
}

function presentationHints(element: Element) {
	if (element.namespaceURI !== SVG_NAMESPACE) {
		return [];
	}

	return PRESENTATION_ATTRIBUTES.flatMap((property): Declaration[] => {
		const value = element.getAttribute(property);
		return value === null ? [] : [{ important: false, property, value }];
	});
}

function queryMatches(
	{ condition, mediaType, modifier }: csstree.MediaQuery,
	environment: CascadeOptions,
) {
	const matches =
		(!mediaType || SCREEN_MEDIA_TYPES.has(mediaType.toLowerCase())) &&
		(!condition || conditionMatches(condition, environment));
	return modifier === "not" ? !matches : matches;
}

function rangeMatches(
	{
		left,
		leftComparison,
		middle,
		right,
		rightComparison,
	}: csstree.FeatureRange,
	{ viewport }: CascadeOptions,
) {
	const operand = (node: csstree.CssNode) =>
		node.type === "Identifier"
			? node.name === "width"
				? viewport.width
				: node.name === "height"
					? viewport.height
					: NaN
			: mediaLength(csstree.generate(node), viewport);
	return (
		COMPARISONS[leftComparison](operand(left), operand(middle)) &&
		(!right ||
			!rightComparison ||
			COMPARISONS[rightComparison](operand(middle), operand(right)))
	);
}

function resolveFontSize(
	value: string,
	parentSize: number,
	length: (value: string) => number,
) {
	const relative = RELATIVE_SIZES[value];
	return (
		KEYWORD_SIZES[value] ??
		(relative === undefined ? length(value) : parentSize * relative)
	);
}

/** Substitutes var() references, or returns undefined when one is invalid at computed-value time. */
function resolveVars(
	value: string,
	style: StyleMap,
	depth = 0,
): string | undefined {
	if (!value.includes("var(")) {
		return value;
	}

	if (
		depth > 20 ||
		[...value.matchAll(VAR)].some(
			(reference) =>
				style[reference[1]] === undefined && reference.at(2) === undefined,
		)
	) {
		return undefined;
	}

	const substituted = value.replace(
		VAR,
		(_: string, name: string, fallback: string | undefined) =>
			style[name] ?? fallback?.trim() ?? "",
	);
	return substituted === value
		? substituted
		: resolveVars(substituted, style, depth + 1);
}

function resolveWeight(value: string, parentWeight: number) {
	switch (value) {
		case "bold":
			return "700";
		case "bolder":
			return parentWeight < 350 ? "400" : parentWeight < 550 ? "700" : "900";
		case "lighter":
			return parentWeight < 550 ? "100" : parentWeight < 750 ? "400" : "700";
		case "normal":
			return "400";
		default:
			return String(Number(value) || 400);
	}
}

function scoped(selector: string, scope: string) {
	return selector.includes(":scope")
		? selector.replaceAll(":scope", `:where(${scope})`)
		: `:where(${scope}) ${selector}`;
}

function scopeRoot(prelude: csstree.AtrulePrelude | csstree.Raw | null) {
	const scope =
		prelude?.type === "AtrulePrelude" ? prelude.children.first : null;
	return scope?.type === "Scope" && scope.root
		? csstree.generate(scope.root)
		: undefined;
}

function specificity(selector: csstree.CssNode) {
	let weight = 0;
	csstree.walk(selector, function (node) {
		switch (node.type) {
			case "AttributeSelector":
			case "ClassSelector":
				weight += CLASS_WEIGHT;
				break;
			case "IdSelector":
				weight += ID_WEIGHT;
				break;
			case "PseudoClassSelector": {
				if (LEGACY_PSEUDO_ELEMENTS.has(node.name)) {
					weight += TYPE_WEIGHT;
					break;
				}

				if (node.name === "where") {
					return this.skip;
				}

				if (["has", "is", "not"].includes(node.name) && node.children) {
					const selectors = node.children
						.toArray()
						.flatMap((child) =>
							child.type === "SelectorList" ? child.children.toArray() : [],
						);
					weight += Math.max(0, ...selectors.map(specificity));
					return this.skip;
				}

				weight += CLASS_WEIGHT;
				break;
			}
			case "PseudoElementSelector":
				weight += TYPE_WEIGHT;
				break;
			case "TypeSelector":
				if (node.name !== "*") {
					weight += TYPE_WEIGHT;
				}

				break;
		}

		return undefined;
	});
	return weight;
}

function termMatches(
	term: csstree.CssNode,
	environment: CascadeOptions,
): boolean {
	switch (term.type) {
		case "Condition":
			return conditionMatches(term, environment);
		case "Feature":
			return featureMatches(term, environment);
		case "FeatureRange":
			return rangeMatches(term, environment);
		default:
			return false;
	}
}
