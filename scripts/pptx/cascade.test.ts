import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import {
	computeStyles,
	createCascade,
	lineHeightOf,
	resolveLength,
} from "./cascade.ts";

const viewport = { height: 600, width: 800 };

function stylesOf(
	html: string,
	css: string,
	colorScheme: "dark" | "light" = "light",
) {
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const computed = computeStyles(
		document,
		createCascade([css], { colorScheme, viewport }),
		{ viewport },
	);
	const element = (selector: string) =>
		document.querySelector(selector) ?? document.documentElement;
	const of = (selector: string) => computed.styles.get(element(selector));
	const pseudosOf = (selector: string) =>
		computed.pseudos.get(element(selector));

	return { computed, element, of, pseudosOf };
}

describe(resolveLength, () => {
	it.each([
		["12px", 12],
		["2rem", 40],
		["1.5em", 15],
		["50%", 50],
		["10vw", 80],
		["10vh", 60],
		["10vmin", 60],
		["10vmax", 80],
		["10dvh", 60],
		["1in", 96],
		["72pt", 96],
		["calc(100% - 2rem)", 60],
		["min(10px, 2em)", 10],
		["max(10px, 2em)", 20],
		["clamp(50px, 20vw, 400px)", 160],
		["clamp(1rem, 1vw, 3rem)", 20],
		["calc(2 * (1rem + 4px))", 48],
	])("resolves %s against its context", (value, expected) => {
		expect(
			resolveLength(value, {
				fontSize: 10,
				percentBase: 100,
				rootFontSize: 20,
				viewport,
			}),
		).toBeCloseTo(expected);
	});

	it("returns 0 when the value is a keyword", () => {
		expect(
			resolveLength("auto", { fontSize: 10, rootFontSize: 16, viewport }),
		).toBe(0);
	});
});

describe(createCascade, () => {
	it("orders layers by declaration, below unlayered rules", () => {
		const { of } = stylesOf(
			`<p class="a">a</p><p class="b">b</p>`,
			`@layer base, override;
			@layer override { .a { color: lime } }
			@layer base { #x, .a { color: red } .b { color: red } }
			p { color: teal }`,
		);
		expect([of(".a")?.color, of(".b")?.color]).toEqual(["teal", "teal"]);
	});

	it("lets later layers win when an earlier layer's selector is more specific", () => {
		const { of } = stylesOf(
			`<p id="x" class="a">a</p>`,
			`@layer one { #x { color: red } } @layer two { p { color: lime } }`,
		);
		expect(of("p")?.color).toBe("lime");
	});

	it("reverses layer order when declarations are !important", () => {
		const { of } = stylesOf(
			`<p>a</p>`,
			`@layer one { p { color: lime !important } } @layer two { p { color: red !important } } p { color: blue }`,
		);
		expect(of("p")?.color).toBe("lime");
	});

	it.each([
		["light", "black"],
		["dark", "white"],
	] as const)(
		"matches prefers-color-scheme when exporting in %s",
		(colorScheme, color) => {
			const { of } = stylesOf(
				`<p>a</p>`,
				`p { color: black } @media (prefers-color-scheme: dark) { p { color: white } }`,
				colorScheme,
			);
			expect(of("p")?.color).toBe(color);
		},
	);

	it.each([
		["not print", "lime"],
		["print", "red"],
		["print, (min-width: 10px)", "lime"],
		["screen and (max-width: 700px)", "red"],
		["(min-width: 50em)", "lime"],
		["(width <= 600px)", "red"],
		["(600px < width <= 900px)", "lime"],
		["(orientation: portrait)", "red"],
		["(prefers-reduced-motion: reduce)", "red"],
		["not all and (monochrome)", "red"],
	])("evaluates @media %s against the canvas", (query, color) => {
		const { of } = stylesOf(
			`<p>a</p>`,
			`p { color: red } @media ${query} { p { color: lime } }`,
		);
		expect(of("p")?.color).toBe(color);
	});

	it("scopes rules in @scope to their root", () => {
		const { of } = stylesOf(
			`<div class="card"><p class="inside">a</p></div><p class="outside">b</p>`,
			`@scope (.card) { p { color: lime } :scope { color: teal } }`,
		);
		expect([
			of(".card")?.color,
			of(".inside")?.color,
			of(".outside")?.color,
		]).toEqual(["teal", "lime", "#000000"]);
	});

	it("weighs :is() by its most specific argument and :where() as nothing", () => {
		const { of } = stylesOf(
			`<p id="x" class="a">a</p>`,
			`:is(#x, p) { color: lime } .a { color: red } :where(#x) { background-color: red } p { background-color: lime }`,
		);
		expect(of("p")).toMatchObject({
			"background-color": "lime",
			color: "lime",
		});
	});
});

