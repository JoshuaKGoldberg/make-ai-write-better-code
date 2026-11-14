import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { computeStyles, contentText, createCascade, toPx } from "./cascade.ts";

const viewport = { height: 600, width: 800 };

function stylesOf(html: string, css: string, options = {}) {
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const computed = computeStyles(
		document,
		createCascade([css], { viewport, ...options }),
		{ viewport },
	);
	const of = (selector: string) => {
		const el = document.querySelector(selector);
		return el ? computed.styles.get(el) : undefined;
	};

	return { computed, document, of };
}

describe(toPx, () => {
	it.each([
		["12px", 12],
		["2rem", 32],
		["1.5em", 15],
		["50%", 50],
		["10vw", 80],
		["10vh", 60],
		["10vmin", 60],
		["1in", 96],
		["72pt", 96],
		["calc(100% - 2rem)", 68],
		["min(10px, 2em)", 10],
		["max(10px, 2em)", 20],
		["clamp(50px, 20vw, 400px)", 160],
		["clamp(1rem, 1vw, 3rem)", 16],
		["calc(2 * (1rem + 4px))", 40],
	])("resolves %s", (value, expected) => {
		expect(toPx(value, 10, 16, 100, viewport)).toBeCloseTo(expected);
	});

	it("returns 0 for keywords", () => {
		expect(toPx("auto", 10)).toBe(0);
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
		expect(of(".a")?.color).toBe("teal");
		expect(of(".b")?.color).toBe("teal");
	});

	it("lets later layers beat earlier ones regardless of specificity", () => {
		const { of } = stylesOf(
			`<p id="x" class="a">a</p>`,
			`@layer one { #x { color: red } } @layer two { p { color: lime } }`,
		);
		expect(of("p")?.color).toBe("lime");
	});

	it("reverses layer order for !important", () => {
		const { of } = stylesOf(
			`<p>a</p>`,
			`@layer one { p { color: lime !important } } @layer two { p { color: red !important } } p { color: blue }`,
		);
		expect(of("p")?.color).toBe("lime");
	});

	it("matches prefers-color-scheme to the export's color scheme", () => {
		const css = `p { color: black } @media (prefers-color-scheme: dark) { p { color: white } }`;
		expect(stylesOf(`<p>a</p>`, css).of("p")?.color).toBe("black");
		expect(
			stylesOf(`<p>a</p>`, css, { colorScheme: "dark" }).of("p")?.color,
		).toBe("white");
	});
});

describe(computeStyles, () => {
	it("expands background layers", () => {
		const { of } = stylesOf(
			`<div>a</div>`,
			`div { background: linear-gradient(#0005, #0008), url("/a b.png") center/cover no-repeat #123 }`,
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

	it("computes ::before and ::after content with its declarations", () => {
		const { computed, document } = stylesOf(
			`<p class="tag" data-label="new">a</p>`,
			`:root { --gold: goldenrod } .tag::before { content: "\\2605  " attr(data-label); color: var(--gold) } .tag::after { content: none }`,
		);
		const tag = document.querySelector(".tag");
		const pseudos = tag ? computed.pseudos.get(tag) : undefined;
		expect(pseudos?.before).toMatchObject({
			css: "color:goldenrod",
			text: "★ new",
		});
		expect(pseudos?.after).toBeUndefined();
	});
});

describe(contentText, () => {
	const { document } = parseHTML(`<p title="hi"></p>`);
	const el = document.querySelector("p") as Element;

	it.each([
		[`"a" "b"`, "ab"],
		[`attr(title) "!"`, "hi!"],
		[`open-quote "x" close-quote`, "“x”"],
		[`"icon" / "alt text"`, "icon"],
		[`""`, ""],
	])("generates %s", (value, text) => {
		expect(contentText(value, el)).toBe(text);
	});

	it.each(["none", "normal", undefined])(
		"generates nothing for %s",
		(value) => {
			expect(contentText(value, el)).toBeUndefined();
		},
	);
});
