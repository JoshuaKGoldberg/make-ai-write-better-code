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
	/** Loads the fonts for text in these font-family stacks, returning those not yet loaded, in registration order. */
	load(stacks: Iterable<string>): Promise<TakumiFont[]>;
	/** Line metrics for a PowerPoint font, from its file when it's loaded. */
	metrics(font: string): FontMetrics;
	/** The families the deck's `fonts` options name as web or local fonts that no stylesheet, web font, or installed font provides. */
	missingFamilies(): Promise<string[]>;
	/** The PowerPoint font (and whether to embolden it) for text in a stack at a weight and style. */
	resolve(stack: string, weight: number, italic: boolean): ResolvedFont;
	/** A monospaced font for spacer runs, and its no-break space's advance in em. */
	spacer(): { advance: number; font: string };
}

interface Face {
	collectionIndex?: number;
	generic?: Generic;
	italic: boolean;
	load: () => Promise<Buffer | undefined>;
	name: string;
	unicodeRange?: [number, number][];
	weight: [number, number];
}

interface FontMetrics {
	/** Ascent above the baseline, in em, as browsers lay out lines. */
	ascent: number;
	/** Where PowerPoint puts a line's baseline, as a fraction of its line pitch. */
	baseline: number;
	/** Descent below the baseline, in em. */
	descent: number;
}

type Generic = NonNullable<Extract<TakumiFont, { data: unknown }>["generic"]>;

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
	names: Set<string>;
}

