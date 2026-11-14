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
	pseudo?: PseudoElementName;
	selector: string;
	specificity: number;
}

interface GeneratedContent {
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
	pseudos: Map<Element, Partial<Record<"after" | "before", GeneratedContent>>>;
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

type PseudoElementName = "after" | "before" | "marker";

const INHERITED = new Set([
	"-webkit-text-fill-color",
	"-webkit-text-stroke-color",
	"-webkit-text-stroke-width",
	"color",
	"color-scheme",
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
} as const satisfies Record<string, string>;

const BORDER_WIDTHS: StyleMap = { medium: "3px", thick: "5px", thin: "1px" };

const LENGTH_PROPERTIES = [
	"-webkit-text-stroke-width",
	"border-bottom-width",
	"border-left-width",
	"border-right-width",
	"border-top-left-radius",
	"border-top-width",
	"margin-bottom",
	"margin-top",
	"padding-bottom",
	"padding-left",
	"padding-right",
	"padding-top",
] as const satisfies readonly KnownProperty[];

const USER_AGENT_CSS = `
html, body, div, p, h1, h2, h3, h4, h5, h6, ul, ol, menu, li, pre, section, header, footer, main, nav, article, aside, address, blockquote, center, figure, figcaption, hgroup, dl, dt, dd, details, summary, form, fieldset, legend, hr, search { display: block }
li { display: list-item }
head, script, style, template, title, meta, link, noscript, datalist { display: none }
table { display: table }
caption { display: table-caption; text-align: center }
colgroup { display: table-column-group }
col { display: table-column }
thead { display: table-header-group }
tbody { display: table-row-group }
tfoot { display: table-footer-group }
tr { display: table-row }
td, th { display: table-cell; padding: 1px }
center { text-align: center }
h1 { font-size: 2em; font-weight: bold }
h2 { font-size: 1.5em; font-weight: bold }
h3 { font-size: 1.17em; font-weight: bold }
h4 { font-weight: bold }
h5 { font-size: 0.83em; font-weight: bold }
h6 { font-size: 0.67em; font-weight: bold }
th { font-weight: bold; text-align: center }
strong, b { font-weight: bolder }
em, i, cite, dfn, var, address { font-style: italic }
code, pre, kbd, samp, tt { font-family: monospace }
pre { white-space: pre }
sup { vertical-align: super; font-size: smaller }
sub { vertical-align: sub; font-size: smaller }
small { font-size: smaller }
big { font-size: larger }
a, u, ins { text-decoration-line: underline }
s, strike, del { text-decoration-line: line-through }
mark { background-color: yellow; color: black }
ul, menu { list-style-type: disc }
ol { list-style-type: decimal }
img, svg, video, canvas { display: inline-block }
`;

const USER_AGENT_LAYER = "<user agent>";

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
	"xx-small": 9,
	"xxx-large": 48,
};
const RELATIVE_SIZES: Partial<Record<string, number>> = {
	larger: 1.2,
	smaller: 0.833,
};
const NORMAL_LINE_HEIGHT = 1.2;
const SIDES = ["top", "right", "bottom", "left"] as const;
const TEXT_DECORATION_LINE =
	/^(?:blink|line-through|none|overline|underline|inherit|initial|unset|revert|revert-layer)$/;
const UNITLESS = /^[\d.]+$/;
const MAX_VAR_DEPTH = 20;

const REPLACED_ELEMENTS = new Set([
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

const DESKTOP_MEDIA: Partial<Record<string, number | string>> = {
	"any-hover": "hover",
	"any-pointer": "fine",
	color: 8,
	"color-gamut": "srgb",
	"color-index": 0,
	"display-mode": "browser",
	"dynamic-range": "standard",
	"forced-colors": "none",
	grid: 0,
	hover: "hover",
	"inverted-colors": "none",
	monochrome: 0,
	pointer: "fine",
	"prefers-contrast": "no-preference",
	"prefers-reduced-data": "no-preference",
	"prefers-reduced-motion": "no-preference",
	"prefers-reduced-transparency": "no-preference",
	scripting: "enabled",
	update: "fast",
};
const FALSE_IN_BOOLEAN_CONTEXT = new Set([0, "no-preference", "none"]);

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
const QUOTES: Partial<Record<string, string>> = {
	"close-quote": "”",
	"open-quote": "“",
};

const isPseudoElementName = (value: string): value is PseudoElementName =>
	value === "after" || value === "before" || value === "marker";

const isLength = (value: string) =>
	LENGTH.test(value) || MATH_FUNCTION.test(value);

const isPseudoElementSelector = (
	node: csstree.CssNode,
): node is csstree.PseudoClassSelector | csstree.PseudoElementSelector =>
	node.type === "PseudoElementSelector" ||
	(node.type === "PseudoClassSelector" &&
		LEGACY_PSEUDO_ELEMENTS.has(node.name));

const pixels = (value: number) => `${String(value)}px`;

/** The computed style of an element no rule applies to. */
export const INITIAL_STYLE: ComputedStyle = INITIAL;

export const isOutOfFlow = (style: ComputedStyle) =>
	/^(?:absolute|fixed)$/.test(style.position ?? "");

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
			const pseudoElement = nodes.find(isPseudoElementSelector);
			const pseudo = pseudoElement?.name;
			if (pseudo !== undefined && !isPseudoElementName(pseudo)) {
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
				const names: string[] = [];
				if (node.prelude) {
					csstree.walk(node.prelude, {
						enter(layer) {
							names.push(layerName ? `${layerName}.${layer.name}` : layer.name);
						},
						visit: "Layer",
					});
				}

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

			if (!node.block) {
				return;
			}

			if (name === "scope") {
				visitBlock(
					node.block.children,
					layerName,
					scopeRoot(node.prelude) ?? scope,
				);
			} else if (
				CONDITIONAL_RULES.has(name) &&
				preludeMatches(node.prelude, environment)
			) {
				visitBlock(node.block.children, layerName, scope);
			}
		});
	};

