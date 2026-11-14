import JSZip from "jszip";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import type { BuildPptxResult } from "./types.ts";

import { buildPptx } from "./build.ts";
import { BuildPptxError } from "./error.ts";

describe(buildPptx, () => {
	const entry = path.join(import.meta.dirname, "fixture/slides.md");
	let directory: string;
	let output: string;
	let result: BuildPptxResult;
	let zip: JSZip;

	const part = async (name: string) => {
		const file = zip.file(name);
		if (!file) {
			throw new Error(`The deck has no ${name}.`);
		}

		return file.async("string");
	};

	const slide = (number: number) =>
		part(`ppt/slides/slide${String(number)}.xml`);
	const shapeNames = async (number: number) =>
		[
			...(await slide(number)).matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g),
		].map(([, name]) => name);

	beforeAll(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptx-build-"));
		output = path.join(directory, "fixture.pptx");
		result = await buildPptx({ entry, output });
		zip = await JSZip.loadAsync(await fs.readFile(output));
	}, 120_000);

	afterAll(async () => {
		await fs.rm(directory, { force: true, recursive: true });
	});

	it("reports content it couldn't export as errors when a slide embeds a page and a video", () => {
		expect(result).toEqual({
			output,
			problems: expect.arrayContaining([
				{
					message:
						"Couldn't export an embedded page (https://example.com/embed).",
					severity: "error",
					slide: 7,
				},
				{
					message: "Couldn't export a video (/clip.mp4).",
					severity: "error",
					slide: 7,
				},
			]),
			slides: 22,
		});
	});

	it("lists problems by slide, then click, and a global layer's once", () => {
		expect(result.problems).toEqual([
			{
				message:
					"Couldn't render the component UnregisteredInGlobalTop: Vue couldn't resolve it.",
				severity: "error",
			},
			{
				message:
					"Couldn't find the font Nowhere Sans, so its text uses a fallback font.",
				severity: "warning",
			},
			{
				message:
					"Couldn't render the component Unregistered: Vue couldn't resolve it.",
				severity: "error",
				slide: 7,
			},
			{
				message: "Couldn't export the modified side of a monaco-diff block.",
				severity: "error",
				slide: 7,
			},
			{
				message: "Couldn't export the output of a monaco-run block.",
				severity: "error",
				slide: 7,
			},
			{
				message:
					"Couldn't export an embedded page (https://example.com/embed).",
				severity: "error",
				slide: 7,
			},
			{
				message: "Couldn't export a video (/clip.mp4).",
				severity: "error",
				slide: 7,
			},
			{
				message: "Couldn't export a Mermaid diagram.",
				severity: "error",
				slide: 7,
			},
			{
				message: "Couldn't draw a v-mark: Marked",
				severity: "warning",
				slide: 8,
			},
			{
				message: "Couldn't draw a v-mark: Marked later",
				severity: "warning",
				slide: 9,
			},
			{
				message: expect.stringMatching(
					/^Couldn't build the slide: Failed to resolve import "\/missing\.png"/,
				),
				severity: "error",
				slide: 17,
			},
			{
				click: 1,
				message: "Couldn't render the click: It failed on a click.",
				severity: "error",
				slide: 21,
			},
		]);
	});

	it("reports an error and keeps the states that rendered when a click fails", async () => {
		expect({
			problems: result.problems,
			slide: await slide(21),
		}).toEqual({
			problems: expect.arrayContaining([
				{
					click: 1,
					message: "Couldn't render the click: It failed on a click.",
					severity: "error",
					slide: 21,
				},
			]),
			slide: expect.stringContaining("<a:t>Before the click</a:t>"),
		});
	});

	it("colors text by the deck's themeConfig when its CSS uses a theme variable", async () => {
		expect(await slide(20)).toMatch(
			/<a:srgbClr val="5D8392"\/>(?:(?!<\/a:r>).)*<a:t>Themed<\/a:t>/s,
		);
	});

	it("reports a warning when a slide has a v-mark", () => {
		expect(result.problems).toContainEqual({
			message: "Couldn't draw a v-mark: Marked",
			severity: "warning",
			slide: 8,
		});
	});

	it("reports a warning when the deck names a font nothing provides", () => {
		expect(result.problems).toContainEqual({
			message:
				"Couldn't find the font Nowhere Sans, so its text uses a fallback font.",
			severity: "warning",
		});
	});

	it("reports an error and writes the other slides when one slide fails", async () => {
		expect({
			failed: await shapeNames(17),
			problems: result.problems,
		}).toEqual({
			failed: [""],
			problems: expect.arrayContaining([
				{
					message: expect.stringMatching(
						/^Couldn't build the slide: Failed to resolve import "\/missing\.png"/,
					),
					severity: "error",
					slide: 17,
				},
			]),
		});
	});

	it("writes the same bytes when built twice", async () => {
		const again = path.join(directory, "again.pptx");
		await buildPptx({ entry, output: again });

		expect((await fs.readFile(again)).equals(await fs.readFile(output))).toBe(
			true,
		);
	}, 120_000);

	it("writes the failed slides blank when every slide fails", async () => {
		const failed = path.join(directory, "failed.pptx");

		expect({
			result: await buildPptx({ entry, output: failed, range: "17" }),
			written: (await fs.stat(failed)).isFile(),
		}).toEqual({
			result: {
				output: failed,
				problems: expect.arrayContaining([
					expect.objectContaining({ severity: "error", slide: 17 }),
				]),
				slides: 1,
			},
			written: true,
		});
	}, 120_000);

	describe("when given no output", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("names the file by the entry when the deck has no exportFilename", async () => {
			vi.spyOn(process, "cwd").mockReturnValue(directory);

			expect(
				await buildPptx({
					entry: path.join(import.meta.dirname, "fixture/untitled.md"),
				}),
			).toEqual(
				expect.objectContaining({
					output: path.join(directory, "untitled-export.pptx"),
				}),
			);
		}, 120_000);

		it("names the file by the deck's exportFilename", async () => {
			vi.spyOn(process, "cwd").mockReturnValue(directory);

			expect(await buildPptx({ entry, range: "1" })).toEqual(
				expect.objectContaining({
					output: path.join(directory, "fixture-deck.pptx"),
				}),
			);
		}, 120_000);
	});

	it("reports a failing click and that it can't check for unresolved components when NODE_ENV is production", async () => {
		await expect(
			promisify(execFile)(
				process.execPath,
				[
					path.join(import.meta.dirname, "bin.ts"),
					entry,
					"--output",
					path.join(directory, "production.pptx"),
					"--range",
					"21",
				],
				{ env: { ...process.env, NODE_ENV: "production" } },
			),
		).rejects.toMatchObject({
			code: 1,
			stderr: `Warning: Couldn't check for components Vue can't resolve, because NODE_ENV is production.
Warning: Couldn't find the font Nowhere Sans, so its text uses a fallback font.
Error on slide 21, click 1: Couldn't render the click: It failed on a click.
`,
		});
	}, 120_000);

	it("writes one slide per click state when withClicks is set", async () => {
		const clicks = path.join(directory, "clicks.pptx");

		expect(
			await buildPptx({ entry, output: clicks, range: "2", withClicks: true }),
		).toEqual({
			output: clicks,
			problems: [
				{
					message:
						"Couldn't render the component UnregisteredInGlobalTop: Vue couldn't resolve it.",
					severity: "error",
				},
				{
					message:
						"Couldn't find the font Nowhere Sans, so its text uses a fallback font.",
					severity: "warning",
				},
			],
			slides: 3,
		});
	}, 120_000);

	it("keeps the model, numbering states by click, and rendered images when given a work directory", async () => {
		const work = path.join(directory, "work");
		await buildPptx({
			entry,
			output: path.join(directory, "work.pptx"),
			range: "10",
			work,
		});

		expect({
			files: await fs.readdir(work),
			model: JSON.parse(
				await fs.readFile(path.join(work, "model.json"), "utf8"),
			) as unknown,
		}).toEqual({
			files: ["background.png", "model.json", "rasters"],
			model: expect.objectContaining({
				slides: [
					expect.objectContaining({
						number: 10,
						states: [expect.objectContaining({ clicks: 1 })],
					}),
				],
			}),
		});
	}, 120_000);

	it("styles slides and renders Slidev's dark content in dark mode when dark is set", async () => {
		const darkOutput = path.join(directory, "dark.pptx");
		await buildPptx({ dark: true, entry, output: darkOutput, range: "1" });
		const dark = await JSZip.loadAsync(await fs.readFile(darkOutput));

		expect({
			cover: await dark.file("ppt/slides/slide1.xml")?.async("string"),
			theme: await dark.file("ppt/theme/theme1.xml")?.async("string"),
		}).toEqual({
			cover: expect.stringMatching(/^(?!.*Light only).*<a:t>Dark only<\/a:t>/s),
			theme: expect.stringContaining('<a:srgbClr val="FF6347"/>'),
		});
	}, 120_000);

	it("throws when dark is set and the deck's colorSchema is light", async () => {
		const light = path.join(directory, "light.md");
		await fs.writeFile(
			light,
			"---\ntheme: none\ncolorSchema: light\n---\n\n# Light\n",
		);

		await expect(
			buildPptx({
				dark: true,
				entry: light,
				output: path.join(directory, "light.pptx"),
			}),
		).rejects.toThrow(
			new BuildPptxError(
				"The deck's colorSchema is \"light\", so it can't export in dark mode.",
			),
		);
	});

	it("throws when the entry doesn't exist", async () => {
		const missing = path.join(directory, "missing.md");

		await expect(
			buildPptx({
				entry: missing,
				output: path.join(directory, "missing.pptx"),
			}),
		).rejects.toThrow(
			new BuildPptxError(`The entry ${missing} doesn't exist.`),
		);
	});

	it("throws when a range selects no slides", async () => {
		await expect(
			buildPptx({
				entry,
				output: path.join(directory, "invalid.pptx"),
				range: "23",
			}),
		).rejects.toThrow(
			new BuildPptxError('Range "23" must select slides from 1 to 22.'),
		);
	});

	it("throws when a range isn't numeric", async () => {
		await expect(
			buildPptx({
				entry,
				output: path.join(directory, "invalid.pptx"),
				range: "two",
			}),
		).rejects.toThrow(
			new BuildPptxError('Range "two" must select slides from 1 to 22.'),
		);
	});

	it("sizes the page by the deck's canvas and aspect ratio", async () => {
		expect(await part("ppt/presentation.xml")).toContain(
			'<p:sldSz cx="9144000" cy="6858000"/>',
		);
	});

	it("names each shape by its content", async () => {
		expect(await shapeNames(3)).toEqual([
			"",
			"Text: Colors and Units",
			"Box: hsl chip",
			"Text: hsl chip",
			"Box: ok",
			"Box: named",
			"Box: mix",
			"Text: Layered: lime",
			"Text: Unlayered: teal",
			"Text: 3 / 22 · default",
		]);
	});

	it("renders global-top layers with Slidev's navigation", async () => {
		expect(await slide(5)).toContain("<a:t>5 / 22 · image-right</a:t>");
	});

	it("names fonts by the font file when the deck loads one", async () => {
		expect(await part("ppt/theme/theme1.xml")).toMatch(
			/<a:minorFont><a:latin typeface="League Spartan"/,
		);
	});

	it("makes each slide's first heading its title", async () => {
		expect(await slide(2)).toContain(
			'name="Text: Lists"></p:cNvPr><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr>',
		);
	});

	it("numbers an ordered list from its start", async () => {
		expect(await slide(2)).toContain(
			'<a:buAutoNum type="arabicPeriod" startAt="3"/>',
		);
	});

	it("numbers an ordered list with letters when its style says so", async () => {
		expect(await slide(2)).toContain(
			'<a:buAutoNum type="alphaLcPeriod" startAt="1"/>',
		);
	});

	it("keeps a string marker's character", async () => {
		expect(await slide(2)).toContain('<a:buChar char="&#x2192;"/>');
	});

	it("draws a keyword marker in Arial", async () => {
		expect(await slide(2)).toContain(
			'<a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="&#x25A0;"/>',
		);
	});

	it("reveals list items one paragraph at a time when they have v-click", async () => {
		expect(await slide(2)).toMatch(
			/<p:cNvPr id="(\d+)" name="List: Alpha Beta".*<p:bldP spid="\1" grpId="0" build="p"\/>/s,
		);
	});

	it("reveals a shape when it has v-click", async () => {
		expect(await slide(6)).toContain('animBg="1"/>');
	});

	it("resolves modern colors when boxes use them", async () => {
		expect(await slide(3)).toMatch(
			/1773CF.*4CB86A.*663399.*<a:srgbClr val="FF6347"><a:alpha val="50000"\/>/s,
		);
	});

	it("sizes boxes when they use viewport units", async () => {
		expect(await slide(3)).toContain('<a:ext cx="2286000" cy="365760"/>');
	});

	it("colors text by cascade layers when rules are layered", async () => {
		expect(await slide(3)).toMatch(/00FF00.*008080/s);
	});

	it("exports generated content when elements have ::before or ::after", async () => {
		expect(await slide(4)).toMatch(
			/<a:srgbClr val="DAA520"\/>.*<a:t>★ <\/a:t>.*<a:ln w="45720"><a:solidFill><a:srgbClr val="FF6347"\/>/s,
		);
	});

	it("crops cover images and background images", async () => {
		expect(await slide(5)).toMatch(
			/<a:srcRect l="0" r="0" t="25000" b="25000"\/>.*<a:srcRect l="16667" r="16667" t="0" b="0"\/>/s,
		);
	});

	it("converts images to PNG when PowerPoint can't show their format", () => {
		expect(zip.file(/^ppt\/media\/.*\.svg$/)).toEqual([]);
	});

	it("plays each slide's transition into the next", async () => {
		expect({
			fade: await slide(2),
			none: await slide(6),
			push: await slide(5),
		}).toEqual({
			fade: expect.stringContaining("<p:fade/>"),
			none: expect.not.stringContaining("<p:transition"),
			push: expect.stringContaining('<p:push dir="l"/>'),
		});
	});

	it("writes a blank code line in the code's color", async () => {
		expect(await slide(6)).toMatch(
			/<a:srgbClr val="AB5959"\/><\/a:solidFill><a:latin typeface="[^"]+" pitchFamily="34" charset="0"\/><a:ea typeface="[^"]+" pitchFamily="34" charset="-122"\/><a:cs typeface="[^"]+" pitchFamily="34" charset="-120"\/><\/a:rPr><a:t> <\/a:t>/,
		);
	});

	it("leaves out text when it's fully transparent", async () => {
		expect(await slide(6)).not.toContain("Invisible text");
	});

	it("outlines an SVG circle when it has only a stroke", async () => {
		expect(await slide(6)).toContain(
			'<a:prstGeom prst="ellipse"><a:avLst></a:avLst></a:prstGeom><a:ln w="45720"><a:solidFill><a:srgbClr val="FF6347"/>',
		);
	});

	it("angles a gradient when its CSS angle is negative", async () => {
		expect(await slide(6)).toContain('<a:lin ang="19800000" scaled="0"/>');
	});

	it("keeps fractional transparency when a fill is faint", async () => {
		expect(await slide(6)).toContain('<a:alpha val="2500"/>');
	});

	it("doesn't underline a link when the browser doesn't", async () => {
		expect(await slide(6)).toContain('u="none"');
	});

	it("rounds picture corners when an image has a border radius", async () => {
		expect(await slide(6)).toMatch(
			/name="Image: Rounded photo"(?:(?!<\/p:pic>).)*<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val \d+"\/>/s,
		);
	});

	it("formats speaker notes when they use Markdown", async () => {
		expect(await part("ppt/notesSlides/notesSlide6.xml")).toMatch(
			/<a:rPr lang="en-US" i="1" dirty="0"\/><a:t>emphasis<\/a:t>.*<a:rPr lang="en-US" b="1" dirty="0"\/><a:t>bold<\/a:t>.*<a:latin typeface="[^"]+"\/><\/a:rPr><a:t>code<\/a:t>.*<a:t>A second paragraph.<\/a:t>/s,
		);
	});

	it("themes new text in the deck's colors when the deck is light", async () => {
		expect(await part("ppt/theme/theme1.xml")).toContain(
			'<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>',
		);
	});

	it("nests a sub-list's items a level deeper when list items have them", async () => {
		expect(await slide(11)).toMatch(
			/<a:pPr algn="l" lvl="1"[^>]*>(?:(?!<\/a:p>).)*<a:t>Child<\/a:t>/s,
		);
	});

	it("keeps a list item's text when it has inline formatting and a sub-list", async () => {
		expect(await slide(11)).toMatch(
			/<a:t>Term<\/a:t>.*<a:t>: description<\/a:t>.*lvl="1".*<a:t>Sub item<\/a:t>/s,
		);
	});

	it("numbers an item after a nested list from its own number", async () => {
		expect(await slide(11)).toMatch(
			/<a:buAutoNum type="arabicPeriod" startAt="2"\/>(?:(?!<\/a:p>).)*<a:t>Second<\/a:t>/s,
		);
	});

	it("marks each item when a list's items are paragraphs", async () => {
		expect(await slide(11)).toMatch(
			/<a:buChar char="&#x25CF;"\/>(?:(?!<\/a:p>).)*<a:t>Loose two<\/a:t>/s,
		);
	});

	it("draws an item's own marker when its list has none", async () => {
		expect(await slide(11)).toMatch(
			/<a:buChar char="&#x25A0;"\/>(?:(?!<\/a:p>).)*<a:t>Own marker<\/a:t>/s,
		);
	});

	it("renders an icon when it's inline in a heading", async () => {
		expect(await shapeNames(12)).toContain("Rendered: icon");
	});

	it("keeps no-break spaces when text has them", async () => {
		expect(await slide(12)).toContain("<a:t>x   y</a:t>");
	});

	it("lowers a subscript when text has one", async () => {
		expect(await slide(12)).toMatch(
			/baseline="-40000"(?:(?!<\/a:r>).)*<a:t>2<\/a:t>/s,
		);
	});

	it("leaves out text when it's clipped away", async () => {
		expect(await slide(12)).not.toContain("Clipped away");
	});

	it("colors text like its parent when its own color doesn't parse", async () => {
		expect(await slide(12)).toMatch(
			/<a:srgbClr val="123456"\/>(?:(?!<\/a:r>).)*<a:t>Parent color<\/a:t>/s,
		);
	});

	it("shadows text when its shadow has unitless offsets", async () => {
		expect(await slide(12)).toMatch(
			/name="Text: Glow"(?:(?!<\/p:sp>).)*<a:effectLst>/s,
		);
	});

	it("resolves padding percentages against the parent's width", async () => {
		expect(await slide(12)).toMatch(
			/name="Text: Percent padding"(?:(?!<\/p:sp>).)*<a:off x="457200"/s,
		);
	});

	it("fades an SVG shape once when it has an opacity attribute", async () => {
		expect(await slide(13)).toContain(
			'<a:prstGeom prst="ellipse"><a:avLst></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FF6347"><a:alpha val="50000"/>',
		);
	});

	it("fills an SVG shape from its group when the group sets a fill", async () => {
		expect(await slide(13)).toMatch(
			/name="Shape: Shapes"(?:(?!<\/p:sp>).)*<a:srgbClr val="008080"\/>/s,
		);
	});

	it("renders pictures when PowerPoint can't draw shapes or backgrounds natively", async () => {
		expect(await shapeNames(13)).toEqual(
			expect.arrayContaining([
				"Rendered: Turned",
				"Rendered: Radial",
				"Rendered: Tiled",
			]),
		);
	});

	it("frames an image when it has a border and background", async () => {
		expect(await shapeNames(13)).toEqual(
			expect.arrayContaining(["Box: framed", "Image: Framed photo"]),
		);
	});

	it("names a box by its first block when it holds several", async () => {
		expect(await shapeNames(13)).toContain("Box: Card title");
	});

	it("exports Monaco and twoslash code as text when a slide has them", async () => {
		expect(await slide(15)).toMatch(/edited.*hovered/s);
	});

	it("shows a twoslash query's type when a slide has one", async () => {
		expect(await slide(15)).toMatch(
			/<a:srgbClr val="[\dA-F]{6}"\/><\/a:solidFill>(?:(?!<\/a:r>).)*<a:t>: <\/a:t>/s,
		);
	});

	it("fills text with its gradient when its background is clipped to the text", async () => {
		expect(await slide(16)).toMatch(
			/name="Text: Gradient text"(?:(?!<\/p:sp>).)*<a:gradFill flip="none" rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000">/s,
		);
	});

	it("breaks a line when text has a <br>", async () => {
		expect(await slide(16)).toMatch(
			/<a:t>First line<\/a:t><\/a:r><a:br\/><a:r>(?:(?!<\/a:r>).)*<a:t>Second line<\/a:t>/s,
		);
	});

	it("fills an SVG shape with its linear gradient when it references one", async () => {
		expect(await slide(16)).toMatch(
			/name="Shape: Labeled"(?:(?!<\/p:sp>).)*<a:srgbClr val="FF0000"><\/a:srgbClr><\/a:gs><a:gs pos="100000"><a:srgbClr val="0000FF">/s,
		);
	});

	it("exports SVG text as text when an SVG has a <text>", async () => {
		expect(await slide(16)).toMatch(
			/name="Text: SVG label"(?:(?!<\/p:sp>).)*<a:srgbClr val="008080"\/>(?:(?!<\/p:sp>).)*<a:t>SVG label<\/a:t>/s,
		);
	});

	it("lays columns out side by side when a block has columns", async () => {
		expect(await slide(16)).toMatch(
			/name="Text: Left column"(?:(?!<\/p:sp>).)*<a:off x="\d+" y="(\d+)".*name="Text: Right column"(?:(?!<\/p:sp>).)*<a:off x="[1-9]\d*" y="\1"/s,
		);
	});

	it("titles the file by the deck", async () => {
		expect(await part("docProps/core.xml")).toContain(
			"<dc:title>Fixture</dc:title>",
		);
	});
});
