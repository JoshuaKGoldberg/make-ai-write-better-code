import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		clearMocks: true,
		coverage: {
			include: ["scripts/**/*.ts", "src/**/*.ts"],
			reporter: ["html", "lcov"],
		},
		exclude: ["dist", "node_modules"],
		setupFiles: ["console-fail-test/setup"],
	},
});
