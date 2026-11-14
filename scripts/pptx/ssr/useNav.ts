import type { ClicksContext } from "@slidev/types";

import { useFixedNav } from "@slidev/client/composables/useNav.ts?pptx-original";
import { computed, inject, ref } from "vue";

// eslint-disable-next-line n/no-missing-import -- Slidev's virtual module, which Vite resolves.
import { slides } from "#slidev/slides";

export * from "@slidev/client/composables/useNav.ts?pptx-original";

export const injectionSlideNav = "$$slidev-pptx-nav";

export function createSlideContext(
	slideNumber: number,
	clicksContext: ClicksContext,
) {
	const route = slides.value[slideNumber - 1];
	const nav = useFixedNav(route, clicksContext);
	return {
		nav: {
			...nav,
			currentRoute: computed(() => ({
				path: nav.currentPath.value,
				query: {},
			})),
			hasPrimarySlide: computed(() => true),
			isEmbedded: computed(() => false),
			isNotesViewer: computed(() => false),
			isPlaying: computed(() => false),
			isPresenter: computed(() => false),
			isPresenterAvailable: computed(() => false),
			isPrintMode: computed(() => true),
			isPrintWithClicks: ref(true),
			printRange: ref(slides.value.map((_, index) => index + 1)),
		},
		route,
	};
}

export function useNav() {
	const nav =
		inject<ReturnType<typeof createSlideContext>["nav"]>(injectionSlideNav);
	if (!nav) {
		throw new Error("useNav() was called outside of a slide render.");
	}

	return nav;
}
