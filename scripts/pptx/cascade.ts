/**
 * A small static CSS cascade. It resolves the computed values PowerPoint export
 * needs (colors, fonts, spacing, borders, transforms, ...) for every element of
 * a parsed document, without a browser: selector matching, specificity, cascade
 * order, !important, inheritance, custom properties, and length units.
 */
import * as csstree from "css-tree";

export interface CascadeRule {
	declarations: Declaration[];
	order: number;
	/** Rules for ::marker are kept apart from the element's own rules. */
	pseudo?: "marker";
	selector: string;
	specificity: number;
}

/** Values by property name, any of which may be missing. */
export type StyleMap = Partial<Record<string, string>>;

/** Computed values: properties with initial values are always present; others may be missing. */
export type ComputedStyle = Record<KnownProperty, string> & StyleMap;

export interface ComputedStyles {
	/** Each list item's ::marker style. */
	markers: Map<Element, ComputedStyle>;
	styles: Map<Element, ComputedStyle>;
}

interface Declaration {
	important?: boolean;
	prop: string;
	value: string;
}

type KnownProperty = "line-height-px" | keyof typeof INITIAL;

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
	{ viewportWidth = 980 } = {},
): CascadeRule[] {
	const rules: CascadeRule[] = [];
	let order = 0;

	const visitRule = (rule: csstree.Rule) => {
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
			if (pseudo && pseudo[1] !== "marker") {
				continue;
			}

			const base = pseudo
				? selector.replace(/::?marker\b/, "").trim() || "*"
				: selector.trim();
			let weight: number;
			try {
				weight = specificity(selector.trim());
			} catch {
				continue;
			}

			rules.push({
				declarations,
				order: order++,
				pseudo: pseudo ? "marker" : undefined,
				selector: base,
				specificity: weight,
			});
		}
	};

	const visitBlock = (children: csstree.List<csstree.CssNode>) => {
		children.forEach((node) => {
			if (node.type === "Rule") {
				visitRule(node);
			} else if (node.type === "Atrule" && node.block) {
				const name = node.name.toLowerCase();
				const prelude = node.prelude ? csstree.generate(node.prelude) : "";
				if (name === "media" && !mediaMatches(prelude, viewportWidth)) {
					return;
				}

				if (["container", "layer", "media", "supports"].includes(name)) {
					visitBlock(node.block.children);
				}
			}
		});
	};

	for (const sheet of [USER_AGENT_CSS, ...sheets]) {
		const ast = csstree.parse(sheet, {
			parseCustomProperty: false,
			parseValue: false,
		});
		if (ast.type === "StyleSheet") {
			visitBlock(ast.children);
		}
	}

	return rules;
}

/** Computes styles for every element of `document`. */
export function computeStyles(
	document: Document,
	rules: CascadeRule[],
	{ rootFontSize = 16 } = {},
): ComputedStyles {
	const styles = new Map<Element, ComputedStyle>();
	const markers = new Map<Element, ComputedStyle>();

	const matched = (el: Element, pseudo: CascadeRule["pseudo"]) =>
		rules
			.filter((rule) => rule.pseudo === pseudo && matches(el, rule.selector))
			.sort((a, b) => a.specificity - b.specificity || a.order - b.order);

	const resolve = (
		el: Element,
		parent: StyleMap,
		pseudo?: CascadeRule["pseudo"],
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
		for (const rule of matched(el, pseudo)) {
			for (const declaration of rule.declarations) {
				(declaration.important ? important : normal).push(declaration);
			}
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
				Object.assign(
					raw,
					expand(declaration.prop, resolveVars(declaration.value, style)),
				);
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
				: resolveFontSize(style["font-size"], parentSize, rootFontSize);
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
				`${String(toPx(style["letter-spacing"], fontSize, rootFontSize))}px`;
		}

		const lineHeightValue = style["line-height"];
		if (lineHeightValue !== undefined && raw["line-height"] !== undefined) {
			// Unitless line heights inherit as factors; lengths inherit as px.
			style["line-height"] =
				lineHeightValue === "normal" || /^[\d.]+$/.test(lineHeightValue)
					? lineHeightValue
					: `${String(toPx(lineHeightValue, fontSize, rootFontSize, fontSize))}px`;
		}

		const computed = {
			...INITIAL,
			...style,
			"line-height-px": "",
		} as ComputedStyle;

		// Flex and grid items are blockified.
		if (
			/flex|grid/.test(parent.display ?? "") &&
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
					: `${String(toPx(value, fontSize, rootFontSize))}px`);
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
					: toPx(lineHeight, fontSize, rootFontSize, fontSize),
		);
		return computed;
	};

	const walk = (el: Element, parent: StyleMap) => {
		const style = resolve(el, parent);
		styles.set(el, style);
		if (el.tagName === "LI") {
			markers.set(el, resolve(el, style, "marker"));
		}

		for (const child of el.children) {
			walk(child, style);
		}
	};

	walk(document.documentElement, { "font-size": `${String(rootFontSize)}px` });
	return { markers, styles };
}