describe(computeStyles, () => {
	it("expands background layers", () => {
		const { of } = stylesOf(
			`<div>a</div>`,
			`div { background: linear-gradient(#0005, #0008), url("/a b.png") center/cover no-repeat fixed #123 }`,
		);
		expect(of("div")).toMatchObject({
			"background-color": "#123",
			"background-image": `linear-gradient(#0005, #0008), url("/a b.png")`,
			"background-position": "0% 0%, center",
			"background-repeat": "repeat, no-repeat",
			"background-size": "auto, cover",
		});
	});

	it("keeps quoted list-style markers whole", () => {
		const { of } = stylesOf(
			`<ul><li>a</li></ul>`,
			`ul { list-style: "\\2192  " inside }`,
		);
		expect(of("li")?.["list-style-type"]).toBe(`"\\2192  "`);
	});

	it("blockifies absolutely positioned elements", () => {
		const { of } = stylesOf(`<span>a</span>`, `span { position: absolute }`);
		expect(of("span")?.display).toBe("block");
	});

	it("lets inline !important beat a rule's !important", () => {
		const { of } = stylesOf(
			`<p style="color: lime !important">a</p>`,
			`p { color: red !important }`,
		);
		expect(of("p")?.color).toBe("lime");
	});

	it("resolves rem against the root element's font size", () => {
		const { of } = stylesOf(
			`<p>a</p>`,
			`html { font-size: 20px; padding-left: 1rem } p { padding-left: 1rem }`,
		);
		expect([of("html")?.["padding-left"], of("p")?.["padding-left"]]).toEqual([
			"16px",
			"20px",
		]);
	});

	it("treats a var() with no value or fallback as unset", () => {
		const { of } = stylesOf(
			`<div><p>a</p></div>`,
			`div { color: red; padding-left: 4px } p { color: var(--missing); padding-left: var(--missing) }`,
		);
		expect(of("p")).toMatchObject({ color: "red", "padding-left": "0px" });
	});

	it("uses a var()'s fallback when its property is missing", () => {
		const { of } = stylesOf(
			`<p>a</p>`,
			`p { color: var(--missing, var(--also-missing, lime)) }`,
		);
		expect(of("p")?.color).toBe("lime");
	});

	it("resolves inherit, initial, and unset", () => {
		const { of } = stylesOf(
			`<div><p class="a">a</p><p class="b">b</p><p class="c">c</p></div>`,
			`div { color: red; padding-left: 4px } p { color: blue } .a { padding-left: inherit } .b { color: initial } .c { color: unset }`,
		);
		expect([
			of(".a")?.["padding-left"],
			of(".b")?.color,
			of(".c")?.color,
		]).toEqual(["4px", "#000000", "red"]);
	});

	it.each([
		["200", "bolder", "400"],
		["400", "bolder", "700"],
		["600", "bolder", "900"],
		["300", "lighter", "100"],
		["700", "lighter", "400"],
		["900", "lighter", "700"],
	])(
		"resolves a font weight of %s made %s",
		(parentWeight, keyword, weight) => {
			const { of } = stylesOf(
				`<div><p>a</p></div>`,
				`div { font-weight: ${parentWeight} } p { font-weight: ${keyword} }`,
			);
			expect(of("p")?.["font-weight"]).toBe(weight);
		},
	);

	it("expands the font shorthand, resetting what it leaves out", () => {
		const { of } = stylesOf(
			`<p class="a">a</p><p class="b">b</p>`,
			`p { font-weight: 700; line-height: 3 } .a { font: italic bold 12px/1.5 "Some Font", serif } .b { font: 10px serif }`,
		);
		expect([of(".a"), of(".b")]).toEqual([
			expect.objectContaining({
				"font-family": `"Some Font", serif`,
				"font-size": "12px",
				"font-style": "italic",
				"font-weight": "700",
				"line-height": "1.5",
			}),
			expect.objectContaining({
				"font-family": "serif",
				"font-size": "10px",
				"font-style": "normal",
				"font-weight": "400",
				"line-height": "normal",
			}),
		]);
	});

	it.each([
		["1pt solid red", "1.3333333333333333px", "solid", "red"],
		["thin dashed", "1px", "dashed", "currentcolor"],
		["calc(2px + 1px) solid blue", "3px", "solid", "blue"],
		["2px none", "0px", "none", "currentcolor"],
	])("expands border: %s", (value, width, style, color) => {
		const { of } = stylesOf(`<p>a</p>`, `p { border: ${value} }`);
		expect(of("p")).toMatchObject({
			"border-left-color": color,
			"border-left-style": style,
			"border-left-width": width,
			"border-top-width": width,
		});
	});

	it("expands inset, columns, and -webkit-text-stroke", () => {
		const { of } = stylesOf(
			`<p>a</p>`,
			`p { inset: 1px 2px; columns: 12em 3; -webkit-text-stroke: 2px red }`,
		);
		expect(of("p")).toMatchObject({
			"-webkit-text-stroke-color": "red",
			"-webkit-text-stroke-width": "2px",
			bottom: "1px",
			"column-count": "3",
			left: "2px",
			right: "2px",
			top: "1px",
		});
	});

	it.each([
		["normal", "normal", 24],
		["1.5", "1.5", 30],
		["150%", "30px", 30],
		["2em", "40px", 40],
	])("computes a line height of %s", (value, lineHeight, pixels) => {
		const { of } = stylesOf(
			`<p>a</p>`,
			`p { font-size: 20px; line-height: ${value} }`,
		);
		const style = of("p");
		expect([style?.["line-height"], style && lineHeightOf(style)]).toEqual([
			lineHeight,
			pixels,
		]);
	});

	it("computes list items' ::marker styles", () => {
		const { computed, element } = stylesOf(
			`<ul><li>a</li></ul>`,
			`li { color: red } li::marker { color: lime }`,
		);
		expect(computed.markers.get(element("li"))?.color).toBe("lime");
	});

	it("applies SVG presentation attributes below CSS rules, and inherits them", () => {
		const { of } = stylesOf(
			`<svg><g fill="red" stroke-width="3"><polygon class="a" /><polygon class="b" fill="blue" /></g></svg>`,
			`.b { fill: lime }`,
		);
		expect([of(".a"), of(".b")]).toEqual([
			expect.objectContaining({ fill: "red", "stroke-width": "3" }),
			expect.objectContaining({ fill: "lime", "stroke-width": "3" }),
		]);
	});

	it("computes ::before and ::after content with its declarations", () => {
		const { pseudosOf } = stylesOf(
			`<p class="tag" data-label="new">a</p>`,
			`:root { --gold: goldenrod } .tag::before { content: "\\2605  " attr(data-label); color: var(--gold) } .tag::after { content: none }`,
		);
		expect(pseudosOf(".tag")).toEqual({
			before: expect.objectContaining({
				css: "color:goldenrod",
				text: "★ new",
			}),
		});
	});

	it.each([
		[`"a" "b"`, "ab"],
		[`attr(title) "!"`, "hi!"],
		[`open-quote "x" close-quote`, "“x”"],
		[`"icon" / "alt text"`, "icon"],
		[`""`, ""],
	])("generates %s as content", (content, text) => {
		const { pseudosOf } = stylesOf(
			`<p title="hi">a</p>`,
			`p::after { content: ${content} }`,
		);
		expect(pseudosOf("p")?.after?.text).toBe(text);
	});

	it.each(["none", "normal"])(
		"generates nothing when content is %s",
		(content) => {
			const { pseudosOf } = stylesOf(
				`<p>a</p>`,
				`p::after { content: ${content} }`,
			);
			expect(pseudosOf("p")).toBeUndefined();
		},
	);

	it.each(["img", "svg"])(
		"generates no ::before content when the element is a replaced %s",
		(tag) => {
			const { pseudosOf } = stylesOf(
				`<${tag} class="x"></${tag}>`,
				`.x::before { content: "a" }`,
			);
			expect(pseudosOf(".x")).toBeUndefined();
		},
	);
});
