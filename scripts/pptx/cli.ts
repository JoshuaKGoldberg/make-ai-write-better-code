import { parseArgs } from "node:util";

const help = `Builds a native, editable PowerPoint file from a Slidev deck.

Usage: slidev-pptx [entry] [options]

Arguments:
  entry               The deck's Markdown entry (default: slides.md)

Options:
  --output <file>     The .pptx file to write (default: the deck's exportFilename, else <entry>-export.pptx)
  --range <range>     The slides to build, such as 1,4-6 (default: all)
  --dark              Export in dark mode
  --with-clicks       Write one slide per click state instead of animating clicks
  --work <directory>  Keep intermediate files here: the model and rendered images
  --help              Print this help

Exits with 1 when an error means content is missing from the PowerPoint.
Warnings, for content that's there but may look different, exit with 0.`;

const options = {
	dark: { type: "boolean" },
	help: { type: "boolean" },
	output: { type: "string" },
	range: { type: "string" },
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
		positionals: [entry],
		values,
	} = parsed;
	if (values.help) {
		console.log(help);
		return 0;
	}

	const started = performance.now();
	const { buildPptx, BuildPptxError } = await import("./index.ts");
	let result;
	try {
		result = await buildPptx({
			dark: values.dark,
			entry,
			output: values.output,
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
		`Wrote ${String(result.slides)} ${result.slides === 1 ? "slide" : "slides"} to ${result.output} in ${((performance.now() - started) / 1000).toFixed(1)}s.`,
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
