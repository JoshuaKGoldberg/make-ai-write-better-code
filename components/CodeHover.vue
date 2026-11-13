<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";

withDefaults(
	defineProps<{
		/** Zero-based column, in characters, counting each tab as two. */
		col: number;
		/** How many characters the squiggle spans. */
		length: number;
		/** Zero-based line in the code block. */
		line: number;
		message: string;
		shown?: boolean;
		/** Where the report came from, such as "ts(18047)" or "eslint(rule-name)". */
		source: string;
	}>(),
	{ shown: true },
);

// The squiggle is drawn as one wavy path with round caps, sized to the
// element's layout width, so its ends are rounded instead of cut off.
const squiggle = {
	amplitude: 1.2,
	halfPeriod: 4,
	height: 6,
	strokeWidth: 3,
};

const squiggleElement = useTemplateRef("squiggleElement");
const squiggleWidth = ref(0);

const observer = new ResizeObserver(() => {
	squiggleWidth.value = squiggleElement.value?.offsetWidth ?? 0;
});

onMounted(() => {
	if (squiggleElement.value) {
		observer.observe(squiggleElement.value);
	}
});

onBeforeUnmount(() => {
	observer.disconnect();
});

const squigglePath = computed(() => {
	const { amplitude, halfPeriod, height, strokeWidth } = squiggle;
	const segments = Math.max(
		1,
		Math.floor((squiggleWidth.value - strokeWidth) / halfPeriod),
	);
	const start = (squiggleWidth.value - segments * halfPeriod) / 2;
	const first = `q ${halfPeriod / 2} ${-amplitude * 2} ${halfPeriod} 0`;
	const rest = ` t ${halfPeriod} 0`.repeat(segments - 1);

	return `M ${start} ${height / 2} ${first}${rest}`;
});
</script>

<template>
	<div
		class="code-hover"
		:class="{ shown }"
		:style="{ '--col': col, '--length': length, '--line': line }"
	>
		<div ref="squiggleElement" class="squiggle">
			<svg aria-hidden="true" :height="squiggle.height" :width="squiggleWidth">
				<path
					:d="squigglePath"
					fill="none"
					stroke="#f14c4c"
					stroke-linecap="round"
					:stroke-width="squiggle.strokeWidth"
				/>
			</svg>
		</div>
		<div class="tooltip" role="tooltip">
			<span class="hover-message">{{ message }}</span>
			<span class="hover-source">{{ source }}</span>
		</div>
	</div>
</template>

<style scoped>
.code-hover {
	font-family: var(--slidev-code-font-family);
	font-size: var(--slidev-code-font-size);
	left: calc(var(--code-origin-left) + var(--col) * 1ch);
	line-height: var(--slidev-code-line-height);
	pointer-events: none;
	position: absolute;
	top: calc(
		var(--code-origin-top) + (var(--line) + 1) * var(--slidev-code-line-height)
	);
	z-index: 1;
}

/* The squiggle appears first, then the tooltip slides down into place. */
.squiggle,
.tooltip {
	opacity: 0;
	transition:
		opacity var(--jg-duration-medium) ease,
		transform var(--jg-duration-medium) ease;
}

.tooltip {
	transform: translateY(-0.5rem);
}

.shown .squiggle {
	opacity: 1;
}

.shown .tooltip {
	opacity: 1;
	transform: none;
	transition-delay: calc(var(--jg-duration-medium) / 2);
}

.squiggle {
	height: 6px;
	margin-top: -4px;
	width: calc(var(--length) * 1ch);
}

.tooltip {
	background: #1b2130;
	border: 1px solid rgb(255 255 255 / 12%);
	border-radius: 4px;
	box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 45%);
	color: #cccccc;
	display: flex;
	flex-direction: column;
	font-size: 0.85em;
	gap: 0.2rem;
	line-height: 1.4;
	margin-top: 0.35rem;
	padding: 0.45rem 0.7rem;
	width: max-content;
	max-width: 64ch;
}

.hover-source {
	color: #8b95a7;
}
</style>
