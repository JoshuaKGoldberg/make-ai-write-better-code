<script setup lang="ts">
import { createRequire } from "node:module";

defineOptions({ inheritAttrs: false });

// Slidev aliases lz-string to its CommonJS file when process.argv[1] makes it think it was installed globally, which Vite can't evaluate.
const require = createRequire(import.meta.url);
const lzString = require("lz-string");

const props = defineProps({
	codeLz: { default: "", type: String },
});

const lines = lzString.decompressFromBase64(props.codeLz).trimEnd().split("\n");
</script>

<template>
	<div class="slidev-code-wrapper relative group">
		<pre
			class="shiki slidev-code"
		><code><template v-for="(line, index) in lines" :key="index"><template v-if="index">{{ "\n" }}</template><span class="line">{{ line }}</span></template></code></pre>
	</div>
</template>
