/// <reference types="@slidev/types/client" />

declare module "@slidev/client/composables/useNav.ts?pptx-original" {
	import type { ClicksContext, SlideRoute } from "@slidev/types";
	import type { ComputedRef } from "vue";

	export function useFixedNav(
		route: SlideRoute,
		clicksContext: ClicksContext,
	): Record<string, unknown> & { currentPath: ComputedRef<string> };
}
