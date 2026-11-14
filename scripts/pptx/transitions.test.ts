import { describe, expect, it } from "vitest";

import { transitionInto, transitionXml } from "./transitions.ts";

describe(transitionInto, () => {
	const config = { transition: "view-transition" };

	it("plays nothing when the slide is the first", () => {
		expect(transitionInto(1, [{ frontmatter: {} }], config)).toBeUndefined();
	});

	it("uses the previous slide's transition when it has one", () => {
		expect(
			transitionInto(
				2,
				[{ frontmatter: { transition: "fade" } }, { frontmatter: {} }],
				config,
			),
		).toBe("fade");
	});

	it("uses the forward half when the transition is a pair", () => {
		expect(
			transitionInto(
				2,
				[{ frontmatter: { transition: "slide-up | slide-down" } }],
				config,
			),
		).toBe("slide-up");
	});

	it("plays nothing when the pair's forward half is empty", () => {
		expect(
			transitionInto(2, [{ frontmatter: { transition: " | fade" } }], config),
		).toBeUndefined();
	});

	it("reads the name when the transition is an object", () => {
		expect(
			transitionInto(
				2,
				[{ frontmatter: { transition: { name: "none" } } }],
				config,
			),
		).toBe("none");
	});

	it.each([[undefined], [false], [""]])(
		"uses the deck's transition when the previous slide's is %j",
		(transition) => {
			expect(transitionInto(2, [{ frontmatter: { transition } }], config)).toBe(
				"view-transition",
			);
		},
	);

	it("plays nothing when neither the slide nor the deck has a transition", () => {
		expect(transitionInto(2, [{ frontmatter: {} }], {})).toBeUndefined();
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
	])("writes %j as %j", (name, xml) => {
		expect(transitionXml(name)).toBe(xml);
	});
});
