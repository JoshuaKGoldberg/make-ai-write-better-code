<script setup lang="ts">
import contributions from "./github-contributions.json";

// Snapshot of github.com/JoshuaKGoldberg's contribution calendar, fetched from
// GitHub's GraphQL API. Each year's levels are one 0-4 digit per day.
const years = contributions.map(({ firstWeekday, levels, total, year }) => ({
	days: [
		...Array.from({ length: firstWeekday }, () => -1),
		...Array.from(levels, Number),
	],
	total: total.toLocaleString("en-US"),
	year,
}));
</script>

<template>
	<div class="github-squares">
		<div v-for="{ days, total, year } in years" :key="year" class="year">
			<span class="year-label">{{ year }}</span>
			<div class="days">
				<span
					v-for="(level, index) in days"
					:key="index"
					class="day"
					:class="`level-${level}`"
				/>
			</div>
			<span class="year-total">{{ total }}</span>
		</div>
	</div>
</template>

<style scoped>
.github-squares {
	display: grid;
	gap: 14px;
}

.year {
	align-items: center;
	display: grid;
	gap: 16px;
	grid-template-columns: 3rem auto 4rem;
}

.year-label {
	color: var(--jg-fg-muted);
	font-size: 1.25rem;
	font-weight: var(--jg-weight-medium);
}

.year-total {
	color: var(--jg-fg-muted);
	font-size: 1rem;
}

.days {
	display: grid;
	gap: 2px;
	grid-auto-columns: 9px;
	grid-auto-flow: column;
	grid-template-rows: repeat(7, 9px);
	width: calc(53 * 11px);
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
