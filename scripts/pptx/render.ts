/**
 * Renders Slidev slides to static HTML for any click state, with no browser:
 * Vite (with Slidev's own plugins) compiles each slide module for SSR, and Vue's
 * server renderer renders it inside a Slidev-like click context.
 */
import type {
	ClicksContext,
	RawAtValue,
	ResolvedSlidevOptions,
} from "@slidev/types";
import type { Component, ObjectDirective, Ref } from "vue";

import { createServer, resolveOptions } from "@slidev/cli";
import { parseRangeString } from "@slidev/parser/core";
import { ImportType, init, parse } from "es-module-lexer";
import { parseHTML } from "linkedom";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSSRApp, h, reactive, ref } from "vue";
import { renderToString } from "vue/server-renderer";

import type * as NavStandIn from "./ssr/useNav.ts";

export interface RenderedSlide {
	frontmatter: Record<string, unknown>;
	/** The global-bottom layers (the deck's, its theme's, and its addons') for this slide. */
	globalBottom: string;
	/** The global-top layers for this slide. */
	globalTop: string;
	/** The slide's speaker notes, in Markdown. */
	note: string;
	/** HTML for each click state, from the slide's `clicksStart` to its last click, inside its slide-bottom and slide-top layers. */
	states: string[];
}

type Constants = Record<
	| "CLASS_VCLICK_CURRENT"
	| "CLASS_VCLICK_HIDDEN"
	| "CLASS_VCLICK_HIDDEN_EXP"
	| "CLASS_VCLICK_PRIOR"
	| "CLASS_VCLICK_TARGET"
	| "injectionClicksContext"
	| "injectionCurrentPage"
	| "injectionFrontmatter"
	| "injectionRenderContext"
	| "injectionSlidevContext"
	| "injectionSlideZoom",
	string
>;

interface Frontmatter {
	clicks?: number;
	clicksStart?: number;
	dragPos?: Record<string, string>;
	zoom?: number;
}

type Layers = Record<
	"GlobalBottom" | "GlobalTop" | "SlideBottom" | "SlideTop",
	Component
>;

type Server = Awaited<ReturnType<typeof createServer>>;

/** Slidev's virtual module of the deck's, theme's, and addons' layer components. */
const LAYERS = "/@slidev/global-layers";

/** Stand-ins in ./ssr for Slidev client files that do their work in onMounted or need the router, neither of which exists on the server. */
const STAND_INS = {
	"builtin/CodeBlockWrapper.vue": "CodeBlockWrapper.vue",
	"builtin/KaTexBlockWrapper.vue": "KaTexBlockWrapper.vue",
	"builtin/ShikiMagicMove.vue": "ShikiMagicMove.vue",
	"builtin/VClickGap.vue": "VClickGap.vue",
	"builtin/VSwitch.ts": "VSwitch.vue",
	"composables/useNav.ts": "useNav.ts",
};

/** Modules whose imports can lead to CSS: sources, styles, and Slidev's and UnoCSS's virtual modules. */
const STYLED =
	/\.(?:css|vue|ts|js|mjs|md)(?:$|\?)|uno:|__uno|type=style|\/@slidev\//;

/** The compiled CSS in a CSS module as Vite's dev server serves it. */
const VITE_CSS = /const __vite__css = ("(?:[^"\\]|\\.)*")/;

const standIn = (file: string) =>
	fileURLToPath(new URL(`./ssr/${file}`, import.meta.url));

/** Starts a Slidev server for the deck at `entry` (an absolute path, or relative to the working directory). */
export async function createSlideRenderer(entry: string) {
	const options = await resolveOptions({ entry }, "dev");
	const standIns = new Map(
		Object.entries(STAND_INS).map(([client, file]) => [
			path.join(options.clientRoot, client),
			standIn(file),
		]),
	);
	const server = await createServer(options, {
		logLevel: "warn",
		plugins: [
			{
				enforce: "pre",
				name: "slidev-pptx-stand-ins",
				async resolveId(source, importer, resolveOptions) {
					const resolved = await this.resolve(source, importer, resolveOptions);
					return resolved && standIns.get(resolved.id);
				},
			},
		],
		resolve: { dedupe: ["vue"] },
		server: { hmr: false, middlewareMode: true, ws: false },
		ssr: { noExternal: ["@slidev/client"] },
	});
	try {
		return await createRenderer(server, options);
	} catch (error) {
		await server.close();
		throw error;
	}
}

