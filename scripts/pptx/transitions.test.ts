import { describe, expect, it } from "vitest";

import { transitionInto, transitionXml } from "./transitions.ts";

describe(transitionInto, () => {
	const slides = [
		{ frontmatter: { transition: "fade" } },
		{ frontmatter: { transition: "slide-up | slide-down" } },
		{ frontmatter: {} },
		{ frontmatter: { transition: { name: "none" } } },
		{ frontmatter: {} },
	];
	const config = { transition: "view-transition" };

	it("plays nothing into the first slide", () => {
		expect(transitionInto(1, slides, config)).toBeUndefined();
	});

	it("uses the previous slide's transition, forward half", () => {
		expect(transitionInto(2, slides, config)).toBe("fade");
		expect(transitionInto(3, slides, config)).toBe("slide-up");
		expect(transitionInto(5, slides, config)).toBe("none");
	});

	it("falls back to the deck's transition", () => {
		expect(transitionInto(4, slides, config)).toBe("view-transition");
		expect(transitionInto(4, slides, {})).toBeUndefined();
	});
});

describe(transitionXml, () => {
	it.each([
		[undefined, ""],
		["none", ""],
		["fade", '<p:transition spd="fast"><p:fade/></p:transition>'],
		[
			"fade-out",
			'<p:transition spd="fast"><p:fade thruBlk="1"/></p:transition>',
		],
		["slide-left", '<p:transition spd="fast"><p:push dir="l"/></p:transition>'],
		["slide-down", '<p:transition spd="fast"><p:push dir="d"/></p:transition>'],
		["my-custom", '<p:transition spd="fast"><p:fade/></p:transition>'],
	])("writes %s", (name, xml) => {
		expect(transitionXml(name)).toBe(xml);
	});
});
