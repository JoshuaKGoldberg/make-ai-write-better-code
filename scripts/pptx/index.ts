/**
 * Builds the deck as a native PowerPoint file.
 *
 * Usage: node scripts/pptx/index.ts [--entry &lt;slides.md>] [--out &lt;file.pptx>] [--slides 1,2,3] [--dark | --light] [--review] [--work &lt;dir>]
 */
import path from "node:path";
import { parseArgs } from "node:util";

import { buildPptx } from "./build.ts";

const { values } = parseArgs({
	options: {
		dark: { type: "boolean" },
		entry: { default: "slides.md", type: "string" },
		light: { type: "boolean" },
		out: { default: "dist/slides.pptx", type: "string" },
		review: { default: false, type: "boolean" },
		slides: { type: "string" },
		work: { type: "string" },
	},
});

const slides = values.slides?.split(",").map((value) => {
	const no = Number(value.trim());
	if (!Number.isInteger(no) || no < 1) {
		throw new Error(
			`--slides takes slide numbers, like 1,2,3; got "${value}".`,
		);
	}

	return no;
});

const started = performance.now();
const out = path.resolve(values.out);
const { problems, slides: written } = await buildPptx({
	colorScheme: values.dark ? "dark" : values.light ? "light" : undefined,
	entry: values.entry,
	out,
	review: values.review,
	slides,
	work: values.work && path.resolve(values.work),
});
for (const problem of problems) {
	console.warn(problem);
}

console.log(
	`Wrote ${String(written)} slides to ${out} in ${((performance.now() - started) / 1000).toFixed(1)}s.`,
);
