import type {
	AppContext,
	AppSetup,
	ClicksContext,
	RawAtValue,
	ResolvedSlidevOptions,
	SlidevThemeConfig,
} from "@slidev/types";
import type { Component, FunctionalComponent, ObjectDirective, Ref } from "vue";

import { createServer, resolveOptions } from "@slidev/cli";
import { ImportType, init, parse } from "es-module-lexer";
import { parseHTML } from "linkedom";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSSRApp, defineComponent, Fragment, h, reactive, ref } from "vue";
import { renderToString } from "vue/server-renderer";

import type { ClickTarget } from "./ssr/clicks.ts";
import type { SlideProblem } from "./ssr/problems.ts";
import type * as NavStandIn from "./ssr/useNav.ts";
import type { BuildPptxProblem } from "./types.ts";

import { BuildPptxError } from "./error.ts";
import {
	CLICK_TARGET_ATTRIBUTE,
	clickTargetProps,
	injectionClickTargets,
} from "./ssr/clicks.ts";
import { injectionSlideProblems } from "./ssr/problems.ts";

export interface RenderedSlide {
	clicksStart: number;
	globalBottom: string;
	globalTop: string;
	problems: SlideProblem[];
	states: string[];
	zoom: number;
}

type Constants = Record<
	| "CLASS_VCLICK_ANIMATION_PREFIX"
	| "CLASS_VCLICK_CURRENT"
	| "CLASS_VCLICK_HIDDEN"
	| "CLASS_VCLICK_HIDDEN_EXP"
	| "CLASS_VCLICK_PRIOR"
	| "CLASS_VCLICK_TARGET"
	| "injectionClicksContext"
	| "injectionCurrentPage"
	| "injectionFrontmatter"
	| "injectionRenderContext"
	| "injectionRoute"
	| "injectionSlidevContext"
	| "injectionSlideZoom",
	string
>;

interface Frontmatter {
	clickAnimation?: string;
	clicks?: number;
	clicksStart?: number;
	dragPos?: Partial<Record<string, string>>;
	zoom?: number;
}

type Layers = Record<
	"GlobalBottom" | "GlobalTop" | "SlideBottom" | "SlideTop",
	Component
>;

interface RenderingSlide {
	frontmatter: Frontmatter;
	number: number;
	zoom: number;
}

type Server = Awaited<ReturnType<typeof createServer>>;

interface VueRouter {
	createMemoryHistory: () => unknown;
	createRouter: (options: {
		history: unknown;
		routes: { component: Component; path: string }[];
	}) => AppContext["router"];
}

const GLOBAL_LAYERS_MODULE = "/@slidev/global-layers";

const FLOATING_VUE_COMPONENTS = ["VDropdown", "VMenu", "VTooltip"];

const FLOATING_VUE_DIRECTIVES = ["close-popper", "tooltip"];

const UNRESOLVED_ASSET = /^Failed to resolve (component|directive): (\S+)/;

const STAND_INS = {
	"builtin/CodeBlockWrapper.vue": "CodeBlockWrapper.vue",
	"builtin/CodeGroup.vue": "CodeGroup.vue",
	"builtin/KaTexBlockWrapper.vue": "KaTexBlockWrapper.vue",
	"builtin/Mermaid.vue": "MermaidDiagram.vue",
	"builtin/Monaco.vue": "MonacoEditor.vue",
	"builtin/ShikiMagicMove.vue": "ShikiMagicMove.vue",
	"builtin/VClickGap.vue": "VClickGap.vue",
	"builtin/VSwitch.ts": "VSwitch.vue",
	"composables/useNav.ts": "useNav.ts",
};

const MAY_IMPORT_CSS =
	/\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss|vue|[cm]?[jt]sx?|md)(?:$|\?)|uno:|__uno|type=style|\/@slidev\//;

const VITE_CSS_MODULE_SOURCE = /const __vite__css = ("(?:[^"\\]|\\.)*")/;

const popperStandIn = defineComponent({
	inheritAttrs: false,
	props: { shown: Boolean },
	setup:
		(props, { slots }) =>
		() =>
			props.shown
				? h("span", { class: "twoslash-query-persisted" }, [
						slots.default?.(),
						slots.popper?.({}),
					])
				: slots.default?.(),
});

const routerLinkStandIn: FunctionalComponent<{ to: string }> = (
	props,
	{ slots },
) => h("a", { href: `#${props.to}` }, slots.default?.());

const standIn = (file: string) =>
	fileURLToPath(new URL(`./ssr/${file}`, import.meta.url));

