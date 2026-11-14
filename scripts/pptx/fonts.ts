/**
 * Finds the fonts a deck's text uses, as a browser would: the deck's `@font-face` rules
 * (including Slidev's web fonts), then installed fonts by family name, then installed
 * fonts for generic families. Each font's file gives layout its glyphs, extraction and
 * writing their metrics, and PowerPoint the font's real name.
 */
import type { ResolvedFontOptions } from "@slidev/types";
import type { Font as TakumiFont } from "@takumi-rs/core";

import * as fontkit from "fontkit";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Assets } from "./assets.ts";

export interface FontBook {
	/** Whether a PowerPoint font has a glyph for a character, or undefined if its coverage is unknown. */
	covers(font: string, codePoint: number): boolean | undefined;
	/** Loads the fonts for text in these font-family stacks, returning those not yet loaded, in registration order. */
	load(stacks: Iterable<string>): Promise<TakumiFont[]>;
	/** Line metrics for a PowerPoint font, from its file when known. */
	metrics(font: string): FontMetrics;
	/** The PowerPoint font (and whether to embolden it) for text in a stack at a weight and style. */
	resolve(stack: string, weight: number, italic: boolean): ResolvedFont;
	/** A monospaced font for spacer runs, and its no-break space's advance in em. */
	spacer(): { advance: number; font: string };
	/** The font family new text in PowerPoint starts in: the deck's sans-serif font. */
	theme(): string | undefined;
}

export interface FontMetrics {
	/** Ascent above the baseline, in em, as browsers lay out lines. */
	ascent: number;
	/** Where PowerPoint puts a line's baseline, as a fraction of its line pitch. */
	baseline: number;
	/** Descent below the baseline, in em. */
	descent: number;
}

export interface ResolvedFont {
	bold: boolean;
	font: string;
}

/** A face a family can use: an `@font-face` rule, or an installed font file. */
interface Face {
	/** The face within a font collection file. */
	collectionIndex?: number;
	generic?: Generic;
	italic: boolean;
	load: () => Promise<Buffer | undefined>;
	/** The family name to register it under for layout. */
	name: string;
	/** Inclusive code point ranges, from `unicode-range`. */
	unicodeRange?: [number, number][];
	/** The face's weight range; a variable font's spans its axis. */
	weight: [number, number];
}

type Generic = NonNullable<Extract<TakumiFont, { data: unknown }>["generic"]>;

/** An installed font face, from its file's name and OS/2 tables. */
interface InstalledFace {
	family: string;
	file: string;
	index: number;
	italic: boolean;
	preferredFamily?: string;
	weight: number;
}

interface LoadedFace {
	data: Buffer;
	face: Face;
	font: fontkit.Font;
}

/** Installed fonts to use for generic families, in order of preference. */
const GENERICS: Partial<Record<string, string[]>> = {
	cursive: ["Apple Chancery", "Comic Sans MS", "URW Chancery L"],
	emoji: ["Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"],
	fantasy: ["Papyrus", "Impact"],
	math: ["STIX Two Math", "Cambria Math", "DejaVu Math TeX Gyre"],
	// Chrome renders ui-monospace with SF Mono on macOS, which apps can't use; Menlo shares its advance.
	monospace: [
		"Menlo",
		"Consolas",
		"DejaVu Sans Mono",
		"Liberation Mono",
		"Courier New",
	],
	"sans-serif": ["Helvetica", "Arial", "DejaVu Sans", "Liberation Sans"],
	serif: ["Times", "Times New Roman", "DejaVu Serif", "Liberation Serif"],
	"system-ui": ["Helvetica Neue", "Segoe UI", "Ubuntu", "DejaVu Sans"],
};
GENERICS["ui-monospace"] = GENERICS.monospace;
GENERICS["ui-sans-serif"] = GENERICS["sans-serif"];
GENERICS["ui-serif"] = GENERICS.serif;
GENERICS["ui-rounded"] = GENERICS["system-ui"];

/**
 * Baselines measured in PowerPoint, as fractions of line pitch. Others are estimated from
 * their OS/2 typographic ascent ratio, by a line fit to these (within 0.005 of each).
 */
