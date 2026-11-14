import { describe, expect, it, vi } from "vitest";

import { buildPptx } from "./build.ts";
import { cli } from "./cli.ts";
import { BuildPptxError } from "./error.ts";

vi.mock(import("./build.ts"), () => ({ buildPptx: vi.fn() }));

const mockBuildPptx = vi.mocked(buildPptx);

describe(cli, () => {
	it("prints usage and succeeds when given --help", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		expect(await cli(["--help"])).toBe(0);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("Usage: slidev-pptx [entry] [options]"),
		);
		expect(mockBuildPptx).not.toHaveBeenCalled();
	});

	it("points to --help and fails when given an unknown option", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		expect(await cli(["--review"])).toBe(1);
		expect(error).toHaveBeenCalledWith(
			expect.stringMatching(
				/^Unknown option '--review'.*\nRun with --help for usage\.$/s,
			),
		);
		expect(mockBuildPptx).not.toHaveBeenCalled();
	});

	it("points to --help and fails when given more than one entry", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		expect(await cli(["one.md", "two.md"])).toBe(1);
		expect(error).toHaveBeenCalledWith(
			"Expected at most one entry; got one.md, two.md.\nRun with --help for usage.",
		);
	});

	it("prints only the message when the build rejects its options", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		mockBuildPptx.mockRejectedValueOnce(
			new BuildPptxError('Range "two" must select slides from 1 to 3.'),
		);

		expect(await cli([])).toBe(1);
		expect(error).toHaveBeenCalledWith(
			"Failed building PowerPoint:",
			'Range "two" must select slides from 1 to 3.',
		);
	});

	it("prints the whole error when the build fails unexpectedly", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const failure = new TypeError("Cannot read properties of undefined");
		mockBuildPptx.mockRejectedValueOnce(failure);

		expect(await cli([])).toBe(1);
		expect(error).toHaveBeenCalledWith("Failed building PowerPoint:", failure);
	});

	it("passes options to the build when given them", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({
			output: "/deck.pptx",
			problems: [],
			slides: 2,
		});

		await cli([
			"deck.md",
			"--dark",
			"--output",
			"deck.pptx",
			"--range",
			"1,3-4",
			"--with-clicks",
			"--work",
			"work",
		]);

		expect(mockBuildPptx).toHaveBeenCalledWith({
			dark: true,
			entry: "deck.md",
			output: "deck.pptx",
			range: "1,3-4",
			withClicks: true,
			work: "work",
		});
	});

	it("leaves the entry and output to the build when given neither", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({
			output: "/slides-export.pptx",
			problems: [],
			slides: 2,
		});

		await cli([]);

		expect(mockBuildPptx).toHaveBeenCalledWith(
			expect.objectContaining({ entry: undefined, output: undefined }),
		);
	});

	it("prints problems and fails when the deck has errors", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({
			output: "/deck.pptx",
			problems: [
				{ message: "Couldn't export a video.", severity: "error", slide: 8 },
				{
					click: 2,
					message: "Couldn't draw a v-mark: x",
					severity: "warning",
					slide: 3,
				},
			],
			slides: 8,
		});

		expect(await cli(["--output", "deck.pptx"])).toBe(1);
		expect({
			error: error.mock.calls,
			log: log.mock.calls,
			warn: warn.mock.calls,
		}).toEqual({
			error: [["Error on slide 8: Couldn't export a video."]],
			log: [[expect.stringMatching(/^Wrote 8 slides to \/deck\.pptx in /)]],
			warn: [["Warning on slide 3, click 2: Couldn't draw a v-mark: x"]],
		});
	});

	it("prints a problem without a slide when it's about the whole deck", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({
			output: "/slides-export.pptx",
			problems: [{ message: "Couldn't find a font.", severity: "warning" }],
			slides: 1,
		});

		await cli([]);

		expect(warn.mock.calls).toEqual([["Warning: Couldn't find a font."]]);
	});

	it("succeeds when the deck has only warnings", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({
			output: "/slides-export.pptx",
			problems: [
				{
					message: "Couldn't draw a v-mark: x",
					severity: "warning",
					slide: 3,
				},
			],
			slides: 3,
		});

		expect(await cli([])).toBe(0);
	});

	it("succeeds when the deck has no problems", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({
			output: "/slides-export.pptx",
			problems: [],
			slides: 1,
		});

		expect(await cli([])).toBe(0);
	});

	it("counts the slide in the singular when it writes one", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({
			output: "/slides-export.pptx",
			problems: [],
			slides: 1,
		});

		await cli([]);

		expect(log).toHaveBeenCalledWith(
			expect.stringMatching(/^Wrote 1 slide to \/slides-export\.pptx in /),
		);
	});
});
