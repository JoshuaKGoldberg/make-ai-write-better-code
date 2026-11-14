<script setup lang="ts">
import { useNav } from "@slidev/client";
const { currentLayout, currentPage, total } = useNav();
</script>

<template>
	<div class="pager">{{ currentPage }} / {{ total }} · {{ currentLayout }}</div>
	<UnregisteredInGlobalTop />
</template>

<style scoped>
.pager {
	position: absolute;
	right: 12px;
	bottom: 8px;
	font-size: 12px;
	color: slategray;
	font-family: "Fixture Sans", sans-serif;
}
</style>
