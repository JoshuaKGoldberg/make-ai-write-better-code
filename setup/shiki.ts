import type { ThemeRegistration } from "shiki";

import { defineShikiSetup } from "@slidev/types";

// Ported from joshuakgoldberg.com's dark-mode code colors (src/layouts/base.css).
const colors = {
	comment: "#85cab1",
	constant: "#d4d8f4",
	deleted: "#f08080",
	function: "#85b8ff",
	inserted: "#70c27d",
	keyword: "#b0cff7",
	parameter: "#8dc1d0",
	punctuation: "#55e1f3",
	string: "#b3baf2",
	stringExpression: "#82c1da",
	text: "#d3d6f0",
};

const joshuakgoldberg: ThemeRegistration = {
	colors: {
		"editor.background": "#00000000",
		"editor.foreground": colors.text,
	},
	name: "joshuakgoldberg-dark",
	tokenColors: [
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: { foreground: colors.comment },
		},
		{
			scope: [
				"constant",
				"constant.numeric",
				"constant.language",
				"support.constant",
				"variable.other.constant",
			],
			settings: { foreground: colors.constant },
		},
		{
			scope: [
				"entity.name.function",
				"support.function",
				"meta.function-call",
				"entity.name.type",
				"entity.name.tag",
				"support.type",
			],
			settings: { foreground: colors.function },
		},
		{
			scope: [
				"keyword",
				"storage",
				"storage.type",
				"keyword.operator.new",
				"variable.language",
			],
			settings: { foreground: colors.keyword },
		},
		{
			scope: ["variable.parameter", "entity.other.attribute-name"],
			settings: { foreground: colors.parameter },
		},
		{
			scope: ["punctuation", "meta.brace", "keyword.operator"],
			settings: { foreground: colors.punctuation },
		},
		{
			scope: ["string", "string.quoted"],
			settings: { foreground: colors.string },
		},
		{
			scope: [
				"string.template",
				"meta.template.expression",
				"punctuation.definition.template-expression",
			],
			settings: { foreground: colors.stringExpression },
		},
		{
			scope: ["markup.deleted", "punctuation.definition.deleted"],
			settings: { foreground: colors.deleted },
		},
		{
			scope: ["markup.inserted", "punctuation.definition.inserted"],
			settings: { foreground: colors.inserted },
		},
	],
	type: "dark",
};

export default defineShikiSetup(() => ({
	themes: {
		dark: joshuakgoldberg,
		light: joshuakgoldberg,
	},
}));
