/**
 * Computes the WCAG 2 contrast ratio between two six-digit hex colors.
 * @see https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */
export function getContrastRatio(first: string, second: string) {
	const [lighter, darker] = [
		getRelativeLuminance(first),
		getRelativeLuminance(second),
	].sort((a, b) => b - a);

	return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance(hex: string) {
	const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
	if (!match) {
		throw new Error(`Expected a six-digit hex color, but got: ${hex}`);
	}

	const [red, green, blue] = match
		.slice(1)
		.map((channel) => toLinear(Number.parseInt(channel, 16) / 255));

	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function toLinear(channel: number) {
	return channel <= 0.04045
		? channel / 12.92
		: ((channel + 0.055) / 1.055) ** 2.4;
}
