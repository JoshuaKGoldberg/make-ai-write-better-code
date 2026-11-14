<script setup lang="ts">
import { useSlideContext } from "@slidev/client";

import { currentHighlightRange } from "./highlightRange.ts";

const props = defineProps({
	at: { default: "+1", type: [String, Number] },
	finally: { default: "last", type: [String, Number] },
	lines: { default: false, type: Boolean },
	maxHeight: { default: undefined, type: String },
	ranges: { default: () => [], type: Array },
	startLine: { default: 1, type: Number },
	title: { default: "", type: String },
});

const { $clicksContext: clicks } = useSlideContext();
const range = currentHighlightRange(clicks, props);
</script>

<template>
	<div
		class="slidev-code-wrapper relative group"
		:data-highlight-range="range"
		:data-start-line="startLine"
		:style="{ '--start': startLine }"
	>
		<slot />
	</div>
</template>