export const resolveDeck = (entry: string) => resolveOptions({ entry }, "dev");

export async function createSlideRenderer(deck: ResolvedSlidevOptions) {
	const missing = Object.keys(STAND_INS).filter(
		(client) => !existsSync(path.join(deck.clientRoot, client)),
	);
	if (missing.length) {
		throw new BuildPptxError(
			`This version of Slidev isn't supported: its client has no ${missing.join(", ")} to stand in for.`,
		);
	}

	const standIns = new Map(
		Object.entries(STAND_INS).map(([client, file]) => [
			path.join(deck.clientRoot, client),
			standIn(file),
		]),
	);
	const server = await createServer(deck, {
		logLevel: "warn",
		plugins: [
			{
				enforce: "pre",
				name: "slidev-pptx-stand-ins",
				async resolveId(source, importer, options) {
					const resolved = await this.resolve(source, importer, options);
					return resolved && standIns.get(resolved.id);
				},
			},
			{
				config(config) {
					config.optimizeDeps = { noDiscovery: true };
				},
				enforce: "post",
				name: "slidev-pptx-no-dep-optimizer",
			},
		],
		server: { hmr: false, middlewareMode: true, ws: false },
		ssr: { noExternal: ["@slidev/client"] },
	});
	try {
		return await createRenderer(server, deck);
	} catch (error) {
		await server.close();
		throw error;
	}
}