function clickDirective(
	constants: Constants,
	clicksContext: ClicksContext,
	kind: "after" | "click" | "hide",
): ObjectDirective<Element, RawAtValue> {
	let registered = 0;
	return {
		getSSRProps({ modifiers, value }) {
			const info = clicksContext.calculate(kind === "after" ? "+0" : value);
			if (!info) {
				return {};
			}

			clicksContext.register(`v-${kind}-${String(registered++)}`, info);
			const hide = kind === "hide" || Boolean(modifiers.hide);
			const active = info.isActive.value;
			const current = info.isCurrent.value;
			const classes = [constants.CLASS_VCLICK_TARGET];
			if (hide ? active : !active) {
				classes.push(constants.CLASS_VCLICK_HIDDEN);
			}

			if (hide && active) {
				classes.push(constants.CLASS_VCLICK_HIDDEN_EXP);
			}

			if (current) {
				classes.push(constants.CLASS_VCLICK_CURRENT);
			}

			if (active && !current) {
				classes.push(constants.CLASS_VCLICK_PRIOR);
			}

			return {
				class: classes.join(" "),
				"data-slidev-clicks-start": String(info.start),
				...(Number.isFinite(info.end)
					? { "data-slidev-clicks-end": String(info.end) }
					: {}),
			};
		},
	};
}

async function createRenderer(server: Server, options: ResolvedSlidevOptions) {
	const load = async <T>(id: string) => (await server.ssrLoadModule(id)) as T;
	const { createClicksContextBase } = await load<{
		createClicksContextBase: (
			current: Ref<number>,
			clicksStart?: number,
			clicksTotalOverrides?: number,
		) => ClicksContext;
	}>(`${options.clientRoot}/composables/useClicks.ts`);
	const constants = await load<Constants>(`${options.clientRoot}/constants.ts`);
	const { collectKatexEquationLines } = await load<{
		collectKatexEquationLines: (element: Element) => Element[][];
	}>(`${options.clientRoot}/builtin/katex-lines.ts`);
	const { createNav, navKey } = await load<typeof NavStandIn>(
		standIn("useNav.ts"),
	);
	const layers = await load<Layers>(LAYERS);
	const { config, slides } = options.data;
	const { client } = server.environments;
	await init;
	const slideModule = (slideNumber: number) =>
		`${options.entry}__slidev_${String(slideNumber)}.md`;

	function createApp(
		slideNumber: number,
		component: Component,
		clicks: number,
		totalClicks?: number,
	) {
		const frontmatter: Frontmatter = slides[slideNumber - 1].frontmatter;
		const clicksContext = createClicksContextBase(
			ref(clicks),
			frontmatter.clicksStart,
			totalClicks ?? frontmatter.clicks,
		);
		const nav = createNav(slideNumber, clicksContext);
		const app = createSSRApp({ render: () => h(component) });
		app.provide(constants.injectionClicksContext, ref(clicksContext));
		app.provide(constants.injectionCurrentPage, ref(slideNumber));
		app.provide(constants.injectionFrontmatter, frontmatter);
		app.provide(constants.injectionRenderContext, ref("slide"));
		app.provide(
			constants.injectionSlidevContext,
			reactive({ configs: config, nav, themeConfigs: config.themeConfig }),
		);
		app.provide(constants.injectionSlideZoom, ref(frontmatter.zoom ?? 1));
		app.provide(navKey, nav);
		app.directive("after", clickDirective(constants, clicksContext, "after"));
		app.directive("click", clickDirective(constants, clicksContext, "click"));
		app.directive(
			"click-hide",
			clickDirective(constants, clicksContext, "hide"),
		);
		app.directive("drag", {
			getSSRProps: ({ value }) => ({
				style: dragStyle(value, frontmatter.dragPos),
			}),
		});
		app.directive("mark", markDirective(clicksContext));
		app.directive("motion", {});
		return { app, clicksContext };
	}

	const render = async (
		slideNumber: number,
		component: Component,
		clicks: number,
		totalClicks?: number,
	) =>
		renderToString(createApp(slideNumber, component, clicks, totalClicks).app);

	const renderGlobalBottom = (slideNumber: number) =>
		render(slideNumber, layers.GlobalBottom, 0);

	async function staticGlobalBottomLayers() {
		const renders = await Promise.all(
			slides.map((_, index) => renderGlobalBottom(index + 1)),
		);
		const [first, ...others] = renders.map((html) =>
			[
				...parseHTML(`<html><body>${html}</body></html>`).document.body
					.children,
			].map((element) => element.outerHTML),
		);
		return first.flatMap((html, index) =>
			others.every(
				(other) => other.length === first.length && other[index] === html,
			)
				? [index]
				: [],
		);
	}

	async function renderSlide(slideNumber: number): Promise<RenderedSlide> {
		const { frontmatter, note = "" } = slides[slideNumber - 1];
		const { clicks, clicksStart = 0 }: Frontmatter = frontmatter;
		const { default: content } = await load<{ default: Component }>(
			slideModule(slideNumber),
		);
		const counted = createApp(slideNumber, content, clicksStart);
		await renderToString(counted.app);
		const totalClicks =
			clicks ?? Math.max(0, ...counted.clicksContext.maxMap.values());
		const states = [];
		for (let click = clicksStart; click <= totalClicks; click++) {
			const html = await Promise.all(
				[layers.SlideBottom, content, layers.SlideTop].map((component) =>
					render(slideNumber, component, click, totalClicks),
				),
			);
			states.push(
				highlightLines(html.join(""), constants, collectKatexEquationLines),
			);
		}

		return {
			frontmatter,
			globalBottom: await renderGlobalBottom(slideNumber),
			globalTop: await render(slideNumber, layers.GlobalTop, 0),
			note,
			states,
		};
	}

	async function collectCss(urls: string[]) {
		const visited = new Set<string>();
		const sheets: string[] = [];
		const visit = async (url: string) => {
			if (visited.has(url) || !STYLED.test(url)) {
				return;
			}

			visited.add(url);
			const transformed = await client.transformRequest(url);
			if (!transformed) {
				return;
			}

			const css = VITE_CSS.exec(transformed.code);
			if (css) {
				sheets.push(JSON.parse(css[1]) as string);
				return;
			}

			for (const { n: specifier, t: type } of parse(transformed.code)[0]) {
				if (specifier && type === ImportType.Static) {
					await visit(specifier);
				}
			}
		};

		for (const url of urls) {
			await visit(url);
		}

		return sheets;
	}

	return {
		close: () => server.close(),
		/** Slidev's resolved deck configuration. */
		config,
		/** CSS shared by every slide: Slidev's styles, the deck's styles, and UnoCSS utilities. */
		globalCss: () => collectCss([`${options.clientRoot}/styles/index.ts`]),
		/** The directory Vite serves at the root as-is. */
		publicDir: server.config.publicDir,
		renderSlide,
		/** The deck's directory. */
		root: options.userRoot,
		/** CSS a slide's module pulls in: its scoped &lt;style> blocks and its components' styles. */
		slideCss: (slideNumber: number) =>
			collectCss([slideModule(slideNumber), LAYERS]),
		slides,
		/** Indexes of the global-bottom layers' top-level elements that are the same on every slide. */
		staticGlobalBottomLayers,
	};
}

