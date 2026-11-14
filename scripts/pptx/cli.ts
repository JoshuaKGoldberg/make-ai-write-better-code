import path from "node:path";
import { parseArgs } from "node:util";

import packageJson from "../../package.json" with { type: "json" };
import { buildPptx, BuildPptxError } from "./build.ts";

const help = `Builds a native, editable PowerPoint file from a Slidev deck.

Usage: slidev-pptx [entry] [options]

Arguments:
  entry               The deck's Markdown entry (default: slides.md)

Options:
  --output <file>     The .pptx file to write (default: <entry>-export.pptx)
  --range <range>     The slides to build, such as 1,4-6 (default: all)
  --dark              Export in dark mode
  --with-clicks       Write one slide per click state instead of animating clicks
  --work <directory>  Keep intermediate files here: the model, rendered images, and Vite's cache
  --help              Print this help
  --version           Print the version

Exits with 1 when an error means content is missing from the PowerPoint.
Warnings, for content that's there but may look different, exit with 0.`;

const options = {
	dark: { type: "boolean" },
	help: { type: "boolean" },
	output: { type: "string" },
	range: { type: "string" },
	version: { type: "boolean" },
	"with-clicks": { type: "boolean" },
	work: { type: "string" },
} as const;

export async function cli(args: string[]) {
	const parsed = parse(args);
	if (typeof parsed === "string") {
		console.error(`${parsed}\nRun with --help for usage.`);
		return 1;
	}

	const {
		positionals: [entry = "slides.md"],
		values,
	} = parsed;
	if (values.help) {
		console.log(help);
		return 0;
	}

	if (values.version) {
		console.log(packageJson.version);
		return 0;
	}

	const started = performance.now();
	const output = path.resolve(
		values.output ?? `${path.basename(entry, ".md")}-export.pptx`,
	);
	let result;
	try {
		result = await buildPptx({
			dark: values.dark,
			entry,
			output,
			range: values.range,
			withClicks: values["with-clicks"],
			work: values.work,
		});
	} catch (error) {
		console.error(
			"Failed building PowerPoint:",
			error instanceof BuildPptxError ? error.message : error,
		);
		return 1;
	}

	for (const { click, message, severity, slide } of result.problems) {
		const where =
			slide === undefined
				? ""
				: ` on slide ${String(slide)}${click === undefined ? "" : `, click ${String(click)}`}`;
		if (severity === "error") {
			console.error(`Error${where}: ${message}`);
		} else {
			console.warn(`Warning${where}: ${message}`);
		}
	}

	console.log(
		`Wrote ${String(result.slides)} slides to ${output} in ${((performance.now() - started) / 1000).toFixed(1)}s.`,
	);
	return result.problems.some(({ severity }) => severity === "error") ? 1 : 0;
}

function parse(args: string[]) {
	try {
		const parsed = parseArgs({ allowPositionals: true, args, options });
		return parsed.positionals.length > 1
			? `Expected at most one entry; got ${parsed.positionals.join(", ")}.`
			: parsed;
	} catch (error) {
		if (!(error instanceof TypeError)) {
			throw error;
		}

		return error.message;
	}
}
