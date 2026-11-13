import type { KnipConfig } from "knip";

export default {
	entry: [
		// Swapped in for Slidev internals through Vite aliases.
		"scripts/pptx/ssr/*",
		"setup/*.ts",
		"src/**/*.test.*",
		"styles/index.ts",
	],
	ignoreExportsUsedInFile: { interface: true, type: true },
	project: [
		"scripts/**/*.{ts,vue}",
		"setup/**/*.ts",
		"src/**/*.ts",
		"styles/**/*.ts",
	],
	treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