const MEASURED_BASELINES: [RegExp, number][] = [
	[/^impact\b/i, 0.782],
	[/^league spartan\b/i, 0.753],
	[/^menlo\b/i, 0.745],
];

/** Metrics for fonts with no file: Menlo's ascent and descent, and League Spartan's PowerPoint baseline. */
const DEFAULT_METRICS: FontMetrics = {
	ascent: 0.928,
	baseline: 0.753,
	descent: 0.236,
};

const WEIGHT_NAMES: Partial<Record<number, string>> = {
	100: "Thin",
	200: "ExtraLight",
	300: "Light",
	400: "Regular",
	500: "Medium",
	600: "SemiBold",
	700: "Bold",
	800: "ExtraBold",
	900: "Black",
};

const WEIGHT_SUFFIX =
	/\s+(?:Thin|Hairline|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy)$/i;

/** Finds the fonts a deck uses, from its stylesheets, its Slidev font options, and installed fonts. */
export function createFontBook({
	assets,
	fonts: options,
	sheets,
}: {
	assets: Assets;
	fonts?: Partial<ResolvedFontOptions>;
	sheets: string[];
}): FontBook {
	const faces = new Map<string, Face[]>();
	const addFaces = (css: string) => {
		for (const face of fontFaces(css, assets)) {
			const key = face.name.toLowerCase();
			faces.set(key, [...(faces.get(key) ?? []), face]);
		}
	};

	sheets.forEach(addFaces);
	let webFonts: Promise<void> | undefined;

	const loaded = new Map<Face, Promise<LoadedFace | undefined>>();
	const ready = new Map<Face, LoadedFace | undefined>();
	const loadFace = (face: Face) => {
		let promise = loaded.get(face);
		if (!promise) {
			promise = face.load().then((data) => {
				const result = data && openFace(data, face);
				ready.set(face, result);
				return result;
			});
			loaded.set(face, promise);
		}

		return promise;
	};

	/** A family's faces: its `@font-face` rules, else an installed or generic family's. */
	const families = new Map<string, Face[]>();
	const familyFaces = (family: string): Face[] => {
		const key = family.toLowerCase();
		const declared = faces.get(key);
		if (declared) {
			return declared;
		}

		let list = families.get(key);
		if (!list) {
			const generic = GENERICS[key];
			list = generic
				? (generic
						.map((name) => installedFaces(name, key as Generic))
						.find((found) => found.length) ?? [])
				: installedFaces(family);
			families.set(key, list);
		}

		return list;
	};

	const usable = (face: Face) => ready.get(face) !== undefined;
	/** A stack's first family with faces that loaded. */
	const familyOf = (stack: string) => {
		for (const family of splitStack(stack)) {
			const list = familyFaces(family).filter(usable);
			if (list.length) {
				return list;
			}
		}

		return undefined;
	};

	const nameOf = new Map<string, LoadedFace[]>();
	const registered = new Set<Face>();
	const metricsCache = new Map<string, FontMetrics>();

	const resolve = (
		stack: string,
		weight: number,
		italic: boolean,
	): ResolvedFont & { face?: LoadedFace } => {
		const family = familyOf(stack);
		const face = family && pickFace(family, weight, italic, ready);
		if (!face) {
			const first = splitStack(stack)[0] ?? "";
			return { bold: weight >= 600, font: first };
		}

		const named = powerPointName(face.font, weight);
		const list = nameOf.get(named.font) ?? [];
		if (!list.includes(face)) {
			// Every subset of the family counts toward the PowerPoint font's coverage.
			nameOf.set(named.font, [
				...list,
				...family.flatMap((f) => {
					const loadedFace = ready.get(f);
					return loadedFace && !list.includes(loadedFace) ? [loadedFace] : [];
				}),
			]);
		}

		return { ...named, face };
	};

	return {
		covers(font, codePoint) {
			const list = nameOf.get(font);
			return list?.length
				? list.some(({ font: f }) => f.hasGlyphForCodePoint(codePoint))
				: undefined;
		},
		async load(stacks) {
			const webfonts = options?.webfonts ?? [];
			if (webfonts.length && options?.provider && options.provider !== "none") {
				webFonts ??= loadWebFonts(options, assets).then(addFaces);
				await webFonts;
			}

			// The deck's sans and mono fonts first, then others as they're first used, then emoji.
			const used: Face[][] = [];
			const texts = [...stacks];
			for (const stack of [
				options?.sans?.join(","),
				options?.mono?.join(","),
				...texts,
				// Spacer runs use a monospaced font.
				"monospace",
				"emoji",
			]) {
				if (stack === undefined) {
					continue;
				}

				for (const family of splitStack(stack)) {
					const list = familyFaces(family);
					await Promise.all(list.map(loadFace));
					const working = list.filter(usable);
					if (working.length) {
						if (!used.includes(list)) {
							used.push(list);
						}

						break;
					}
				}
			}

			const wanted = new Set(
				[...texts, "emoji"].flatMap((stack) => familyOf(stack) ?? []),
			);
			const fonts: TakumiFont[] = [];
			for (const face of used.flat()) {
				const result = ready.get(face);
				if (!result || !wanted.has(face) || registered.has(face)) {
					continue;
				}

				registered.add(face);
				fonts.push({
					data: result.data,
					generic: face.generic,
					name: face.name,
					style: face.italic ? "italic" : undefined,
					unicodeRange: face.unicodeRange,
					weight:
						face.weight[0] === face.weight[1] ? face.weight[0] : undefined,
				});
			}

			return fonts;
		},
		metrics(font) {
			let metrics = metricsCache.get(font);
			if (!metrics) {
				const face = nameOf.get(font)?.find((f) => covers(f.face, 0x61));
				metrics = face ? metricsOf(face.font, font) : DEFAULT_METRICS;
				metricsCache.set(font, metrics);
			}

			return metrics;
		},
		resolve: (stack, weight, italic) => {
			const { bold, font } = resolve(stack, weight, italic);
			return { bold, font };
		},
		spacer() {
			const { face, font } = resolve("monospace", 400, false);
			const glyph = face?.font.glyphForCodePoint(0xa0);
			return face && glyph
				? { advance: glyph.advanceWidth / face.font.unitsPerEm, font }
				: { advance: 0.6, font: "Courier New" };
		},
		theme() {
			const stack = options?.sans?.join(",");
			if (!stack) {
				return undefined;
			}

			const { face, font } = resolve(stack, 400, false);
			return face ? familyName(face.font) : font || undefined;
		},
	};
}