interface ResolvedFont {
	bold: boolean;
	font: string;
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
const BASELINE_FIT_INTERCEPT = 0.532;
const BASELINE_FIT_SLOPE = 0.2855;

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
	fonts: fontOptions,
	sheets,
}: {
	assets: Assets;
	fonts: ResolvedFontOptions;
	sheets: string[];
}): FontBook {
	const declaredFaces = new Map<string, Face[]>();
	const imported = new Set<string>();
	const addSheet = async (css: string, base?: string) => {
		const sheet = readSheet(css, assets, base);
		for (const face of sheet.faces) {
			const key = face.name.toLowerCase();
			declaredFaces.set(key, [...(declaredFaces.get(key) ?? []), face]);
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

		if (fontOptions.webfonts.length && fontOptions.provider !== "none") {
			await addSheet(await loadWebFonts(fontOptions, assets));
		}
	};

	const openedFaces: LoadedFace[] = [];
	const registered = new Set<Face>();
	const facesByFont = new Map<string, LoadedFace[]>();
	const loadedFaces = createCache((face: Face) =>
		face.load().then((data) => {
			const loaded = data && openFace(data, face);
			if (loaded) {
				openedFaces.push(loaded);
				facesByFont.clear();
			}

			return loaded;
		}),
	);
	const usable = (face: Face) => loadedFaces.get(face) !== undefined;

	const installedFamilies = new Map<string, Face[]>();
	const familyFaces = (family: string) => {
		const key = family.toLowerCase();
		const declared = declaredFaces.get(key);
		if (declared) {
			return declared;
		}

		let list = installedFamilies.get(key);
		if (!list) {
			const generic = isGeneric(key) ? key : undefined;
			const fallbacks = generic && GENERICS[generic];
			list = fallbacks
				? (fallbacks
						.map((name) => installedFaces(name, generic))
						.find((found) => found.length) ?? [])
				: installedFaces(family);
			installedFamilies.set(key, list);
		}

		return list;
	};

	const familyOf = (stack: string) =>
		splitStack(stack)
			.map((family) => familyFaces(family).filter(usable))
			.find((list) => list.length);

	const facesNamed = (font: string) => {
		let list = facesByFont.get(font);
		if (!list) {
			list = openedFaces.filter((loaded) => loaded.names.has(font));
			facesByFont.set(font, list);
		}

		return list;
	};

	const loadFamily = async (family: string) => {
		const list = familyFaces(family);
		await Promise.all(list.map(loadedFaces.load));
		return list;
	};

	const addSheetsOnce = async () => {
		sheetsAdded ??= addSheets();
		await sheetsAdded;
	};

	const resolve = (
		stack: string,
		weight: number,
		italic: boolean,
	): ResolvedFont & { face?: LoadedFace } => {
		const family = familyOf(stack);
		const face = family && pickFace(family, weight, italic, loadedFaces.get);
		const [first = ""] = splitStack(stack);
		return face
			? { ...powerPointName(face.font, weight), face }
			: {
					bold: weight >= 600,
					font: (isGeneric(first) ? GENERICS[first]?.[0] : undefined) ?? first,
				};
	};

	return {
		async load(stacks) {
			await addSheetsOnce();

			const used: Face[][] = [];
			const texts = [...stacks];
			const candidates = [
				fontOptions.sans.join(","),
				fontOptions.mono.join(","),
				...texts,
				"monospace",
				"emoji",
			];
			for (const stack of candidates) {
				for (const family of splitStack(stack)) {
					const list = await loadFamily(family);
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
		async missingFamilies() {
			await addSheetsOnce();

			const named = new Set(
				[...fontOptions.webfonts, ...fontOptions.local].map(unquote),
			);
			const missing: string[] = [];
			for (const family of named) {
				if (!(await loadFamily(family)).some(usable)) {
					missing.push(family);
				}
			}

			return missing;
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
	};
}

function familyName(font: fontkit.Font) {
	return (
		font.getName("preferredFamily", "en") ??
		font.familyName.replace(WEIGHT_SUFFIX, "")
	);
}

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

function fontFace(
	declarations: Declaration[],
	assets: Assets,
	base: string | undefined,
) {
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
				? [{ url: resolveUrl(url, base) }]
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
	} satisfies Face;
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

async function loadWebFonts(options: ResolvedFontOptions, assets: Assets) {
	const weights = options.weights
		.flatMap((weight) =>
			options.italic ? [`0,${weight}`, `1,${weight}`] : [weight],
		)
		.sort()
		.join(";");
	const query = options.webfonts
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

function metricsOf(font: fontkit.Font, name: string) {
	const windowsMetrics = windowsMetricsOf(font);
	const typographic = windowsMetrics?.fsSelection.useTypoMetrics
		? windowsMetrics
		: undefined;
	const ascent =
		(typographic ? typographic.typoAscender : font.ascent) / font.unitsPerEm;
	const descent =
		-(typographic ? typographic.typoDescender : font.descent) / font.unitsPerEm;
	const measured = MEASURED_BASELINES.find(([pattern]) => pattern.test(name));
	const typographicAscentRatio =
		windowsMetrics &&
		windowsMetrics.typoAscender - windowsMetrics.typoDescender > 0
			? windowsMetrics.typoAscender /
				(windowsMetrics.typoAscender - windowsMetrics.typoDescender)
			: ascent / (ascent + descent);
	return {
		ascent,
		baseline:
			measured?.[1] ??
			BASELINE_FIT_INTERCEPT + BASELINE_FIT_SLOPE * typographicAscentRatio,
		descent,
	} satisfies FontMetrics;
}

function openFace(data: Buffer, face: Face): LoadedFace | undefined {
	let font: fontkit.Font;
	try {
		const file = fontkit.create(data);
		font = "fonts" in file ? file.fonts[face.collectionIndex ?? 0] : file;
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
		return weightTier(weight, nearest) * 1000 + Math.abs(nearest - weight);
	};

	const best = pool
		.toSorted((first, second) => rank(first.weight) - rank(second.weight))
		.at(0);
	return best && loaded(best);
}

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

	return {
		bold:
			weight >= 600 &&
			(/^bold(?: italic)?$/i.test(font.subfamilyName) ||
				(windowsMetricsOf(font)?.usWeightClass ?? 400) < 600),
		font: font.familyName,
	};
}

function readFaces(file: string) {
	let descriptor: number | undefined;
	try {
		descriptor = fs.openSync(file, "r");
		return readFacesFrom(descriptor, file);
	} catch {
		return [];
	} finally {
		if (descriptor !== undefined) {
			fs.closeSync(descriptor);
		}
	}
}

function readFacesFrom(descriptor: number, file: string): InstalledFace[] {
	const read = (offset: number, length: number) => {
		const buffer = Buffer.alloc(length);
		fs.readSync(descriptor, buffer, 0, length, offset);
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
}

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
		const recordOffset = 6 + record * 12;
		const platform = table.readUInt16BE(recordOffset);
		const language = table.readUInt16BE(recordOffset + 4);
		const id = table.readUInt16BE(recordOffset + 6);
		const length = table.readUInt16BE(recordOffset + 8);
		const offset = storage + table.readUInt16BE(recordOffset + 10);
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
						: undefined;
				if (target?.type === "String" || target?.type === "Url") {
					imports.push(resolveUrl(target.value, base));
				}
			},
			visit: "Atrule",
		},
	);
	return { faces, imports };
}

function resolveUrl(url: string, base: string | undefined) {
	return URL.parse(url, base)?.href ?? url;
}

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

function splitStack(stack: string) {
	return splitTopLevel(stack, ",").map(unquote).filter(Boolean);
}

function weightTier(weight: number, nearest: number) {
	const heavier = nearest > weight;
	if (weight > 500) {
		return heavier ? 0 : 1;
	}

	if (weight < 400) {
		return heavier ? 1 : 0;
	}

	return !heavier ? 1 : nearest <= 500 ? 0 : 2;
}

/** A font's OS/2 table, which some fonts lack, though fontkit's types say otherwise. */
function windowsMetricsOf(font: fontkit.Font): fontkit.Os2Table | undefined {
	return font["OS/2"];
}
