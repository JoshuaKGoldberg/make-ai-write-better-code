<script setup lang="ts">
const props = defineProps({ clicks: { required: true, type: Number } });

if (props.clicks > 0) {
	throw new Error("It failed on a click.");
}
</script>

<template>
	<p>Before the click</p>
</template>