const covers = (face: Face, codePoint: number) =>
	!face.unicodeRange ||
	face.unicodeRange.some(
		([low, high]) => codePoint >= low && codePoint <= high,
	);

/** The family name a font file gives, without a variable font's default instance's weight. */
function familyName(font: fontkit.Font) {
	return (
		font.getName("preferredFamily", "en") ??
		font.familyName.replace(WEIGHT_SUFFIX, "")
	);
}

/** Parses `@font-face` rules into faces that load their first supported source. */
function fontFaces(css: string, assets: Assets): Face[] {
	const out: Face[] = [];
	for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
		const declarations = new Map<string, string>();
		for (const declaration of splitTopLevel(body, ";")) {
			const colon = declaration.indexOf(":");
			if (colon > 0) {
				declarations.set(
					declaration.slice(0, colon).trim().toLowerCase(),
					declaration.slice(colon + 1).trim(),
				);
			}
		}

		const name = unquote(declarations.get("font-family") ?? "");
		const sources = splitTopLevel(declarations.get("src") ?? "", ",").flatMap(
			(source): ({ local: string } | { url: string })[] => {
				const local = /^local\(([^)]*)\)$/i.exec(source);
				if (local) {
					return [{ local: unquote(local[1]) }];
				}

				const url = /url\(([^)]*)\)/i.exec(source)?.[1];
				const format = /format\(([^)]*)\)/i.exec(source)?.[1] ?? "";
				return url && !/embedded-opentype|svg/i.test(format)
					? [{ url: unquote(url) }]
					: [];
			},
		);
		if (!name || !sources.length) {
			continue;
		}

		const weights = (declarations.get("font-weight") ?? "400")
			.split(/\s+/)
			.map((value) =>
				value === "bold" ? 700 : value === "normal" ? 400 : Number(value),
			)
			.filter((value) => Number.isFinite(value));
		out.push({
			italic: /italic|oblique/i.test(declarations.get("font-style") ?? ""),
			async load() {
				for (const source of sources) {
					if ("local" in source) {
						const installed = installedFaces(source.local)[0] as
							Face | undefined;
						const data = await installed?.load();
						if (data) {
							return data;
						}
					} else {
						const data = await assets.load(source.url);
						if (data) {
							return data;
						}
					}
				}

				return undefined;
			},
			name,
			unicodeRange: parseUnicodeRange(declarations.get("unicode-range")),
			weight: [weights[0] ?? 400, weights.at(-1) ?? 400],
		});
	}

	return out;
}

