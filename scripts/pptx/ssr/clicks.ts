import type { ClicksContext } from "@slidev/types";

import { inject } from "vue";

export type ClickTarget = (clicks: ClicksContext, element: Element) => void;

export const CLICK_TARGET_ATTRIBUTE = "data-slidev-pptx-click-";

export const injectionClickTargets = "$$slidev-pptx-click-targets";

export function clickTargetProps(targets: ClickTarget[], target: ClickTarget) {
	return { [CLICK_TARGET_ATTRIBUTE + String(targets.push(target) - 1)]: "" };
}

export function useClickTarget(target: ClickTarget) {
	const targets = inject<ClickTarget[]>(injectionClickTargets);
	if (!targets) {
		throw new Error("A click target was used outside of a slide render.");
	}

	return clickTargetProps(targets, target);
}
