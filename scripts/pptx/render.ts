import type {
	ClicksContext,
	RawAtValue,
	ResolvedSlidevOptions,
} from "@slidev/types";
import type { Component, ObjectDirective, Ref } from "vue";

import { createServer, resolveOptions } from "@slidev/cli";
import { ImportType, init, parse } from "es-module-lexer";
import { parseHTML } from "linkedom";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSSRApp, defineComponent, Fragment, h, reactive, ref } from "vue";
import { renderToString } from "vue/server-renderer";

import type * as ClicksStandIn from "./ssr/clicks.ts";
import type { ClickTarget } from "./ssr/clicks.ts";
import type * as NavStandIn from "./ssr/useNav.ts";

export interface RenderedSlide {
	clicksStart: number;
	globalBottom: string;
	globalTop: string;
	problems: string[];
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

type Server = Awaited<ReturnType<typeof createServer>>;

const GLOBAL_LAYERS_MODULE = "/@slidev/global-layers";

/** Stand-ins in ./ssr for Slidev client files that need a browser: they work in onMounted, use the router, or mount an editor. */
const STAND_INS = {
	"builtin/CodeBlockWrapper.vue": "CodeBlockWrapper.vue",
	"builtin/CodeGroup.vue": "CodeGroup.vue",
	"builtin/KaTexBlockWrapper.vue": "KaTexBlockWrapper.vue",
	"builtin/Monaco.vue": "MonacoEditor.vue",
	"builtin/ShikiMagicMove.vue": "ShikiMagicMove.vue",
	"builtin/VClickGap.vue": "VClickGap.vue",
	"builtin/VSwitch.ts": "VSwitch.vue",
	"composables/useNav.ts": "useNav.ts",
};

const MAY_IMPORT_CSS =
	/\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss|vue|[cm]?[jt]sx?|md)(?:$|\?)|uno:|__uno|type=style|\/@slidev\//;

/** The compiled CSS in a CSS module as Vite's dev server serves it. */
const VITE_CSS = /const __vite__css = ("(?:[^"\\]|\\.)*")/;

const standIn = (file: string) =>
	fileURLToPath(new URL(`./ssr/${file}`, import.meta.url));

export const resolveDeck = (entry: string) => resolveOptions({ entry }, "dev");

export async function createSlideRenderer(
	deck: ResolvedSlidevOptions,
	cacheDir: string,
) {
	const missing = Object.keys(STAND_INS).filter(
		(client) => !existsSync(path.join(deck.clientRoot, client)),
	);
	if (missing.length) {
		throw new Error(
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
		cacheDir,
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
	{ clickTargetProps }: typeof ClicksStandIn,
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
	const clicksStandIn = await load<typeof ClicksStandIn>(standIn("clicks.ts"));
	const { createSlideContext } = await load<typeof NavStandIn>(
		standIn("useNav.ts"),
	);
	const layers = await load<Layers>(GLOBAL_LAYERS_MODULE);
	const { config, slides } = deck.data;
	const { client } = server.environments;
	await init;
	const slideModule = (slideNumber: number) =>
		`${deck.entry}__slidev_${String(slideNumber)}.md`;

	async function renderApp(
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
		const { nav, route } = createSlideContext(slideNumber, clicksContext);
		const problems: string[] = [];
		const targets: ClickTarget[] = [];
		const click = (kind: "after" | "click" | "hide") =>
			clickDirective(
				clicksStandIn,
				constants,
				targets,
				kind,
				(frontmatter.clickAnimation ?? config.clickAnimation)
					.split(/[\s,]+/)
					.filter(Boolean),
			);
		const app = createSSRApp({ render: () => h(component) });
		app.provide(constants.injectionClicksContext, ref(clicksContext));
		app.provide(constants.injectionCurrentPage, ref(slideNumber));
		app.provide(constants.injectionFrontmatter, frontmatter);
		app.provide(constants.injectionRenderContext, ref("slide"));
		app.provide(constants.injectionRoute, route);
		app.provide(
			constants.injectionSlidevContext,
			reactive({ configs: config, nav, themeConfigs: config.themeConfig }),
		);
		app.provide(constants.injectionSlideZoom, ref(frontmatter.zoom ?? 1));
		app.provide(clicksStandIn.injectionClickTargets, targets);
		app.component(
			"VMenu",
			defineComponent({
				inheritAttrs: false,
				setup:
					(_, { slots }) =>
					() =>
						slots.default?.(),
			}),
		);
		app.directive("after", click("after"));
		app.directive("click", click("click"));
		app.directive("click-hide", click("hide"));
		app.directive("drag", {
			getSSRProps: ({ value }) => ({
				style: dragStyle(dragPosition(value, frontmatter.dragPos)),
			}),
		});
		app.directive("mark", markDirective(clicksStandIn, targets, problems));
		app.directive("motion", {});

		const html = await renderToString(app);
		return {
			clicksContext,
			html: targets.length
				? resolveClickTargets(html, targets, clicksContext)
				: html,
			problems,
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
			for (const name of element.getAttributeNames()) {
				if (name.startsWith(clicksStandIn.CLICK_TARGET_ATTRIBUTE)) {
					element.removeAttribute(name);
					targets[
						Number(name.slice(clicksStandIn.CLICK_TARGET_ATTRIBUTE.length))
					](clicksContext, element);
				}
			}
		}

		return document.body.innerHTML;
	}

	async function renderSlide(slideNumber: number): Promise<RenderedSlide> {
		const { frontmatter } = slides[slideNumber - 1];
		const { clicks, clicksStart = 0, zoom = 1 }: Frontmatter = frontmatter;
		const { default: content } = await load<{ default: Component }>(
			slideModule(slideNumber),
		);
		const slide = {
			render: () =>
				h(Fragment, [h(layers.SlideBottom), h(content), h(layers.SlideTop)]),
		};
		const counted = await renderApp(slideNumber, slide, clicksStart);
		const totalClicks =
			clicks ?? Math.max(0, ...counted.clicksContext.maxMap.values());
		const states = [];
		for (let click = clicksStart; click <= totalClicks; click++) {
			states.push(
				(await renderApp(slideNumber, slide, click, totalClicks)).html,
			);
		}

		return {
			clicksStart,
			globalBottom: (await renderApp(slideNumber, layers.GlobalBottom, 0)).html,
			globalTop: (await renderApp(slideNumber, layers.GlobalTop, 0)).html,
			problems: counted.problems,
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
		globalCss: () => collectCss([`${deck.clientRoot}/styles/index.ts`]),
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
	{ clickTargetProps }: typeof ClicksStandIn,
	targets: ClickTarget[],
	problems: string[],
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
				problems.push(
					`Couldn't draw a v-mark: ${element.textContent.trim().slice(0, 60)}`,
				);
			}),
	};
}
