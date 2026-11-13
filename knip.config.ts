import type { KnipConfig } from "knip";

export default {
	entry: ["setup/*.ts", "src/**/*.test.*", "styles/index.ts"],
	ignoreExportsUsedInFile: { interface: true, type: true },
	project: ["setup/**/*.ts", "src/**/*.ts", "styles/**/*.ts"],
	treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
