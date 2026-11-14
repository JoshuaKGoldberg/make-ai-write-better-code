import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LaidOutRuns } from "./layout.ts";

import { createAssets, imageSize } from "./assets.ts";
import { createCascade } from "./cascade.ts";
import { createLayout, ID } from "./layout.ts";

const canvas = { height: 300, width: 400 };
const sheets = [`p { font-family: "Fixture Sans"; margin: 0 }`];
const rules = createCascade(sheets, { colorScheme: "light", viewport: canvas });
const fixture = path.join(import.meta.dirname, "fixture");
const red = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="red"/></svg>`;

describe(createLayout, () => {
	let work = "";
	let layout: ReturnType<typeof createLayout>;
	const layOut = (html: string) =>
		layout.layoutState(layout.prepare(1, html, { rules }, {}), { sheets });

	beforeAll(async () => {
		work = await fs.mkdtemp(path.join(os.tmpdir(), "layout-test-"));
		layout = createLayout({
			assets: createAssets({
				publicDir: path.join(fixture, "public"),
				root: fixture,
				work,
			}),
			canvas,
			colorScheme: "light",
		});
		await layout.registerFonts([
			{
				data: await fs.readFile(
					path.join(fixture, "fonts/league-spartan.woff2"),
				),
				name: "Fixture Sans",
			},
		]);
	});

	afterAll(async () => {
		await fs.rm(work, { force: true, recursive: true });
	});

	it("keeps text when Vue's comment markers surround it", async () => {
		const { runs } = await layOut("<p><!--[-->Light<!--]--></p>");

		expect([...runs.values()]).toEqual([
			expect.objectContaining({
				runs: [expect.objectContaining({ text: "Light" })],
			}),
		]);
	});

	it("lays out an element's siblings when it has display: none", async () => {
		const { mismatches, runs } = await layOut(
			`<p>before</p><p style="display: none">hidden</p><p>after</p>`,
		);

		expect({ mismatches, runs: [...runs.values()] }).toEqual({
			mismatches: [],
			runs: [
				expect.objectContaining({
					runs: [expect.objectContaining({ text: "before" })],
				}),
				expect.objectContaining({
					runs: [expect.objectContaining({ text: "after" })],
				}),
			],
		});
	});

	it("keeps an element's text when an attribute has a >", async () => {
		const { runs } = await layOut(`<p title="a > b">titled</p>`);

		expect([...runs.values()]).toEqual([
			expect.objectContaining({
				runs: [expect.objectContaining({ text: "titled" })],
			}),
		]);
	});

	it("lays out an image when its source has a <", async () => {
		const { mismatches } = await layOut(`<img src='${red}' alt="a -> b">`);

		expect(mismatches).toEqual([]);
	});

	it("lays out an element when an inline declaration is invalid", async () => {
		const { runs } = await layOut(
			`<p style="height: tall; color: red">kept</p>`,
		);

		expect([...runs.values()]).toEqual([
			expect.objectContaining({
				runs: [expect.objectContaining({ text: "kept" })],
			}),
		]);
	});

	it("lays out an element when takumi rejects its inline values", async () => {
		const { mismatches, runs } = await layOut(
			`<div style="display: contents"><p style="position: sticky; overflow: auto; overflow-y: scroll">kept</p></div>`,
		);

		expect({ mismatches, runs: [...runs.values()] }).toEqual({
			mismatches: [],
			runs: [
				expect.objectContaining({
					runs: [expect.objectContaining({ text: "kept" })],
				}),
			],
		});
	});

	it("measures an inline-block's box when it sits alone before a block", async () => {
		const { boxes, document, mismatches } = await layOut(
			`<div><span style="display: inline-block; width: 10px; height: 10px"></span><p>after</p></div>`,
		);

		expect({
			mismatches,
			span: boxes.get(document.querySelector("span")?.getAttribute(ID) ?? ""),
		}).toEqual({
			mismatches: [],
			span: expect.objectContaining({ height: 10, width: 10 }),
		});
	});

	it("lays out a slide when an image has no source", async () => {
		const { mismatches, runs } = await layOut(`<p>kept</p><img alt="">`);

		expect({ mismatches, runs: [...runs.values()] }).toEqual({
			mismatches: [],
			runs: [
				expect.objectContaining({
					runs: [expect.objectContaining({ text: "kept" })],
				}),
			],
		});
	});

	it("measures an inline image's own box when text precedes it", async () => {
		const { boxes, document, mismatches } = await layOut(
			`<p><b>Bold</b> <img src='${red}'></p>`,
		);
		const boxOf = (selector: string) =>
			boxes.get(document.querySelector(selector)?.getAttribute(ID) ?? "");

		expect({ bold: boxOf("b"), image: boxOf("img"), mismatches }).toEqual({
			bold: undefined,
			image: expect.objectContaining({ height: 20, width: 30 }),
			mismatches: [],
		});
	});

	it("sizes an image by its width attribute when the attribute has a px unit", async () => {
		const { boxes, document } = await layOut(`<img src='${red}' width="60px">`);

		expect(
			boxes.get(document.querySelector("img")?.getAttribute(ID) ?? ""),
		).toEqual(expect.objectContaining({ height: 40, width: 60 }));
	});

	it("gives white space to the text it's in when takumi lays it out as a run of its own", async () => {
		const { document, runs } = await layOut(
			`<p><b>bold</b> <a href="https://sli.dev">link</a></p><p style="white-space: pre"><i>{</i>\n<u>\tcount</u></p>`,
		);
		const idOf = (selector: string) =>
			document.querySelector(selector)?.getAttribute(ID);

		expect([...runs.values()]).toEqual([
			expect.objectContaining({
				runs: [
					expect.objectContaining({ owner: idOf("b"), text: "bold" }),
					expect.objectContaining({ owner: idOf("p"), text: " " }),
					expect.objectContaining({ owner: idOf("a"), text: "link" }),
				],
			}),
			expect.objectContaining({
				runs: [
					expect.objectContaining({ owner: idOf("i"), text: "{" }),
					expect.objectContaining({ owner: idOf("u"), text: "\t" }),
					expect.objectContaining({ owner: idOf("u"), text: "count" }),
				],
			}),
		]);
	});

	it("gives a paragraph its text when it starts a list item with an inside marker", async () => {
		const { mismatches, runs } = await layOut(
			`<ul style="list-style-position: inside"><li><p>a <b>b</b></p></li></ul>`,
		);

		expect({ mismatches, runs: [...runs.values()] }).toEqual({
			mismatches: [],
			runs: [
				expect.objectContaining({
					runs: [
						expect.objectContaining({ text: "a " }),
						expect.objectContaining({ text: "b" }),
					],
				}),
			],
		});
	});

	it("gives a nested list its own text when its item has an inside marker", async () => {
		const { byId, looseRuns, mismatches, runs } = await layOut(
			`<ul style="list-style-position: inside"><li>a <b>b</b><ul><li>c <i>d</i></li></ul></li></ul>`,
		);
		const ownersOf = (entries: LaidOutRuns[]) =>
			entries.flatMap((entry) =>
				entry.runs.map(({ owner, text }) => [byId.get(owner)?.localName, text]),
			);

		expect({
			looseRuns: ownersOf([...looseRuns.values()].flat()),
			mismatches,
			runs: ownersOf([...runs.values()]),
		}).toEqual({
			looseRuns: [
				["li", "a "],
				["b", "b"],
			],
			mismatches: [],
			runs: [
				["li", "c "],
				["i", "d"],
			],
		});
	});

	it("gives a display: contents element's text to its own children when it sits in text", async () => {
		const { byId, mismatches, runs } = await layOut(
			`<p>lead <span style="display: contents"><b>x</b></span> tail</p>`,
		);

		expect({
			mismatches,
			owners: [...runs.values()].flatMap((entry) =>
				entry.runs.map(({ owner, text }) => [byId.get(owner)?.localName, text]),
			),
		}).toEqual({
			mismatches: [],
			owners: [
				["p", "lead "],
				["b", "x"],
				["p", " tail"],
			],
		});
	});

	it("lays out a table's rows when they aren't in a row group", async () => {
		const { looseRuns, mismatches } = await layOut(
			`<p style="display: inline-table"><span style="display: table-row">a</span><span style="display: table-row">b</span></p>`,
		);

		expect({ looseRuns: [...looseRuns.values()], mismatches }).toEqual({
			looseRuns: [
				[
					expect.objectContaining({
						runs: [expect.objectContaining({ text: "a" })],
					}),
				],
				[
					expect.objectContaining({
						runs: [expect.objectContaining({ text: "b" })],
					}),
				],
			],
			mismatches: [],
		});
	});

	it("renders an image to a PNG at twice its size", async () => {
		const png = (await layout.toPng("/shape.svg")) ?? Buffer.alloc(0);

		expect(imageSize(png)).toEqual({ height: 160, width: 240 });
	});

	it("averages a PNG's color", async () => {
		const png = (await layout.toPng(red)) ?? Buffer.alloc(0);

		expect(await layout.averageColor(png)).toBe("FF0000");
	});
});
