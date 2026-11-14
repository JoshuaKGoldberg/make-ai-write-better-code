<script setup lang="ts">
import { useSlideContext } from "@slidev/client";

import { currentHighlightRange } from "./highlightRange.ts";

const props = defineProps({
	at: { default: "+1", type: [String, Number] },
	finally: { default: "last", type: [String, Number] },
	ranges: { default: () => [], type: Array },
	startLine: { default: 1, type: Number },
});

const { $clicksContext: clicks } = useSlideContext();
const range = currentHighlightRange(clicks, props);
</script>

<template>
	<div
		class="slidev-katex-wrapper"
		:data-highlight-range="range"
		:data-start-line="startLine"
	>
		<slot />
	</div>
</template>
