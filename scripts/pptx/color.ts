/**
 * CSS color parsing: hex, named colors, rgb(), hsl(), hwb(), lab(), lch(), oklab(),
 * oklch(), color(), and color-mix(), each resolved to sRGB hex and an alpha.
 */

export interface Color {
	/** Alpha, 0-1. */
	a: number;
	/** Six lowercase hex digits, clipped to sRGB. */
	hex: string;
}

/** A color as gamma-encoded sRGB channels (unclipped, so mixes keep wide-gamut values) and alpha. */
type Matrix = [Vector, Vector, Vector];

interface Rgba {
	a: number;
	b: number;
	g: number;
	r: number;
}
type Vector = [number, number, number];

// cspell:disable
const NAMED = Object.fromEntries(
	"aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32"
		.split(",")
		.map((entry) => entry.split(":")),
) as Partial<Record<string, string>>;
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
const D50_WHITE: Vector = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

/** Parses a CSS color into a hex string and alpha, or undefined for transparent, none, or unsupported values. */
export function parseColor(
	value: string | undefined,
	current?: string,
): Color | undefined {
	const rgba = value
		? parseRgba(value.trim().toLowerCase(), current)
		: undefined;
	if (!rgba) {
		return undefined;
	}

	const channel = (c: number) =>
		Math.round(Math.min(1, Math.max(0, c)) * 255)
			.toString(16)
			.padStart(2, "0");
	return {
		a: Math.min(1, Math.max(0, rgba.a)),
		hex: channel(rgba.r) + channel(rgba.g) + channel(rgba.b),
	};
}

const multiply = (m: Matrix, [x, y, z]: Vector): Vector => [
	m[0][0] * x + m[0][1] * y + m[0][2] * z,
	m[1][0] * x + m[1][1] * y + m[1][2] * z,
	m[2][0] * x + m[2][1] * y + m[2][2] * z,
];