let installed: Map<string, InstalledFace[]> | undefined;

/** Installed faces of a family, by its typographic or legacy family name. */
function installedFaces(family: string, generic?: Generic): Face[] {
	installed ??= scanInstalledFonts();
	const list = installed.get(family.toLowerCase()) ?? [];
	const byFile = new Map<string, InstalledFace[]>();
	for (const face of list) {
		byFile.set(face.file, [...(byFile.get(face.file) ?? []), face]);
	}

	// One face per file: layout registers whole files (collections hold every style).
	return [...byFile.values()].map((faces) => {
		const regular =
			faces.find((face) => !face.italic && face.weight === 400) ?? faces[0];
		return {
			collectionIndex: regular.index,
			generic,
			italic: regular.italic,
			load: () => Promise.resolve(fs.readFileSync(regular.file)),
			name: family,
			weight: [
				Math.min(...faces.map((face) => face.weight)),
				Math.max(...faces.map((face) => face.weight)),
			],
		};
	});
}

/** Loads Slidev's web font stylesheet (Google Fonts or coollabs) and returns its CSS. */
async function loadWebFonts(
	options: Partial<ResolvedFontOptions>,
	assets: Assets,
) {
	const weights = (options.weights ?? ["200", "400", "600"])
		.flatMap((weight) =>
			options.italic ? [`0,${weight}`, `1,${weight}`] : [weight],
		)
		.sort()
		.join(";");
	const query = (options.webfonts ?? [])
		.map(
			(family) =>
				`family=${unquote(family).replace(/\s+/g, "+")}:${options.italic ? "ital," : ""}wght@${weights}`,
		)
		.join("&");
	const url =
		options.provider === "coollabs"
			? `https://api.fonts.coollabs.io/fonts?${query}&display=swap`
			: `https://fonts.googleapis.com/css2?${query}&display=swap`;
	return (await assets.load(url))?.toString("utf8") ?? "";
}

/** Line metrics from a font file: the ascent and descent browsers lay lines out with, and PowerPoint's baseline. */
function metricsOf(font: fontkit.Font, name: string): FontMetrics {
	const os2 = font["OS/2"] as
		| undefined
		| {
				fsSelection?: { useTypoMetrics?: boolean };
				typoAscender: number;
				typoDescender: number;
		  };
	const em = font.unitsPerEm;
	const typo = os2?.fsSelection?.useTypoMetrics ? os2 : undefined;
	const ascent = (typo ? typo.typoAscender : font.ascent) / em;
	const descent = -(typo ? typo.typoDescender : font.descent) / em;
	const measured = MEASURED_BASELINES.find(([pattern]) => pattern.test(name));
	const typoRatio =
		os2 && os2.typoAscender - os2.typoDescender > 0
			? os2.typoAscender / (os2.typoAscender - os2.typoDescender)
			: ascent / (ascent + descent);
	return {
		ascent,
		baseline: measured?.[1] ?? 0.532 + 0.2855 * typoRatio,
		descent,
	};
}

/** Opens a face's file, choosing its face within a collection. */
function openFace(data: Buffer, face: Face): LoadedFace | undefined {
	try {
		const opened = fontkit.create(data);
		const font =
			"fonts" in opened ? opened.fonts[face.collectionIndex ?? 0] : opened;
		return { data, face, font };
	} catch {
		return undefined;
	}
}

