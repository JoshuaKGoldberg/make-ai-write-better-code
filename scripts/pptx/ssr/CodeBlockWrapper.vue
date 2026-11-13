<!-- Server-render stand-in for Slidev's CodeBlockWrapper: registers the same clicks,
and records the active highlight range for post-processing to apply. -->
<script setup lang="ts">
import { useSlideContext } from "@slidev/client";

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
let range = "";
if (clicks && props.ranges.length) {
	const info = clicks.calculateSince(props.at, props.ranges.length - 1);
	clicks.register(Symbol("code-block"), info);
	const index = info ? Math.max(0, clicks.current - info.start + 1) : Infinity;
	const finallyRange =
		props.finally === "last" ? props.ranges.at(-1) : String(props.finally);
	range = props.ranges[index] ?? finallyRange;
}
</script>

<template>
	<div
		class="slidev-code-wrapper relative group"
		:data-highlight-range="range || undefined"
		:data-start-line="startLine"
		:style="{ '--start': startLine }"
	>
		<slot />
	</div>
</template>
