// Slidev's own useNav module, imported past the alias that swaps in the stand-in.
declare module "@slidev/client/composables/useNav.ts?pptx-original" {
	import type { ClicksContext, SlideRoute } from "@slidev/types";
	import type { ComputedRef } from "vue";

	export function useFixedNav(
		route: SlideRoute,
		clicksContext: ClicksContext,
	): Record<string, unknown> & { currentPath: ComputedRef<string> };
}

// As @slidev/types/client.d.ts declares it.
declare module "#slidev/slides" {
	import type { SlideRoute } from "@slidev/types";
	import type { ShallowRef } from "vue";

	export const slides: ShallowRef<SlideRoute[]>;
}
