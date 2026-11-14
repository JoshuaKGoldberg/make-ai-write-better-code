<script setup lang="ts">
import { useNav } from "@slidev/client";
const { currentPage, total, currentLayout } = useNav();
</script>

<template>
	<div class="pager">{{ currentPage }} / {{ total }} · {{ currentLayout }}</div>
</template>

<style scoped>
.pager {
	position: absolute;
	right: 12px;
	bottom: 8px;
	font-size: 12px;
	color: slategray;
	font-family: Georgia, serif;
}
</style>
