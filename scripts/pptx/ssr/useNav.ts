/**
 * Server-render stand-in for Slidev's useNav, which needs the router: Slidev's own fixed
 * navigation (the kind its print and export views use) for the slide being rendered.
 */
import type { ClicksContext } from "@slidev/types";

// The query keeps these imports from resolving back to this stand-in.
import { useFixedNav } from "@slidev/client/composables/useNav.ts?pptx-original";
import { computed, ref } from "vue";

// eslint-disable-next-line n/no-missing-import -- Slidev's virtual module, which Vite resolves.
import { slides } from "#slidev/slides";

export * from "@slidev/client/composables/useNav.ts?pptx-original";

declare global {
	var __pptxNav: undefined | { clicksContext: ClicksContext; no: number };
}

export function useNav() {
	const state = globalThis.__pptxNav;
	if (!state) {
		throw new Error("useNav() was called outside of a slide render.");
	}

	const nav = useFixedNav(slides.value[state.no - 1], state.clicksContext);
	return {
		...nav,
		currentRoute: computed(() => ({ path: nav.currentPath.value, query: {} })),
		hasPrimarySlide: computed(() => true),
		isEmbedded: computed(() => false),
		isNotesViewer: computed(() => false),
		isPlaying: computed(() => false),
		isPresenter: computed(() => false),
		isPresenterAvailable: computed(() => false),
		// Exporting is printing, with every click state.
		isPrintMode: computed(() => true),
		isPrintWithClicks: ref(true),
		printRange: ref(slides.value.map((_, i) => i + 1)),
	};
}
