<script setup lang="ts">
import {
	CLASS_VCLICK_CURRENT,
	CLASS_VCLICK_DISPLAY_NONE,
	CLASS_VCLICK_PRIOR,
	CLASS_VCLICK_TARGET,
	CLICKS_MAX,
} from "@slidev/client/constants.ts";
import { useSlots } from "vue";

import { useClickTarget } from "./clicks.ts";

const props = defineProps({
	at: { default: "+1", type: [Number, String] },
	childTag: { default: "div", type: String },
	tag: { default: "div", type: String },
	transition: { default: false, type: [Object, String, Boolean] },
	unmount: { default: false, type: Boolean },
});

const contents = [];
let lastStart;
for (const [range, slot] of Object.entries(useSlots()).sort(
	([a], [b]) => -a.split("-")[0] + +b.split("-")[0],
)) {
	if (Number.isFinite(+range)) {
		contents.unshift({ end: lastStart ?? +range + 1, slot, start: +range });
		lastStart = +range;
	} else {
		const [start, end] = range.split("-").map(Number);
		if (!Number.isFinite(start) || !Number.isFinite(end)) {
			throw new TypeError(`Invalid range for v-switch: ${range}`);
		}

		contents.unshift({ end, slot, start });
		lastStart = start;
	}
}

const target = useClickTarget((clicks, element, id) => {
	const info = clicks.calculateSince(
		props.at,
		Math.max(...contents.map(({ end }) => end)) - 1,
	);
	clicks.register(id, info);
	const offset = info ? info.currentOffset.value + 1 : CLICKS_MAX;
	for (const [index, child] of [...element.children].entries()) {
		const { end, start } = contents[index];
		const visible = start <= offset && offset < end;
		if (props.unmount && !visible) {
			child.remove();
			continue;
		}

		child.classList.add(CLASS_VCLICK_TARGET);
		child.classList.toggle(CLASS_VCLICK_CURRENT, offset === start);
		child.classList.toggle(CLASS_VCLICK_PRIOR, offset >= end);
		child.classList.toggle(CLASS_VCLICK_DISPLAY_NONE, !visible);
	}
});
</script>

<template>
	<component :is="tag" v-bind="target">
		<component
			:is="childTag"
			v-for="{ end, slot, start } in contents"
			:key="start"
			:data-slidev-clicks-start="start"
			:data-slidev-clicks-end="end"
		>
			<component :is="slot" />
		</component>
	</component>
</template>
