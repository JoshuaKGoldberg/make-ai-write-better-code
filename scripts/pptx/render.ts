/**
 * Renders Slidev slides to static HTML for any click state, with no browser:
 * Vite (with Slidev's own plugins) compiles each slide module for SSR, and Vue's
 * server renderer renders it inside a Slidev-like click context.
 */
import type { ClicksContext, SlideInfo, SlidevConfig } from "@slidev/types";
import type { App, Component, ObjectDirective } from "vue";

import { createServer, resolveOptions } from "@slidev/cli";
import { parseRangeString } from "@slidev/parser/core";
import { renderToString } from "@vue/server-renderer";
import { parseHTML } from "linkedom";
import { createSSRApp, h, reactive, ref } from "vue";

export interface RenderedSlide {
	frontmatter: Record<string, unknown>;
	/** The global-bottom layers (the deck's, its theme's, and its addons') for this slide. */
	globalBottom: string;
	/** The global-top layers for this slide. */
	globalTop: string;
	note: string;
	/** HTML for each click state, from 0 to `total`, inside its slide-bottom and slide-top layers. */
	states: string[];
	total: number;
}

export interface SlideRenderer {
	close(): Promise<void>;
	/** Slidev's resolved deck configuration. */
	config: SlidevConfig;
	count: number;
	/** CSS shared by every slide: Slidev's styles, the deck's styles, and UnoCSS utilities. */
	globalCss(): Promise<string[]>;
	/** The directory Vite serves at the root as-is. */
	publicDir: string;
	renderSlide(no: number): Promise<RenderedSlide>;
	/** The deck's directory. */
	root: string;
	/** CSS a slide's module pulls in: its scoped &lt;style> blocks and its components' styles. */
	slideCss(no: number): Promise<string[]>;
	slides: SlideInfo[];
}

type Layers = Record<
	"GlobalBottom" | "GlobalTop" | "SlideBottom" | "SlideTop",
	Component
>;

/** Slidev's virtual module of the deck's, theme's, and addons' layer components. */
const LAYERS = "/@slidev/global-layers";

const CLASS = {
	current: "slidev-vclick-current",
	hidden: "slidev-vclick-hidden",
	hiddenExplicitly: "slidev-vclick-hidden-explicitly",
	prior: "slidev-vclick-prior",
	target: "slidev-vclick-target",
};

// Components may construct browser-only observers in setup; on the server they observe nothing.
if (!("ResizeObserver" in globalThis)) {
	Object.assign(globalThis, {
		ResizeObserver: class {
			disconnect() {
				/* Nothing to observe on the server. */
			}
			observe() {
				/* Nothing to observe on the server. */
			}
			unobserve() {
				/* Nothing to observe on the server. */
			}
		},
	});
}

const standIn = (name: string) =>
	new URL(`./ssr/${name}`, import.meta.url).pathname;

