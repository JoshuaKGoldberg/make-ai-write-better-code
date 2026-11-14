/**
 * A small static CSS cascade. It resolves the computed values PowerPoint export
 * needs (colors, fonts, spacing, borders, transforms, ...) for every element of
 * a parsed document, without a browser: selector matching, specificity, cascade
 * order, !important, inheritance, custom properties, and length units.
 */
import * as csstree from "css-tree";

export interface CascadeOptions {
	/** Which `prefers-color-scheme` media queries match. */
	colorScheme?: "dark" | "light";
	viewport?: Viewport;
}

export interface CascadeRule {
	declarations: Declaration[];
	/** The rule's cascade layer's precedence: higher wins for normal declarations, lower for !important. */
	layer: number;
	order: number;
	/** Rules for pseudo-elements are kept apart from the element's own rules. */
	pseudo?: Pseudo;
	selector: string;
	specificity: number;
}

/** A ::before or ::after pseudo-element with generated content. */
export interface PseudoElement {
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

interface Declaration {
	important?: boolean;
	prop: string;
	value: string;
}

type KnownProperty = "line-height-px" | keyof typeof INITIAL;

type Pseudo = "after" | "before" | "marker";

const INHERITED = new Set([
	"-webkit-text-fill-color",
	"-webkit-text-stroke-color",
	"-webkit-text-stroke-width",
	"color",
	"cursor",
	"direction",
	"dominant-baseline",
	"fill",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"letter-spacing",
	"line-height",
	"list-style-type",
	"paint-order",
	"stroke",
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

/** Lengths normalized to px once an element's font size is known. */
const BORDER_WIDTHS: StyleMap = { medium: "3px", thick: "5px", thin: "1px" };

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
const KEYWORD_SIZES: Record<string, number> = {
	large: 18,
	medium: 16,
	small: 13,
	"x-large": 24,
	"x-small": 10,
	"xx-large": 32,
};
const RELATIVE_SIZES: Record<string, number> = { larger: 1.2, smaller: 0.833 };
const SIDES = ["top", "right", "bottom", "left"] as const;
const DEFAULT_VIEWPORT: Viewport = { height: 552, width: 980 };

/** Elements that can't have ::before or ::after content. */
const REPLACED = new Set([
	"BR",
	"CANVAS",
	"HR",
	"IFRAME",
	"IMG",
	"INPUT",
	"SELECT",
	"svg",
	"TEXTAREA",
	"VIDEO",
]);

const isPseudo = (value: string): value is Pseudo =>
	value === "after" || value === "before" || value === "marker";

const initial = (key: string): string | undefined =>
	key in INITIAL ? INITIAL[key as keyof typeof INITIAL] : undefined;

/** The computed style of an element no rule applies to. */
export const INITIAL_STYLE: ComputedStyle = {
	...INITIAL,
	"line-height-px": "19.2",
};

/** Parses stylesheets (after the user-agent defaults) into an ordered rule list. */
export function createCascade(
	sheets: string[],
	{ colorScheme = "light", viewport = DEFAULT_VIEWPORT }: CascadeOptions = {},
): CascadeRule[] {
	const rules: (CascadeRule & { layerName: string })[] = [];
	let order = 0;
	// Layer names in the order they're first declared; "" holds unlayered rules.
	const layers: string[] = [];
	let anonymous = 0;
	const declareLayer = (name: string) => {
		const parts = name.split(".");
		for (let i = 1; i <= parts.length; i++) {
			const prefix = parts.slice(0, i).join(".");
			if (!layers.includes(prefix)) {
				layers.push(prefix);
			}
		}
	};

	const visitRule = (rule: csstree.Rule, layerName: string) => {
		const declarations: Declaration[] = [];
		rule.block.children.forEach((node) => {
			if (node.type !== "Declaration") {
				return;
			}

			const value =
				node.value.type === "Raw"
					? node.value.value
					: csstree.generate(node.value);
			declarations.push({
				important: Boolean(node.important),
				prop: node.property.toLowerCase(),
				value: value.trim(),
			});
		});
		if (!declarations.length) {
			return;
		}

		for (const selector of splitTopLevel(csstree.generate(rule.prelude), ",")) {
			const pseudo =
				/::?(marker|before|after|placeholder|selection|backdrop|-webkit-[\w-]+|first-letter|first-line)\b/.exec(
					selector,
				);
			const kind = pseudo?.[1];
			if (kind !== undefined && !isPseudo(kind)) {
				continue;
			}

			const base = pseudo
				? selector.replace(pseudo[0], "").trim() || "*"
				: selector.trim();
			let weight: number;
			try {
				weight = specificity(selector.trim());
			} catch {
				continue;
			}

			rules.push({
				declarations,
				layer: 0,
				layerName,
				order: order++,
				pseudo: kind,
				selector: base,
				specificity: weight,
			});
		}
	};

	const visitBlock = (
		children: csstree.List<csstree.CssNode>,
		layerName: string,
	) => {
		children.forEach((node) => {
			if (node.type === "Rule") {
				visitRule(node, layerName);
				return;
			}

			if (node.type !== "Atrule") {
				return;
			}

			const name = node.name.toLowerCase();
			const prelude = node.prelude ? csstree.generate(node.prelude) : "";
			if (name === "layer") {
				const names = prelude
					.split(",")
					.map((part) => part.trim())
					.filter(Boolean)
					.map((part) => (layerName ? `${layerName}.${part}` : part));
				if (!node.block) {
					names.forEach(declareLayer);
					return;
				}

				const nested =
					names[0] ??
					`${layerName ? `${layerName}.` : ""}<anonymous ${String(anonymous++)}>`;
				declareLayer(nested);
				visitBlock(node.block.children, nested);
				return;
			}

			if (
				!node.block ||
				(name === "media" && !mediaMatches(prelude, viewport, colorScheme))
			) {
				return;
			}

			if (["container", "media", "scope", "supports"].includes(name)) {
				visitBlock(node.block.children, layerName);
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

	// A layer's own rules beat its sublayers', and later layers beat earlier ones; unlayered
	// rules beat every layer.
	const ranked = [...layers].sort((a, b) => {
		const pa = a.split(".");
		const pb = b.split(".");
		for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
			if (pa[i] !== pb[i]) {
				const prefix = pa.slice(0, i).join(".");
				const ia = layers.indexOf(prefix ? `${prefix}.${pa[i]}` : pa[i]);
				const ib = layers.indexOf(prefix ? `${prefix}.${pb[i]}` : pb[i]);
				return ia - ib;
			}
		}

		return pb.length - pa.length;
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
	{
		rootFontSize = 16,
		viewport = DEFAULT_VIEWPORT,
	}: { rootFontSize?: number; viewport?: Viewport } = {},
): ComputedStyles {
	const styles = new Map<Element, ComputedStyle>();
	const markers = new Map<Element, ComputedStyle>();
	const pseudos: ComputedStyles["pseudos"] = new Map();
	const pseudoRules = new Set(rules.map((rule) => rule.pseudo));
	const length = (value: string, fontSize: number, percentBase = 0) =>
		toPx(value, fontSize, rootFontSize, percentBase, viewport);

	const matched = (el: Element, pseudo: CascadeRule["pseudo"]) =>
		rules.filter(
			(rule) => rule.pseudo === pseudo && matches(el, rule.selector),
		);

	const resolve = (
		el: Element,
		parent: StyleMap,
		pseudo?: CascadeRule["pseudo"],
		declaredOut?: string[],
	): ComputedStyle => {
		const style: StyleMap = {};
		for (const [key, value] of Object.entries(parent)) {
			if (INHERITED.has(key) || key.startsWith("--")) {
				style[key] = value;
			}
		}

		// Declarations in cascade order (later wins). Inline styles beat normal rules,
		// and !important beats both.
		const normal: Declaration[] = [];
		const important: Declaration[] = [];
		const applying = matched(el, pseudo);
		const byPrecedence = (layer: -1 | 1) => (a: CascadeRule, b: CascadeRule) =>
			layer * (a.layer - b.layer) ||
			a.specificity - b.specificity ||
			a.order - b.order;
		for (const rule of applying.toSorted(byPrecedence(1))) {
			normal.push(...rule.declarations.filter((d) => !d.important));
		}

		for (const rule of applying.toSorted(byPrecedence(-1))) {
			important.push(...rule.declarations.filter((d) => d.important));
		}

		const inline = pseudo ? null : el.getAttribute("style");
		if (inline) {
			for (const declaration of splitTopLevel(inline, ";")) {
				const colon = declaration.indexOf(":");
				if (colon >= 0) {
					normal.push({
						prop: declaration.slice(0, colon).trim().toLowerCase(),
						value: declaration.slice(colon + 1).trim(),
					});
				}
			}
		}

		const ordered = [...normal, ...important];

		// Custom properties first, so other values can use them; shorthands expand after var().
		for (const declaration of ordered) {
			if (declaration.prop.startsWith("--")) {
				style[declaration.prop] = declaration.value;
			}
		}

		for (const [key, value] of Object.entries(style)) {
			if (key.startsWith("--") && value !== undefined) {
				style[key] = resolveVars(value, style);
			}
		}

		const raw: StyleMap = {};
		for (const declaration of ordered) {
			if (!declaration.prop.startsWith("--")) {
				const value = resolveVars(declaration.value, style);
				Object.assign(raw, expand(declaration.prop, value));
				if (declaration.prop !== "content") {
					declaredOut?.push(`${declaration.prop}:${value}`);
				}
			}
		}

		for (const [key, value = ""] of Object.entries(raw)) {
			const keyword = value.trim();
			if (keyword === "inherit") {
				style[key] = parent[key] ?? initial(key);
			} else if (["initial", "revert", "unset"].includes(keyword)) {
				style[key] =
					INHERITED.has(key) && keyword !== "initial"
						? parent[key]
						: initial(key);
			} else {
				style[key] = keyword;
			}
		}

		// Font size first: em units elsewhere depend on it.
		const parentSize = parseFloat(parent["font-size"] ?? "") || rootFontSize;
		const fontSize =
			style["font-size"] === undefined || raw["font-size"] === undefined
				? parentSize
				: resolveFontSize(style["font-size"], parentSize, (value) =>
						length(value, parentSize),
					);
		style["font-size"] = `${String(fontSize)}px`;
		if (
			style["font-weight"] !== undefined &&
			raw["font-weight"] !== undefined
		) {
			style["font-weight"] = resolveWeight(
				style["font-weight"],
				Number(parent["font-weight"] ?? 400),
			);
		}

		if (
			style["letter-spacing"] !== undefined &&
			raw["letter-spacing"] !== undefined &&
			style["letter-spacing"] !== "normal"
		) {
			style["letter-spacing"] =
				`${String(length(style["letter-spacing"], fontSize))}px`;
		}

		const lineHeightValue = style["line-height"];
		if (lineHeightValue !== undefined && raw["line-height"] !== undefined) {
			// Unitless line heights inherit as factors; lengths inherit as px.
			style["line-height"] =
				lineHeightValue === "normal" || /^[\d.]+$/.test(lineHeightValue)
					? lineHeightValue
					: `${String(length(lineHeightValue, fontSize, fontSize))}px`;
		}

		const computed = {
			...INITIAL,
			...style,
			"line-height-px": "",
		} as ComputedStyle;

		// Flex and grid items, floats, and absolutely positioned elements are blockified.
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
					: `${String(length(value, fontSize))}px`);
		}

		for (const side of SIDES) {
			if (["hidden", "none"].includes(computed[`border-${side}-style`])) {
				computed[`border-${side}-width`] = "0px";
			}
		}

		const lineHeight = computed["line-height"];
		computed["line-height-px"] = String(
			lineHeight === "normal"
				? fontSize * 1.2
				: /^[\d.]+$/.test(lineHeight)
					? Number(lineHeight) * fontSize
					: length(lineHeight, fontSize, fontSize),
		);
		return computed;
	};

	const walk = (el: Element, parent: StyleMap) => {
		const style = resolve(el, parent);
		styles.set(el, style);
		if (el.tagName === "LI") {
			markers.set(el, resolve(el, style, "marker"));
		}

		if (style.display !== "none" && !REPLACED.has(el.tagName)) {
			for (const kind of ["before", "after"] as const) {
				if (!pseudoRules.has(kind) || !matched(el, kind).length) {
					continue;
				}

				const declared: string[] = [];
				const pseudoStyle = resolve(el, style, kind, declared);
				const text = contentText(pseudoStyle.content, el);
				if (text !== undefined && pseudoStyle.display !== "none") {
					pseudos.set(el, {
						...pseudos.get(el),
						[kind]: { css: declared.join(";"), style: pseudoStyle, text },
					});
				}
			}
		}

		for (const child of el.children) {
			walk(child, style);
		}
	};

	walk(document.documentElement, { "font-size": `${String(rootFontSize)}px` });
	return { markers, pseudos, styles };
}

/** The text a pseudo-element's `content` generates, or undefined when it generates none. */
export function contentText(
	value: string | undefined,
	el: Element,
): string | undefined {
	const content = value?.trim() ?? "";
	if (!content || content === "none" || content === "normal") {
		return undefined;
	}

	let text = "";
	for (const [token] of content.matchAll(
		/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[\w-]+\([^)]*\)|open-quote|close-quote|\//g,
	)) {
		if (token === "/") {
			// Alternative text for screen readers follows a slash.
			break;
		}

		if (token.startsWith('"') || token.startsWith("'")) {
			text += unescapeCss(token.slice(1, -1));
		} else if (token.startsWith("attr(")) {
			const name = token.slice(5, -1).trim().split(/[\s,]/)[0];
			text += el.getAttribute(name) ?? "";
		} else if (token === "open-quote") {
			text += "\u201C";
		} else if (token === "close-quote") {
			text += "\u201D";
		}
	}

	return text;
}

/** Unescapes a CSS string's escapes, like "\\2192 " for an arrow. */
export function unescapeCss(value: string) {
	return value.replace(
		/\\(?:([\da-f]{1,6})\s?|(\n)|(.))/gi,
		(_, hex?: string, newline?: string, char?: string) =>
			hex
				? String.fromCodePoint(parseInt(hex, 16))
				: newline
					? ""
					: (char ?? ""),
	);
}

/** The viewport lengths resolve against: the slide canvas, as Slidev exports it. */
export interface Viewport {
	height: number;
	width: number;
}

const LENGTH =
	/(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(rem|em|ex|ch|cap|px|pt|pc|in|cm|mm|q|%|[sld]?v(?:min|max|[whib]))?/gi;

/** Resolves a length, or a `calc()`, `min()`, `max()`, or `clamp()` expression, to px. */
export function toPx(
	value: string | undefined,
	fontSize: number,
	rootFontSize = 16,
	percentBase = 0,
	viewport: Viewport = { height: 0, width: 0 },
): number {
	const v = (value ?? "").trim().toLowerCase();
	if (!v || ["auto", "none", "normal"].includes(v)) {
		return 0;
	}

	const unit = (n: string, u: string) => {
		const num = Number(n);
		switch (u) {
			case "":
			case "px":
				return num;
			case "%":
				return (num / 100) * percentBase;
			case "cap":
				return num * fontSize * 0.7;
			case "ch":
				return num * fontSize * 0.6;
			case "cm":
				return (num * 96) / 2.54;
			case "em":
				return num * fontSize;
			case "ex":
				return num * fontSize * 0.5;
			case "in":
				return num * 96;
			case "mm":
				return (num * 96) / 25.4;
			case "pc":
				return num * 16;
			case "pt":
				return (num * 96) / 72;
			case "q":
				return (num * 96) / 101.6;
			case "rem":
				return num * rootFontSize;
		}

		// Viewport units, with small, large, and dynamic viewports all the canvas.
		const axis = u.replace(/^[sld]/, "");
		const size =
			axis === "vw" || axis === "vi"
				? viewport.width
				: axis === "vh" || axis === "vb"
					? viewport.height
					: axis === "vmin"
						? Math.min(viewport.width, viewport.height)
						: Math.max(viewport.width, viewport.height);
		return (num / 100) * size;
	};

	if (/^(?:calc|min|max|clamp)\(/.test(v) || /[+*/]|\s-\s/.test(v)) {
		const expression = v.replace(LENGTH, (_: string, n: string, u?: string) =>
			String(unit(n, u ?? "")),
		);
		return /^(?:[\d\s.e+\-*/(),]|calc|min|max|clamp)+$/.test(expression)
			? evaluateArithmetic(expression)
			: 0;
	}

	const match =
		/^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(rem|em|ex|ch|cap|px|pt|pc|in|cm|mm|q|%|[sld]?v(?:min|max|[whib]))?$/i.exec(
			v,
		);
	return match ? unit(match[1], (match.at(2) ?? "").toLowerCase()) : 0;
}

/** Evaluates + - * /, parentheses, and calc(), min(), max(), and clamp() over numbers. */
function evaluateArithmetic(expression: string): number {
	const tokens =
		expression.match(
			/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|calc|min|max|clamp|[+\-*/(),]/g,
		) ?? [];
	let i = 0;
	const args = (): number[] => {
		i++; // (
		const values = [sum()];
		while (tokens[i] === ",") {
			i++;
			values.push(sum());
		}

		i++; // )
		return values;
	};

	const factor = (): number => {
		const token = tokens[i];
		switch (token) {
			case "(": {
				i++;
				const value = sum();
				i++;
				return value;
			}
			case "-":
				i++;
				return -factor();
			case "calc":
				i++;
				return args()[0] ?? 0;
			case "clamp": {
				i++;
				const [low = 0, value = 0, high = 0] = args();
				return Math.max(low, Math.min(value, high));
			}
			case "max":
				i++;
				return Math.max(...args());
			case "min":
				i++;
				return Math.min(...args());
			default:
				i++;
				return Number(token);
		}
	};

	const product = (): number => {
		let value = factor();
		while (tokens[i] === "*" || tokens[i] === "/") {
			value = tokens[i++] === "*" ? value * factor() : value / factor();
		}

		return value;
	};

	const sum = (): number => {
		let value = product();
		while (tokens[i] === "+" || tokens[i] === "-") {
			value = tokens[i++] === "+" ? value + product() : value - product();
		}

		return value;
	};

	const result = sum();
	return Number.isFinite(result) ? result : 0;
}

/** Expands the shorthands decks commonly use into the longhands the exporter reads. */
function expand(prop: string, value: string): StyleMap {
	switch (prop) {
		case "-webkit-text-stroke": {
			const parts = splitTopLevel(value, " ");
			return {
				"-webkit-text-stroke-color": parts.at(1) ?? "currentcolor",
				"-webkit-text-stroke-width": parts.at(0),
			};
		}
		case "background":
			return expandBackground(value);
		case "border":
			return Object.assign(
				{},
				...SIDES.map((side) => expandBorder(`border-${side}`, value)),
			) as StyleMap;
		case "border-bottom":
		case "border-left":
		case "border-right":
		case "border-top":
			return expandBorder(prop, value);
		case "border-color":
		case "border-style":
		case "border-width":
			return expandSides(prop.replace("-", "-*-"), value);
		case "border-radius":
			return {
				"border-top-left-radius": splitTopLevel(value.split("/")[0], " ")[0],
			};
		case "columns": {
			const count = splitTopLevel(value, " ").find((part) =>
				/^\d+$/.test(part),
			);
			return count ? { "column-count": count } : {};
		}
		case "font": {
			const match =
				/(?:(\d{3}|bold|normal)\s+)?([\d.]+(?:px|rem|em|%))(?:\s*\/\s*([\w.%]+))?\s+(.+)/.exec(
					value,
				);
			if (!match) {
				return {};
			}

			return {
				"font-family": match[4],
				"font-size": match[2],
				...(match[1] ? { "font-weight": match[1] } : {}),
				...(match[3] ? { "line-height": match[3] } : {}),
			};
		}
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
			return expandSides(`${prop}-*`, value);
		case "text-decoration":
			return { "text-decoration-line": splitTopLevel(value, " ")[0] };
		default:
			return { [prop]: value };
	}
}

/** Expands the `background` shorthand's layers into their images, positions, sizes, repeats, and color. */
function expandBackground(value: string): StyleMap {
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
		// A slash between position and size may have no spaces around it.
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
				/^(?:scroll|fixed|local|(?:border|padding|content)-box|text)$/.test(
					part,
				)
			) {
				// Attachment, origin, and clip don't change a static export.
			} else if (
				/^(?:left|right|top|bottom|center|cover|contain|auto)$/.test(part) ||
				/^(?:-?[\d.]|calc\()/.test(part)
			) {
				(afterSlash ? size : position).push(part);
			} else {
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
function expandBorder(prefix: string, value: string): StyleMap {
	const out: StyleMap = {
		[`${prefix}-color`]: "currentcolor",
		[`${prefix}-style`]: "none",
		[`${prefix}-width`]: "medium",
	};
	for (const part of splitTopLevel(value, " ")) {
		if (BORDER_STYLES.has(part)) {
			out[`${prefix}-style`] = part;
		} else if (/^[\d.]+(?:px|rem|em)?$|^(?:thin|medium|thick)$/.test(part)) {
			out[`${prefix}-width`] = part;
		} else {
			out[`${prefix}-color`] = part;
		}
	}

	return out;
}

function expandSides(pattern: string, value: string): StyleMap {
	const [top, right = top, bottom = top, left = right] = splitTopLevel(
		value,
		" ",
	);
	return Object.fromEntries(
		[top, right, bottom, left].map((side, i) => [
			pattern.replace("*", SIDES[i]),
			side,
		]),
	);
}

function matches(el: Element, selector: string) {
	try {
		return el.matches(selector);
	} catch {
		return false;
	}
}

function mediaMatches(
	prelude: string,
	viewport: Viewport,
	colorScheme: "dark" | "light",
) {
	const text = prelude.toLowerCase();
	const scheme = /prefers-color-scheme:\s*(dark|light)/.exec(text)?.[1];
	if (
		(text.includes("print") && !/screen|all/.test(text)) ||
		(scheme && scheme !== colorScheme) ||
		/prefers-reduced-motion:\s*reduce/.test(text)
	) {
		return false;
	}

	for (const match of text.matchAll(
		/(min|max)-(width|height):\s*([\d.]+)(px|r?em)/g,
	)) {
		const limit = Number(match[3]) * (match[4] === "px" ? 1 : 16);
		const size = match[2] === "width" ? viewport.width : viewport.height;
		if (match[1] === "min" ? size < limit : size > limit) {
			return false;
		}
	}

	const orientation = /orientation:\s*(landscape|portrait)/.exec(text)?.[1];
	return (
		!orientation ||
		(orientation === "landscape") === viewport.width >= viewport.height
	);
}

function resolveFontSize(
	value: string,
	parentSize: number,
	length: (value: string) => number,
) {
	if (value in KEYWORD_SIZES) {
		return KEYWORD_SIZES[value];
	}

	if (value in RELATIVE_SIZES) {
		return parentSize * RELATIVE_SIZES[value];
	}

	if (value.endsWith("%")) {
		return (parseFloat(value) / 100) * parentSize;
	}

	if (value.endsWith("em") && !value.endsWith("rem")) {
		return parseFloat(value) * parentSize;
	}

	return length(value);
}

function resolveVars(value: string, style: StyleMap, depth = 0): string {
	if (depth > 20 || !value.includes("var(")) {
		return value;
	}

	// Innermost var() first, so fallbacks can contain var().
	const out = value.replace(
		/var\(\s*(--[\w-]+)\s*(?:,((?:[^()]|\([^()]*\))*))?\)/g,
		(_: string, name: string, fallback: string | undefined) => {
			const resolved = style[name];
			if (resolved) {
				return resolved;
			}

			return fallback?.trim() ?? "";
		},
	);
	return out === value ? out : resolveVars(out, style, depth + 1);
}

function resolveWeight(value: string, parentWeight: number) {
	switch (value) {
		case "bold":
			return "700";
		case "bolder":
			return parentWeight < 600 ? "700" : "900";
		case "lighter":
			return "300";
		case "normal":
			return "400";
		default:
			return String(Number(value) || 400);
	}
}

function specificity(selector: string): number {
	let ids = 0;
	let classes = 0;
	let types = 0;
	csstree.walk(
		csstree.parse(selector, { context: "selector" }),
		function (node) {
			switch (node.type) {
				case "AttributeSelector":
				case "ClassSelector":
					classes++;
					break;
				case "IdSelector":
					ids++;
					break;
				case "PseudoClassSelector": {
					if (node.name === "where") {
						return this.skip;
					}

					if (["has", "is", "not"].includes(node.name) && node.children) {
						// The specificity of the most specific argument.
						let best = 0;
						node.children.forEach((child) => {
							csstree.walk(child, (inner) => {
								if (inner.type === "Selector") {
									best = Math.max(best, specificity(csstree.generate(inner)));
								}
							});
						});
						ids += Math.floor(best / 1e6);
						classes += Math.floor((best % 1e6) / 1e3);
						types += best % 1e3;
						return this.skip;
					}

					classes++;
					break;
				}
				case "PseudoElementSelector":
					types++;
					break;
				case "TypeSelector":
					if (node.name !== "*") {
						types++;
					}

					break;
			}

			return undefined;
		},
	);
	return ids * 1e6 + classes * 1e3 + types;
}

/** Splits on a separator outside parentheses and strings (" " splits on any whitespace). */
function splitTopLevel(value: string, separator: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quote = "";
	let escaped = false;
	let current = "";
	for (const ch of value.trim()) {
		if (quote) {
			current += ch;
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === quote) {
				quote = "";
			}

			continue;
		}

		if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			depth--;
		}

		if (depth === 0 && (separator === " " ? /\s/.test(ch) : ch === separator)) {
			if (current) {
				out.push(current);
			}

			current = "";
		} else {
			current += ch;
		}
	}

	if (current) {
		out.push(current);
	}

	return out;
}
