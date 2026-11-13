<script setup lang="ts">
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
</script>

<template>
	<div
		class="code-hover"
		:class="{ shown }"
		:style="{ '--col': col, '--length': length, '--line': line }"
	>
		<div class="squiggle" />
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
	opacity: 0;
	pointer-events: none;
	position: absolute;
	top: calc(
		var(--code-origin-top) + (var(--line) + 1) * var(--slidev-code-line-height)
	);
	transition: opacity var(--jg-duration-medium) ease;
	z-index: 1;
}

.code-hover.shown {
	opacity: 1;
}

.squiggle {
	background: url("/squiggle-error.svg") repeat-x;
	background-size: auto 100%;
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
