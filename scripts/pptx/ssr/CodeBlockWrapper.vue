<script setup lang="ts">
import { configs } from "@slidev/client";
import { CLASS_VCLICK_HIDDEN } from "@slidev/client/constants.ts";
import TitleIcon from "@slidev/client/internals/TitleIcon.vue";
import { updateCodeHighlightRange } from "@slidev/client/logic/utils.ts";
import { inject } from "vue";

import { useHighlightRange } from "./highlightRange.ts";

const props = defineProps({
	at: { default: "+1", type: [String, Number] },
	finally: { default: "last", type: [String, Number] },
	lines: { default: configs.lineNumbers, type: Boolean },
	maxHeight: { default: undefined, type: String },
	ranges: { default: () => [], type: Array },
	startLine: { default: 1, type: Number },
	title: { default: "", type: String },
});

const activeTitle = inject("activeTitle", undefined);
const showTitle = activeTitle === undefined && props.title;
const target = useHighlightRange(props, (element, range, hidden) => {
	if (hidden) {
		element.classList.add(CLASS_VCLICK_HIDDEN);
	}

	const lines = [...element.querySelectorAll(".shiki code > .line")];
	updateCodeHighlightRange(range, lines.length, props.startLine, (line) => [
		lines[line],
	]);
});
</script>

<template>
	<div
		class="slidev-code-wrapper relative group"
		:class="{
			'slidev-code-line-numbers': lines,
			active: activeTitle === title,
		}"
		:style="{
			'max-height': maxHeight,
			'overflow-y': maxHeight ? 'scroll' : undefined,
			'--start': startLine,
		}"
		:data-title="title"
		v-bind="target"
	>
		<div v-if="showTitle" class="slidev-code-block-title">
			<TitleIcon :title="title" />
			<div class="leading-1em">
				{{ title.replace(/~([^~]+)~/g, "").trim() }}
			</div>
		</div>
		<slot />
	</div>
</template>
