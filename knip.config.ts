import type { KnipConfig } from "knip";

export default {
	entry: [
		"scripts/pptx/index.ts",
		"scripts/pptx/ssr/*",
		"scripts/**/*.test.*",
		"setup/*.ts",
		"src/**/*.test.*",
		"styles/index.ts",
	],
	ignore: ["scripts/pptx/fixture/**"],
	ignoreUnresolved: [/^#slidev\//],
	project: [
		"scripts/**/*.{ts,vue}",
		"setup/**/*.ts",
		"src/**/*.ts",
		"styles/**/*.ts",
	],
	treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
