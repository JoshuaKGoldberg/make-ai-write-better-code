// Server-render stand-in for Slidev's useNav, which needs the router.
import { computed } from "vue";

export function useNav() {
	const state = (
		globalThis as { __pptxNav?: { currentPage: number; total: number } }
	).__pptxNav ?? { currentPage: 1, total: 1 };
	return {
		currentPage: computed(() => state.currentPage),
		isPrintMode: computed(() => false),
		total: computed(() => state.total),
	};
}
