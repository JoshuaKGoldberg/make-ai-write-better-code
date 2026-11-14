/**
 * Slide transitions: which Slidev transition plays into each slide, and PowerPoint's
 * closest equivalent.
 */
import type { SlidevConfig } from "@slidev/types";

/**
 * The transition into a slide, as Slidev plays it going forward: the previous slide's
 * `transition`, else the deck's, and a "forward | backward" pair's forward half.
 */
export function transitionInto(
	no: number,
	slides: { frontmatter: Record<string, unknown> }[],
	config: { transition?: SlidevConfig["transition"] },
): string | undefined {
	if (no <= 1) {
		return undefined;
	}

	const own: unknown = slides[no - 2]?.frontmatter.transition;
	// Like Slidev, any falsy transition (like false or "") defers to the deck's.
	const value: unknown = isFalsy(own) ? config.transition : own;
	const name =
		typeof value === "string"
			? value
			: typeof value === "object" && value && "name" in value
				? String(value.name)
				: undefined;
	const forward = name?.split("|")[0].trim();
	return forward === "" ? undefined : forward;
}

/**
 * PowerPoint's closest transition to a Slidev one: fades for fades (and view transitions),
 * pushes for slides, and none for none. Custom transitions fade.
 */
export function transitionXml(name: string | undefined) {
	if (!name || name === "none") {
		return "";
	}

	const push = /^slide-(left|right|up|down)$/.exec(name)?.[1];
	const effect = push
		? `<p:push dir="${push === "left" ? "l" : push === "right" ? "r" : push === "up" ? "u" : "d"}"/>`
		: name === "fade-out"
			? '<p:fade thruBlk="1"/>'
			: "<p:fade/>";
	return `<p:transition spd="fast">${effect}</p:transition>`;
}

const isFalsy = (value: unknown) =>
	value === undefined ||
	value === null ||
	value === false ||
	value === "" ||
	value === 0;
