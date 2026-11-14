/**
 * CSS color parsing: hex, named colors, rgb(), hsl(), hwb(), lab(), lch(), oklab(),
 * oklch(), color(), and color-mix(), each resolved to sRGB hex and an alpha.
 */
import { splitTopLevel } from "./css.ts";

interface Color {
	/** Alpha, 0-1. */
	a: number;
	/** Six lowercase hex digits, clipped to sRGB. */
	hex: string;
}

type Matrix = [Vector, Vector, Vector];

/** A color as gamma-encoded sRGB channels (unclipped, so mixes keep wide-gamut values) and alpha. */
interface Rgba {
	alpha: number;
	b: number;
	g: number;
	r: number;
}

/** A color space color-mix() can interpolate in. */
interface Space {
	from: (coordinates: Vector, alpha: number) => Rgba;
	/** The index of the coordinate that's a hue, if any. */
	hueIndex?: number;
	to: (color: Rgba) => Vector;
}

type Vector = [number, number, number];

// cspell:disable
const NAMED: Partial<Record<string, string>> = Object.fromEntries(
	[
		..."aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32".matchAll(
			/(\w+):(\w+)/g,
		),
	].map(([, name, hex]): [string, string] => [name, hex]),
);
// cspell:enable

const D50_TO_D65: Matrix = [
	[0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
	[-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
	[0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];
const D65_TO_D50: Matrix = [
	[1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
	[0.029627815688159344, 0.990434484573249, -0.01707382502938514],
	[-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];
const XYZ_TO_LINEAR_SRGB: Matrix = [
	[3.2409699419045226, -1.537383177570094, -0.4986107602930034],
	[-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
	[0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const LINEAR_SRGB_TO_XYZ: Matrix = [
	[0.41239079926595934, 0.357584339383878, 0.1804807884018343],
	[0.21263900587151027, 0.715168678767756, 0.07219231536073371],
	[0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const P3_TO_XYZ: Matrix = [
	[0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
	[0.2289745640697488, 0.6917385218365064, 0.079286914093745],
	[0, 0.04511338185890264, 1.043944368900976],
];
const OKLAB_TO_LMS: Matrix = [
	[1, 0.3963377774, 0.2158037573],
	[1, -0.1055613458, -0.0638541728],
	[1, -0.0894841775, -1.291485548],
];
const LMS_TO_LINEAR_SRGB: Matrix = [
	[4.0767416621, -3.3077115913, 0.2309699292],
	[-1.2684380046, 2.6097574011, -0.3413193965],
	[-0.0041960863, -0.7034186147, 1.707614701],
];
const LINEAR_SRGB_TO_LMS: Matrix = [
	[0.4122214708, 0.5363325363, 0.0514459929],
	[0.2119034982, 0.6806995451, 0.1073969566],
	[0.0883024619, 0.2817188376, 0.6299787005],
];
const LMS_TO_OKLAB: Matrix = [
	[0.2104542553, 0.793617785, -0.0040720468],
	[1.9779984951, -2.428592205, 0.4505937099],
	[0.0259040371, 0.7827717662, -0.808675766],
];
const D50_WHITE: Vector = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

const HUE_UNITS: Partial<Record<string, number>> = {
	"": 1,
	deg: 1,
	grad: 0.9,
	rad: 180 / Math.PI,
	turn: 360,
};

const PREDEFINED_SPACES = new Set([
	"srgb",
	"srgb-linear",
	"xyz",
	"xyz-d50",
	"xyz-d65",
]);

const mapVector = (
	vector: Vector,
	transform: (value: number, index: number) => number,
): Vector => [
	transform(vector[0], 0),
	transform(vector[1], 1),
	transform(vector[2], 2),
];

const multiply = (matrix: Matrix, vector: Vector) =>
	mapVector(
		vector,
		(_, row) =>
			matrix[row][0] * vector[0] +
			matrix[row][1] * vector[1] +
			matrix[row][2] * vector[2],
	);

const toLinear = (channel: number) => {
	const magnitude = Math.abs(channel);
	return magnitude <= 0.04045
		? channel / 12.92
		: Math.sign(channel) * ((magnitude + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (channel: number) => {
	const magnitude = Math.abs(channel);
	return magnitude <= 0.0031308
		? channel * 12.92
		: Math.sign(channel) * (1.055 * magnitude ** (1 / 2.4) - 0.055);
};

const fromLinearRgb = (linear: Vector, alpha: number): Rgba => {
	const [r, g, b] = mapVector(linear, fromLinear);
	return { alpha, b, g, r };
};

const linearRgbOf = ({ b, g, r }: Rgba) => mapVector([r, g, b], toLinear);

const fromPolar = ([lightness, chroma, hue]: Vector): Vector => {
	const radians = (hue * Math.PI) / 180;
	return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
};

const toPolar = ([lightness, a, b]: Vector): Vector => [
	lightness,
	Math.hypot(a, b),
	((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
];

function fromHsl([hue, saturation, lightness]: Vector, alpha: number): Rgba {
	const chroma = saturation * Math.min(lightness, 1 - lightness);
	const channel = (offset: number) => {
		const position = (offset + hue / 30) % 12;
		return (
			lightness - chroma * Math.max(-1, Math.min(position - 3, 9 - position, 1))
		);
	};

	return { alpha, b: channel(4), g: channel(8), r: channel(0) };
}

function fromHwb([hue, whiteness, blackness]: Vector, alpha: number): Rgba {
	if (whiteness + blackness >= 1) {
		const gray = whiteness / (whiteness + blackness);
		return { alpha, b: gray, g: gray, r: gray };
	}

	const { b, g, r } = fromHsl([hue, 1, 0.5], alpha);
	const scale = (channel: number) =>
		channel * (1 - whiteness - blackness) + whiteness;
	return { alpha, b: scale(b), g: scale(g), r: scale(r) };
}

function fromLab([lightness, a, b]: Vector, alpha: number) {
	const fy = (lightness + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;
	const xyz: Vector = [
		(fx ** 3 > LAB_EPSILON ? fx ** 3 : (116 * fx - 16) / LAB_KAPPA) *
			D50_WHITE[0],
		lightness > LAB_KAPPA * LAB_EPSILON ? fy ** 3 : lightness / LAB_KAPPA,
		(fz ** 3 > LAB_EPSILON ? fz ** 3 : (116 * fz - 16) / LAB_KAPPA) *
			D50_WHITE[2],
	];
	return fromLinearRgb(
		multiply(XYZ_TO_LINEAR_SRGB, multiply(D50_TO_D65, xyz)),
		alpha,
	);
}

function fromOklab(oklab: Vector, alpha: number) {
	return fromLinearRgb(
		multiply(
			LMS_TO_LINEAR_SRGB,
			mapVector(multiply(OKLAB_TO_LMS, oklab), (value) => value ** 3),
		),
		alpha,
	);
}

function toHsl({ b, g, r }: Rgba): Vector {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const lightness = (max + min) / 2;
	const delta = max - min;
	if (delta === 0) {
		return [0, 0, lightness];
	}

	const hue =
		max === r
			? ((g - b) / delta + 6) % 6
			: max === g
				? (b - r) / delta + 2
				: (r - g) / delta + 4;
	return [60 * hue, delta / (1 - Math.abs(2 * lightness - 1)), lightness];
}

function toLab(color: Rgba) {
	const f = (value: number) =>
		value > LAB_EPSILON ? Math.cbrt(value) : (LAB_KAPPA * value + 16) / 116;
	const [x, y, z] = mapVector(
		multiply(D65_TO_D50, multiply(LINEAR_SRGB_TO_XYZ, linearRgbOf(color))),
		(value, index) => f(value / D50_WHITE[index]),
	);
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)] satisfies Vector;
}

function toOklab(color: Rgba) {
	return multiply(
		LMS_TO_OKLAB,
		mapVector(multiply(LINEAR_SRGB_TO_LMS, linearRgbOf(color)), Math.cbrt),
	);
}

const XYZ_D65: Space = {
	from: (xyz, alpha) => fromLinearRgb(multiply(XYZ_TO_LINEAR_SRGB, xyz), alpha),
	to: (color) => multiply(LINEAR_SRGB_TO_XYZ, linearRgbOf(color)),
};

const SPACES: Partial<Record<string, Space>> = {
	hsl: { from: fromHsl, hueIndex: 0, to: toHsl },
	hwb: {
		from: fromHwb,
		hueIndex: 0,
		to: (color) => [
			toHsl(color)[0],
			Math.min(color.r, color.g, color.b),
			1 - Math.max(color.r, color.g, color.b),
		],
	},
	lab: { from: fromLab, to: toLab },
	lch: {
		from: (lch, alpha) => fromLab(fromPolar(lch), alpha),
		hueIndex: 2,
		to: (color) => toPolar(toLab(color)),
	},
	oklab: { from: fromOklab, to: toOklab },
	oklch: {
		from: (oklch, alpha) => fromOklab(fromPolar(oklch), alpha),
		hueIndex: 2,
		to: (color) => toPolar(toOklab(color)),
	},
	srgb: {
		from: ([r, g, b], alpha) => ({ alpha, b, g, r }),
		to: ({ b, g, r }) => [r, g, b],
	},
	"srgb-linear": { from: fromLinearRgb, to: linearRgbOf },
	xyz: XYZ_D65,
	"xyz-d50": {
		from: (xyz, alpha) =>
			fromLinearRgb(
				multiply(XYZ_TO_LINEAR_SRGB, multiply(D50_TO_D65, xyz)),
				alpha,
			),
		to: (color) =>
			multiply(D65_TO_D50, multiply(LINEAR_SRGB_TO_XYZ, linearRgbOf(color))),
	},
	"xyz-d65": XYZ_D65,
};

/** Parses a CSS color into a hex string and alpha, or undefined for transparent, none, or unsupported values. */
export function parseColor(value: string | undefined, current?: string) {
	const rgba = value
		? parseRgba(normalize(value), current && normalize(current))
		: undefined;
	if (!rgba || ![rgba.r, rgba.g, rgba.b, rgba.alpha].every(Number.isFinite)) {
		return undefined;
	}

	const channel = (level: number) =>
		Math.round(Math.min(1, Math.max(0, level)) * 255)
			.toString(16)
			.padStart(2, "0");
	return {
		a: Math.min(1, Math.max(0, rgba.alpha)),
		hex: channel(rgba.r) + channel(rgba.g) + channel(rgba.b),
	} satisfies Color;
}

function hueOf(part: string) {
	return part === "none"
		? 0
		: parseFloat(part) * (HUE_UNITS[/[a-z]*$/.exec(part)?.[0] ?? ""] ?? NaN);
}

/** Resolves `color-mix()`, interpolating with premultiplied alpha. */
function mix(args: string[], current: string | undefined) {
	const [method = "", ...colors] = args;
	const space = SPACES[/^in\s+([\w-]+)/.exec(method)?.[1] ?? "oklab"];
	const [first, second] = colors.map((part) => {
		const tokens = splitTopLevel(part, " ");
		const percentIndex = tokens.findIndex((token) => /^[\d.]+%$/.test(token));
		const color = parseRgba(
			tokens.filter((_, index) => index !== percentIndex).join(" "),
			current,
			true,
		);
		return (
			color && {
				color,
				percent:
					percentIndex < 0 ? undefined : parseFloat(tokens[percentIndex]),
			}
		);
	});
	if (!space || !first || !second || colors.length !== 2) {
		return undefined;
	}

	const firstPercent =
		first.percent ?? (second.percent === undefined ? 50 : 100 - second.percent);
	const total = firstPercent + (second.percent ?? 100 - firstPercent);
	if (total <= 0) {
		return undefined;
	}

	const firstWeight = firstPercent / total;
	const secondWeight = 1 - firstWeight;
	const { hueIndex } = space;
	const firstCoordinates = space.to(first.color);
	const secondCoordinates = space.to(second.color);
	if (hueIndex !== undefined) {
		const difference = secondCoordinates[hueIndex] - firstCoordinates[hueIndex];
		secondCoordinates[hueIndex] -=
			difference > 180 ? 360 : difference < -180 ? -360 : 0;
	}

	const alpha =
		first.color.alpha * firstWeight + second.color.alpha * secondWeight;
	const coordinates = mapVector(firstCoordinates, (value, index) =>
		index === hueIndex
			? (((value * firstWeight + secondCoordinates[index] * secondWeight) %
					360) +
					360) %
				360
			: alpha === 0
				? 0
				: (value * first.color.alpha * firstWeight +
						secondCoordinates[index] * second.color.alpha * secondWeight) /
					alpha,
	);
	return space.from(coordinates, alpha * Math.min(1, total / 100));
}

function normalize(value: string) {
	return value.trim().toLowerCase();
}

function parseHex(digits: string): Rgba {
	const full =
		digits.length <= 4
			? digits.replace(/./g, (digit) => digit + digit)
			: digits;
	const byte = (index: number) =>
		parseInt(full.slice(index, index + 2), 16) / 255;
	return {
		alpha: full.length === 8 ? byte(6) : 1,
		b: byte(4),
		g: byte(2),
		r: byte(0),
	};
}

function parseRgba(
	text: string,
	current: string | undefined,
	transparentIsColor = false,
): Rgba | undefined {
	if (text === "transparent") {
		return transparentIsColor ? { alpha: 0, b: 0, g: 0, r: 0 } : undefined;
	}

	if (text === "currentcolor") {
		return current && current !== "currentcolor"
			? parseRgba(current, undefined, transparentIsColor)
			: undefined;
	}

	const hex =
		NAMED[text] ?? /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(text)?.[1];
	if (hex) {
		return parseHex(hex);
	}

	const [, name, body] = /^([a-z-]+)\((.*)\)$/s.exec(text) ?? [];
	if (!name || !body) {
		return undefined;
	}

	if (name === "color-mix") {
		return mix(splitTopLevel(body, ","), current);
	}

	if (/\bfrom\b/.test(body)) {
		return undefined;
	}

	const sections = splitTopLevel(body, "/");
	const alphaText = sections.at(1);
	const parts = splitTopLevel(sections.at(0) ?? "", ",").flatMap((part) =>
		splitTopLevel(part, " "),
	);
	const legacyAlpha =
		alphaText === undefined && body.includes(",") && parts.length === 4
			? parts[3]
			: undefined;
	const number = (part: string | undefined, percentScale: number) =>
		!part || part === "none"
			? 0
			: part.endsWith("%")
				? (parseFloat(part) / 100) * percentScale
				: parseFloat(part);
	const alphaPart = alphaText ?? legacyAlpha;
	const alpha = alphaPart === undefined ? 1 : number(alphaPart, 1);
	const channels = name === "color" ? parts.slice(1) : parts;
	if (
		channels.some((part) => part !== "none" && Number.isNaN(parseFloat(part)))
	) {
		return undefined;
	}

	const [first, second, third] = channels;
	switch (name) {
		case "color": {
			const space = parts[0];
			const coordinates: Vector = [
				number(first, 1),
				number(second, 1),
				number(third, 1),
			];
			return space === "display-p3"
				? fromLinearRgb(
						multiply(
							XYZ_TO_LINEAR_SRGB,
							multiply(P3_TO_XYZ, mapVector(coordinates, toLinear)),
						),
						alpha,
					)
				: PREDEFINED_SPACES.has(space)
					? SPACES[space]?.from(coordinates, alpha)
					: undefined;
		}
		case "hsl":
		case "hsla":
		case "hwb":
			return (name === "hwb" ? fromHwb : fromHsl)(
				[hueOf(first), number(second, 100) / 100, number(third, 100) / 100],
				alpha,
			);
		case "lab":
			return fromLab(
				[number(first, 100), number(second, 125), number(third, 125)],
				alpha,
			);
		case "lch":
			return fromLab(
				fromPolar([number(first, 100), number(second, 150), hueOf(third)]),
				alpha,
			);
		case "oklab":
			return fromOklab(
				[number(first, 1), number(second, 0.4), number(third, 0.4)],
				alpha,
			);
		case "oklch":
			return fromOklab(
				fromPolar([number(first, 1), number(second, 0.4), hueOf(third)]),
				alpha,
			);
		case "rgb":
		case "rgba":
			return {
				alpha,
				b: number(third, 255) / 255,
				g: number(second, 255) / 255,
				r: number(first, 255) / 255,
			};
		default:
			return undefined;
	}
}
