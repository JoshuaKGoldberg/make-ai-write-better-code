<!-- Server-render stand-in for Slidev's ShikiMagicMove: registers the same clicks and
renders the current step's tokens as a static code block. -->
<script setup lang="ts">
import { useSlideContext } from "@slidev/client";
import lz from "lz-string";

const props = defineProps({
	at: { default: "+1", type: [String, Number] },
	duration: { default: 0, type: Number },
	lines: { default: false, type: Boolean },
	stepRanges: { required: true, type: Array },
	stepsLz: { required: true, type: String },
	title: { default: "", type: String },
});

const steps = JSON.parse(lz.decompressFromBase64(props.stepsLz));
const { $clicksContext: clicks } = useSlideContext();
const ranges = props.stepRanges.map((r) => (r.length ? r : ["all"]));
const clickCounts = ranges.map((r) => r.length).reduce((a, b) => a + b, 0);
const info = clicks.calculateSince(props.at, clickCounts - 1);
clicks.register(Symbol("magic-move"), info);

// Same step/range resolution as Slidev's ShikiMagicMove watcher.
const clickCount = info ? clicks.current - info.start : Infinity;
let step = steps.length - 1;
let rangeStr = "all";
let sum = 0;
for (let i = 0; i < ranges.length; i++) {
	if (clickCount < sum + ranges[i].length - 1) {
		step = i;
		rangeStr = ranges[i][clickCount - sum + 1];
		break;
	}

	sum += ranges[i].length || 1;
}

const escape = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const current = steps[step];
const lines: string[] = [""];
for (const token of current.tokens) {
	const parts = String(token.content).split("\n");
	parts.forEach((part, i) => {
		if (i > 0) {
			lines.push("");
		}

		if (part) {
			lines[lines.length - 1] += `<span style="${
				token.htmlStyle
					? Object.entries(token.htmlStyle)
							.map(([k, v]) => `${k}:${v}`)
							.join(";")
					: ""
			}">${escape(part)}</span>`;
		}
	});
}

const html = `<pre class="slidev-code relative shiki overflow-visible ${current.themeName ?? ""}" style="${current.rootStyle ?? ""}"><code>${lines.map((l) => `<span class="line">${l}</span>`).join("\n")}</code></pre>`;
</script>

<template>
	<div
		class="slidev-code-wrapper slidev-code-magic-move relative group"
		:data-highlight-range="rangeStr"
		data-start-line="1"
		v-html="html"
	/>
</template>
