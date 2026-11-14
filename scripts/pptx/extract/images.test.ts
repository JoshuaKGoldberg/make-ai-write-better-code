import { describe, expect, it } from "vitest";

import { fileNameOf } from "./images.ts";

describe(fileNameOf, () => {
	it("decodes a name when it's percent-encoded", () => {
		expect(fileNameOf("/images/my%20photo.png?v=2#top")).toBe("my photo.png");
	});

	it("keeps a percent sign when it isn't an escape", () => {
		expect(fileNameOf("/images/100%.png")).toBe("100%.png");
	});
});
