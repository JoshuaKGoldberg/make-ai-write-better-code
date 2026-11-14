<script setup lang="ts">
import { useSlideContext } from "@slidev/client";
import {
	CLASS_VCLICK_CURRENT,
	CLASS_VCLICK_DISPLAY_NONE,
	CLASS_VCLICK_PRIOR,
	CLASS_VCLICK_TARGET,
} from "@slidev/client/constants.ts";
import { useSlots } from "vue";

const props = defineProps({
	at: { default: "+1", type: [Number, String] },
	childTag: { default: "div", type: String },
	tag: { default: "div", type: String },
	transition: { default: false, type: [Object, String, Boolean] },
	unmount: { default: false, type: Boolean },
});

const contents = [];
let nextStart;
for (const [range, slot] of Object.entries(useSlots()).sort(
	([a], [b]) => parseInt(b) - parseInt(a),
)) {
	const [start, end = nextStart ?? start + 1] = range.split("-").map(Number);
	contents.unshift({ end, slot, start });
	nextStart = start;
}

const { $clicksContext: clicks } = useSlideContext();
const info = clicks.calculateSince(
	props.at,
	Math.max(...contents.map(({ end }) => end)) - 1,
);
clicks.register(Symbol("v-switch"), info);
const offset = info ? info.currentOffset.value + 1 : Infinity;
const shown = contents
	.map((content) => ({
		...content,
		visible: content.start <= offset && offset < content.end,
	}))
	.filter(({ visible }) => visible || !props.unmount);
</script>

<template>
	<component :is="tag">
		<component
			:is="childTag"
			v-for="{ end, slot, start, visible } in shown"
			:key="start"
			:class="[
				CLASS_VCLICK_TARGET,
				offset === start && CLASS_VCLICK_CURRENT,
				offset >= end && CLASS_VCLICK_PRIOR,
				!visible && CLASS_VCLICK_DISPLAY_NONE,
			]"
			:data-slidev-clicks-start="start"
			:data-slidev-clicks-end="end"
		>
			<component :is="slot" />
		</component>
	</component>
</template>
