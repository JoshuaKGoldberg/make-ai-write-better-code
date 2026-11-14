import type { KnipConfig } from "knip";

export default {
	entry: [
		// Swapped in for Slidev internals through Vite aliases.
		"scripts/pptx/ssr/*",
		"scripts/**/*.test.*",
		"setup/*.ts",
		"src/**/*.test.*",
		"styles/index.ts",
	],
	// A Slidev deck the PowerPoint build's tests build.
	ignore: ["scripts/pptx/fixture/**"],
	ignoreExportsUsedInFile: { interface: true, type: true },
	// Slidev's virtual modules, which its Vite plugins resolve.
	ignoreUnresolved: [/^#slidev\//],
	project: [
		"scripts/**/*.{ts,vue}",
		"setup/**/*.ts",
		"src/**/*.ts",
		"styles/**/*.ts",
	],
	treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
