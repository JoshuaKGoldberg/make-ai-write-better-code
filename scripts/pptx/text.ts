const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The first `length` user-perceived characters of `text`, never splitting an emoji. */
export function truncate(text: string, length: number) {
	return [...graphemes.segment(text)]
		.slice(0, length)
		.map(({ segment }) => segment)
		.join("");
}
