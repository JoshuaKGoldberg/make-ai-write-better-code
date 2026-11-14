import type LzString from "lz-string";

// Slidev's isInstalledGlobally heuristic, true when process.argv[1] has a /.pnpm/ path as under Vitest or a pnpm-installed bin, aliases lz-string to its CommonJS file, which Vite then can't evaluate. getBuiltinModule keeps node:module out of the client graph that CSS collection walks.
export const lzString = process
	.getBuiltinModule("node:module")
	.createRequire(import.meta.url)("lz-string") as typeof LzString;