function dragStyle(value: unknown, dragPos: Record<string, string> = {}) {
	const position =
		typeof value === "string" && !value.includes(",") ? dragPos[value] : value;
	const [left, top, width, height, rotation = 0] = (
		Array.isArray(position) ? position : String(position).split(",")
	).map(Number);
	return Number.isFinite(left)
		? {
				height: Number.isFinite(height) ? `${String(height)}px` : undefined,
				left: `${String(left)}px`,
				position: "absolute",
				top: `${String(top)}px`,
				transform: `rotate(${String(rotation)}deg)`,
				transformOrigin: "center center",
				width: `${String(width)}px`,
				zIndex: 100,
			}
		: { position: "absolute", zIndex: 100 };
}

function highlightLines(
	html: string,
	constants: Constants,
	collectKatexEquationLines: (element: Element) => Element[][],
) {
	if (!html.includes("data-highlight-range")) {
		return html;
	}

	const { document } = parseHTML(
		`<!doctype html><html><body>${html}</body></html>`,
	);
	for (const wrapper of document.querySelectorAll(
		".slidev-code-wrapper, .slidev-katex-wrapper",
	)) {
		const range = wrapper.getAttribute("data-highlight-range");
		if (!range) {
			continue;
		}

		if (range === "hide") {
			wrapper.classList.add(constants.CLASS_VCLICK_HIDDEN);
			continue;
		}

		const katex = wrapper.classList.contains("slidev-katex-wrapper");
		const lines = katex
			? collectKatexEquationLines(wrapper)
			: [...wrapper.querySelectorAll(".shiki code > .line")].map((line) => [
					line,
				]);
		const startLine = Number(wrapper.getAttribute("data-start-line"));
		const highlighted = new Set(
			parseRangeString(lines.length + startLine - 1, range),
		);
		for (const [index, line] of lines.entries()) {
			const on = highlighted.has(index + startLine);
			for (const element of line) {
				if (!katex) {
					element.classList.toggle("slidev-code-highlighted", on);
					element.classList.toggle("slidev-code-dishonored", !on);
				}

				element.classList.toggle("highlighted", on);
				element.classList.toggle("dishonored", !on);
			}
		}
	}

	return document.body.innerHTML;
}

function markDirective(
	clicksContext: ClicksContext,
): ObjectDirective<Element, RawAtValue | { at?: RawAtValue }> {
	let registered = 0;
	return {
		getSSRProps({ value }) {
			const at =
				typeof value === "object" && !Array.isArray(value) ? value?.at : value;
			clicksContext.register(
				`v-mark-${String(registered++)}`,
				clicksContext.calculate(at),
			);
			return {};
		},
	};
}