const toLinear = (c: number) => {
	const abs = Math.abs(c);
	return abs <= 0.04045
		? c / 12.92
		: Math.sign(c) * ((abs + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (c: number) => {
	const abs = Math.abs(c);
	return abs <= 0.0031308
		? c * 12.92
		: Math.sign(c) * (1.055 * abs ** (1 / 2.4) - 0.055);
};

const fromLinearRgb = ([r, g, b]: Vector, a: number): Rgba => ({
	a,
	b: fromLinear(b),
	g: fromLinear(g),
	r: fromLinear(r),
});

const linearRgbOf = ({ b, g, r }: Rgba): Vector => [
	toLinear(r),
	toLinear(g),
	toLinear(b),
];

function fromHsl(h: number, s: number, l: number, a: number): Rgba {
	const k = (n: number) => (n + h / 30) % 12;
	const chroma = s * Math.min(l, 1 - l);
	const f = (n: number) =>
		l - chroma * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
	return { a, b: f(4), g: f(8), r: f(0) };
}

function fromHwb(h: number, w: number, bl: number, a: number): Rgba {
	if (w + bl >= 1) {
		const gray = w / (w + bl);
		return { a, b: gray, g: gray, r: gray };
	}

	const rgb = fromHsl(h, 1, 0.5, a);
	const scale = (c: number) => c * (1 - w - bl) + w;
	return { a, b: scale(rgb.b), g: scale(rgb.g), r: scale(rgb.r) };
}

function fromLab(l: number, a: number, b: number, alpha: number): Rgba {
	const fy = (l + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;
	const xyz: Vector = [
		(fx ** 3 > LAB_EPSILON ? fx ** 3 : (116 * fx - 16) / LAB_KAPPA) *
			D50_WHITE[0],
		l > LAB_KAPPA * LAB_EPSILON ? fy ** 3 : l / LAB_KAPPA,
		(fz ** 3 > LAB_EPSILON ? fz ** 3 : (116 * fz - 16) / LAB_KAPPA) *
			D50_WHITE[2],
	];
	return fromLinearRgb(
		multiply(XYZ_TO_LINEAR_SRGB, multiply(D50_TO_D65, xyz)),
		alpha,
	);
}

function fromOklab(l: number, a: number, b: number, alpha: number): Rgba {
	const lms = [
		l + 0.3963377774 * a + 0.2158037573 * b,
		l - 0.1055613458 * a - 0.0638541728 * b,
		l - 0.0894841775 * a - 1.291485548 * b,
	].map((c) => c ** 3);
	return fromLinearRgb(
		[
			4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
			-1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
			-0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
		],
		alpha,
	);
}

function hueOf(part: string) {
	const value = parseFloat(part);
	if (part.endsWith("turn")) {
		return value * 360;
	}

	if (part.endsWith("grad")) {
		return value * 0.9;
	}

	if (part.endsWith("rad")) {
		return (value * 180) / Math.PI;
	}

	return value;
}

/** The color's coordinates in a color-mix() interpolation space, with the index of its hue, if any. */
function fromSpace([x, y, z]: Vector, space: string, a: number): Rgba {
	const rad = (z * Math.PI) / 180;
	switch (space) {
		case "hsl":
			return fromHsl(x, y, z, a);
		case "lab":
			return fromLab(x, y, z, a);
		case "lch":
			return fromLab(x, y * Math.cos(rad), y * Math.sin(rad), a);
		case "oklab":
			return fromOklab(x, y, z, a);
		case "oklch":
			return fromOklab(x, y * Math.cos(rad), y * Math.sin(rad), a);
		case "srgb-linear":
			return fromLinearRgb([x, y, z], a);
		case "xyz":
		case "xyz-d65":
			return fromLinearRgb(multiply(XYZ_TO_LINEAR_SRGB, [x, y, z]), a);
		case "xyz-d50":
			return fromLinearRgb(
				multiply(XYZ_TO_LINEAR_SRGB, multiply(D50_TO_D65, [x, y, z])),
				a,
			);
		default:
			return { a, b: z, g: y, r: x };
	}
}

function toPolar([l, a, b]: Vector): { coords: Vector; hue: number } {
	const hue = (Math.atan2(b, a) * 180) / Math.PI;
	return { coords: [l, Math.hypot(a, b), (hue + 360) % 360], hue: 2 };
}

function toSpace(color: Rgba, space: string): { coords: Vector; hue?: number } {
	const linear = linearRgbOf(color);
	switch (space) {
		case "hsl": {
			const { b, g, r } = color;
			const max = Math.max(r, g, b);
			const min = Math.min(r, g, b);
			const l = (max + min) / 2;
			const d = max - min;
			const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
			const h =
				d === 0
					? 0
					: max === r
						? 60 * (((g - b) / d + 6) % 6)
						: max === g
							? 60 * ((b - r) / d + 2)
							: 60 * ((r - g) / d + 4);
			return { coords: [h, s, l], hue: 0 };
		}
		case "lab":
		case "lch": {
			const [x, y, z] = multiply(
				D65_TO_D50,
				multiply(LINEAR_SRGB_TO_XYZ, linear),
			).map((c, i) => c / D50_WHITE[i]);
			const f = (t: number) =>
				t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;
			const lab: Vector = [
				116 * f(y) - 16,
				500 * (f(x) - f(y)),
				200 * (f(y) - f(z)),
			];
			return space === "lab" ? { coords: lab } : toPolar(lab);
		}
		case "oklab":
		case "oklch": {
			const [l, m, s] = [
				0.4122214708 * linear[0] +
					0.5363325363 * linear[1] +
					0.0514459929 * linear[2],
				0.2119034982 * linear[0] +
					0.6806995451 * linear[1] +
					0.1073969566 * linear[2],
				0.0883024619 * linear[0] +
					0.2817188376 * linear[1] +
					0.6299787005 * linear[2],
			].map(Math.cbrt);
			const lab: Vector = [
				0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
				1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
				0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
			];
			return space === "oklab" ? { coords: lab } : toPolar(lab);
		}
		case "srgb-linear":
			return { coords: linear };
		case "xyz":
		case "xyz-d65":
			return { coords: multiply(LINEAR_SRGB_TO_XYZ, linear) };
		case "xyz-d50":
			return {
				coords: multiply(D65_TO_D50, multiply(LINEAR_SRGB_TO_XYZ, linear)),
			};
		default:
			return { coords: [color.r, color.g, color.b] };
	}
}

/** Resolves `color-mix()`, interpolating with premultiplied alpha. */
function mix(args: string[], current: string | undefined): Rgba | undefined {
	const [method, first, second] = args;
	const space = /^in\s+([\w-]+)/.exec(method)?.[1] ?? "oklab";
	const parse = (part: string | undefined) => {
		const percent = part ? /\s(-?[\d.]+)%$/.exec(part) : null;
		const color = part
			? parseRgba(
					percent ? part.slice(0, percent.index).trim() : part,
					current,
					true,
				)
			: undefined;
		return (
			color && { color, percent: percent ? Number(percent[1]) : undefined }
		);
	};

	const a = parse(first);
	const b = parse(second);
	if (!a || !b) {
		return undefined;
	}

	let p1 = a.percent ?? (b.percent === undefined ? 50 : 100 - b.percent);
	let p2 = b.percent ?? 100 - p1;
	const sum = p1 + p2;
	if (sum <= 0) {
		return undefined;
	}

	p1 /= sum;
	p2 /= sum;
	const one = toSpace(a.color, space);
	const two = toSpace(b.color, space);
	if (one.hue !== undefined) {
		// Shorter arc between hues.
		const h1 = one.coords[one.hue];
		let h2 = two.coords[one.hue];
		if (h2 - h1 > 180) {
			h2 -= 360;
		} else if (h2 - h1 < -180) {
			h2 += 360;
		}

		two.coords[one.hue] = h2;
	}

	const alpha = a.color.a * p1 + b.color.a * p2;
	const coords = one.coords.map((c1, i) => {
		const c2 = two.coords[i];
		if (i === one.hue) {
			return (((c1 * p1 + c2 * p2) % 360) + 360) % 360;
		}

		return alpha === 0
			? 0
			: (c1 * a.color.a * p1 + c2 * b.color.a * p2) / alpha;
	}) as Vector;
	return fromSpace(coords, space, alpha * Math.min(1, sum / 100));
}

function parseRgba(
	v: string,
	current: string | undefined,
	transparentIsColor = false,
): Rgba | undefined {
	if (v === "transparent") {
		return transparentIsColor ? { a: 0, b: 0, g: 0, r: 0 } : undefined;
	}

	if (v === "none" || !v) {
		return undefined;
	}

	if (v === "currentcolor") {
		return current && current.trim().toLowerCase() !== "currentcolor"
			? parseRgba(current.trim().toLowerCase(), undefined, transparentIsColor)
			: undefined;
	}

	const named = NAMED[v];
	if (named) {
		return parseRgba(`#${named}`, current);
	}

	const hex = /^#([\da-f]{3,8})$/.exec(v);
	if (hex) {
		if (![3, 4, 6, 8].includes(hex[1].length)) {
			return undefined;
		}

		const digits =
			hex[1].length <= 4 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
		const byte = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
		return {
			a: digits.length === 8 ? byte(6) : 1,
			b: byte(4),
			g: byte(2),
			r: byte(0),
		};
	}

	const fn = /^([a-z-]+)\((.*)\)$/s.exec(v);
	if (!fn) {
		return undefined;
	}

	const [, name, body] = fn;
	if (name === "color-mix") {
		return mix(splitArgs(body, ","), current);
	}

	if (/\bfrom\b/.test(body)) {
		// Relative color syntax isn't supported.
		return undefined;
	}

	const [channelsPart, alphaPart] = body.includes("/")
		? body.split("/")
		: [body, undefined];
	let parts = splitArgs(channelsPart, /[\s,]+/);
	let alphaText = alphaPart?.trim();
	if (!alphaText && body.includes(",") && parts.length === 4) {
		alphaText = parts[3];
		parts = parts.slice(0, 3);
	}

	const number = (part: string | undefined, percentScale = 1) => {
		if (!part || part === "none") {
			return 0;
		}

		return part.endsWith("%")
			? (parseFloat(part) / 100) * percentScale
			: parseFloat(part);
	};

	const a = alphaText === undefined ? 1 : number(alphaText, 1);
	if (
		parts
			.slice(name === "color" ? 1 : 0)
			.some((part) => Number.isNaN(parseFloat(part)) && part !== "none")
	) {
		return undefined;
	}

	switch (name) {
		case "color": {
			const [space, ...channels] = parts;
			const values = channels.map((part) => number(part, 1)) as Vector;
			if (space === "display-p3") {
				return fromLinearRgb(
					multiply(
						XYZ_TO_LINEAR_SRGB,
						multiply(P3_TO_XYZ, values.map(toLinear) as Vector),
					),
					a,
				);
			}

			return fromSpace(values, space, a);
		}
		case "hsl":
		case "hsla":
			return fromHsl(
				hueOf(parts[0]),
				number(parts[1], 100) / 100,
				number(parts[2], 100) / 100,
				a,
			);
		case "hwb":
			return fromHwb(
				hueOf(parts[0]),
				number(parts[1], 100) / 100,
				number(parts[2], 100) / 100,
				a,
			);
		case "lab":
			return fromLab(
				number(parts[0], 100),
				number(parts[1], 125),
				number(parts[2], 125),
				a,
			);
		case "lch":
			return fromSpace(
				[number(parts[0], 100), number(parts[1], 150), hueOf(parts[2])],
				"lch",
				a,
			);
		case "oklab":
			return fromOklab(
				number(parts[0], 1),
				number(parts[1], 0.4),
				number(parts[2], 0.4),
				a,
			);
		case "oklch":
			return fromSpace(
				[number(parts[0], 1), number(parts[1], 0.4), hueOf(parts[2])],
				"oklch",
				a,
			);
		case "rgb":
		case "rgba":
			return {
				a,
				b: number(parts[2], 255) / 255,
				g: number(parts[1], 255) / 255,
				r: number(parts[0], 255) / 255,
			};
		default:
			return undefined;
	}
}

/** Splits function arguments on a separator outside parentheses. */
function splitArgs(value: string, separator: RegExp | string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = "";
	const isSeparator = (ch: string) =>
		typeof separator === "string" ? ch === separator : separator.test(ch);
	for (const ch of value.trim()) {
		if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			depth--;
		}

		if (depth === 0 && isSeparator(ch)) {
			if (current.trim()) {
				out.push(current.trim());
			}

			current = "";
		} else {
			current += ch;
		}
	}

	if (current.trim()) {
		out.push(current.trim());
	}

	return out;
}