/** Starts a Slidev server for the deck at `entry` (an absolute path, or relative to the working directory). */
export async function createSlideRenderer(
	entry = "slides.md",
): Promise<SlideRenderer> {
	const options = await resolveOptions({ entry }, "dev");
	const server = await createServer(options, {
		logLevel: "warn",
		resolve: {
			// Slidev's magic-move, code-highlight, and nav helpers do their work in onMounted
			// or need the router, neither of which exists on the server.
			alias: [
				{
					find: /^.*\/@slidev\/client\/builtin\/ShikiMagicMove\.vue$/,
					replacement: standIn("ShikiMagicMove.vue"),
				},
				{
					find: /^.*\/@slidev\/client\/builtin\/CodeBlockWrapper\.vue$/,
					replacement: standIn("CodeBlockWrapper.vue"),
				},
				{
					find: /^(?:.*\/@slidev\/client\/|\.\.?\/)(?:\.\.\/)*composables\/useNav(?:\.ts)?$/,
					replacement: standIn("useNav.ts"),
				},
			],
			dedupe: ["vue", "@vue/server-renderer"],
		},
		server: { hmr: false, middlewareMode: true, ws: false },
		ssr: { noExternal: ["@slidev/client"] },
	});
	const root = options.userRoot;
	const slides = options.data.slides;
	const load = async <T>(path: string) =>
		(await server.ssrLoadModule(path)) as T;
	const { createClicksContextBase } = await load<{
		createClicksContextBase: (
			current: { value: number },
			start?: number,
			total?: number,
		) => ClicksContext;
	}>(`${options.clientRoot}/composables/useClicks.ts`);

	const layers = await load<Layers>(LAYERS);
	// The stand-in (see ssr/useNav.ts), which the alias swaps in for Slidev's.
	const { useNav } = await load<{ useNav: () => Record<string, unknown> }>(
		`${options.clientRoot}/composables/useNav.ts`,
	);

	function createApp(
		no: number,
		component: Component,
		clicks: number,
		totalOverride?: number,
	) {
		const slide = slides[no - 1];
		const ctx = createClicksContextBase(
			ref(clicks),
			0,
			totalOverride ?? (slide.frontmatter.clicks as number | undefined),
		);
		globalThis.__pptxNav = { clicksContext: ctx, no };
		const ctxRef = ref(ctx);
		const app: App = createSSRApp({ render: () => h(component) });
		app.provide("$$slidev-clicks-context", ctxRef);
		app.provide("$$slidev-page", ref(no));
		app.provide("$$slidev-render-context", ref("slide"));
		// Slidev's own injection key, spelled as Slidev spells it.
		app.provide("$$slidev-fontmatter", slide.frontmatter);
		app.provide("$$slidev-slide-zoom", ref(slide.frontmatter.zoom ?? 1));
		app.provide(
			"$$slidev-context",
			reactive({
				configs: options.data.config,
				nav: useNav(),
				themeConfigs: options.data.config.themeConfig,
			}),
		);
		app.directive("click", clickDirective(ctx, "click"));
		app.directive("after", clickDirective(ctx, "after"));
		app.directive("click-hide", clickDirective(ctx, "hide"));
		return { app, ctx, slide };
	}

	async function renderState(
		no: number,
		clicks: number,
		totalOverride?: number,
	) {
		const mod = await load<{ default: Component }>(
			`${options.entry}__slidev_${String(no)}.md`,
		);
		const { app, ctx, slide } = createApp(
			no,
			mod.default,
			clicks,
			totalOverride,
		);
		const content = await renderToString(app);
		// Slide layers render around each slide's content, in its click state.
		const html = highlightCode(
			(await renderLayer(no, layers.SlideBottom, clicks)) +
				content +
				(await renderLayer(no, layers.SlideTop, clicks)),
		);
		const total =
			totalOverride ??
			(slide.frontmatter.clicks as number | undefined) ??
			Math.max(0, ...ctx.maxMap.values());
		return { html, total };
	}

	const renderLayer = (no: number, component: Component, clicks = 0) =>
		renderToString(createApp(no, component, clicks).app);

	// Walks the client-side import graph from the given modules and returns their CSS,
	// as Vite serves it (after PostCSS, UnoCSS directives, and Vue scoping).
	const transforms = new Map<string, null | string>();
	async function collectCss(entries: string[]) {
		const seen = new Set<string>();
		const sheets: string[] = [];
		const visit = async (url: string) => {
			if (seen.has(url)) {
				return;
			}

			seen.add(url);
			if (!transforms.has(url)) {
				transforms.set(
					url,
					(await server.transformRequest(url).catch(() => null))?.code ?? null,
				);
			}

			const code = transforms.get(url);
			if (!code) {
				return;
			}

			const css = /const __vite__css = ("(?:[^"\\]|\\.)*")/.exec(code);
			if (css) {
				sheets.push(JSON.parse(css[1]) as string);
				return;
			}

			for (const match of code.matchAll(
				/\bimport(?:[\w$*{},\s]+from)?\s*["']([^"']+)["']/g,
			)) {
				const dependency = match[1];
				if (
					!/^(?:vue|@vue\/|\/@vite\/|\/@id\/__x00__plugin-vue)/.test(
						dependency,
					) &&
					/\.(?:css|vue|ts|js|mjs|md)(?:$|\?)|uno:|__uno|type=style|\/@slidev\//.test(
						dependency,
					)
				) {
					await visit(dependency);
				}
			}
		};

		for (const url of entries) {
			await visit(url);
		}

		return sheets;
	}

	return {
		close: () => server.close(),
		config: options.data.config,
		count: slides.length,
		globalCss: () => collectCss([`${options.clientRoot}/styles/index.ts`]),
		publicDir: server.config.publicDir,
		async renderSlide(no) {
			const first = await renderState(no, 0);
			const states = [first.html];
			for (let clicks = 1; clicks <= first.total; clicks++) {
				states.push((await renderState(no, clicks, first.total)).html);
			}

			return {
				frontmatter: slides[no - 1].frontmatter,
				globalBottom: await renderLayer(no, layers.GlobalBottom),
				globalTop: await renderLayer(no, layers.GlobalTop),
				note: slides[no - 1].note ?? "",
				states,
				total: first.total,
			};
		},
		root,
		slideCss: (no) =>
			collectCss([`${options.entry}__slidev_${String(no)}.md`, LAYERS]),
		slides,
	};
}

