<script setup lang="ts">
import TitleIcon from "@slidev/client/internals/TitleIcon.vue";
import { provide, ref, useSlots } from "vue";

const tabs = (useSlots().default?.() ?? []).flatMap(({ props }) =>
	props?.title ? [props.title] : [],
);
const activeTitle = ref(tabs[0] ?? "");

provide("activeTitle", activeTitle);
</script>

<template>
	<div class="slidev-code-group">
		<div class="slidev-code-group-tabs">
			<div v-for="tab in tabs" :key="tab" class="flex items-center">
				<div
					class="slidev-code-tab"
					:style="{
						borderColor:
							activeTitle === tab
								? 'var(--slidev-theme-primary)'
								: 'transparent',
						color:
							activeTitle === tab
								? 'var(--slidev-code-tab-active-text-color)'
								: 'var(--slidev-code-tab-text-color)',
					}"
				>
					<TitleIcon :title="tab" />

					<div>
						{{ tab.replace(/~([^~]+)~/g, "").trim() }}
					</div>
				</div>
			</div>
		</div>
		<div class="slidev-code-group-blocks">
			<slot />
		</div>
	</div>
</template>