/** Parses a CSS color into a hex string and alpha, or undefined for transparent/none. */
export function parseColor(
	value: string | undefined,
	current?: string,
): undefined | { a: number; hex: string } {
	if (!value) {
		return undefined;
	}

	const v = value.trim().toLowerCase();
	if (v === "transparent" || v === "none") {
		return undefined;
	}

	if (v === "currentcolor") {
		return current ? parseColor(current) : undefined;
	}

	const named: Record<string, string> = {
		black: "000000",
		red: "ff0000",
		white: "ffffff",
	};
	if (v in named) {
		return { a: 1, hex: named[v] };
	}

	const hex = /^#([\da-f]{3,8})$/.exec(v);
	if (hex) {
		const digits =
			hex[1].length <= 4 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
		return {
			a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
			hex: digits.slice(0, 6),
		};
	}

	const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
	if (rgb) {
		const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
		const channel = (part: string) =>
			part.endsWith("%") ? (parseFloat(part) / 100) * 255 : Number(part);
		const alphaPart = parts.at(3);
		const alpha =
			alphaPart === undefined
				? 1
				: alphaPart.endsWith("%")
					? parseFloat(alphaPart) / 100
					: Number(alphaPart);
		return {
			a: alpha,
			hex: parts
				.slice(0, 3)
				.map((part) => Math.round(channel(part)).toString(16).padStart(2, "0"))
				.join(""),
		};
	}

	return undefined;
}

/** Resolves a length or `calc()` expression to px. */
export function toPx(
	value: string | undefined,
	fontSize: number,
	rootFontSize = 16,
	percentBase = 0,
): number {
	const v = (value ?? "").trim();
	if (!v || ["auto", "none", "normal"].includes(v)) {
		return 0;
	}

	const unit = (n: string, u: string) => {
		const num = Number(n);
		switch (u) {
			case "%":
				return (num / 100) * percentBase;
			case "ch":
				return num * fontSize * 0.6;
			case "em":
				return num * fontSize;
			case "pt":
				return (num * 96) / 72;
			case "rem":
				return num * rootFontSize;
			default:
				return num;
		}
	};

	if (v.startsWith("calc(") || /[+*/]|\s-\s/.test(v)) {
		const expression = v
			.replace(/^calc/, "")
			.replace(
				/(-?[\d.]+)(px|rem|em|%|ch|pt)?/g,
				(_: string, n: string, u: string | undefined) =>
					String(unit(n, u ?? "")),
			);
		return /^[\d\s.+\-*/()]+$/.test(expression)
			? evaluateArithmetic(expression)
			: 0;
	}

	const match = /^(-?[\d.]+)(px|rem|em|%|ch|pt)?$/.exec(v);
	return match ? unit(match[1], match.at(2) ?? "") : 0;
}

/** Evaluates + - * / and parentheses over numbers, for resolved calc() expressions. */
function evaluateArithmetic(expression: string): number {
	const tokens = expression.match(/\d*\.?\d+|[+\-*/()]/g) ?? [];
	let i = 0;
	const factor = (): number => {
		const token = tokens[i++];
		if (token === "(") {
			const value = sum();
			i++;
			return value;
		}

		if (token === "-") {
			return -factor();
		}

		return Number(token);
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

	return sum();
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
			return /gradient\(|url\(/.test(value)
				? { "background-color": "transparent", "background-image": value }
				: { "background-color": value, "background-image": "none" };
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

function mediaMatches(prelude: string, viewportWidth: number) {
	const text = prelude.toLowerCase();
	if (
		(text.includes("print") && !/screen|all/.test(text)) ||
		/prefers-color-scheme:\s*light|prefers-reduced-motion:\s*reduce/.test(text)
	) {
		return false;
	}

	for (const match of text.matchAll(/(min|max)-width:\s*([\d.]+)px/g)) {
		const width = Number(match[2]);
		if (match[1] === "min" ? viewportWidth < width : viewportWidth > width) {
			return false;
		}
	}

	return true;
}

function resolveFontSize(
	value: string,
	parentSize: number,
	rootFontSize: number,
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

	return toPx(value, parentSize, rootFontSize);
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

/** Splits on a separator outside parentheses (" " splits on any whitespace). */
function splitTopLevel(value: string, separator: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of value.trim()) {
		if (ch === "(") {
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
