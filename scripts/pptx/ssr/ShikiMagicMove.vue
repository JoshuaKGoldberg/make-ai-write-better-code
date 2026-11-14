<script setup lang="ts">
import TitleIcon from "@slidev/client/internals/TitleIcon.vue";
import { updateCodeHighlightRange } from "@slidev/client/logic/utils.ts";
import { createRequire } from "node:module";

import { useClickTarget } from "./clicks.ts";

// Slidev aliases lz-string to its CommonJS file when process.argv[1] makes it think it was installed globally, which Vite can't evaluate.
const require = createRequire(import.meta.url);
const lzString = require("lz-string");

const props = defineProps({
	at: { default: "+1", type: [String, Number] },
	duration: { default: 0, type: Number },
	lines: { default: false, type: Boolean },
	stepRanges: { required: true, type: Array },
	stepsLz: { required: true, type: String },
	title: { default: "", type: String },
});

const steps = JSON.parse(lzString.decompressFromBase64(props.stepsLz)).map(
	({ rootStyle, themeName, tokens }) => {
		const tokenLines = [[]];
		for (const token of tokens) {
			for (const [index, content] of token.content.split("\n").entries()) {
				if (index) {
					tokenLines.push([]);
				}

				if (content) {
					tokenLines.at(-1).push({ content, style: token.htmlStyle });
				}
			}
		}

		return { rootStyle, themeName, tokenLines };
	},
);
const stepRanges = props.stepRanges.map((ranges) =>
	ranges.length ? ranges : ["all"],
);

const target = useClickTarget((clicks, element) => {
	const info = clicks.calculateSince(props.at, stepRanges.flat().length - 1);
	clicks.register(element, info);
	const clickCount = info
		? clicks.current - info.start
		: Number.POSITIVE_INFINITY;
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

	const codes = [...element.querySelectorAll(":scope > pre")];
	for (const [index, code] of codes.entries()) {
		if (index !== step) {
			code.remove();
		}
	}

	const lines = [...codes[step].querySelectorAll("code > .line")];
	updateCodeHighlightRange(range, lines.length, 1, (line) => [lines[line]]);
});
</script>

<template>
	<div
		class="slidev-code-wrapper slidev-code-magic-move relative group"
		v-bind="target"
	>
		<div v-if="title" class="slidev-code-block-title">
			<TitleIcon :title="title" />
			<div class="leading-1em">
				{{ title.replace(/~([^~]+)~/g, "").trim() }}
			</div>
		</div>
		<pre
			v-for="({ rootStyle, themeName, tokenLines }, step) in steps"
			:key="step"
			:class="['slidev-code relative shiki overflow-visible', themeName]"
			:style="rootStyle"
		><code><template v-for="(line, index) in tokenLines" :key="index"><template v-if="index">{{ "\n" }}</template><span class="line"><span v-for="(token, tokenIndex) in line" :key="tokenIndex" :style="token.style">{{ token.content }}</span></span></template></code></pre>
	</div>
</template>
