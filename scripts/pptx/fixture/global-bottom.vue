<script setup lang="ts">
import { useNav } from "@slidev/client";
const { currentLayout } = useNav();
</script>

<template>
	<div class="backdrop" />
	<div :data-layout="currentLayout" />
</template>