	const visitSheet = (sheet: string, layerName: string) => {
		const ast = csstree.parse(sheet, {
			parseCustomProperty: false,
			parseValue: false,
		});
		if (ast.type === "StyleSheet") {
			visitBlock(ast.children, layerName);
		}
	};

	visitSheet(USER_AGENT_CSS, USER_AGENT_LAYER);
	for (const sheet of sheets) {
		visitSheet(sheet, "");
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
	const ranks = new Map([
		[USER_AGENT_LAYER, -1],
		...ranked.map((name, index): [string, number] => [name, index]),
	]);
	return rules.map(({ layerName, ...rule }) => ({
		...rule,
		layer: ranks.get(layerName) ?? ranked.length,
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
	const rulesFor = (pseudo: PseudoElementName | undefined) =>
		supported.filter((rule) => rule.pseudo === pseudo);
	const elementRules = rulesFor(undefined);
	const pseudoRules = {
		after: rulesFor("after"),
		before: rulesFor("before"),
		marker: rulesFor("marker"),
	};
	let rootFontSize = parseFloat(INITIAL["font-size"]);
	const length = (value: string, fontSize: number, percentBase?: number) =>
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

		const inlineStyle = pseudo ? undefined : element.getAttribute("style");
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
				(INHERITED.has(key) &&
					value !== "initial" &&
					CSS_WIDE_KEYWORDS.has(value));
			style[key] = inherits
				? (parent[key] ?? INITIAL_STYLE[key])
				: CSS_WIDE_KEYWORDS.has(value)
					? INITIAL_STYLE[key]
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
			lineHeightFactor(lineHeight) === undefined
		) {
			style["line-height"] = pixels(length(lineHeight, fontSize, fontSize));
		}

		const colorScheme = style["color-scheme"] ?? "";
		const dark = /\bdark\b/.test(colorScheme) && !/\blight\b/.test(colorScheme);
		for (const [key, value] of Object.entries(style)) {
			if (value?.includes("light-dark(")) {
				style[key] = resolveLightDark(value, dark);
			}
		}

		const computed: ComputedStyle = { ...INITIAL, ...style };

		if (
			(/flex|grid/.test(parent.display ?? "") ||
				isOutOfFlow(computed) ||
				(computed.float ?? "none") !== "none") &&
			computed.display.startsWith("inline")
		) {
			computed.display =
				computed.display === "inline"
					? "block"
					: computed.display.replace("inline-", "");
		}

		for (const key of LENGTH_PROPERTIES) {
			const value = computed[key];
			computed[key] =
				BORDER_WIDTHS[value] ??
				(value.includes("%") || value === "auto"
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
			!REPLACED_ELEMENTS.has(element.localName) &&
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
	const lineHeight = style["line-height"];
	const factor = lineHeightFactor(lineHeight);
	return factor === undefined
		? parseFloat(lineHeight)
		: factor * parseFloat(style["font-size"]);
}

/** Resolves a length, or a `calc()`, `min()`, `max()`, or `clamp()` expression, to px. */
export function resolveLength(
	value: string | undefined,
	{ fontSize, percentBase = 0, rootFontSize, viewport }: LengthContext,
) {
	const text = (value ?? "").trim().toLowerCase();
	const toPixels = (amount: string, unit: string) => {
		const number = Number(amount);
		const absolute = ABSOLUTE_UNITS[unit];
		if (absolute !== undefined) {
			return number * absolute;
		}

		const relative = FONT_UNITS[unit];
		if (relative !== undefined) {
			return number * relative * fontSize;
		}

		if (unit === "rem") {
			return number * rootFontSize;
		}

		return (
			(number / 100) *
			(unit === "%"
				? percentBase
				: VIEWPORT_UNITS[unit.replace(/^[sld]/, "")](viewport))
		);
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

/** Resolves a length against the initial font size, as media queries and SVG attributes do. */
export function resolveInitialLength(value: string, viewport: Viewport) {
	const fontSize = parseFloat(INITIAL["font-size"]);
	return resolveLength(value, { fontSize, rootFontSize: fontSize, viewport });
}

function conditionMatches(
	condition: csstree.Condition,
	environment: CascadeOptions,
) {
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

function contentPart(node: csstree.CssNode, element: Element) {
	switch (node.type) {
		case "Function": {
			const name = node.children.first;
			return node.name === "attr" && name?.type === "Identifier"
				? (element.getAttribute(name.name) ?? "")
				: "";
		}
		case "Identifier":
			return QUOTES[node.name] ?? "";
		case "String":
			return node.value;
		default:
			return "";
	}
}

function contentText(value: string | undefined, element: Element) {
	if (!value || value === "none" || value === "normal") {
		return undefined;
	}

	const ast = csstree.parse(value, { context: "value" });
	const nodes = ast.type === "Value" ? ast.children.toArray() : [];
	const altTextStart = nodes.findIndex(
		(node) => node.type === "Operator" && node.value === "/",
	);
	return nodes
		.slice(0, altTextStart < 0 ? undefined : altTextStart)
		.map((node) => contentPart(node, element))
		.join("");
}

function evaluateArithmetic(expression: string) {
	const tokens =
		expression.match(
			/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|calc|min|max|clamp|[+\-*/(),]/g,
		) ?? [];
	let index = 0;
	const argumentList = (): number[] => {
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
				return argumentList()[0] ?? 0;
			case "clamp": {
				index++;
				const [low = 0, value = 0, high = 0] = argumentList();
				return Math.max(low, Math.min(value, high));
			}
			case "max":
				index++;
				return Math.max(...argumentList());
			case "min":
				index++;
				return Math.min(...argumentList());
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

function expand(property: string, value: string) {
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
		case "border-top-left-radius":
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
			return {
				"text-decoration-line":
					splitTopLevel(value, " ")
						.filter((part) => TEXT_DECORATION_LINE.test(part))
						.join(" ") || "none",
			};
		default:
			return expandLogical(property, value) ?? { [property]: value };
	}
}

function expandBackground(value: string) {
	const images: string[] = [];
	const positions: string[] = [];
	const sizes: string[] = [];
	const repeats: string[] = [];
	const clips: string[] = [];
	let color = "transparent";
	for (const layer of splitTopLevel(value, ",")) {
		let image = "none";
		const position: string[] = [];
		const size: string[] = [];
		const repeat: string[] = [];
		const boxes: string[] = [];
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
			} else if (/^(?:(?:border|padding|content)-box|text)$/.test(part)) {
				boxes.push(part);
			} else if (!/^(?:scroll|fixed|local)$/.test(part)) {
				color = part;
			}
		}

		images.push(image);
		positions.push(position.join(" ") || "0% 0%");
		sizes.push(size.join(" ") || "auto");
		repeats.push(repeat.join(" ") || "repeat");
		clips.push(boxes.at(-1) ?? "border-box");
	}

	return {
		"background-clip": clips.join(", "),
		"background-color": color,
		"background-image": images.every((image) => image === "none")
			? "none"
			: images.join(", "),
		"background-position": positions.join(", "),
		"background-repeat": repeats.join(", "),
		"background-size": sizes.join(", "),
	};
}

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

function expandFont(value: string) {
	const parts = splitTopLevel(splitTopLevel(value, "/").join(" / "), " ");
	const sizeIndex = parts.findIndex(
		(part) =>
			(isLength(part) && !UNITLESS.test(part)) ||
			part in KEYWORD_SIZES ||
			part in RELATIVE_SIZES,
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

function expandLogical(property: string, value: string) {
	const [, box, axis, edge] =
		/^(margin|padding|inset)-(block|inline)(?:-(start|end))?$/.exec(property) ??
		[];
	if (!box) {
		return undefined;
	}

	const prefix = box === "inset" ? "" : `${box}-`;
	const [start, end] = axis === "block" ? ["top", "bottom"] : ["left", "right"];
	if (edge) {
		return { [`${prefix}${edge === "start" ? start : end}`]: value };
	}

	const [startValue, endValue = startValue] = splitTopLevel(value, " ");
	return { [`${prefix}${end}`]: endValue, [`${prefix}${start}`]: startValue };
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
	environment: CascadeOptions,
) {
	const [, bound, feature = name] = /^(min|max)-(.+)$/.exec(name) ?? [];
	const actual = mediaValue(feature, environment);
	if (actual === undefined) {
		return false;
	}

	if (!value) {
		return !bound && !FALSE_IN_BOOLEAN_CONTEXT.has(actual);
	}

	if (typeof actual === "string") {
		return !bound && csstree.generate(value) === actual;
	}

	const limit = resolveInitialLength(
		csstree.generate(value),
		environment.viewport,
	);
	return bound === "min"
		? actual >= limit
		: bound === "max"
			? actual <= limit
			: actual === limit;
}

function findFunction(value: string, name: string) {
	const start = value.indexOf(`${name}(`);
	if (start < 0) {
		return undefined;
	}

	const open = start + name.length + 1;
	let close = open;
	for (let nesting = 1; close < value.length; close++) {
		if (value[close] === "(") {
			nesting++;
		} else if (value[close] === ")" && --nesting === 0) {
			break;
		}
	}

	return {
		after: value.slice(close + 1),
		before: value.slice(0, start),
		body: value.slice(open, close),
	};
}

function isSupported(document: Document, selector: string) {
	try {
		document.documentElement.matches(selector);
		return true;
	} catch {
		return false;
	}
}

function lineHeightFactor(lineHeight: string) {
	return lineHeight === "normal"
		? NORMAL_LINE_HEIGHT
		: UNITLESS.test(lineHeight)
			? Number(lineHeight)
			: undefined;
}

function mediaValue(
	name: string,
	{ colorScheme, viewport }: CascadeOptions,
): number | string | undefined {
	switch (name) {
		case "aspect-ratio":
			return viewport.width / viewport.height;
		case "height":
			return viewport.height;
		case "orientation":
			return viewport.width >= viewport.height ? "landscape" : "portrait";
		case "prefers-color-scheme":
			return colorScheme;
		case "width":
			return viewport.width;
		default:
			return DESKTOP_MEDIA[name];
	}
}

function preludeMatches(
	prelude: csstree.AtrulePrelude | csstree.Raw | null,
	environment: CascadeOptions,
) {
	return (
		!prelude ||
		(prelude.type === "AtrulePrelude" &&
			prelude.children
				.toArray()
				.every(
					(node) =>
						node.type === "Identifier" || termMatches(node, environment),
				))
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
	environment: CascadeOptions,
) {
	const operand = (node: csstree.CssNode) => {
		if (node.type !== "Identifier") {
			return resolveInitialLength(csstree.generate(node), environment.viewport);
		}

		const value = mediaValue(node.name, environment);
		return typeof value === "number" ? value : NaN;
	};

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

function resolveLightDark(value: string, dark: boolean): string {
	const call = findFunction(value, "light-dark");
	if (!call) {
		return value;
	}

	const [light = "", darkValue = ""] = splitTopLevel(call.body, ",");
	return resolveLightDark(
		call.before + (dark ? darkValue : light) + call.after,
		dark,
	);
}

function resolveVars(
	value: string,
	style: StyleMap,
	depth = 0,
): string | undefined {
	const call = findFunction(value, "var");
	if (!call) {
		return value;
	}

	const [name = "", ...fallbackParts] = call.body.split(",");
	const substitute =
		style[name.trim()] ??
		(fallbackParts.length ? fallbackParts.join(",").trim() : undefined);
	if (substitute === undefined || depth >= MAX_VAR_DEPTH) {
		return undefined;
	}

	const resolved = resolveVars(substitute, style, depth + 1);
	const after = resolveVars(call.after, style, depth);
	return resolved === undefined || after === undefined
		? undefined
		: call.before + resolved + after;
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
		prelude?.type === "AtrulePrelude" ? prelude.children.first : undefined;
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

function supportsDeclaration({ property, value }: csstree.Declaration) {
	const text = csstree.generate(value);
	return (
		property.startsWith("--") ||
		text.includes("var(") ||
		!csstree.lexer.matchProperty(property, text).error
	);
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
		case "FeatureFunction":
			return term.feature === "selector";
		case "FeatureRange":
			return rangeMatches(term, environment);
		case "MediaQueryList":
			return term.children
				.toArray()
				.some(
					(query) =>
						query.type === "MediaQuery" && queryMatches(query, environment),
				);
		case "SupportsDeclaration":
			return supportsDeclaration(term.declaration);
		default:
			return false;
	}
}
