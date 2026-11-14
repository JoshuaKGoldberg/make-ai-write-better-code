/**
 * Finds the fonts a deck's text uses, as a browser would: the deck's `@font-face` rules
 * (including Slidev's web fonts), then installed fonts by family name, then installed
 * fonts for generic families. Each font's file gives layout its glyphs, extraction and
 * writing their metrics, and PowerPoint the font's real name.
 */
import type { ResolvedFontOptions } from "@slidev/types";
import type { Font as TakumiFont } from "@takumi-rs/core";

import * as csstree from "css-tree";
import * as fontkit from "fontkit";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Assets } from "./assets.ts";
import type { Declaration } from "./css.ts";

import { createCache, cssUrls } from "./assets.ts";
import { declarationsOf, splitTopLevel, unquote } from "./css.ts";

export interface FontBook {
	/** Whether a PowerPoint font has a glyph for a character, or undefined if its coverage is unknown. */
	covers(font: string, codePoint: number): boolean | undefined;
	/** Loads the fonts for text in these font-family stacks, returning those not yet loaded, in registration order. */
	load(stacks: Iterable<string>): Promise<TakumiFont[]>;
	/** Line metrics for a PowerPoint font, from its file when it's loaded. */
	metrics(font: string): FontMetrics;
	/** The PowerPoint font (and whether to embolden it) for text in a stack at a weight and style. */
	resolve(stack: string, weight: number, italic: boolean): ResolvedFont;
	/** A monospaced font for spacer runs, and its no-break space's advance in em. */
	spacer(): { advance: number; font: string };
	/** The font family new text in PowerPoint starts in: the deck's sans-serif font. */
	theme(): string | undefined;
}

interface FontMetrics {
	/** Ascent above the baseline, in em, as browsers lay out lines. */
	ascent: number;
	/** Where PowerPoint puts a line's baseline, as a fraction of its line pitch. */
	baseline: number;
	/** Descent below the baseline, in em. */
	descent: number;
}

interface ResolvedFont {
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
	/** The PowerPoint fonts the face can be, across weights. */
	names: Set<string>;
}

// Chrome renders ui-monospace with SF Mono on macOS, which apps can't use; Menlo shares its advance.
const MONOSPACE = [
	"Menlo",
	"Consolas",
	"DejaVu Sans Mono",
	"Liberation Mono",
	"Courier New",
];
const SANS_SERIF = ["Helvetica", "Arial", "DejaVu Sans", "Liberation Sans"];
const SERIF = ["Times", "Times New Roman", "DejaVu Serif", "Liberation Serif"];
const SYSTEM_UI = ["Helvetica Neue", "Segoe UI", "Ubuntu", "DejaVu Sans"];

/** Installed fonts to use for generic families, in order of preference. */
const GENERICS: Partial<Record<Generic, string[]>> = {
	cursive: ["Apple Chancery", "Comic Sans MS", "URW Chancery L"],
	emoji: ["Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"],
	fantasy: ["Papyrus", "Impact"],
	math: ["STIX Two Math", "Cambria Math", "DejaVu Math TeX Gyre"],
	monospace: MONOSPACE,
	"sans-serif": SANS_SERIF,
	serif: SERIF,
	"system-ui": SYSTEM_UI,
	"ui-monospace": MONOSPACE,
	"ui-rounded": SYSTEM_UI,
	"ui-sans-serif": SANS_SERIF,
	"ui-serif": SERIF,
};

const MENLO_BASELINE = 0.745;

/**
 * Baselines measured in PowerPoint, as fractions of line pitch. Others are estimated from
 * their OS/2 typographic ascent ratio, by a line fit to these (within 0.005 of each).
 */
const MEASURED_BASELINES: [RegExp, number][] = [
	[/^impact\b/i, 0.782],
	[/^league spartan\b/i, 0.753],
	[/^menlo\b/i, MENLO_BASELINE],
];

