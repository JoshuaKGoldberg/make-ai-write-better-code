<script setup lang="ts">
import { collectKatexEquationLines } from "@slidev/client/builtin/katex-lines.ts";
import {
	CLASS_VCLICK_HIDDEN,
	CLASS_VCLICK_TARGET,
} from "@slidev/client/constants.ts";
import { parseRangeString } from "@slidev/parser/core";

import { useHighlightRange } from "./highlightRange.ts";

const props = defineProps({
	at: { default: "+1", type: [String, Number] },
	finally: { default: "last", type: [String, Number] },
	ranges: { default: () => [], type: Array },
	startLine: { default: 1, type: Number },
});

const target = useHighlightRange(props, (element, range, hidden) => {
	if (hidden) {
		element.classList.add(CLASS_VCLICK_HIDDEN);
	}

	const lines = collectKatexEquationLines(element);
	const highlighted = parseRangeString(
		lines.length + props.startLine - 1,
		range,
	);
	for (const [index, line] of lines.entries()) {
		for (const node of line) {
			node.classList.add(CLASS_VCLICK_TARGET);
			node.classList.toggle(
				"highlighted",
				highlighted.includes(index + props.startLine),
			);
			node.classList.toggle(
				"dishonored",
				!highlighted.includes(index + props.startLine),
			);
		}
	}
});
</script>

<template>
	<div class="slidev-katex-wrapper" v-bind="target">
		<slot />
	</div>
</template>
