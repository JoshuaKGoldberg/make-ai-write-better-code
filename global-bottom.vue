<script setup lang="ts">
import { useNav } from "@slidev/client";
import { computed } from "vue";

const { currentPage, total } = useNav();

const progress = computed(() => `${(currentPage.value / total.value) * 100}%`);
</script>

<template>
	<div aria-hidden="true" class="ambient">
		<div class="glow glow-one" />
		<div class="glow glow-two" />
	</div>
	<div aria-hidden="true" class="progress" :style="{ width: progress }" />
</template>

<style scoped>
.ambient {
	inset: 0;
	overflow: hidden;
	pointer-events: none;
	position: absolute;
}

.glow {
	border-radius: 50%;
	filter: blur(80px);
	position: absolute;
}

.glow-one {
	animation: drift-one 40s ease-in-out infinite alternate;
	background: rgb(0 163 255 / 3.25%);
	height: 22rem;
	left: -6rem;
	top: -8rem;
	width: 34rem;
}

.glow-two {
	animation: drift-two 52s ease-in-out infinite alternate;
	background: rgb(119 187 255 / 2%);
	bottom: -10rem;
	height: 20rem;
	right: -8rem;
	width: 30rem;
}

@keyframes drift-one {
	to {
		transform: translate(9rem, 2rem);
	}
}

@keyframes drift-two {
	to {
		transform: translate(-8rem, -1.5rem);
	}
}

.progress {
	background: linear-gradient(90deg, rgb(0 163 255 / 0%), var(--jg-squiggle));
	bottom: 0;
	height: 2px;
	left: 0;
	opacity: 0.28;
	position: absolute;
	transition: width var(--jg-duration-slowest) ease;
}

@media (prefers-reduced-motion: reduce) {
	.glow {
		animation: none;
	}
}
</style>
