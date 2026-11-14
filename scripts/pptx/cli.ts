/**
 * The command line for building a native PowerPoint file from a Slidev deck.
 *
 * Usage: [--entry slides.md] [--out file.pptx] [--slides 1,2,3] [--dark | --light] [--slide-per-click] [--work directory]
 */
import path from "node:path";
import { parseArgs } from "node:util";

import { buildPptx } from "./build.ts";

/** Runs the command line with these arguments; returns its exit code. */
export async function cli(args: string[]) {
	const started = performance.now();
	try {
		const { values } = parseArgs({
			args,
			options: {
				dark: { type: "boolean" },
				entry: { type: "string" },
				light: { type: "boolean" },
				out: { default: "dist/slides.pptx", type: "string" },
				"slide-per-click": { type: "boolean" },
				slides: { type: "string" },
				work: { type: "string" },
			},
		});
		if (values.dark && values.light) {
			throw new Error("Pass at most one of --dark and --light.");
		}

		const out = path.resolve(values.out);
		const { problems, slides } = await buildPptx({
			colorScheme: values.dark ? "dark" : values.light ? "light" : undefined,
			entry: values.entry,
			out,
			slidePerClick: values["slide-per-click"],
			slides: values.slides?.split(",").map(Number),
			work: values.work,
		});
		for (const { click, message, slide } of problems) {
			console.warn(
				`Slide ${String(slide)}${click === undefined ? "" : `, click ${String(click)}`}: ${message}`,
			);
		}

		console.log(
			`Wrote ${String(slides)} slides to ${out} in ${((performance.now() - started) / 1000).toFixed(1)}s.`,
		);
		return problems.length ? 1 : 0;
	} catch (error) {
		console.error(
			`Failed building PowerPoint: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	}
}
