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
				backdrop: "FFFFFF",
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
				fill: { color: "FF0000", transparency: 0 },
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
				fill: {
					gradient: expect.objectContaining({
						stops: [
							{ color: "0000FF", position: 0, transparency: 0 },
							{ color: "0000FF", position: 100, transparency: 0 },
						],
					}),
				},
			}),
			expect.objectContaining({
				fill: {
					gradient: expect.objectContaining({
						stops: [
							{ color: "FF0000", position: 0, transparency: 0 },
							{ color: "FF0000", position: 100, transparency: 0 },
						],
					}),
				},
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
				fill: { color: "FF0000", transparency: 0 },
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
							{ color: "FF0000", position: 0, transparency: 0 },
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
								underline: { color: "FF0000", style: "wavy" },
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
								color: "FF0000",
								text: "red",
								underline: { color: "0000FF", style: "single" },
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
				border: { color: "FF0000", transparency: 0, width: 4 },
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
				border: expect.objectContaining({ color: "FF0000" }),
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

	it("exports a twoslash query's type below its line, under its token, when the query shows", async () => {
		const { items } = await extract(
			`<pre><code><span class="line"><span>let </span><span><span>name</span><span class="twoslash-popup-container" style="position: absolute"><div class="twoslash-popup-arrow"></div><code class="twoslash-popup-code"><span>let name: string</span></code></span></span><span> = ""</span></span></code></pre>`,
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
					{
						runs: [
							expect.objectContaining({ pad: true }),
							expect.objectContaining({ text: "let name: string" }),
						],
					},
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

	it("draws a pill behind inline code when it sits in a list item", async () => {
		const { items } = await extract(
			`<ul><li>Run <code style="background: red">npm</code> first</li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				fill: { color: "FF0000", transparency: 0 },
				kind: "box",
			}),
			expect.objectContaining({ kind: "list" }),
		]);
	});

	it("keeps a list native when an item holds a block without text of its own", async () => {
		const { items } = await extract(
			`<ul><li>Install<div><pre>npm i</pre></div></li><li>Run</li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "list",
				paragraphs: [
					expect.objectContaining({
						bullet: true,
						runs: [expect.objectContaining({ text: "Install" })],
					}),
					expect.objectContaining({
						bullet: true,
						runs: [expect.objectContaining({ text: "Run" })],
					}),
				],
			}),
			expect.objectContaining({
				kind: "code",
				paragraphs: [{ runs: [expect.objectContaining({ text: "npm i" })] }],
			}),
		]);
	});

	it("leaves out a list's bullet color when it's the text's", async () => {
		const { items } = await extract(`<ul style="color: red"><li>red</li></ul>`);

		expect(items).toEqual([
			expect.objectContaining({ bulletColor: undefined, kind: "list" }),
		]);
	});

	it("colors a list's bullets when the marker's color isn't the text's", async () => {
		const { items } = await extract(
			`<ul><li>black</li></ul>`,
			`li::marker { color: blue }`,
		);

		expect(items).toEqual([
			expect.objectContaining({ bulletColor: "0000FF", kind: "list" }),
		]);
	});

	it("places an item's bullet a line above its nested list when the nested list starts it", async () => {
		const { items } = await extract(
			`<ul style="line-height: 20px"><li><ul><li>nested</li></ul></li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					expect.objectContaining({ baselines: [expect.closeTo(9.54)] }),
					expect.objectContaining({ baselines: [expect.closeTo(29.54)] }),
				],
			}),
		]);
	});

	it("places a code block's first baseline on its first line when that line is blank", async () => {
		const { items } = await extract(
			`<pre style="line-height: 20px"><span class="line"></span>\n<span class="line">second</span></pre>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				baselines: [expect.closeTo(13.54), expect.closeTo(33.54)],
				kind: "code",
			}),
		]);
	});

	it("leaves out text when its ancestor's overflow clips it away", async () => {
		const { items } = await extract(
			`<div style="height: 30px; overflow: hidden"><p>one</p><p>two</p><p>three</p></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "one" })] }],
			}),
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "two" })] }],
			}),
		]);
	});

	it("leaves out a code block's lines when its wrapper's overflow clips them", async () => {
		const { items } = await extract(
			`<div style="max-height: 30px; overflow-y: auto"><pre style="line-height: 15px"><span class="line">a</span>\n<span class="line">b</span>\n<span class="line">c</span></pre></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				box: { height: 30, width: 400, x: 0, y: 0 },
				kind: "code",
				paragraphs: [
					{ runs: [expect.objectContaining({ text: "a" })] },
					{ runs: [expect.objectContaining({ text: "b" })] },
				],
			}),
		]);
	});

	it("crops an image and rounds it when a rounded ancestor's overflow clips it", async () => {
		const { items } = await extract(
			`<div style="width: 40px; height: 20px; overflow: hidden; border-radius: 6px"><img src="/photo.png" style="width: 40px; height: 40px"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				box: { height: 20, width: 40, x: 0, y: 0 },
				crop: { height: 40, width: 40, x: 0, y: 0 },
				kind: "image",
				radius: 6,
			}),
		]);
	});

	it("doesn't clip an absolutely positioned box when the clipping ancestor isn't its containing block", async () => {
		const { items } = await extract(
			`<div style="position: relative"><div style="width: 50px; height: 20px; overflow: hidden"><div style="position: absolute; width: 100px; height: 100px; background: red"></div></div></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				box: { height: 100, width: 100, x: 0, y: 0 },
				kind: "box",
			}),
		]);
	});

	it("keeps rotated text when only its turned corner shows inside a clip", async () => {
		const { items } = await extract(
			`<div style="width: 300px; height: 100px; overflow: hidden"><p style="margin-top: 102px; transform: rotate(-8deg)">rotated</p></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [{ runs: [expect.objectContaining({ text: "rotated" })] }],
			}),
		]);
	});

	it("gives a box its shadow when it has a box-shadow", async () => {
		const { items } = await extract(
			`<div style="width: 10px; height: 10px; background: red; box-shadow: 0 2px 4px blue"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "box",
				shadow: {
					blur: 4,
					color: "0000FF",
					offsetX: 0,
					offsetY: 2,
					transparency: 0,
				},
			}),
		]);
	});

	it("gives an image its shadow when it has a box-shadow", async () => {
		const { items } = await extract(
			`<img src="/photo.png" style="width: 10px; box-shadow: 0 0 8px rgb(0 0 0 / 50%)">`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "image",
				shadow: {
					blur: 8,
					color: "000000",
					offsetX: 0,
					offsetY: 0,
					transparency: 50,
				},
			}),
		]);
	});

	it("splits a list into one list per column when it lays out in columns", async () => {
		const { items } = await extract(
			`<div style="column-count: 2"><ol><li>one</li><li>two</li><li>three</li><li>four</li></ol></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				box: expect.objectContaining({ x: 0 }),
				paragraphs: [
					expect.objectContaining({ number: 1 }),
					expect.objectContaining({ number: 2 }),
				],
			}),
			expect.objectContaining({
				box: expect.objectContaining({ x: 188 }),
				paragraphs: [
					expect.objectContaining({ number: 3 }),
					expect.objectContaining({ number: 4 }),
				],
			}),
		]);
	});

	it("colors a list's markers when an item starts with a spacer", async () => {
		const { items } = await extract(
			`<ul><li><code style="padding: 0 4px; background: #eee">x</code> text</li></ul>`,
		);

		expect(items).toContainEqual(
			expect.objectContaining({ bulletColor: "000000", kind: "list" }),
		);
	});

	it("colors a list's markers when an item's first run is hidden", async () => {
		const { items } = await extract(
			`<ul><li><span style="opacity: 0">Revealed</span> then the rest</li></ul>`,
		);

		expect(items).toContainEqual(
			expect.objectContaining({ bulletColor: "000000", kind: "list" }),
		);
	});

	it("leaves a list's markers uncolored when they match the text", async () => {
		const { items } = await extract(`<ul><li>text</li></ul>`);

		expect(items).toEqual([
			expect.objectContaining({ bulletColor: undefined, kind: "list" }),
		]);
	});

	it("gives an item a spacer paragraph to mark when it starts with a block", async () => {
		const { items } = await extract(
			`<ol><li>one</li><li><div style="height: 20px; background: red"></div></li><li>three</li></ol>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "list",
				paragraphs: [
					expect.objectContaining({
						bullet: true,
						number: 1,
						runs: [expect.objectContaining({ text: "one" })],
					}),
					expect.objectContaining({
						bullet: true,
						number: 2,
						runs: [
							expect.objectContaining({
								pad: true,
								text: "\u00A0",
								transparency: 100,
							}),
						],
					}),
					expect.objectContaining({
						bullet: true,
						number: 3,
						runs: [expect.objectContaining({ text: "three" })],
					}),
				],
			}),
			expect.objectContaining({ fill: { color: "FF0000", transparency: 0 } }),
		]);
	});

	it("keeps a list as one list when click animations offset its hidden items", async () => {
		const { items } = await extract(
			`<ul><li>one</li><li style="translate: 20px 0; opacity: 0">two</li><li style="scale: 0.9; opacity: 0">three</li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				key: "ul0#list",
				paragraphs: [
					expect.objectContaining({ visible: true }),
					expect.objectContaining({ visible: false }),
					expect.objectContaining({ visible: false }),
				],
			}),
		]);
	});

	it("leaves out a list item and its number when it isn't displayed", async () => {
		const { items } = await extract(
			`<ol><li style="display: none">zero</li><li>one</li><li style="display: none">mid</li><li>two</li></ol>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					expect.objectContaining({
						number: 1,
						runs: [expect.objectContaining({ text: "one" })],
					}),
					expect.objectContaining({
						number: 2,
						runs: [expect.objectContaining({ text: "two" })],
					}),
				],
			}),
		]);
	});

	it.each([
		[2, [5, 5]],
		[3, [4, 4, 2]],
	])(
		"balances ten items into %i columns when their line height is fractional",
		async (count, lengths) => {
			const { items } = await extract(
				`<div style="column-count: ${String(count)}"><ol style="line-height: 1.8em"><li>1</li><li>2</li><li>3</li><li>4</li><li>5</li><li>6</li><li>7</li><li>8</li><li>9</li><li>10</li></ol></div>`,
			);

			expect(
				items.map((item) => "paragraphs" in item && item.paragraphs.length),
			).toEqual(lengths);
		},
	);

	it("exports a list's items as cards when its grid lays them side by side", async () => {
		const { items } = await extract(
			`<ul style="display: grid; grid-template-columns: 1fr 1fr; list-style: none"><li style="background: #eee">A</li><li style="background: #eee">B</li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ key: "ul0/li0#box", kind: "box" }),
			expect.objectContaining({
				kind: "text",
				paragraphs: [{ runs: [expect.objectContaining({ text: "A" })] }],
			}),
			expect.objectContaining({ key: "ul0/li1#box", kind: "box" }),
			expect.objectContaining({
				kind: "text",
				paragraphs: [{ runs: [expect.objectContaining({ text: "B" })] }],
			}),
		]);
	});

	it("exports a list's items as marked lists when its grid lays them side by side", async () => {
		const { items } = await extract(
			`<ol start="3" style="display: grid; grid-template-columns: 1fr 1fr"><li>A</li><li>B</li></ol>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				key: "ol0/li0#list",
				kind: "list",
				paragraphs: [
					expect.objectContaining({
						bullet: true,
						marker: "decimal",
						number: 3,
						runs: [expect.objectContaining({ text: "A" })],
					}),
				],
			}),
			expect.objectContaining({
				key: "ol0/li1#list",
				kind: "list",
				paragraphs: [
					expect.objectContaining({
						bullet: true,
						marker: "decimal",
						number: 4,
						runs: [expect.objectContaining({ text: "B" })],
					}),
				],
			}),
		]);
	});

	it("exports a flex column's items as one list when hidden items are moved up", async () => {
		const { items } = await extract(
			`<ul style="display: flex; flex-direction: column"><li>A</li><li style="translate: 0 -20px; opacity: 0">B</li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ key: "ul0#list", kind: "list" }),
		]);
	});

	it("renders a list item as a picture when PowerPoint can't draw its background", async () => {
		const { items } = await extract(
			`<ul><li style="background-image: radial-gradient(red, blue)">a<pre>code</pre></li><li>b</li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ key: "ul0/li0#raster", kind: "raster" }),
			expect.objectContaining({
				key: "ul0#list",
				paragraphs: [
					expect.objectContaining({
						runs: [expect.objectContaining({ text: "b" })],
					}),
				],
			}),
		]);
	});

	it("exports a list's items as a list when its grid stacks them", async () => {
		const { items } = await extract(
			`<ul style="display: grid; gap: 4px"><li>A</li><li>B</li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ key: "ul0#list", kind: "list" }),
		]);
	});

	it("paints an item's highlight beneath its list when the item has a background", async () => {
		const { items } = await extract(
			`<ul><li style="background: yellow">a</li><li>b</li></ul>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				fill: { color: "FFFF00", transparency: 0 },
				key: "ul0/li0#box",
			}),
			expect.objectContaining({ key: "ul0#list" }),
		]);
	});

	it("leaves out a list's paragraph when its ancestor's overflow clips all of it", async () => {
		const { items } = await extract(
			`<div style="height: 15px; overflow: hidden"><ul style="margin: 0; line-height: 15px"><li>one</li><li>two</li></ul></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					expect.objectContaining({
						runs: [expect.objectContaining({ text: "one" })],
					}),
				],
			}),
		]);
	});

	it("clips text vertically when only overflow-x hides", async () => {
		const { items } = await extract(
			`<div style="height: 30px; overflow-x: hidden"><p style="line-height: 15px">one<br>two<br>three</p></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ text: "one" }),
							expect.objectContaining({ text: "two" }),
						],
					},
				],
			}),
		]);
	});

	it("doesn't clip a fixed box when a positioned ancestor's overflow clips", async () => {
		const { items } = await extract(
			`<div style="position: relative; width: 50px; height: 20px; overflow: hidden"><div style="position: fixed; width: 100px; height: 100px; background: red"></div></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ box: { height: 100, width: 100, x: 0, y: 0 } }),
		]);
	});

	it("clips an absolutely positioned box when a transformed ancestor's overflow clips", async () => {
		const { items } = await extract(
			`<div style="width: 50px; height: 20px; overflow: hidden; transform: translateX(0)"><div style="position: absolute; width: 100px; height: 100px; background: red"></div></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ box: { height: 20, width: 50, x: 0, y: 0 } }),
		]);
	});

	it("gives an image its frame's shadow and corners when a frame with no fill clips it", async () => {
		const { items } = await extract(
			`<div style="width: 40px; overflow: hidden; border-radius: 6px; box-shadow: 0 2px 4px blue"><img src="/photo.png" style="width: 40px"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "image",
				radius: 6,
				shadow: {
					blur: 4,
					color: "0000FF",
					offsetX: 0,
					offsetY: 2,
					transparency: 0,
				},
			}),
		]);
	});

	it("gives a filled box its clip's shadow and corners when it fills a clip with no fill", async () => {
		const { items } = await extract(
			`<div style="width: 40px; overflow: hidden; border-radius: 6px; box-shadow: 0 2px 4px blue"><div style="height: 20px; background: white"></div></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "box",
				radius: 6,
				shadow: {
					blur: 4,
					color: "0000FF",
					offsetX: 0,
					offsetY: 2,
					transparency: 0,
				},
			}),
		]);
	});

	it("gives a box no shadow when its fill is mostly transparent", async () => {
		const { items } = await extract(
			`<div style="width: 10px; height: 10px; background: rgb(0 0 0 / 10%); box-shadow: 0 2px 4px blue"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({ kind: "box", shadow: undefined }),
		]);
	});

	it("gives a box the shadow layer that stands out most from the slide's background", async () => {
		const { items } = await extract(
			`<div style="width: 10px; height: 10px; background: red; box-shadow: 0 0 40px rgb(0 163 255 / 9%), 0 4px 8px rgb(0 0 0 / 30%)"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				shadow: {
					blur: 8,
					color: "000000",
					offsetX: 0,
					offsetY: 4,
					transparency: 70,
				},
			}),
		]);
	});

	it("outlines a box with its rings when its box-shadow layers only spread", async () => {
		const { items } = await extract(
			`<div style="width: 20px; height: 20px; border-radius: 4px; box-shadow: 0 0 0 2px white, 0 0 0 4px red"></div>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				border: { color: "FF0000", transparency: 0, width: 4 },
				box: { height: 24, width: 24, x: -2, y: -2 },
				kind: "box",
				radius: 6,
			}),
			expect.objectContaining({
				border: { color: "FFFFFF", transparency: 0, width: 2 },
				box: { height: 22, width: 22, x: -1, y: -1 },
				kind: "box",
				radius: 5,
			}),
		]);
	});

	it("exports a code line's number before its text when lines are numbered", async () => {
		const { items } = await extract(
			`<pre><code><span class="line"><span>first</span></span>\n<span class="line"><span>second</span></span></code></pre>`,
			`code { counter-reset: step } .line::before { content: counter(step); counter-increment: step; display: inline-block; width: 20px; margin-right: 10px }`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "code",
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ text: "1" }),
							expect.objectContaining({ pad: true }),
							expect.objectContaining({ text: "first" }),
						],
					},
					{
						runs: [
							expect.objectContaining({ text: "2" }),
							expect.objectContaining({ pad: true }),
							expect.objectContaining({ text: "second" }),
						],
					},
				],
			}),
		]);
	});

	it("keeps a code line's runs in order when the line wraps", async () => {
		const { items } = await extract(
			`<pre style="white-space: pre-wrap; width: 120px"><code><span class="line"><span>const</span><span> veryLongName = </span><span>anotherLongName</span><span>(argument)</span></span></code></pre>`,
		);

		expect(items).toEqual([
			expect.objectContaining({
				kind: "code",
				paragraphs: [
					{
						runs: [
							expect.objectContaining({ text: "const" }),
							expect.objectContaining({ text: " " }),
							expect.objectContaining({ text: "veryLongName = " }),
							expect.objectContaining({ text: "anotherLongName" }),
							expect.objectContaining({ text: "(argument)" }),
						],
					},
				],
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
