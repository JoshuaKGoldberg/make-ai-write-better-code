<script setup lang="ts">
import { useClickTarget } from "./clicks.ts";

const props = defineProps({
	size: { default: 1, type: [String, Number] },
});

const delta = Number.isNaN(Number(props.size)) ? 1 : Number(props.size);
const target = useClickTarget((clicks, element) => {
	clicks.register(element, { delta, max: clicks.currentOffset + delta - 1 });
	element.remove();
});
</script>

<template>
	<span v-bind="target" />
</template>
