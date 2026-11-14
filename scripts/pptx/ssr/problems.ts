import { inject } from "vue";

import type { BuildPptxProblem } from "../types.ts";

export type SlideProblem = Pick<
	BuildPptxProblem,
	"click" | "message" | "severity"
>;

export const injectionSlideProblems = "$$slidev-pptx-slide-problems";

export function useSlideProblems() {
	const problems = inject<SlideProblem[]>(injectionSlideProblems);
	if (!problems) {
		throw new Error("A slide problem was reported outside of a slide render.");
	}

	return problems;
}
