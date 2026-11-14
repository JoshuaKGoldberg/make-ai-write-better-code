import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		clearMocks: true,
		coverage: {
			exclude: ["scripts/pptx/bin.ts", "scripts/pptx/ssr/**"],
			include: ["scripts/**/*.ts", "src/**/*.ts"],
			reporter: ["html", "lcov"],
		},
		exclude: ["dist", "node_modules"],
		setupFiles: ["console-fail-test/setup"],
	},
});
