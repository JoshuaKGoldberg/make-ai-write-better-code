import type LzString from "lz-string";

import { createRequire } from "node:module";

// Slidev's isInstalledGlobally heuristic, true when process.argv[1] has a /.pnpm/ path as under Vitest or a pnpm-installed bin, aliases lz-string to its CommonJS file, which Vite then can't evaluate.
export const lzString = createRequire(import.meta.url)(
	"lz-string",
) as typeof LzString;
