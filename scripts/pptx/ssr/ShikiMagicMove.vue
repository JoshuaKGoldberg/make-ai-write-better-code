<script setup lang="ts">
import { useSlideContext } from "@slidev/client";
import lzString from "lz-string";

const props = defineProps({
	at: { default: "+1", type: [String, Number] },
	duration: { default: 0, type: Number },
	lines: { default: false, type: Boolean },
	stepRanges: { required: true, type: Array },
	stepsLz: { required: true, type: String },
	title: { default: "", type: String },
});

const steps = JSON.parse(lzString.decompressFromBase64(props.stepsLz));
const { $clicksContext: clicks } = useSlideContext();
const stepRanges = props.stepRanges.map((ranges) =>
	ranges.length ? ranges : ["all"],
);
const info = clicks.calculateSince(props.at, stepRanges.flat().length - 1);
clicks.register(Symbol("magic-move"), info);

const clickCount = info ? clicks.current - info.start : Infinity;
let step = steps.length - 1;
let range = "all";
let clicksBefore = 0;
for (const [index, ranges] of stepRanges.entries()) {
	if (clickCount < clicksBefore + ranges.length - 1) {
		step = index;
		range = ranges[clickCount - clicksBefore + 1];
		break;
	}

	clicksBefore += ranges.length;
}

const { rootStyle, themeName, tokens } = steps[step];
const tokenLines = [[]];
for (const token of tokens) {
	String(token.content)
		.split("\n")
		.forEach((content, index) => {
			if (index) {
				tokenLines.push([]);
			}

			if (content) {
				tokenLines.at(-1).push({ content, style: token.htmlStyle });
			}
		});
}
</script>

<template>
	<div
		class="slidev-code-wrapper slidev-code-magic-move relative group"
		:data-highlight-range="range"
		data-start-line="1"
	>
		<pre
			:class="['slidev-code relative shiki overflow-visible', themeName]"
			:style="rootStyle"
		><code><template v-for="(line, index) in tokenLines" :key="index"><template v-if="index">{{ "\n" }}</template><span class="line"><span v-for="(token, tokenIndex) in line" :key="tokenIndex" :style="token.style">{{ token.content }}</span></span></template></code></pre>
	</div>
</template>
