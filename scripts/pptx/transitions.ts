/**
 * Slide transitions: which Slidev transition plays into each slide, and PowerPoint's
 * closest equivalent.
 */
import type { SlidevConfig } from "@slidev/types";

const PUSH_DIRECTIONS: Record<string, string> = {
	down: "d",
	left: "l",
	right: "r",
	up: "u",
};

/**
 * The transition into a slide, as Slidev plays it going forward: the previous slide's
 * `transition`, else the deck's, and a "forward | backward" pair's forward half.
 */
export function transitionInto(
	slideNumber: number,
	slides: { frontmatter: Record<string, unknown> }[],
	config: { transition?: SlidevConfig["transition"] },
) {
	if (slideNumber <= 1) {
		return undefined;
	}

	const forward = (
		nameOf(slides[slideNumber - 2].frontmatter.transition) ??
		nameOf(config.transition)
	)
		?.split("|")[0]
		.trim();
	return forward === "" ? undefined : forward;
}

/** A transition's name, if it has one: like Slidev, falsy transitions (like false or "") defer to the deck's. */
const nameOf = (transition: unknown) =>
	typeof transition === "object" && transition && "name" in transition
		? String(transition.name)
		: typeof transition === "string" && transition !== ""
			? transition
			: undefined;

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
		? `<p:push dir="${PUSH_DIRECTIONS[push]}"/>`
		: name === "fade-out"
			? '<p:fade thruBlk="1"/>'
			: "<p:fade/>";
	return `<p:transition spd="fast">${effect}</p:transition>`;
}
