import type { SlidevConfig } from "@slidev/types";

const PUSH_DIRECTIONS: Partial<Record<string, string>> = {
	"slide-down": "d",
	"slide-left": "l",
	"slide-right": "r",
	"slide-up": "u",
};

/** The transition into a slide going forward: the previous slide's, else the deck's, and a "forward | backward" pair's forward half. */
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

/** PowerPoint's closest transition to a Slidev one; custom transitions fade. */
export function transitionXml(name: string | undefined) {
	if (!name || name === "none") {
		return "";
	}

	const push = PUSH_DIRECTIONS[name];
	const effect = push
		? `<p:push dir="${push}"/>`
		: name === "fade-out"
			? '<p:fade thruBlk="1"/>'
			: "<p:fade/>";
	return `<p:transition spd="fast">${effect}</p:transition>`;
}