/** Menlo's metrics, for fonts with no loaded file. */
const DEFAULT_METRICS: FontMetrics = {
	ascent: 0.928,
	baseline: MENLO_BASELINE,
	descent: 0.236,
};

const LATIN_SMALL_A = 0x61;

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

const isGeneric = (family: string): family is Generic =>
	Object.hasOwn(GENERICS, family);

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
	const imported = new Set<string>();
	const addSheet = async (css: string, base?: string) => {
		const sheet = readSheet(css, assets, base);
		for (const face of sheet.faces) {
			const key = face.name.toLowerCase();
			faces.set(key, [...(faces.get(key) ?? []), face]);
		}

		for (const url of sheet.imports.filter((url) => !imported.has(url))) {
			imported.add(url);
			const text = (await assets.load(url))?.toString("utf8");
			if (text !== undefined) {
				await addSheet(text, url);
			}
		}
	};

	let sheetsAdded: Promise<void> | undefined;
	const addSheets = async () => {
		for (const sheet of sheets) {
			await addSheet(sheet);
		}

		if (
			options?.webfonts?.length &&
			options.provider &&
			options.provider !== "none"
		) {
			await addSheet(await loadWebFonts(options, assets));
		}
	};

	const opened: LoadedFace[] = [];
	const registered = new Set<Face>();
	const named = new Map<string, LoadedFace[]>();
	const loadedFaces = createCache((face: Face) =>
		face.load().then((data) => {
			const loaded = data && openFace(data, face);
			if (loaded) {
				opened.push(loaded);
				named.clear();
			}

			return loaded;
		}),
	);
	const usable = (face: Face) => loadedFaces.get(face) !== undefined;

	const families = new Map<string, Face[]>();
	const familyFaces = (family: string) => {
		const key = family.toLowerCase();
		const declared = faces.get(key);
		if (declared) {
			return declared;
		}

		let list = families.get(key);
		if (!list) {
			const generic = isGeneric(key) ? key : undefined;
			const fallbacks = generic && GENERICS[generic];
			list = fallbacks
				? (fallbacks
						.map((name) => installedFaces(name, generic))
						.find((found) => found.length) ?? [])
				: installedFaces(family);
			families.set(key, list);
		}

		return list;
	};

	const familyOf = (stack: string) =>
		splitStack(stack)
			.map((family) => familyFaces(family).filter(usable))
			.find((list) => list.length);

	const facesNamed = (font: string) => {
		let list = named.get(font);
		if (!list) {
			list = opened.filter((loaded) => loaded.names.has(font));
			named.set(font, list);
		}

		return list;
	};

	const resolve = (
		stack: string,
		weight: number,
		italic: boolean,
	): ResolvedFont & { face?: LoadedFace } => {
		const family = familyOf(stack);
		const face = family && pickFace(family, weight, italic, loadedFaces.get);
		return face
			? { ...powerPointName(face.font, weight), face }
			: { bold: weight >= 600, font: splitStack(stack)[0] ?? "" };
	};

	return {
		covers(font, codePoint) {
			const list = facesNamed(font);
			return list.length
				? list.some((loaded) => loaded.font.hasGlyphForCodePoint(codePoint))
				: undefined;
		},
		async load(stacks) {
			sheetsAdded ??= addSheets();
			await sheetsAdded;

			const used: Face[][] = [];
			const texts = [...stacks];
			const candidates = [
				options?.sans?.join(","),
				options?.mono?.join(","),
				...texts,
				"monospace",
				"emoji",
			].filter((stack) => stack !== undefined);
			for (const stack of candidates) {
				for (const family of splitStack(stack)) {
					const list = familyFaces(family);
					await Promise.all(list.map(loadedFaces.load));
					if (list.some(usable)) {
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
			return used.flat().flatMap((face): TakumiFont[] => {
				const loaded = loadedFaces.get(face);
				if (!loaded || !wanted.has(face) || registered.has(face)) {
					return [];
				}

				registered.add(face);
				return [
					{
						data: loaded.data,
						generic: face.generic,
						name: face.name,
						style: face.italic ? "italic" : undefined,
						unicodeRange: face.unicodeRange,
						weight:
							face.weight[0] === face.weight[1] ? face.weight[0] : undefined,
					},
				];
			});
		},
		metrics(font) {
			const loaded = facesNamed(font).find(({ face }) =>
				inUnicodeRange(face, LATIN_SMALL_A),
			);
			return loaded ? metricsOf(loaded.font, font) : DEFAULT_METRICS;
		},
		resolve(stack, weight, italic) {
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

/** The family name a font file gives, without a variable font's default instance's weight. */
function familyName(font: fontkit.Font) {
	return (
		font.getName("preferredFamily", "en") ??
		font.familyName.replace(WEIGHT_SUFFIX, "")
	);
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

/** An `@font-face` rule's face, which loads its first supported source. */
function fontFace(
	declarations: Declaration[],
	assets: Assets,
	base: string | undefined,
): Face | undefined {
	const value = (property: string) =>
		declarations.findLast((declaration) => declaration.property === property)
			?.value;
	const name = unquote(value("font-family") ?? "");
	const sources = splitTopLevel(value("src") ?? "", ",").flatMap(
		(source): ({ local: string } | { url: string })[] => {
			const local = /^local\(([^)]*)\)$/i.exec(source);
			if (local) {
				return [{ local: unquote(local[1]) }];
			}

			const url = cssUrls(source).at(0);
			const format = /format\(([^)]*)\)/i.exec(source)?.[1] ?? "";
			return url && !/embedded-opentype|svg/i.test(format)
				? [{ url: base ? new URL(url, base).href : url }]
				: [];
		},
	);
	if (!name || !sources.length) {
		return undefined;
	}

	const weights = splitTopLevel(value("font-weight") ?? "400", " ")
		.map((weight) =>
			weight === "bold" ? 700 : weight === "normal" ? 400 : Number(weight),
		)
		.filter((weight) => Number.isFinite(weight));
	return {
		italic: /italic|oblique/i.test(value("font-style") ?? ""),
		async load() {
			for (const source of sources) {
				const data = await ("local" in source
					? installedFaces(source.local).at(0)?.load()
					: assets.load(source.url));
				if (data) {
					return data;
				}
			}

			return undefined;
		},
		name,
		unicodeRange: parseUnicodeRange(value("unicode-range")),
		weight: [weights[0] ?? 400, weights.at(-1) ?? 400],
	};
}

function inUnicodeRange(face: Face, codePoint: number) {
	return (
		!face.unicodeRange ||
		face.unicodeRange.some(
			([low, high]) => codePoint >= low && codePoint <= high,
		)
	);
}

let installed: Map<string, InstalledFace[]> | undefined;

/** Installed faces of a family, by its typographic or legacy family name: one per file, since layout registers whole files. */
function installedFaces(family: string, generic?: Generic): Face[] {
	installed ??= scanInstalledFonts();
	const byFile = new Map<string, InstalledFace[]>();
	for (const face of installed.get(family.toLowerCase()) ?? []) {
		byFile.set(face.file, [...(byFile.get(face.file) ?? []), face]);
	}

	return [...byFile.values()].map((faces) => {
		const regular =
			faces.find((face) => !face.italic && face.weight === 400) ?? faces[0];
		return {
			collectionIndex: regular.index,
			generic,
			italic: regular.italic,
			load: () => fs.promises.readFile(regular.file),
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
	const windowsMetrics = windowsMetricsOf(font);
	const typographic = windowsMetrics?.fsSelection.useTypoMetrics
		? windowsMetrics
		: undefined;
	const ascent =
		(typographic ? typographic.typoAscender : font.ascent) / font.unitsPerEm;
	const descent =
		-(typographic ? typographic.typoDescender : font.descent) / font.unitsPerEm;
	const measured = MEASURED_BASELINES.find(([pattern]) => pattern.test(name));
	const typoRatio =
		windowsMetrics &&
		windowsMetrics.typoAscender - windowsMetrics.typoDescender > 0
			? windowsMetrics.typoAscender /
				(windowsMetrics.typoAscender - windowsMetrics.typoDescender)
			: ascent / (ascent + descent);
	return {
		ascent,
		baseline: measured?.[1] ?? 0.532 + 0.2855 * typoRatio,
		descent,
	};
}

/** Opens a face's file, choosing its face within a collection. */
function openFace(data: Buffer, face: Face): LoadedFace | undefined {
	let font: fontkit.Font;
	try {
		const opened = fontkit.create(data);
		font = "fonts" in opened ? opened.fonts[face.collectionIndex ?? 0] : opened;
	} catch {
		return undefined;
	}

	return {
		data,
		face,
		font,
		names: new Set(
			Object.keys(WEIGHT_NAMES).map(
				(weight) => powerPointName(font, Number(weight)).font,
			),
		),
	};
}

function parseUnicodeRange(value: string | undefined) {
	return value?.split(",").flatMap((part): [number, number][] => {
		const match = /U\+([\da-f?]+)(?:-([\da-f]+))?/i.exec(part.trim());
		if (!match) {
			return [];
		}

		const start = match[1];
		return [
			[
				parseInt(start.replace(/\?/g, "0"), 16),
				parseInt(match.at(2) ?? start.replace(/\?/g, "f"), 16),
			],
		];
	});
}

/**
 * The face of a family CSS font matching picks for a weight and style: the closest weight,
 * trying heavier faces first above 500, lighter faces first below 400, and in between,
 * faces up to 500, then lighter faces, then heavier ones.
 */
function pickFace(
	family: Face[],
	weight: number,
	italic: boolean,
	loaded: (face: Face) => LoadedFace | undefined,
) {
	const styled = family.filter((face) => face.italic === italic);
	const candidates = (styled.length ? styled : family).filter(
		(face) => loaded(face) && inUnicodeRange(face, LATIN_SMALL_A),
	);
	const pool = candidates.length ? candidates : family.filter(loaded);
	const rank = ([low, high]: [number, number]) => {
		if (weight >= low && weight <= high) {
			return 0;
		}

		const nearest = weight < low ? low : high;
		const heavier = nearest > weight;
		const tier =
			weight > 500
				? heavier
					? 0
					: 1
				: weight < 400
					? heavier
						? 1
						: 0
					: !heavier
						? 1
						: nearest <= 500
							? 0
							: 2;
		return tier * 1000 + Math.abs(nearest - weight);
	};

	const best = pool
		.toSorted((first, second) => rank(first.weight) - rank(second.weight))
		.at(0);
	return best && loaded(best);
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
		const instance =
			Object.entries(namedVariations)
				.filter(([, settings]) => settings.wght !== undefined)
				.sort(
					([, first], [, second]) =>
						Math.abs((first.wght ?? 0) - clamped) -
						Math.abs((second.wght ?? 0) - clamped),
				)
				.at(0)?.[0] ?? WEIGHT_NAMES[Math.round(clamped / 100) * 100];
		const family = familyName(font);
		return {
			bold: false,
			font:
				instance && !/^(?:regular|normal)$/i.test(instance)
					? `${family} ${instance}`
					: family,
		};
	}

	const windowsMetrics = windowsMetricsOf(font);
	const standardStyle = /^(?:regular|bold|italic|bold italic)$/i.test(
		font.subfamilyName,
	);
	return {
		bold:
			weight >= 600 &&
			(standardStyle || (windowsMetrics?.usWeightClass ?? 400) < 600),
		font: font.familyName,
	};
}

/** Reads each face's family names, weight, and italic flag from a TrueType or OpenType file. */
function readFaces(file: string): InstalledFace[] {
	let descriptor: number | undefined;
	try {
		descriptor = fs.openSync(file, "r");
		const handle = descriptor;
		const read = (offset: number, length: number) => {
			const buffer = Buffer.alloc(length);
			fs.readSync(handle, buffer, 0, length, offset);
			return buffer;
		};

		const header = read(0, 12);
		const collection = header.toString("latin1", 0, 4) === "ttcf";
		const count = collection ? header.readUInt32BE(8) : 1;
		const directory = collection ? read(12, 4 * count) : undefined;
		const offsets = Array.from({ length: count }, (_, index) =>
			directory ? directory.readUInt32BE(index * 4) : 0,
		);
		return offsets.flatMap((offset, index) => {
			const tables = new Map<string, { length: number; offset: number }>();
			const tableCount = read(offset + 4, 2).readUInt16BE(0);
			const records = read(offset + 12, tableCount * 16);
			for (let record = 0; record < tableCount; record++) {
				tables.set(records.toString("latin1", record * 16, record * 16 + 4), {
					length: records.readUInt32BE(record * 16 + 12),
					offset: records.readUInt32BE(record * 16 + 8),
				});
			}

			const nameTable = tables.get("name");
			if (!nameTable) {
				return [];
			}

			const names = readNames(read(nameTable.offset, nameTable.length));
			const metricsTable = tables.get("OS/2");
			const windowsMetrics =
				metricsTable &&
				read(metricsTable.offset, Math.min(metricsTable.length, 64));
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
						windowsMetrics && windowsMetrics.length >= 64
							? (windowsMetrics.readUInt16BE(62) & 1) === 1
							: /italic|oblique/i.test(names.get(2) ?? ""),
					preferredFamily: names.get(16),
					weight:
						windowsMetrics && windowsMetrics.length >= 6
							? windowsMetrics.readUInt16BE(4)
							: 400,
				},
			];
		});
	} catch {
		return [];
	} finally {
		if (descriptor !== undefined) {
			fs.closeSync(descriptor);
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
	const utf16 = new TextDecoder("utf-16be");
	for (let record = 0; record < count; record++) {
		const at = 6 + record * 12;
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
			platform === 3 ? utf16.decode(bytes) : bytes.toString("latin1"),
		);
		best.set(id, score);
	}

	return names;
}

function readSheet(css: string, assets: Assets, base?: string) {
	const faces: Face[] = [];
	const imports: string[] = [];
	csstree.walk(
		csstree.parse(css, { parseCustomProperty: false, parseValue: false }),
		{
			enter(node) {
				const name = node.name.toLowerCase();
				const face =
					name === "font-face" && node.block
						? fontFace(declarationsOf(node.block.children), assets, base)
						: undefined;
				if (face) {
					faces.push(face);
				}

				const target =
					name === "import" && node.prelude?.type === "AtrulePrelude"
						? node.prelude.children.first
						: null;
				if (target?.type === "String" || target?.type === "Url") {
					imports.push(base ? new URL(target.value, base).href : target.value);
				}
			},
			visit: "Atrule",
		},
	);
	return { faces, imports };
}

/** Indexes installed fonts by family name, reading only each file's name and OS/2 tables. */
function scanInstalledFonts() {
	const index = new Map<string, InstalledFace[]>();
	for (const directory of fontDirectories()) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, {
				recursive: true,
				withFileTypes: true,
			});
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (!/\.(?:ttf|otf|ttc|otc)$/i.test(entry.name)) {
				continue;
			}

			for (const face of readFaces(path.join(entry.parentPath, entry.name))) {
				for (const name of new Set([face.family, face.preferredFamily])) {
					if (name) {
						const key = name.toLowerCase();
						index.set(key, [...(index.get(key) ?? []), face]);
					}
				}
			}
		}
	}

	return index;
}

/** A font-family stack's family names, unquoted. */
function splitStack(stack: string) {
	return splitTopLevel(stack, ",").map(unquote).filter(Boolean);
}

/** A font's OS/2 table, which some fonts lack, though fontkit's types say otherwise. */
function windowsMetricsOf(font: fontkit.Font): fontkit.Os2Table | undefined {
	return font["OS/2"];
}
