import { useClickTarget } from "./clicks.ts";

export function useHighlightRange(
	props: { at: number | string; finally: number | string; ranges: string[] },
	highlight: (element: Element, range: string, hidden: boolean) => void,
) {
	if (!props.ranges.length) {
		return {};
	}

	return useClickTarget((clicks, element) => {
		const info = clicks.calculateSince(props.at, props.ranges.length - 1);
		clicks.register(element, info);
		const index = info
			? Math.max(0, clicks.current - info.start + 1)
			: Number.POSITIVE_INFINITY;
		const finallyRange =
			props.finally === "last"
				? props.ranges[props.ranges.length - 1]
				: String(props.finally);
		const range = props.ranges[index] ?? finallyRange;
		const hidden = range === "hide";
		highlight(
			element,
			hidden ? (props.ranges[index + 1] ?? finallyRange) : range,
			hidden,
		);
	});
}
