<script setup lang="ts">
import contributions from "./github-contributions.json";

// Snapshot of github.com/JoshuaKGoldberg's last 574 weeks (eleven years) of
// contributions, from GitHub's GraphQL API. Each day is one character: a 0-4
// contribution level, or "-" for days that hadn't happened yet. Weeks start on
// Sunday and wrap into bands so the grid fills a 16:9 slide.
const bandCount = 7;
const daysPerWeek = 7;
const weeksPerBand = contributions.levels.length / daysPerWeek / bandCount;

const bands = Array.from({ length: bandCount }, (_, band) =>
	Array.from(
		contributions.levels.slice(
			band * weeksPerBand * daysPerWeek,
			(band + 1) * weeksPerBand * daysPerWeek,
		),
	),
);
</script>

<template>
	<div aria-hidden="true" class="github-squares">
		<div v-for="(days, band) in bands" :key="band" class="band">
			<span
				v-for="(level, index) in days"
				:key="index"
				class="day"
				:class="`level-${level}`"
			/>
		</div>
	</div>
</template>

<style scoped>
.github-squares {
	display: grid;
	gap: 3px;
	grid-template-rows: repeat(7, 1fr);
	inset: 0;
	padding: 3px;
	position: absolute;
}

.band {
	column-gap: 3.7px;
	display: grid;
	row-gap: 3px;
	grid-auto-columns: 1fr;
	grid-auto-flow: column;
	grid-template-rows: repeat(7, 1fr);
}

.day {
	border-radius: 2px;
}

/* GitHub's dark mode contribution colors. */
.level-0 {
	background: #151b23;
}

.level-1 {
	background: #033a16;
}

.level-2 {
	background: #196c2e;
}

.level-3 {
	background: #2ea043;
}

.level-4 {
	background: #56d364;
}
</style>