function parseUnicodeRange(value: string | undefined) {
	if (!value) {
		return undefined;
	}

	return value.split(",").flatMap((part): [number, number][] => {
		const match = /U\+([\da-f?]+)(?:-([\da-f]+))?/i.exec(part.trim());
		if (!match) {
			return [];
		}

		const start = match[1];
		const end = match.at(2);
		return [
			[
				parseInt(start.replace(/\?/g, "0"), 16),
				parseInt(end ?? start.replace(/\?/g, "f"), 16),
			],
		];
	});
}

/** The face of a family CSS font matching picks for a weight and style. */
function pickFace(
	family: Face[],
	weight: number,
	italic: boolean,
	ready: Map<Face, LoadedFace | undefined>,
): LoadedFace | undefined {
	const styled = family.filter((face) => face.italic === italic);
	const candidates = (styled.length ? styled : family).filter(
		(face) => ready.get(face) && covers(face, 0x61),
	);
	const pool = candidates.length
		? candidates
		: family.filter((face) => ready.get(face));
	// Closest weight, preferring heavier faces above 500 and lighter ones below 400.
	const distance = ([low, high]: [number, number]) => {
		if (weight >= low && weight <= high) {
			return 0;
		}

		const nearest = weight < low ? low : high;
		const heavier = nearest > weight;
		const preferred =
			weight > 500
				? heavier
				: weight < 400
					? !heavier
					: heavier && nearest <= 500;
		return Math.abs(nearest - weight) + (preferred ? 0 : 1000);
	};

	const best = pool
		.toSorted((a, b) => distance(a.weight) - distance(b.weight))
		.at(0);
	return best && ready.get(best);
}

/**
 * The name PowerPoint knows a face by. A variable font's named instances are separate
 * fonts to PowerPoint (like "League Spartan Light"); other faces use their family name,
 * emboldened when the text is bold and the face isn't already.
 */
function powerPointName(font: fontkit.Font, weight: number): ResolvedFont {
	const axis = font.variationAxes.wght;
	if (axis) {
		const clamped = Math.min(axis.max, Math.max(axis.min, weight));
		// fontkit has named instances, but its types don't list them.
		const { namedVariations } = font as fontkit.Font & {
			namedVariations: Record<string, Partial<Record<string, number>>>;
		};
		const instances = Object.entries(namedVariations)
			.filter(([, settings]) => settings.wght !== undefined)
			.sort(
				([, a], [, b]) =>
					Math.abs((a.wght ?? 0) - clamped) - Math.abs((b.wght ?? 0) - clamped),
			);
		const instance =
			instances[0]?.[0] ?? WEIGHT_NAMES[Math.round(clamped / 100) * 100];
		const family = familyName(font);
		return {
			bold: false,
			font:
				instance && !/^(?:regular|normal)$/i.test(instance)
					? `${family} ${instance}`
					: family,
		};
	}

	const os2 = font["OS/2"] as undefined | { usWeightClass?: number };
	const standardStyle = /^(?:regular|bold|italic|bold italic)$/i.test(
		font.subfamilyName,
	);
	return {
		bold: weight >= 600 && (standardStyle || (os2?.usWeightClass ?? 400) < 600),
		font: font.familyName,
	};
}

/** Directories fonts are installed in, by platform. */
function fontDirectories() {
	const home = os.homedir();
	switch (process.platform) {
		case "darwin":
			return [
				"/System/Library/Fonts",
				"/Library/Fonts",
				path.join(home, "Library/Fonts"),
			];
		case "win32":
			return [
				path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts"),
				path.join(
					process.env.LOCALAPPDATA ?? path.join(home, "AppData/Local"),
					"Microsoft/Windows/Fonts",
				),
			];
		default:
			return [
				"/usr/share/fonts",
				"/usr/local/share/fonts",
				path.join(home, ".local/share/fonts"),
				path.join(home, ".fonts"),
			];
	}
}

/** Indexes installed fonts by family name, reading only each file's name and OS/2 tables. */
function scanInstalledFonts() {
	const index = new Map<string, InstalledFace[]>();
	const visit = (directory: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(file);
			} else if (/\.(?:ttf|otf|ttc|otc)$/i.test(entry.name)) {
				for (const face of readFaces(file)) {
					for (const name of new Set([face.family, face.preferredFamily])) {
						if (name) {
							const key = name.toLowerCase();
							index.set(key, [...(index.get(key) ?? []), face]);
						}
					}
				}
			}
		}
	};

	fontDirectories().forEach(visit);
	return index;
}