export function staticGlobalBottomLayers(globalBottoms: string[]) {
	const [first = [], ...others] = globalBottoms.map((html) =>
		[
			...parseHTML(`<html><body>${html}</body></html>`).document.body.children,
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

function* childrenFirst(element: Element): Generator<Element> {
	for (const child of [...element.children]) {
		yield* childrenFirst(child);
	}

	yield element;
}

function clickDirective(
	constants: Constants,
	targets: ClickTarget[],
	kind: "after" | "click" | "hide",
	defaultAnimations: string[],
): ObjectDirective<Element, RawAtValue> {
	return {
		getSSRProps: ({ modifiers, value }) =>
			clickTargetProps(targets, (clicks, element) => {
				const info = clicks.calculate(kind === "after" ? "+0" : value);
				if (!info) {
					return;
				}

				clicks.register(element, info);
				element.classList.add(constants.CLASS_VCLICK_TARGET);
				if (kind === "click") {
					element.setAttribute("data-slidev-clicks-start", String(info.start));
					if (Number.isFinite(info.end)) {
						element.setAttribute("data-slidev-clicks-end", String(info.end));
					}
				}

				const active = info.isActive.value;
				const current = info.isCurrent.value;
				if (kind === "hide" || modifiers.hide) {
					element.classList.toggle(constants.CLASS_VCLICK_HIDDEN, active);
					element.classList.toggle(constants.CLASS_VCLICK_HIDDEN_EXP, active);
				} else {
					element.classList.toggle(constants.CLASS_VCLICK_HIDDEN, !active);
				}

				const animations = Object.keys(modifiers).filter(
					(modifier) => modifier !== "hide",
				);
				for (const animation of animations.length
					? animations
					: defaultAnimations) {
					element.classList.add(
						constants.CLASS_VCLICK_ANIMATION_PREFIX + animation,
					);
				}

				element.classList.toggle(constants.CLASS_VCLICK_CURRENT, current);
				element.classList.toggle(
					constants.CLASS_VCLICK_PRIOR,
					active && !current,
				);
			}),
	};
}

async function createRenderer(server: Server, deck: ResolvedSlidevOptions) {
	const load = async <T>(id: string) => (await server.ssrLoadModule(id)) as T;
	const { createClicksContextBase } = await load<{
		createClicksContextBase: (
			current: Ref<number>,
			clicksStart?: number,
			clicksTotalOverrides?: number,
		) => ClicksContext;
	}>(`${deck.clientRoot}/composables/useClicks.ts`);
	const constants = await load<Constants>(`${deck.clientRoot}/constants.ts`);
	const { createSlideContext, injectionSlideNav } = await load<
		typeof NavStandIn
	>(standIn("useNav.ts"));
	const layers = await load<Layers>(GLOBAL_LAYERS_MODULE);
	const { default: setups } = await load<{ default: AppSetup[] }>(
		"/@slidev/setups/main",
	);
	const vueRouter = await server.environments.ssr.pluginContainer.resolveId(
		"vue-router",
		path.join(deck.clientRoot, "index.ts"),
	);
	if (!vueRouter) {
		throw new BuildPptxError(
			"This version of Slidev isn't supported: its client has no vue-router.",
		);
	}

	const { createMemoryHistory, createRouter } = (await import(
		pathToFileURL(vueRouter.id).href
	)) as VueRouter;
	const { config, slides } = deck.data;
	const { client } = server.environments;
	await init;
	const slideModule = (slideNumber: number) =>
		`${deck.entry}__slidev_${String(slideNumber)}.md`;
	const deckProblems: BuildPptxProblem[] =
		process.env.NODE_ENV === "production"
			? [
					{
						message:
							"Couldn't check for components Vue can't resolve, because NODE_ENV is production.",
						severity: "warning",
					},
				]
			: [];

	async function renderApp(
		{ frontmatter, number: slideNumber, zoom }: RenderingSlide,
		component: Component,
		clicks: number,
		totalClicks = frontmatter.clicks,
	) {
		const clicksContext = createClicksContextBase(
			ref(clicks),
			frontmatter.clicksStart,
			totalClicks,
		);
		const { nav, route } = createSlideContext(slideNumber, clicksContext);
		const problems: SlideProblem[] = [];
		const targets: ClickTarget[] = [];
		const defaultAnimations =
			// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Like Slidev, an empty clickAnimation means none.
			(frontmatter.clickAnimation || config.clickAnimation)
				.split(/[\s,]+/)
				.filter(Boolean);
		const click = (kind: "after" | "click" | "hide") =>
			clickDirective(constants, targets, kind, defaultAnimations);
		const app = createSSRApp({ render: () => h(component) });
		app.config.throwUnhandledErrorInProduction = true;
		app.config.warnHandler = (message) => {
			const unresolved = UNRESOLVED_ASSET.exec(message);
			if (unresolved) {
				problems.push({
					message: `Couldn't render the ${unresolved[1]} ${unresolved[2]}: Vue couldn't resolve it.`,
					severity: "error",
				});
			}
		};
		app.provide(constants.injectionClicksContext, ref(clicksContext));
		app.provide(constants.injectionCurrentPage, ref(slideNumber));
		app.provide(constants.injectionFrontmatter, frontmatter);
		app.provide(constants.injectionRenderContext, ref("slide"));
		app.provide(constants.injectionRoute, route);
		app.provide(
			constants.injectionSlidevContext,
			reactive({ configs: config, nav, themeConfigs: config.themeConfig }),
		);
		app.provide(constants.injectionSlideZoom, ref(zoom));
		app.provide(injectionSlideNav, nav);
		app.provide(injectionClickTargets, targets);
		app.provide(injectionSlideProblems, problems);
		app.component("RouterLink", routerLinkStandIn);
		for (const name of FLOATING_VUE_COMPONENTS) {
			app.component(name, popperStandIn);
		}

		for (const name of FLOATING_VUE_DIRECTIVES) {
			app.directive(name, {});
		}

		app.directive("after", click("after"));
		app.directive("click", click("click"));
		app.directive("click-hide", click("hide"));
		app.directive("drag", {
			getSSRProps: ({ value }) => ({
				style: dragStyle(dragPosition(value, frontmatter.dragPos)),
			}),
		});
		app.directive("mark", markDirective(targets, problems));
		app.directive("motion", {});
		const router = createRouter({
			history: createMemoryHistory(),
			routes: [{ component: { render: () => null }, path: "/:path(.*)*" }],
		});
		const settingUp = (async () => {
			for (const setup of setups) {
				await app.runWithContext(() => setup({ app, router }));
			}
		})();
		await Promise.all([settingUp, router.push(`/${String(slideNumber)}`)]);

		const html = await renderToString(app);
		return {
			clicksContext,
			html: targets.length
				? resolveClickTargets(html, targets, clicksContext)
				: html,
			problems,
		};
	}

	async function renderSlide(slideNumber: number): Promise<RenderedSlide> {
		const frontmatter: Frontmatter = slides[slideNumber - 1].frontmatter;
		const { clicksStart = 0, zoom = 1 } = frontmatter;
		const rendering = { frontmatter, number: slideNumber, zoom };
		const { default: content } = await load<{ default: Component }>(
			slideModule(slideNumber),
		);
		const slide = {
			render: () =>
				h(Fragment, [h(layers.SlideBottom), h(content), h(layers.SlideTop)]),
		};
		const counted = await renderApp(rendering, slide, clicksStart);
		const totalClicks = Math.max(
			clicksStart,
			frontmatter.clicks ??
				Math.max(0, ...counted.clicksContext.maxMap.values()),
		);
		const { problems } = counted;
		const states = [];
		for (let click = clicksStart; click <= totalClicks; click++) {
			try {
				const state = await renderApp(rendering, slide, click, totalClicks);
				problems.push(...state.problems);
				states.push(state.html);
			} catch (error) {
				problems.push({
					click,
					message: `Couldn't render the click: ${error instanceof Error ? error.message : String(error)}`,
					severity: "error",
				});
				states.push("");
			}
		}

		const globalBottom = await renderApp(rendering, layers.GlobalBottom, 0);
		const globalTop = await renderApp(rendering, layers.GlobalTop, 0);
		deckProblems.push(
			...[...globalBottom.problems, ...globalTop.problems]
				.filter(
					({ message }) =>
						!deckProblems.some((problem) => problem.message === message),
				)
				.map(({ message, severity }) => ({ message, severity })),
		);
		return {
			clicksStart,
			globalBottom: globalBottom.html,
			globalTop: globalTop.html,
			problems: uniqueProblems(problems),
			states,
			zoom,
		};
	}

	async function collectCss(urls: string[]) {
		const visited = new Set<string>();
		const sheets: string[] = [];
		const visit = async (url: string) => {
			if (visited.has(url) || !MAY_IMPORT_CSS.test(url)) {
				return;
			}

			visited.add(url);
			const transformed = await client.transformRequest(url);
			if (!transformed) {
				return;
			}

			const css = VITE_CSS_MODULE_SOURCE.exec(transformed.code);
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
		globalCss: async () => [
			...(await collectCss([`${deck.clientRoot}/styles/index.ts`])),
			themeVariables(config.themeConfig),
		],
		problems: deckProblems,
		publicDir: server.config.publicDir,
		renderSlide,
		root: deck.userRoot,
		slideCss: (slideNumber: number) =>
			collectCss([slideModule(slideNumber), GLOBAL_LAYERS_MODULE]),
	};
}

function dragPosition(
	value: unknown,
	dragPos: Partial<Record<string, string>> = {},
) {
	if (Array.isArray(value)) {
		return value.map(Number);
	}

	if (typeof value === "string" && value.includes(",")) {
		return value.split(",").map(Number);
	}

	return typeof value === "number" || typeof value === "string"
		? dragPos[String(value)]?.split(",").map(Number)
		: undefined;
}

function dragStyle(position: number[] | undefined) {
	if (!position || !Number.isFinite(position[0])) {
		return { position: "absolute", zIndex: 100 };
	}

	const [left, top, width, height, rotation = 0] = position;
	return {
		height: Number.isFinite(height) ? `${String(height)}px` : undefined,
		left: `${String(left)}px`,
		position: "absolute",
		top: `${String(top)}px`,
		transform: `rotate(${String(rotation)}deg)`,
		transformOrigin: "center center",
		width: `${String(width)}px`,
		zIndex: 100,
	};
}

function markDirective(
	targets: ClickTarget[],
	problems: SlideProblem[],
): ObjectDirective<Element, RawAtValue | { at?: RawAtValue }> {
	return {
		getSSRProps: ({ value }) =>
			clickTargetProps(targets, (clicks, element) => {
				clicks.register(
					element,
					clicks.calculate(
						typeof value === "object" && !Array.isArray(value)
							? value?.at
							: value,
					),
				);
				problems.push({
					message: `Couldn't draw a v-mark: ${element.textContent.trim().slice(0, 60)}`,
					severity: "warning",
				});
			}),
	};
}

function resolveClickTargets(
	html: string,
	targets: ClickTarget[],
	clicksContext: ClicksContext,
) {
	const { document } = parseHTML(
		`<!doctype html><html><body>${html}</body></html>`,
	);
	for (const element of childrenFirst(document.body)) {
		const indices = element
			.getAttributeNames()
			.filter((name) => name.startsWith(CLICK_TARGET_ATTRIBUTE))
			.map((name) => {
				element.removeAttribute(name);
				return Number(name.slice(CLICK_TARGET_ATTRIBUTE.length));
			})
			.sort((a, b) => a - b);
		for (const index of indices) {
			targets[index](clicksContext, element);
		}
	}

	return document.body.innerHTML;
}

function themeVariables(themeConfig: SlidevThemeConfig) {
	return `body{${Object.entries(themeConfig)
		.map(([key, value]) => `--slidev-theme-${key}:${String(value)};`)
		.join("")}}`;
}

function uniqueProblems(problems: SlideProblem[]) {
	return [
		...new Map(
			problems.map((problem) => [
				`${String(problem.click)} ${problem.message}`,
				problem,
			]),
		).values(),
	];
}
