import type { ClicksContext } from "@slidev/types";

let registered = 0;

export function currentHighlightRange(
	clicks: ClicksContext,
	props: { at: number | string; finally: number | string; ranges: string[] },
) {
	if (!props.ranges.length) {
		return undefined;
	}

	const info = clicks.calculateSince(props.at, props.ranges.length - 1);
	clicks.register(`highlight-range-${String(registered++)}`, info);
	const index = info ? Math.max(0, clicks.current - info.start + 1) : Infinity;
	return (
		props.ranges[index] ??
		(props.finally === "last" ? props.ranges.at(-1) : String(props.finally))
	);
}