/** Reads each face's family names, weight, and italic flag from a TrueType or OpenType file. */
function readFaces(file: string): InstalledFace[] {
	let fd: number | undefined;
	try {
		fd = fs.openSync(file, "r");
		const handle = fd;
		const read = (offset: number, length: number) => {
			const buffer = Buffer.alloc(length);
			fs.readSync(handle, buffer, 0, length, offset);
			return buffer;
		};

		const header = read(0, 12);
		const collection = header.toString("latin1", 0, 4) === "ttcf";
		const count = collection ? header.readUInt32BE(8) : 1;
		const directory = collection ? read(12, 4 * count) : undefined;
		const offsets = Array.from({ length: count }, (_, i) =>
			directory ? directory.readUInt32BE(i * 4) : 0,
		);
		return offsets.flatMap((offset, index) => {
			const tables = new Map<string, { length: number; offset: number }>();
			const tableCount = read(offset + 4, 2).readUInt16BE(0);
			const records = read(offset + 12, tableCount * 16);
			for (let i = 0; i < tableCount; i++) {
				tables.set(records.toString("latin1", i * 16, i * 16 + 4), {
					length: records.readUInt32BE(i * 16 + 12),
					offset: records.readUInt32BE(i * 16 + 8),
				});
			}

			const nameTable = tables.get("name");
			if (!nameTable) {
				return [];
			}

			const names = readNames(read(nameTable.offset, nameTable.length));
			const os2Table = tables.get("OS/2");
			const os2 =
				os2Table && read(os2Table.offset, Math.min(os2Table.length, 64));
			const family = names.get(1);
			if (!family) {
				return [];
			}

			return [
				{
					family,
					file,
					index,
					italic:
						os2 && os2.length >= 64
							? (os2.readUInt16BE(62) & 1) === 1
							: /italic|oblique/i.test(names.get(2) ?? ""),
					preferredFamily: names.get(16),
					weight: os2 && os2.length >= 6 ? os2.readUInt16BE(4) : 400,
				},
			];
		});
	} catch {
		return [];
	} finally {
		if (fd !== undefined) {
			fs.closeSync(fd);
		}
	}
}

/** Reads English names from a name table, by name ID. */
function readNames(table: Buffer) {
	const names = new Map<number, string>();
	const count = table.readUInt16BE(2);
	const storage = table.readUInt16BE(4);
	const rank = (platform: number, language: number) =>
		platform === 3 && language === 0x409
			? 2
			: platform === 1 && language === 0
				? 1
				: 0;
	const best = new Map<number, number>();
	for (let i = 0; i < count; i++) {
		const at = 6 + i * 12;
		const platform = table.readUInt16BE(at);
		const language = table.readUInt16BE(at + 4);
		const id = table.readUInt16BE(at + 6);
		const length = table.readUInt16BE(at + 8);
		const offset = storage + table.readUInt16BE(at + 10);
		const score = rank(platform, language);
		if (
			!score ||
			score <= (best.get(id) ?? 0) ||
			offset + length > table.length
		) {
			continue;
		}

		const bytes = table.subarray(offset, offset + length);
		names.set(
			id,
			platform === 3
				? Buffer.from(bytes).swap16().toString("utf16le")
				: bytes.toString("latin1"),
		);
		best.set(id, score);
	}

	return names;
}

/** A font-family stack's family names, unquoted. */
function splitStack(stack: string) {
	return splitTopLevel(stack, ",").map(unquote).filter(Boolean);
}

function splitTopLevel(value: string, separator: string) {
	const out: string[] = [];
	let depth = 0;
	let quote = "";
	let current = "";
	for (const ch of value) {
		if (quote) {
			quote = ch === quote ? "" : quote;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			depth--;
		} else if (ch === separator && depth === 0) {
			out.push(current.trim());
			current = "";
			continue;
		}

		current += ch;
	}

	if (current.trim()) {
		out.push(current.trim());
	}

	return out;
}

const unquote = (value: string) =>
	value
		.trim()
		.replace(/^(["'])(.*)\1$/s, "$2")
		.trim();
