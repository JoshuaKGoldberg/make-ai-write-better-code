<script setup lang="ts">
import { lzString } from "./lzString.ts";
import { useSlideProblems } from "./problems.ts";

const props = defineProps({
	codeLz: { default: "", type: String },
	diffLz: { default: "", type: String },
	lang: { default: "typescript", type: String },
	runnable: Boolean,
});

const problems = useSlideProblems();
if (props.diffLz) {
	problems.push({
		message: "Couldn't export the modified side of a monaco-diff block.",
		severity: "error",
	});
}

if (props.runnable) {
	problems.push({
		message: "Couldn't export the output of a monaco-run block.",
		severity: "error",
	});
}

const lines = lzString.decompressFromBase64(props.codeLz).trimEnd().split("\n");
</script>

<template>
	<div class="slidev-code-wrapper relative group">
		<pre
			class="shiki slidev-code"
		><code><template v-for="(line, index) in lines" :key="index"><template v-if="index">{{ "\n" }}</template><span class="line">{{ line }}</span></template></code></pre>
	</div>
</template>
