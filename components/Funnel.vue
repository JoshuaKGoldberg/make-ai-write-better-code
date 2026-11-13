<script setup lang="ts">
import { useSlideContext } from "@slidev/client";
import { computed, useId } from "vue";

const props = withDefaults(
	defineProps<{
		/** Label beside the bug that makes it all the way through. */
		bottom?: string;
		/** A single stage to mark as "you are here", showing only its question. */
		current?: string;
		/** Stage names to emphasize, such as the development-time stages. */
		highlight?: string[];
		/** Optional questions shown beside each stage, one per click. */
		questions?: string[];
		stages: string[];
		/** Label beside the bugs going into the funnel. */
		top?: string;
	}>(),
	{ highlight: () => [], questions: () => [] },
);

const { $clicks } = useSlideContext();

// Slidev keeps neighboring slides mounted, so each funnel needs its own
// gradient ids: url(#id) would otherwise resolve to a hidden slide's gradient.
const gradientId = `funnel-band-${useId()}`;

const bugs = { bottom: 62, radius: 4.5, top: 16 };
const cone = { bottom: 362, gap: 6, top: 82 };
const mouthWidth = 560;
const neckWidth = 120;
const spoutBottom = 414;
const center = computed(() => (props.questions.length ? 300 : 400));
const width = computed(() => (props.questions.length ? 1000 : 800));

function widthAt(y: number) {
	const progress = (y - cone.top) / (cone.bottom - cone.top);
	return mouthWidth + (neckWidth - mouthWidth) * progress;
}

const bugPositions = computed(() => {
	const columns = 15;
	const rows = 3;
	const spread = mouthWidth - 64;
	const spacing = spread / (columns - 1);
	const rowGap = (bugs.bottom - bugs.top) / (rows - 1);

	return Array.from({ length: rows }, (_, row) =>
		Array.from({ length: row % 2 ? columns - 1 : columns }, (_, column) => ({
			x:
				center.value -
				spread / 2 +
				column * spacing +
				(row % 2 ? spacing / 2 : 0),
			y: bugs.top + row * rowGap,
		})),
	).flat();
});

const bands = computed(() => {
	const height =
		(cone.bottom - cone.top - cone.gap * (props.stages.length - 1)) /
		props.stages.length;

	return props.stages.map((stage, index) => {
		const y1 = cone.top + index * (height + cone.gap);
		const y2 = y1 + height;
		const [top, bottom] = [widthAt(y1) / 2, widthAt(y2) / 2];
		const x = center.value;

		return {
			highlighted: props.current
				? props.current === stage
				: props.highlight.includes(stage),
			points: `${x - top},${y1} ${x + top},${y1} ${x + bottom},${y2} ${x - bottom},${y2}`,
			question: props.questions[index],
			stage,
			visible: props.current ? props.current === stage : $clicks.value > index,
			y: (y1 + y2) / 2,
		};
	});
});

const spout = computed(() => {
	const x = center.value;
	const top = cone.bottom + cone.gap;
	return `${x - 30},${top} ${x + 30},${top} ${x + 30},${spoutBottom} ${x - 30},${spoutBottom}`;
});
</script>

<template>
	<svg
		:aria-label="`Funnel of bugs through: ${stages.join(', ')}`"
		class="funnel"
		:class="{ wide: questions.length }"
		role="img"
		:viewBox="`0 0 ${width} 450`"
	>
		<defs>
			<linearGradient :id="gradientId" x1="0" x2="0" y1="0" y2="1">
				<stop offset="0%" stop-color="rgb(119 187 255)" stop-opacity="0.14" />
				<stop
					offset="100%"
					stop-color="rgb(119 187 255)"
					stop-opacity="0.095"
				/>
			</linearGradient>
			<linearGradient
				:id="`${gradientId}-highlighted`"
				x1="0"
				x2="1"
				y1="0"
				y2="0"
			>
				<stop offset="0%" stop-color="rgb(0 163 255)" stop-opacity="0.46" />
				<stop offset="100%" stop-color="rgb(119 187 255)" stop-opacity="0.38" />
			</linearGradient>
		</defs>
		<circle
			v-for="(bug, index) in bugPositions"
			:key="index"
			class="bug"
			:cx="bug.x"
			:cy="bug.y"
			:r="bugs.radius"
		/>
		<text
			v-if="top"
			class="end-label"
			:x="center - mouthWidth / 2 - 16"
			:y="(bugs.top + bugs.bottom) / 2"
		>
			{{ top }}
		</text>
		<g v-for="band in bands" :key="band.stage">
			<polygon
				class="band"
				:class="{ highlighted: band.highlighted }"
				:fill="`url(#${gradientId}${band.highlighted ? '-highlighted' : ''})`"
				:points="band.points"
			/>
			<text
				class="stage"
				:class="{ highlighted: band.highlighted }"
				:x="center"
				:y="band.y"
			>
				{{ band.stage }}
			</text>
			<text
				v-if="band.question"
				class="question"
				:class="{ visible: band.visible }"
				:x="center + mouthWidth / 2 + 40"
				:y="band.y"
			>
				{{ band.question }}
			</text>
		</g>
		<polygon class="band" :fill="`url(#${gradientId})`" :points="spout" />
		<circle class="bug" :cx="center" cy="432" :r="bugs.radius" />
		<text v-if="bottom" class="end-label after" :x="center + 18" y="432">
			{{ bottom }}
		</text>
	</svg>
</template>

<style scoped>
.funnel {
	display: block;
	margin: 1rem auto 0;
	width: 38rem;
}

.funnel.wide {
	width: 54rem;
}

.band {
	stroke: rgb(119 187 255 / 7%);
	stroke-width: 1;
}

.band.highlighted {
	filter: drop-shadow(0 0 5px rgb(0 163 255 / 22%));
	stroke: rgb(119 187 255 / 22%);
}

.bug {
	fill: var(--jg-link);
	filter: drop-shadow(0 0 2px rgb(119 187 255 / 35%));
}

text {
	dominant-baseline: central;
	font-family: var(--jg-font-sans);
}

.stage {
	fill: var(--jg-fg-muted);
	font-size: 19px;
	font-weight: 500;
	text-anchor: middle;
}

.stage.highlighted {
	fill: var(--jg-fg-strong);
	font-weight: 600;
}

.wide .stage {
	font-size: 26px;
}

.question {
	fill: var(--jg-fg);
	font-size: 26px;
	font-weight: 300;
	opacity: 0;
	transition: opacity var(--jg-duration-medium) ease;
}

.question.visible {
	opacity: 1;
}

.end-label {
	fill: var(--jg-fg-muted);
	font-size: 18px;
	text-anchor: end;
}

.end-label.after {
	text-anchor: start;
}
</style>