/**
 * A server-render stand-in for Slidev's v-click, v-after, and v-click-hide: each
 * resolves its click range against the slide's clicks context in render (document)
 * order, and outputs the classes Slidev's directives toggle in the browser.
 */
function clickDirective(
	ctx: ClicksContext,
	kind: "after" | "click" | "hide",
): ObjectDirective {
	let registered = 0;
	return {
		getSSRProps(binding) {
			const info = ctx.calculate(
				kind === "after"
					? "+0"
					: (binding.value as Parameters<ClicksContext["calculate"]>[0]),
			);
			if (!info) {
				return {};
			}

			ctx.register(`v-${kind}-${String(registered++)}`, info);
			const hide = kind === "hide" || Boolean(binding.modifiers.hide);
			const active = info.isActive.value;
			const current = info.isCurrent.value;
			const classes = [CLASS.target];
			if (hide ? active : !active) {
				classes.push(CLASS.hidden);
			}

			if (hide && active) {
				classes.push(CLASS.hiddenExplicitly);
			}

			if (current) {
				classes.push(CLASS.current);
			}

			if (active && !current) {
				classes.push(CLASS.prior);
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

/**
 * Applies each code block's active line-highlight range, as Slidev's CodeBlockWrapper
 * does once mounted: lines outside the range get `slidev-code-dishonored`.
 */
function highlightCode(html: string) {
	if (!html.includes("data-highlight-range")) {
		return html;
	}

	const { document } = parseHTML(
		`<!doctype html><html><body>${html}</body></html>`,
	);
	for (const wrapper of document.querySelectorAll("[data-highlight-range]")) {
		const range = wrapper.getAttribute("data-highlight-range") ?? "all";
		const startLine = Number(wrapper.getAttribute("data-start-line") ?? 1);
		const lines = [...wrapper.querySelectorAll(".shiki code > .line")];
		if (range === "hide") {
			wrapper.classList.add(CLASS.hidden);
			continue;
		}

		const highlighted = new Set(
			parseRangeString(lines.length + startLine - 1, range),
		);
		lines.forEach((line, index) => {
			const on = highlighted.has(index + startLine);
			line.classList.toggle("slidev-code-highlighted", on);
			line.classList.toggle("slidev-code-dishonored", !on);
			line.classList.toggle("highlighted", on);
			line.classList.toggle("dishonored", !on);
		});
	}

	return document.body.innerHTML;
}
