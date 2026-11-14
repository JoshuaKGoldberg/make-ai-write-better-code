import type { ResolvedFontOptions } from "@slidev/types";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAssets } from "./assets.ts";
import { createCascade } from "./cascade.ts";
import { extractState } from "./extract.ts";
import { createFontBook } from "./fonts.ts";
import { createLayout } from "./layout.ts";

const canvas = { height: 300, width: 400 };
const fixture = path.join(import.meta.dirname, "fixture");
const baseSheet = `p, pre, li, h1, div, td { font-family: "Fixture Sans"; margin: 0 }`;
const fontOptions: ResolvedFontOptions = {
	italic: false,
	local: [],
	mono: [],
	provider: "none",
	sans: [],
	serif: [],
	webfonts: [],
	weights: [],
};
const circle = `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="red"/></svg>`;

describe(extractState, () => {
	let work = "";
	let extract: (
		html: string,
		sheet?: string,
	) => Promise<ReturnType<typeof extractState>>;

	beforeAll(async () => {
		work = await fs.mkdtemp(path.join(os.tmpdir(), "extract-test-"));
		const assets = createAssets({
			publicDir: path.join(fixture, "public"),
			root: fixture,
			work,
		});
		const layout = createLayout({ assets, canvas, colorScheme: "light" });
		await layout.registerFonts([
			{
				data: await fs.readFile(
					path.join(fixture, "fonts/league-spartan.woff2"),
				),
				name: "Fixture Sans",
			},
		]);
		extract = async (html, sheet = "") => {
			const sheets = [baseSheet, sheet];
			const rules = createCascade(sheets, {
				colorScheme: "light",
				viewport: canvas,
			});
			const laidOut = await layout.layoutState(
				layout.prepare(1, html, { rules }, {}),
				{ sheets },
			);
			return extractState(laidOut, {
				assets,
				canvas,
				fonts: createFontBook({ assets, fonts: fontOptions, sheets }),
			});
		};
	});

	afterAll(async () => {
		await fs.rm(work, { force: true, recursive: true });
	});

	it("exports a flex container's text when it's bare", async () => {
		const { items } = await extract(
			`<div style="display: flex; justify-content: center">Hello</div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "text",
				paragraphs: [{ runs: [expect.objectContaining({ text: "Hello" })] }],
			}),
		]);
	});

	it("draws an inline icon when bold text precedes it", async () => {
		const { items } = await extract(`<p><b>Bold</b> and ${circle}</p>`);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ text: "Bold" }),
							expect.objectContaining({ text: " and" }),
						],
					},
				],
			}),
			expect.objectContaining({ kind: "ellipse" }),
		]);
	});

	it("draws an empty inline-block when it sits in text", async () => {
		const { items } = await extract(
			`<p>Hi <span style="display: inline-block; width: 20px; height: 20px; background: red"></span> there</p>`,
		);

		expect(items).toContainEqual(
			expect.objectContaining({
				box: expect.objectContaining({ height: 20, width: 20 }),
				fill: { color: "ff0000", transparency: 0 },
				kind: "box",
			}),
		);
	});

	it("exports an inline-block's text when it sits in text", async () => {
		const { items } = await extract(
			`<p>Hi <span style="display: inline-block">badge</span> there</p>`,
		);

		expect(items).toContainEqual(
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "badge" })] }],
			}),
		);
	});

	it("splits a pre's text into lines when it has no highlighted lines", async () => {
		const { items } = await extract(`<pre>hello\nworld</pre>`);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "code",
				paragraphs: [
					{ runs: [expect.objectContaining({ text: "hello" })] },
					{ runs: [expect.objectContaining({ text: "world" })] },
				],
			}),
		]);
	});

	it("paints the bottom background layer first when there are several", async () => {
		const { items } = await extract(
			`<div style="width: 100px; height: 100px; background-image: linear-gradient(red, red), linear-gradient(blue, blue)"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				fill: expect.objectContaining({ color: "0000ff" }),
			}),
			expect.objectContaining({
				fill: expect.objectContaining({ color: "ff0000" }),
			}),
		]);
	});

	it("sizes a background image by its own layer when an earlier layer is none", async () => {
		const { items } = await extract(
			`<div style="width: 100px; height: 100px; background-image: none, url(/shape.svg); background-size: 10px 10px, cover; background-repeat: no-repeat"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				box: { height: 100, width: 100, x: 0, y: 0 },
				kind: "image",
			}),
		]);
	});

	it("fades a list item's text when the item has its own opacity", async () => {
		const { items } = await extract(
			`<ul><li>one</li><li style="opacity: 0.4">two</li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					expect.objectContaining({
						runs: [expect.objectContaining({ text: "one", transparency: 0 })],
					}),
					expect.objectContaining({
						runs: [expect.objectContaining({ text: "two", transparency: 60 })],
					}),
				],
			}),
		]);
	});

	it("keeps a nested list when its item has several inline elements", async () => {
		const { items } = await extract(
			`<ul><li>two <b>bold</b> and <i>it</i><ul><li>three</li></ul></li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					expect.objectContaining({ level: 0 }),
					expect.objectContaining({
						level: 1,
						runs: [expect.objectContaining({ text: "three" })],
					}),
				],
			}),
		]);
	});

	it("exports a container's blocks when inline content precedes them", async () => {
		const { items } = await extract(
			`<div><span>1</span> / <span>2</span><p>Scaled</p><div style="width: 10px; height: 10px; background: red"></div></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "Scaled" })] }],
			}),
			expect.objectContaining({
				box: { height: 10, width: 10, x: 0, y: 30 },
				kind: "box",
			}),
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ text: "1" }),
							expect.objectContaining({ text: " / " }),
							expect.objectContaining({ text: "2" }),
						],
					},
				],
			}),
		]);
	});

	it("draws generated content over its host when text precedes it", async () => {
		const { items } = await extract(
			`<div class="box">Boxed</div>`,
			`.box { position: relative; padding: 12px } .box::after { content: ""; position: absolute; inset: 0; border: 4px solid red }`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				box: expect.objectContaining({ x: 12, y: 12 }),
				kind: "text",
			}),
			expect.objectContaining({
				box: expect.objectContaining({ width: 400, x: 0, y: 0 }),
				kind: "box",
			}),
		]);
	});

	it("renders an SVG as a picture when it's rotated", async () => {
		const { items } = await extract(
			`<svg style="transform: rotate(45deg)" width="40" height="20" viewBox="0 0 40 20"><polygon points="0,0 40,0 40,20" fill="red"/></svg>`,
		);

		expect(items).toEqual([expect.objectContaining({ kind: "raster" })]);
	});

	it("draws an inline element's bottom border when it has one", async () => {
		const { items } = await extract(
			`<p>see <a href="https://example.com" style="border-bottom: 2px solid red">link</a> here</p>`,
		);

		expect(items).toContainEqual(
			expect.objectContaining({
				box: expect.objectContaining({ height: 2 }),
				fill: { color: "ff0000", transparency: 0 },
				kind: "box",
			}),
		);
	});

	it("leaves out the background color when backgrounds clip to text", async () => {
		const { items } = await extract(
			`<p style="background-color: white; background-image: linear-gradient(red, blue); -webkit-background-clip: text; color: transparent">Gradient</p>`,
		);

		expect(items).toEqual([expect.objectContaining({ kind: "text" })]);
	});

	it("angles an SVG gradient across the shape's box when its units are the bounding box", async () => {
		const { items } = await extract(
			`<svg width="200" height="50" viewBox="0 0 200 50"><linearGradient id="diagonal" x2="1" y2="1"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="transparent"/></linearGradient><ellipse cx="100" cy="25" rx="100" ry="25" fill="url(#diagonal)"/></svg>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				fill: expect.objectContaining({
					gradient: {
						angle: expect.closeTo(165.96, 2),
						stops: [
							{ color: "ff0000", position: 0, transparency: 0 },
							{ color: "000000", position: 100, transparency: 100 },
						],
					},
				}),
			}),
		]);
	});

	it("leaves out shapes when they're inside defs", async () => {
		const { items } = await extract(
			`<svg width="40" height="40" viewBox="0 0 40 40"><defs><circle id="c" cx="10" cy="10" r="8"/></defs><polygon points="0,0 40,0 40,40" fill="blue"/></svg>`,
		);

		expect(items).toEqual([expect.objectContaining({ kind: "polygon" })]);
	});

	it("keeps white space and newlines when white-space is pre", async () => {
		const { items } = await extract(
			`<p style="white-space: pre">a    b\nc</p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ text: "a    b" }),
							expect.objectContaining({ lineBreak: "forced", text: "c" }),
						],
					},
				],
			}),
		]);
	});

	it("renders math as one picture with its TeX as alt text", async () => {
		const { items } = await extract(
			`<p>Area: <span class="katex"><span class="katex-source" style="position: absolute; clip: rect(1px, 1px, 1px, 1px); width: 1px; height: 1px; overflow: hidden"><annotation encoding="application/x-tex">x^2</annotation></span><span class="katex-html" style="display: inline-block">x2</span></span></p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ kind: "text" }),
			expect.objectContaining({ alt: "x^2", kind: "raster" }),
		]);
	});

	it("reports a problem when an image doesn't load", async () => {
		const { problems } = await extract(
			`<img src="/missing.png" style="width: 10px; height: 10px">`,
		);

		expect(problems).toEqual(["Couldn't load the image /missing.png."]);
	});

	it("strikes text through when its decoration is line-through", async () => {
		const { items } = await extract(
			`<p><span style="text-decoration-line: line-through">old</span> new</p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ strike: true, text: "old" }),
							expect.objectContaining({ strike: false, text: " new" }),
						],
					},
				],
			}),
		]);
	});

	it("strikes text through when an ancestor's decoration is line-through", async () => {
		const { items } = await extract(`<p><del><strong>old</strong></del></p>`);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{ runs: [expect.objectContaining({ strike: true, text: "old" })] },
				],
			}),
		]);
	});

	it("underlines text when an ancestor's decoration is underline", async () => {
		const { items } = await extract(`<p><u><em>linked</em></u></p>`);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({
								text: "linked",
								underline: { style: "single" },
							}),
						],
					},
				],
			}),
		]);
	});

	it("underlines text in its decoration's style and color when they're set", async () => {
		const { items } = await extract(
			`<p style="color: #0000ff"><u style="text-decoration: underline wavy #ff0000">wavy</u></p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({
								text: "wavy",
								underline: { color: "ff0000", style: "wavy" },
							}),
						],
					},
				],
			}),
		]);
	});

	it("colors an underline as its decorating element's text when the text inside is another color", async () => {
		const { items } = await extract(
			`<p><a href="https://sli.dev" style="color: #0000ff"><span style="color: #ff0000">red</span></a></p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({
								color: "ff0000",
								text: "red",
								underline: { color: "0000ff", style: "single" },
							}),
						],
					},
				],
			}),
		]);
	});

	it("leaves the space before a link out of the link when an element precedes it", async () => {
		const { items } = await extract(
			`<p><b>bold</b> <a href="https://sli.dev">link</a></p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ href: undefined, text: "bold" }),
							expect.objectContaining({ href: undefined, text: " " }),
							expect.objectContaining({
								href: "https://sli.dev",
								text: "link",
							}),
						],
					},
				],
			}),
		]);
	});

	it("doesn't decorate an inline block's text when only its ancestor is decorated", async () => {
		const { items } = await extract(
			`<p><u>under <span style="display: inline-block">apart</span></u></p>`,
		);

		expect(items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					paragraphs: [
						{
							runs: [
								expect.objectContaining({
									text: "apart",
									underline: undefined,
								}),
							],
						},
					],
				}),
			]),
		);
	});

	it("marks items decorative when they're shapes or hidden from screen readers", async () => {
		const { items } = await extract(
			`<div style="width: 10px; height: 10px; background: red"></div><p aria-hidden="true">hidden</p><p>read</p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ decorative: true, kind: "box" }),
			expect.objectContaining({ decorative: true, kind: "text" }),
			expect.objectContaining({ decorative: false, kind: "text" }),
		]);
	});

	it("measures the span available to text as its nearest visible box's content box", async () => {
		const { items } = await extract(
			`<div style="box-sizing: border-box; width: 200px; padding: 10px; border: 1px solid black"><div><p style="width: 50px">card</p></div></div><p style="margin-left: 100px; width: 50px">page</p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ kind: "box" }),
			expect.objectContaining({
				style: expect.objectContaining({ available: { left: 11, right: 189 } }),
			}),
			expect.objectContaining({
				style: expect.objectContaining({ available: { left: 0, right: 400 } }),
			}),
		]);
	});

	it("aligns text right when its direction is right to left", async () => {
		const { items } = await extract(`<p dir="rtl">text</p>`);

		expect(items).toEqual([
			expect.objectContaining({
				style: expect.objectContaining({ align: "right" }),
			}),
		]);
	});

	it("exports a table's rows when they aren't in a tbody", async () => {
		const { items } = await extract(`<table><tr><td>cell</td></tr></table>`);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "cell" })] }],
			}),
		]);
	});

	it("leaves out a details element's body when it's closed", async () => {
		const { items } = await extract(
			`<details><summary>More</summary><p>Hidden</p></details>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "More" })] }],
			}),
		]);
	});

	it("draws a border over the background layers when a box has both", async () => {
		const { items } = await extract(
			`<div style="width: 100px; height: 50px; border: 4px solid red; background-color: black; background-image: linear-gradient(blue, green)"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				border: undefined,
				fill: { color: "000000", transparency: 0 },
			}),
			expect.objectContaining({
				fill: expect.objectContaining({ gradient: expect.anything() }),
			}),
			expect.objectContaining({
				border: { color: "ff0000", transparency: 0, width: 4 },
			}),
		]);
	});

	it("angles a corner gradient by its box's shape when it isn't square", async () => {
		const { items } = await extract(
			`<div style="width: 200px; height: 50px; background-image: linear-gradient(to right bottom, red, blue)"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				fill: expect.objectContaining({
					gradient: expect.objectContaining({
						angle: expect.closeTo(165.96, 2),
					}),
				}),
			}),
		]);
	});

	it("exports an inline-block once when it sits in a list item beside a nested list", async () => {
		const { items } = await extract(
			`<ul><li>two <span style="display: inline-block">badge</span><ul><li>three</li></ul></li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					expect.objectContaining({
						runs: [expect.objectContaining({ text: "two" })],
					}),
					expect.objectContaining({
						runs: [expect.objectContaining({ text: "three" })],
					}),
				],
			}),
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "badge" })] }],
			}),
		]);
	});

	it("exports a block's text apart when it sits inside an inline element", async () => {
		const { items } = await extract(
			`<p>lead <a href="https://example.com"><span>pre</span><div>card</div></a> tail</p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ text: "lead " }),
							expect.objectContaining({ text: "pre " }),
							expect.objectContaining({ lineBreak: "wrap", text: "tail" }),
						],
					},
				],
			}),
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "card" })] }],
			}),
		]);
	});

	it("exports a float's text apart when it sits in text", async () => {
		const { items } = await extract(
			`<p><span style="float: right">F</span>text here</p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{ runs: [expect.objectContaining({ text: "text here" })] },
				],
			}),
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "F" })] }],
			}),
		]);
	});

	it("leaves out a list item's marker when it sits inside the text", async () => {
		const { items } = await extract(
			`<ul><li style="list-style-position: inside">a <b>b</b></li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					expect.objectContaining({
						runs: [
							expect.objectContaining({ pad: true }),
							expect.objectContaining({ bold: false, text: "a " }),
							expect.objectContaining({ bold: true, text: "b" }),
						],
					}),
				],
			}),
		]);
	});

	it("pads a line's text past an icon when the icon starts the line", async () => {
		const { items } = await extract(`<p>${circle} Done</p>`);

		expect(items).toContainEqual(
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ pad: true, transparency: 100 }),
							expect.objectContaining({ text: " Done" }),
						],
					},
				],
			}),
		);
	});

	it("sizes a pill by its padding and border on every side", async () => {
		const { items } = await extract(
			`<p><span style="padding: 2px 4px 6px 8px; border: 1px solid red">x</span></p>`,
		);

		expect(items).toContainEqual(
			expect.objectContaining({
				border: expect.objectContaining({ color: "ff0000" }),
				box: {
					height: expect.closeTo(24.72, 2),
					width: expect.closeTo(22.07, 2),
					x: 0,
					y: expect.closeTo(-3.2, 2),
				},
			}),
		);
	});

	it("shows an element when it's visible inside a hidden one", async () => {
		const { items } = await extract(
			`<div style="visibility: hidden"><p>hidden</p><p style="visibility: visible">shown</p></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "shown" })] }],
			}),
		]);
	});

	it("marks text right to left when an ancestor's direction is", async () => {
		const { items } = await extract(
			`<div style="direction: rtl"><p>text</p></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				style: expect.objectContaining({ align: "right", rtl: true }),
			}),
		]);
	});

	it("exports a twoslash error when it sits between code lines", async () => {
		const { items } = await extract(
			`<pre><code><span class="line">one</span>\n<div class="twoslash-meta-line twoslash-error-line">error</div><span class="line">two</span></code></pre>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{ runs: [expect.objectContaining({ text: "one" })] },
					{ runs: [expect.objectContaining({ text: "error" })] },
					{ runs: [expect.objectContaining({ text: "two" })] },
				],
			}),
		]);
	});

	it("exports a twoslash query's type below its line when the query shows", async () => {
		const { items } = await extract(
			`<pre><code><span class="line"><span>let </span><span><span>name</span><span class="twoslash-popup-container"><div class="twoslash-popup-arrow"></div><code class="twoslash-popup-code"><span>let name: string</span></code></span></span><span> = ""</span></span></code></pre>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ text: "let " }),
							expect.objectContaining({ text: "name" }),
							expect.objectContaining({ text: ' = ""' }),
						],
					},
					{ runs: [expect.objectContaining({ text: "let name: string" })] },
				],
			}),
		]);
	});

	it("names math by its visible text when it has MathML", async () => {
		const { items } = await extract(
			`<p><span class="katex"><span class="katex-mathml" style="position: absolute; clip: rect(1px, 1px, 1px, 1px); width: 1px; height: 1px; overflow: hidden"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" style="display: inline-block">x2</span></span></p>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ alt: "x^2", kind: "raster", label: "x2" }),
		]);
	});

	it("measures the span available to text as the slide layout's content box when no box encloses it", async () => {
		const { items } = await extract(
			`<div class="slidev-layout" style="padding: 0 40px"><p style="width: 50px">text</p></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				style: expect.objectContaining({ available: { left: 40, right: 360 } }),
			}),
		]);
	});

	it("keys an element the same when generated content before it comes and goes", async () => {
		const sheet = `.on::before { content: "*" }`;
		const without = await extract(`<div><p>a</p><p>b</p></div>`, sheet);
		const with_ = await extract(
			`<div class="on"><p>a</p><p>b</p></div>`,
			sheet,
		);

		expect(with_.items.map(({ key }) => key)).toEqual([
			...without.items.map(({ key }) => key),
			expect.any(String),
		]);
	});
});
