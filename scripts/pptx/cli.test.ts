import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildPptx } from "./build.ts";
import { cli } from "./cli.ts";

vi.mock("./build.ts");

const mockBuildPptx = vi.mocked(buildPptx);

describe(cli, () => {
	it("fails when given both --dark and --light", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		expect(await cli(["--dark", "--light"])).toBe(1);
		expect(error).toHaveBeenCalledWith(
			"Failed building PowerPoint: Pass at most one of --dark and --light.",
		);
		expect(mockBuildPptx).not.toHaveBeenCalled();
	});

	it("fails when given an unknown option", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		expect(await cli(["--review"])).toBe(1);
		expect(error).toHaveBeenCalledWith(
			expect.stringMatching(
				/^Failed building PowerPoint: Unknown option '--review'/,
			),
		);
	});

	it("fails with the build's message when the build throws", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		mockBuildPptx.mockRejectedValueOnce(new Error("Slides must be numbers."));

		expect(await cli(["--slides", "two"])).toBe(1);
		expect(error).toHaveBeenCalledWith(
			"Failed building PowerPoint: Slides must be numbers.",
		);
	});

	it("passes options to the build when given them", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({ problems: [], slides: 2 });

		await cli([
			"--entry",
			"deck.md",
			"--light",
			"--out",
			"deck.pptx",
			"--slide-per-click",
			"--slides",
			"1,3",
			"--work",
			"work",
		]);

		expect(mockBuildPptx).toHaveBeenCalledWith({
			colorScheme: "light",
			entry: "deck.md",
			out: path.resolve("deck.pptx"),
			slidePerClick: true,
			slides: [1, 3],
			work: "work",
		});
	});

	it("prints problems and fails when the deck has them", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({
			problems: [
				{ message: "Couldn't export a video.", slide: 8 },
				{ click: 2, message: "Couldn't rasterize [x].", slide: 3 },
			],
			slides: 8,
		});

		expect(await cli(["--out", "deck.pptx"])).toBe(1);
		expect({ log: log.mock.calls, warn: warn.mock.calls }).toEqual({
			log: [[expect.stringMatching(/^Wrote 8 slides to .*deck\.pptx in /)]],
			warn: [
				["Slide 8: Couldn't export a video."],
				["Slide 3, click 2: Couldn't rasterize [x]."],
			],
		});
	});

	it("succeeds when the deck has no problems", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		mockBuildPptx.mockResolvedValueOnce({ problems: [], slides: 1 });

		expect(await cli([])).toBe(0);
	});
});
