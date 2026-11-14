import type { Token } from "markdown-exit";

import JSZip from "jszip";
import { parseHTML } from "linkedom";
import { createMarkdownExit } from "markdown-exit";
import { createHash } from "node:crypto";
import path from "node:path";

import type { Gradient } from "./model.ts";

import { transitionXml } from "./transitions.ts";

export type Gradients = ReturnType<typeof createGradients>;

/** A list's marker in PowerPoint: Arial's disc, circle, or square, another character, or automatic numbering. */
export type Marker =
	| { code: string; kind: "keyword" | "string" }
	| { kind: "number"; style: string };

export interface SlidePatch {
	/** Names of shapes screen readers should skip. */
	decorative: string[];
	effects: Effect[];
	lists: {
		/** The markers' color as uppercase hex, when it isn't the text's. */
		color?: string;
		/** Each paragraph's marker, in order; undefined where it shows none. */
		markers: (Marker["kind"] | undefined)[];
		name: string;
	}[];
	/** The speaker notes, as Markdown. */
	notes: string;
	pictureCorners: {
		/** The corner radius as a fraction of the picture's shorter side, in 100000ths. */
		adjust: number;
		name: string;
	}[];
	title?: {
		look: TitleLook;
		name: string;
		text: string;
	};
	/** The Slidev transition into the slide, if any. */
	transition?: string;
}

/** A solid color, as uppercase hex, and how transparent it is (0-100). */
export interface Paint {
	color: string;
	transparency: number;
}

/** How new shapes look: the deck's most common box. */
export interface ShapeLook {
	fill: Paint;
	/** The outline, with its width in EMU. */
	line?: Paint & { width: number };
}

/** What new content in PowerPoint starts from: the theme, the master's styles, and the document's properties. Colors are uppercase hex. */
export interface Theme {
	/** Most used first, for up to six accents. */
	accents: string[];
	background: string;
	/** Body text's most used line spacing, in 1000ths of a percent. */
	bodyLineSpacing?: number;
	/** Body text's most used size, in 100ths of a point. */
	bodySize?: number;
	/** Every font the slides use. */
	fonts: string[];
	link?: string;
	/** The heading font. */
	majorFont: string;
	/** The body font. */
	minorFont: string;
	name: string;
	shape?: ShapeLook;
	text: string;
	title: TitleLook;
}

/** Where a slide's title sits and how it's styled, in EMU and PowerPoint's units. */
export interface TitleLook {
	align: "ctr" | "just" | "l" | "r";
	/** Whether the title is bold. */
	bold: boolean;
	/** Uppercase hex. */
	color: string;
	cx: number;
	cy: number;
	font: string;
	/** Whether the title is italic. */
	italic: boolean;
	/** In 100ths of a point. */
	letterSpacing: number;
	/** In 1000ths of a percent. */
	lineSpacing?: number;
	/** In 100ths of a point. */
	size: number;
	/** Whether the title shows capitalized. */
	upper: boolean;
	x: number;
	y: number;
}

interface Effect {
	/** The click it plays on, from 1. */
	click: number;
	/** The shape's name, as given to pptxgenjs. */
	name: string;
	/** Animate one paragraph (a list item) instead of the whole shape. */
	paragraph?: number;
	type: "entr" | "exit";
}

interface NotesFormat {
	bold: boolean;
	code: boolean;
	href?: string;
	italic: boolean;
	strike: boolean;
}

interface PackageOptions {
	/** The slide background, as a PNG. */
	background: Buffer;
	gradients: Gradients;
	/** The font for `code` in speaker notes. */
	monospace: string;
	/** Each PowerPoint slide's patches, in order. */
	slides: SlidePatch[];
	theme: Theme;
}

/** A stand-in language that marks a run to be shown capitalized (`cap="all"`). */
export const UPPERCASE_LANG = "x-pptx-uppercase";

/** Alt text that marks a picture as decorative, as pptxgenjs writes a picture's path for empty alt text. */
export const DECORATIVE = "pptx:decorative";

const REPRODUCIBLE_DATE = "1980-01-01T00:00:00Z";

const FADE_DURATION = 300;

const CONTENT_TYPES = "[Content_Types].xml";
const NOTES_PLACEHOLDER = "Notes Placeholder 2";
const TITLE_PLACEHOLDER = '<p:nvPr><p:ph type="title"/></p:nvPr>';
const UNTITLED_SLIDE = "PowerPoint Presentation";

const DECORATIVE_EXTENSION =
	'<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>';

const HYPERLINK_TYPE =
	"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

/** EMU per notes paragraph indent level. */
const NOTES_INDENT = 285750;
const NOTES_NUMBERING = "arabicPeriod";

const SCRIPT_REFERENCES = { cs: "cs", ea: "ea", latin: "lt" } as const;

/** A portrait 7.5" by 10" page, PowerPoint's default notes size. */
const NOTES_SIZE = '<p:notesSz cx="6858000" cy="9144000"/>';

const NOTES_BREAK = '<a:br><a:rPr lang="en-US" dirty="0"/></a:br>';
const NOTES_BLANK_PARAGRAPH =
	'<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>';

/** The formatting that HTML tags in speaker notes turn on. */
const NOTES_HTML_FORMATS: Partial<Record<string, "bold" | "italic">> = {
	b: "bold",
	em: "italic",
	i: "italic",
	strong: "bold",
};

/** The HTML elements that start their own paragraph in speaker notes. */
const NOTES_HTML_BLOCKS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"dd",
	"div",
	"dl",
	"dt",
	"figcaption",
	"figure",
	"footer",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"table",
	"tr",
	"ul",
]);

const PLAIN_NOTES: NotesFormat = {
	bold: false,
	code: false,
	italic: false,
	strike: false,
};

const markdown = createMarkdownExit({ html: true });

/** A rotation in [0, 360), as PowerPoint writes them. */
export const normalizeDegrees = (rotation: number) =>
	((rotation % 360) + 360) % 360;

/** One placeholder color per gradient, which post-processing swaps for a real gradFill. */
export function createGradients(
	/** Colors the deck uses, as uppercase hex, which placeholders must not be. */
	reserved: Set<string>,
) {
	const byKey = new Map<string, { gradient: Gradient; sentinel: string }>();
	let candidate = 0xfea000;

	return {
		/** Replaces placeholder fills in slide XML with the gradients they stand for. */
		apply(xml: string) {
			let patched = xml;
			for (const { gradient, sentinel } of byKey.values()) {
				patched = patched.replace(
					new RegExp(
						`<a:solidFill><a:srgbClr val="${sentinel}"(?:/>|>(?:<a:alpha val="\\d+"/>)?</a:srgbClr>)</a:solidFill>`,
						"g",
					),
					gradientFillXml(gradient),
				);
			}

			return patched;
		},
		sentinel(gradient: Gradient) {
			const key = JSON.stringify(gradient);
			let entry = byKey.get(key);
			if (!entry) {
				while (reserved.has(hex(candidate))) {
					candidate++;
				}

				entry = { gradient, sentinel: hex(candidate++) };
				byKey.set(key, entry);
			}

			return entry.sentinel;
		},
		/** Every placeholder color handed out. */
		sentinels: () => [...byKey.values()].map(({ sentinel }) => sentinel),
	};
}

/**
 * Tracks consecutive numbered paragraphs, which PowerPoint numbers on from the first one's
 * start; returns the start a paragraph's numbering needs.
 */
export function createNumbering() {
	let sequence:
		undefined | { level: number; next: number; start: number; style: string };
	return (level: number, number: number, style: string | undefined) => {
		const start =
			sequence?.level === level &&
			sequence.style === style &&
			sequence.next === number
				? sequence.start
				: number;
		sequence =
			style === undefined
				? undefined
				: { level, next: number + 1, start, style };
		return start;
	};
}

const hex = (value: number, digits = 6) =>
	Math.round(value).toString(16).toUpperCase().padStart(digits, "0");

export function patchSlide(
	xml: string,
	patch: SlidePatch,
	{ gradients, theme }: { gradients: Gradients; theme: Theme },
) {
	const ids = new Map<string, string>();
	const shapes = new Set<string>();
	for (const match of xml.matchAll(
		/<p:(?<kind>sp|pic)>\s*<p:nv(?:Sp|Pic)Pr>\s*<p:cNvPr id="(?<id>\d+)" name="(?<name>[^"]+)"/g,
	)) {
		const { id, kind, name } = match.groups ?? {};
		ids.set(name, id);
		if (kind === "sp") {
			shapes.add(id);
		}
	}

	let patched = patchOnce(
		singleParagraphProperties(xml),
		"</p:clrMapOvr>",
		`</p:clrMapOvr>${transitionXml(patch.transition)}${patch.effects.length ? timingXml(patch.effects, ids, shapes) : ""}`,
	)
		.replaceAll(
			`lang="${UPPERCASE_LANG}" altLang="en-US"`,
			'lang="en-US" cap="all"',
		)
		.replaceAll("<a:ln></a:ln>", "<a:ln><a:noFill/></a:ln>")
		// Browsers kern text by default; PowerPoint only kerns runs that ask for it, and pptxgenjs
		// writes kern="0" on letter-spaced runs.
		.replace(
			/<a:rPr lang="en-US"(?![^>]*\bkern=)/g,
			'<a:rPr lang="en-US" kern="100"',
		)
		.replaceAll(' kern="0"', ' kern="100"');

	for (const { adjust, name } of patch.pictureCorners) {
		patched = replaceShape(patched, name, (picture) =>
			patchOnce(
				picture,
				/<a:prstGeom prst="rect">.*?<\/a:prstGeom>/s,
				`<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${String(adjust)}"/></a:avLst></a:prstGeom>`,
			),
		);
	}

	for (const { color, markers, name } of patch.lists) {
		patched = replaceShape(patched, name, (shape) =>
			styleMarkers(shape, markers, color),
		);
	}

	if (patch.title) {
		patched = replaceShape(patched, patch.title.name, (shape) =>
			inheritTitleLook(
				patchOnce(
					patchOnce(
						shape,
						'<p:cNvSpPr txBox="1"/>',
						'<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>',
					),
					"<p:nvPr></p:nvPr>",
					TITLE_PLACEHOLDER,
				),
				theme.title,
			),
		);
	}

	for (const name of patch.decorative) {
		patched = replaceShape(patched, name, (shape) =>
			patchOnce(
				shape.replace(` descr="${DECORATIVE}"`, ' descr=""'),
				"</p:cNvPr>",
				`${DECORATIVE_EXTENSION}</p:cNvPr>`,
			),
		);
	}

	const result = themeReferences(
		gradients.apply(endParagraphProperties(patched)),
		theme,
	);
	const leftover = [
		`descr="${DECORATIVE}"`,
		`lang="${UPPERCASE_LANG}"`,
		...gradients.sentinels().map((sentinel) => `val="${sentinel}"`),
	].find((marker) => result.includes(marker));
	if (leftover) {
		throw new Error(`Expected no ${leftover} left in the package's XML.`);
	}

	return result;
}

/** A title placeholder's runs without the properties they'd inherit from the master's title style, so editing the master restyles them. */
function inheritTitleLook(shape: string, look: TitleLook) {
	const fill = `<a:solidFill><a:srgbClr val="${look.color}"/></a:solidFill>`;
	return shape.replace(
		/<a:(rPr|endParaRPr)\b([^>]*?)(?:\/>|>(.*?)<\/a:\1>)/gs,
		(_, tag: string, attributes: string, children: string | undefined) => {
			const kept = titleRunAttributes(look).reduce(
				(result, { name, plain, value }) => {
					const own = new RegExp(` ${name}="([^"]*)"`).exec(result)?.[1];
					if (own === undefined) {
						return value === undefined
							? result
							: `${result} ${name}="${plain}"`;
					}

					return own === value
						? result.replace(` ${name}="${own}"`, "")
						: result;
				},
				attributes.replace(` sz="${String(look.size)}"`, ""),
			);
			const inner = children ?? "";
			const outline = /^<a:ln\b.*?<\/a:ln>/s.exec(inner)?.[0] ?? "";
			const rest = inner.slice(outline.length);
			const content = (
				outline + (rest.startsWith(fill) ? rest.slice(fill.length) : rest)
			).replace(
				/<a:(?:latin|ea|cs) typeface="([^"]*)"[^>]*\/>/g,
				(element, typeface: string) =>
					unescapeXml(typeface) === look.font ? "" : element,
			);
			return content
				? `<a:${tag}${kept}>${content}</a:${tag}>`
				: `<a:${tag}${kept}/>`;
		},
	);
}

/** The run properties besides size that the master's title style gives titles, each with what a run without it means. */
const titleRunAttributes = (look: TitleLook) => [
	{ name: "b", plain: "0", value: look.bold ? "1" : undefined },
	{ name: "i", plain: "0", value: look.italic ? "1" : undefined },
	{ name: "cap", plain: "none", value: look.upper ? "all" : undefined },
	{
		name: "spc",
		plain: "0",
		value: look.letterSpacing ? String(look.letterSpacing) : undefined,
	},
];

/** Replaces the first match, throwing when there's none: pptxgenjs's output isn't what the patch expects. */
function patchOnce(
	xml: string,
	search: RegExp | string,
	replacement: ((match: string, ...groups: string[]) => string) | string,
) {
	if (typeof search === "string" ? !xml.includes(search) : !search.test(xml)) {
		throw new Error(`Expected ${String(search)} in the package's XML.`);
	}

	return xml.replace(
		search,
		typeof replacement === "string" ? () => replacement : replacement,
	);
}

function replaceShape(
	xml: string,
	name: string,
	replace: (shape: string) => string,
) {
	const nameIndex = xml.indexOf(` name="${escapeXml(name)}"`);
	const start = Math.max(
		xml.lastIndexOf("<p:sp>", nameIndex),
		xml.lastIndexOf("<p:pic>", nameIndex),
	);
	if (nameIndex < 0 || start < 0) {
		throw new Error(`No shape named "${name}".`);
	}

	const close = xml.startsWith("<p:sp>", start) ? "</p:sp>" : "</p:pic>";
	const end = xml.indexOf(close, nameIndex) + close.length;
	return xml.slice(0, start) + replace(xml.slice(start, end)) + xml.slice(end);
}

function styleMarkers(
	shape: string,
	markers: SlidePatch["lists"][number]["markers"],
	color: string | undefined,
) {
	const bulletColor = color
		? `<a:buClr><a:srgbClr val="${color}"/></a:buClr>`
		: "";
	const plainSize = '<a:buSzPct val="100000"/>';
	let index = 0;
	const styled = shape.replace(
		/<a:pPr\b[^>]*?(?:\/>|>.*?<\/a:pPr>)/gs,
		(properties) => {
			const marker = markers.at(index++);
			switch (marker) {
				// Arial's ● at 60% best matches a browser's disc marker in size and height (measured in
				// PowerPoint), and its ○ and ■ its circle and square.
				case "keyword":
					return patchOnce(
						properties,
						plainSize,
						`${bulletColor}<a:buSzPct val="60000"/><a:buFont typeface="Arial"/>`,
					);
				case "number":
					return patchOnce(
						properties,
						`${plainSize}<a:buFont typeface="+mj-lt"/>`,
						`${bulletColor}${plainSize}<a:buFontTx/>`,
					);
				case "string":
					return patchOnce(properties, plainSize, bulletColor + plainSize);
				default:
					return properties;
			}
		},
	);
	if (index !== markers.length) {
		throw new Error(
			`A list has ${String(index)} paragraphs but ${String(markers.length)} markers.`,
		);
	}

	return styled;
}

/** Keeps only each paragraph's first properties, as pptxgenjs writes them before every run. */
function singleParagraphProperties(xml: string) {
	return xml.replace(/<a:p>(.*?)<\/a:p>/gs, (paragraph, body: string) => {
		let first = true;
		const properties = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>.*?<\/a:pPr>/gs;
		const kept = body.replace(properties, (match: string, offset: number) => {
			const keep = first && offset === 0;
			first = false;
			return keep ? match : "";
		});
		return kept === body ? paragraph : `<a:p>${kept}</a:p>`;
	});
}

/** Gives each paragraph's end the properties of its last run, so text typed at its end looks like it. */
function endParagraphProperties(xml: string) {
	return xml.replace(/<a:p>(.*?)<\/a:p>/gs, (paragraph, body: string) => {
		const last = body.match(/<a:rPr\b[^>]*?(?:\/>|>.*?<\/a:rPr>)/gs)?.at(-1);
		return last
			? paragraph.replace(
					/<a:endParaRPr\b[^>]*\/>/,
					last
						.replace(/<a:hlinkClick\b[^>]*?(?:\/>|>.*?<\/a:hlinkClick>)/s, "")
						.replace(/^<a:rPr/, "<a:endParaRPr")
						.replace(/<\/a:rPr>$/, "</a:endParaRPr>"),
				)
			: paragraph;
	});
}

function schemeColor(
	properties: string,
	color: string | undefined,
	scheme: string,
) {
	return color
		? properties.replace(
				new RegExp(`<a:srgbClr val="${color}"(/>|>(.*?)</a:srgbClr>)`, "gs"),
				(_, end: string, children: string | undefined) =>
					children === undefined
						? `<a:schemeClr val="${scheme}"${end}`
						: `<a:schemeClr val="${scheme}">${children}</a:schemeClr>`,
			)
		: properties;
}

/** Points runs in the theme's fonts and colors at the theme, so changing it restyles them. */
function themeReferences(xml: string, theme: Theme) {
	return xml
		.replace(
			/<a:(latin|ea|cs) typeface="([^"]*)"[^>]*\/>/g,
			(element, script: keyof typeof SCRIPT_REFERENCES, typeface: string) => {
				const font = unescapeXml(typeface);
				return themeFontOf(font, theme)
					? fontXml(script, font, theme)
					: element;
			},
		)
		.replace(
			/<a:(rPr|endParaRPr)\b[^>]*?(?:\/>|>.*?<\/a:\1>)/gs,
			(properties) =>
				schemeColor(
					properties.includes("<a:hlinkClick")
						? schemeColor(properties, theme.link, "hlink")
						: properties,
					theme.text,
					"tx1",
				),
		);
}

/** Patches every slide, then tidies the package and writes it with fixed dates. */
export async function finishPackage(
	zip: JSZip,
	{ background, gradients, monospace, slides, theme }: PackageOptions,
) {
	for (const [index, patch] of slides.entries()) {
		const slide = `ppt/slides/slide${String(index + 1)}.xml`;
		zip.file(
			slide,
			patchSlide(await read(zip, slide), patch, { gradients, theme }),
		);
		await mergeHyperlinks(zip, slide);
		await writeNotes(
			zip,
			`ppt/notesSlides/notesSlide${String(index + 1)}.xml`,
			patch.notes,
			monospace,
		);
	}

	await writeThemes(zip, theme);
	await writeMaster(zip, theme, background);
	await writeLayout(zip);
	await writePresentation(zip, theme);
	await writeDocumentProperties(zip, theme, slides);
	await deduplicateMedia(zip);
	await tidyContentTypes(zip);

	const output = new JSZip();
	for (const file of zip.file(/./)) {
		output.file(file.name, await file.async("uint8array"), {
			createFolders: false,
			date: new Date(REPRODUCIBLE_DATE),
		});
	}

	return output.generateAsync({ compression: "DEFLATE", type: "nodebuffer" });
}

async function mergeHyperlinks(zip: JSZip, part: string) {
	const relsFile = relationshipsOf(part);
	const kept = new Map<string, string>();
	const merged = new Map<string, string>();
	const rels = (await read(zip, relsFile)).replace(
		/<Relationship Id="(rId\d+)" Type="([^"]+)" Target="([^"]*)" TargetMode="External"\/>/g,
		(relationship, id: string, type: string, target: string) => {
			if (type !== HYPERLINK_TYPE) {
				return relationship;
			}

			const first = kept.get(target);
			if (first) {
				merged.set(id, first);
				return "";
			}

			kept.set(target, id);
			return relationship;
		},
	);
	if (merged.size) {
		zip.file(relsFile, rels);
		zip.file(
			part,
			(await read(zip, part)).replace(
				/r:id="(rId\d+)"/g,
				(attribute, id: string) => {
					const first = merged.get(id);
					return first ? `r:id="${first}"` : attribute;
				},
			),
		);
	}
}

const relationshipsOf = (part: string) =>
	path.posix.join(
		path.posix.dirname(part),
		"_rels",
		`${path.posix.basename(part)}.rels`,
	);

/** Gives the slide master's theme the deck's colors, fonts, and name, and the notes master pptxgenjs's own theme. */
async function writeThemes(zip: JSZip, theme: Theme) {
	const slideTheme = "ppt/theme/theme1.xml";
	const notesTheme = "ppt/theme/theme2.xml";
	const notesMasterRels = "ppt/notesMasters/_rels/notesMaster1.xml.rels";
	const original = await read(zip, slideTheme);
	zip.file(notesTheme, original);
	zip.file(
		notesMasterRels,
		patchOnce(
			await read(zip, notesMasterRels),
			"../theme/theme1.xml",
			`../theme/${path.posix.basename(notesTheme)}`,
		),
	);
	zip.file(
		CONTENT_TYPES,
		patchOnce(
			await read(zip, CONTENT_TYPES),
			new RegExp(`<Override PartName="/${slideTheme}"[^>]*/>`),
			(override) => override + override.replace(slideTheme, notesTheme),
		),
	);

	zip.file(slideTheme, themeXml(original, theme));
}

/** A theme with the deck's colors, fonts, and name, and its most common box as the look of new shapes. */
export function themeXml(original: string, theme: Theme) {
	const dark = darkBackground(theme);
	const colors: [string, string | undefined][] = [
		["dk1", dark ? theme.background : theme.text],
		["lt1", dark ? theme.text : theme.background],
		[
			dark ? "lt2" : "dk2",
			titleColorScheme(theme) === "tx2" ? theme.title.color : undefined,
		],
		[
			dark ? "dk2" : "lt2",
			theme.shape && paintOver(theme.shape.fill, theme.background),
		],
		["hlink", theme.link],
		["folHlink", theme.link],
		...theme.accents.map((color, index): [string, string] => [
			`accent${String(index + 1)}`,
			color,
		]),
	];
	const withColors = colors.reduce(
		(xml, [name, color]) =>
			color
				? patchOnce(
						xml,
						new RegExp(`<a:${name}>.*?</a:${name}>`),
						`<a:${name}><a:srgbClr val="${color}"/></a:${name}>`,
					)
				: xml,
		original,
	);
	const withFonts = (["majorFont", "minorFont"] as const).reduce(
		(xml, scheme) =>
			patchOnce(
				xml,
				new RegExp(
					`<a:${scheme}><a:latin [^>]*/><a:ea typeface=""/><a:cs typeface=""/>`,
				),
				`<a:${scheme}>${["latin", "ea", "cs"].map((script) => `<a:${script} typeface="${escapeXml(theme[scheme])}"/>`).join("")}`,
			),
		withColors,
	);
	const withShapes = theme.shape
		? patchOnce(withFonts, "<a:objectDefaults/>", shapeDefaultsXml(theme.shape))
		: withFonts;
	const name = escapeXml(theme.name);
	return [
		/(<a:theme\b[^>]*) name="Office Theme"/,
		/(<a:clrScheme) name="Office"/,
		/(<a:fontScheme) name="Office"/,
		/(<thm15:themeFamily\b[^>]*) name="Office Theme"/,
	].reduce(
		(xml, element) =>
			patchOnce(xml, element, (_, start) => `${start} name="${name}"`),
		withShapes,
	);
}

const shapeDefaultsXml = ({ fill, line }: ShapeLook) =>
	`<a:objectDefaults><a:spDef><a:spPr>${solidFillXml(fill)}${line ? `<a:ln w="${String(line.width)}">${solidFillXml(line)}</a:ln>` : "<a:ln><a:noFill/></a:ln>"}</a:spPr><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:style><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></a:style></a:spDef></a:objectDefaults>`;

const solidFillXml = ({ color, transparency }: Paint) =>
	`<a:solidFill><a:srgbClr val="${color}"${transparency ? `>${alphaXml(transparency)}</a:srgbClr>` : "/>"}</a:solidFill>`;

const alphaXml = (transparency: number) =>
	`<a:alpha val="${String(Math.round((100 - transparency) * 1000))}"/>`;

const darkBackground = ({ background, text }: Theme) =>
	luminance(background) < luminance(text);

const channelsOf = (color: string) =>
	[0, 2, 4].map((index) => parseInt(color.slice(index, index + 2), 16));

const luminance = (color: string) =>
	channelsOf(color).reduce(
		(sum, channel, index) => sum + [0.299, 0.587, 0.114][index] * channel,
		0,
	);

/** The color a paint shows over a background color. */
const paintOver = ({ color, transparency }: Paint, background: string) => {
	const below = channelsOf(background);
	return channelsOf(color)
		.map((channel, index) =>
			hex(channel + ((below[index] - channel) * transparency) / 100, 2),
		)
		.join("");
};

/** The theme color titles take: the text's, or a second text color of their own. */
const titleColorScheme = ({ text, title }: Theme) =>
	title.color === text ? "tx1" : "tx2";

/** Gives the master the deck's background, its slides' title placement and style, and its body text's defaults. */
async function writeMaster(zip: JSZip, theme: Theme, background: Buffer) {
	const masterFile = "ppt/slideMasters/slideMaster1.xml";
	const masterRels = relationshipsOf(masterFile);
	const rels = await read(zip, masterRels);
	const backgroundId = `rId${String(
		Math.max(
			...[...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1])),
		) + 1,
	)}`;
	zip.file("ppt/media/background.png", background);
	zip.file(
		masterRels,
		patchOnce(
			rels,
			"</Relationships>",
			`<Relationship Id="${backgroundId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/background.png"/></Relationships>`,
		),
	);
	zip.file(
		masterFile,
		masterXml(await read(zip, masterFile), theme, backgroundId),
	);
}

/** A slide master with the deck's background picture, title, and body text defaults, mapping text to the light color on a dark background. */
export function masterXml(master: string, theme: Theme, backgroundId: string) {
	const { title } = theme;
	const withBackground = patchOnce(
		master,
		"<p:cSld>",
		`<p:cSld><p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${backgroundId}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`,
	);
	const withTitle = patchOnce(
		withBackground,
		"</p:grpSpPr>",
		`</p:grpSpPr>${titleShape(
			`<p:spPr><a:xfrm><a:off x="${String(title.x)}" y="${String(title.y)}"/><a:ext cx="${String(title.cx)}" cy="${String(title.cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`,
			'<a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"/>',
		)}`,
	);
	const styled = bodyDefaults(
		titleStyle(withTitle, theme),
		"p:otherStyle",
		theme,
	);
	return darkBackground(theme)
		? patchOnce(
				styled,
				'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"',
				'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"',
			)
		: styled;
}

/** Gives the master's title style the deck's title alignment, spacing, size, run properties, color, and font. */
function titleStyle(master: string, theme: Theme) {
	const { title } = theme;
	const attributes = titleRunAttributes(title)
		.flatMap(({ name, value }) =>
			value === undefined ? [] : [` ${name}="${value}"`],
		)
		.join("");
	const replacements = [
		[' algn="ctr"', ` algn="${title.align}"`],
		["<a:spcBef>", `${lineSpacingXml(title.lineSpacing)}<a:spcBef>`],
		[' sz="4400"', ` sz="${String(title.size)}"${attributes}`],
		[
			'<a:schemeClr val="tx1"/>',
			`<a:schemeClr val="${titleColorScheme(theme)}"/>`,
		],
		[
			'<a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/>',
			(["latin", "ea", "cs"] as const)
				.map((script) => fontXml(script, title.font, theme))
				.join(""),
		],
	] as const;
	return patchOnce(master, /<p:titleStyle>.*?<\/p:titleStyle>/s, (style) =>
		replacements.reduce(
			(patched, [search, replacement]) =>
				patchOnce(patched, search, replacement),
			style,
		),
	);
}

const titleShape = (properties: string, body: string) =>
	`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>${TITLE_PLACEHOLDER}</p:nvSpPr>${properties}<p:txBody>${body}<a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;

const lineSpacingXml = (spacing: number | undefined) =>
	spacing === undefined
		? ""
		: `<a:lnSpc><a:spcPct val="${String(spacing)}"/></a:lnSpc>`;

const themeFontOf = (font: string, { majorFont, minorFont }: Theme) =>
	font === minorFont ? "mn" : font === majorFont ? "mj" : undefined;

/** A font for one script, referring to the theme's when it's one of them. */
const fontXml = (
	script: keyof typeof SCRIPT_REFERENCES,
	font: string,
	theme: Theme,
) => {
	const themeFont = themeFontOf(font, theme);
	return `<a:${script} typeface="${themeFont ? `+${themeFont}-${SCRIPT_REFERENCES[script]}` : escapeXml(font)}"/>`;
};

/** Gives a text style's first level the deck's body text size and line spacing. */
function bodyDefaults(xml: string, style: string, theme: Theme) {
	return theme.bodySize === undefined
		? xml
		: patchOnce(
				xml,
				new RegExp(
					`(<${style}>(?:(?!</${style}>).)*?<a:lvl1pPr\\b[^>]*>)<a:defRPr sz="\\d+"`,
					"s",
				),
				(_, start) =>
					`${start}${lineSpacingXml(theme.bodyLineSpacing)}<a:defRPr sz="${String(theme.bodySize)}"`,
			);
}

async function deduplicateMedia(zip: JSZip) {
	const canonical = new Map<string, string>();
	const replacements = new Map<string, string>();
	const media = zip
		.file(/^ppt\/media\//)
		.sort((a, b) => a.name.localeCompare(b.name));
	for (const file of media) {
		const hash = createHash("sha256")
			.update(await file.async("nodebuffer"))
			.digest("hex");
		const kept = canonical.get(hash);
		if (kept) {
			replacements.set(file.name, kept);
		} else {
			canonical.set(hash, file.name);
		}
	}

	for (const file of zip.file(/\.rels$/)) {
		const xml = await file.async("string");
		let patched = xml;
		for (const [duplicate, kept] of replacements) {
			patched = patched.replaceAll(
				`../media/${path.posix.basename(duplicate)}"`,
				`../media/${path.posix.basename(kept)}"`,
			);
		}

		if (patched !== xml) {
			zip.file(file.name, patched);
		}
	}

	for (const duplicate of replacements.keys()) {
		zip.remove(duplicate);
	}
}

/** Makes pptxgenjs's default layout a Title Only layout that shows the master's background. */
async function writeLayout(zip: JSZip) {
	const layoutFile = "ppt/slideLayouts/slideLayout1.xml";
	const layout = await read(zip, layoutFile);
	const renamed = patchOnce(
		layout,
		/<p:cSld name="[^"]*"><p:bg>.*?<\/p:bg>/s,
		'<p:cSld name="Title Only">',
	);
	const typed = patchOnce(
		renamed,
		' preserve="1"',
		' type="titleOnly" preserve="1"',
	);
	zip.file(
		layoutFile,
		patchOnce(
			typed,
			"</p:grpSpPr>",
			`</p:grpSpPr>${titleShape("<p:spPr/>", "<a:bodyPr/>")}`,
		),
	);
}

/** Gives new text the deck's body defaults, notes pages PowerPoint's own size rather than pptxgenjs's sideways slide size, and the notes master its place in the schema's order. */
async function writePresentation(zip: JSZip, theme: Theme) {
	const presentationFile = "ppt/presentation.xml";
	zip.file(
		presentationFile,
		bodyDefaults(
			patchOnce(
				patchOnce(
					await read(zip, presentationFile),
					/(<\/p:sldMasterIdLst>)(.*?)(<p:notesMasterIdLst>.*?<\/p:notesMasterIdLst>)/s,
					(_, masters, slides, notesMaster) => masters + notesMaster + slides,
				),
				/<p:notesSz [^>]*\/>/,
				NOTES_SIZE,
			),
			"p:defaultTextStyle",
			theme,
		),
	);
}

/** Lists the deck's fonts, theme, and slide titles, and fixes its dates, as PowerPoint would. */
async function writeDocumentProperties(
	zip: JSZip,
	theme: Theme,
	slides: SlidePatch[],
) {
	const titles = slides.map(({ title }) => title?.text ?? UNTITLED_SLIDE);
	const parts = [...theme.fonts, theme.name, ...titles];
	const headings = [
		["Fonts Used", theme.fonts.length],
		["Theme", 1],
		["Slide Titles", titles.length],
	] as const;
	const appFile = "docProps/app.xml";
	zip.file(
		appFile,
		patchOnce(
			patchOnce(
				await read(zip, appFile),
				/<HeadingPairs>.*<\/HeadingPairs>/s,
				`<HeadingPairs><vt:vector size="${String(headings.length * 2)}" baseType="variant">${headings.map(([heading, count]) => `<vt:variant><vt:lpstr>${heading}</vt:lpstr></vt:variant><vt:variant><vt:i4>${String(count)}</vt:i4></vt:variant>`).join("")}</vt:vector></HeadingPairs>`,
			),
			/<TitlesOfParts>.*<\/TitlesOfParts>/s,
			`<TitlesOfParts><vt:vector size="${String(parts.length)}" baseType="lpstr">${parts.map((part) => `<vt:lpstr>${escapeXml(part)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts>`,
		),
	);

	const coreFile = "docProps/core.xml";
	zip.file(
		coreFile,
		(await read(zip, coreFile)).replace(
			/(<dcterms:(?:created|modified)\b[^>]*>)[^<]*/g,
			`$1${REPRODUCIBLE_DATE}`,
		),
	);
}

async function writeNotes(
	zip: JSZip,
	part: string,
	notes: string,
	monospace: string,
) {
	const relsFile = relationshipsOf(part);
	let rels = await read(zip, relsFile);
	const links = new Map<string, string>();
	const linkId = (url: string) => {
		let id = links.get(url);
		if (!id) {
			id = `rId${String(Math.max(...[...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]))) + 1)}`;
			links.set(url, id);
			rels = patchOnce(
				rels,
				"</Relationships>",
				`<Relationship Id="${id}" Type="${HYPERLINK_TYPE}" Target="${escapeXml(url)}" TargetMode="External"/></Relationships>`,
			);
		}

		return id;
	};

	const paragraphs = notesParagraphs(notes, monospace, linkId);
	zip.file(
		part,
		replaceShape(await read(zip, part), NOTES_PLACEHOLDER, (shape) =>
			patchOnce(
				shape,
				/<a:p>.*<\/a:p>/s,
				paragraphs.join("") || NOTES_BLANK_PARAGRAPH,
			),
		),
	);
	if (links.size) {
		zip.file(relsFile, rels);
	}
}

/** Notes paragraphs from Markdown: one per paragraph, heading, list item, code line, and HTML block, with a blank paragraph wherever the source has blank lines. */
export function notesParagraphs(
	notes: string,
	monospace: string,
	linkId: (url: string) => string,
) {
	const run = (text: string, format: NotesFormat) => {
		const attributes = [
			format.bold && ' b="1"',
			format.italic && ' i="1"',
			format.strike && ' strike="sngStrike"',
		]
			.filter(Boolean)
			.join("");
		const children =
			(format.code ? `<a:latin typeface="${escapeXml(monospace)}"/>` : "") +
			(format.href ? `<a:hlinkClick r:id="${linkId(format.href)}"/>` : "");
		return `<a:r><a:rPr lang="en-US"${attributes} dirty="0"${children ? `>${children}</a:rPr>` : "/>"}<a:t>${escapeXml(text)}</a:t></a:r>`;
	};

	/** Runs whose bold and italic nest as tags and emphasis open and close, broken into lines without whitespace at their ends. */
	const createRuns = (bold: boolean) => {
		const initial = { ...PLAIN_NOTES, bold };
		const format: NotesFormat = { ...initial };
		const depths = { bold: 0, italic: 0 };
		const pieces: { format: NotesFormat; text: string }[] = [];
		let lines = "";
		const line = () => {
			const last = pieces.at(-1);
			if (last && !last.format.code) {
				last.text = last.text.trimEnd();
			}

			return pieces
				.splice(0)
				.filter(({ text }) => text)
				.map((piece) => run(piece.text, piece.format))
				.join("");
		};

		return {
			add(text: string, code = false) {
				const pieceFormat = { ...format, code };
				const last = pieces.at(-1);
				const added =
					code || /\S$/.test(last?.text ?? "") ? text : text.trimStart();
				if (
					last &&
					JSON.stringify(last.format) === JSON.stringify(pieceFormat)
				) {
					last.text += added;
				} else if (added) {
					pieces.push({ format: pieceFormat, text: added });
				}
			},
			format,
			lineBreak() {
				lines += line() + NOTES_BREAK;
			},
			toggle(property: keyof typeof depths, opening: boolean) {
				depths[property] = Math.max(0, depths[property] + (opening ? 1 : -1));
				format[property] = initial[property] || depths[property] > 0;
			},
			written() {
				const written = lines + line();
				lines = "";
				return written;
			},
		};
	};

	const inlineRuns = (children: Token[], bold: boolean) => {
		const runs = createRuns(bold);
		for (const child of children) {
			switch (child.type) {
				case "code_inline":
					runs.add(child.content, true);
					break;
				case "em_close":
				case "em_open":
					runs.toggle("italic", child.nesting === 1);
					break;
				case "hardbreak":
				case "softbreak":
					runs.lineBreak();
					break;
				case "html_inline": {
					const [, closing, name = ""] =
						/^<(\/?)([a-z]\w*)/i.exec(child.content) ?? [];
					const tag = name.toLowerCase();
					const property = NOTES_HTML_FORMATS[tag];
					if (tag === "br") {
						runs.lineBreak();
					} else if (property) {
						runs.toggle(property, !closing);
					}

					break;
				}
				case "image":
				case "text":
					runs.add(child.content);
					break;
				case "link_close":
				case "link_open":
					runs.format.href =
						child.nesting === 1
							? (child.attrGet("href") ?? undefined)
							: undefined;
					break;
				case "s_close":
				case "s_open":
					runs.format.strike = child.nesting === 1;
					break;
				case "strong_close":
				case "strong_open":
					runs.toggle("bold", child.nesting === 1);
					break;
			}
		}

		return runs.written();
	};

	/** An HTML block's paragraphs: one per block element, with its line breaks and bold and italic text. */
	const htmlParagraphs = (html: string) => {
		const paragraphs: string[] = [];
		const runs = createRuns(false);
		const endParagraph = () => {
			const written = runs.written();
			if (written) {
				paragraphs.push(`<a:p>${written}</a:p>`);
			}
		};

		const walk = (node: ChildNode) => {
			const tag = node.nodeName.toLowerCase();
			if (tag === "#text") {
				runs.add((node.textContent ?? "").replace(/\s+/g, " "));
			} else if (tag === "br") {
				runs.lineBreak();
			} else if (node.nodeType === node.ELEMENT_NODE) {
				const block = NOTES_HTML_BLOCKS.has(tag);
				const property = NOTES_HTML_FORMATS[tag];
				if (block) {
					endParagraph();
				}

				if (property) {
					runs.toggle(property, true);
				}

				node.childNodes.forEach(walk);
				if (property) {
					runs.toggle(property, false);
				}

				if (block) {
					endParagraph();
				}
			}
		};

		parseHTML(
			`<html><body>${html}</body></html>`,
		).document.body.childNodes.forEach(walk);
		endParagraph();
		return paragraphs;
	};

	const paragraphs: string[] = [];
	const lists: { number: number; ordered: boolean }[] = [];
	const numbering = createNumbering();
	let itemStarts = false;
	let heading = false;
	let lastLine: number | undefined;
	for (const token of markdown.parse(notes, {})) {
		if (token.level === 0 && token.nesting !== -1 && token.map) {
			if (lastLine !== undefined && token.map[0] > lastLine) {
				paragraphs.push(NOTES_BLANK_PARAGRAPH);
			}

			lastLine = token.map[1];
		}

		switch (token.type) {
			case "bullet_list_close":
			case "ordered_list_close":
				lists.pop();
				break;
			case "bullet_list_open":
			case "ordered_list_open":
				lists.push({
					number: Number(token.attrGet("start") ?? 1),
					ordered: token.type === "ordered_list_open",
				});
				break;
			case "code_block":
			case "fence":
				paragraphs.push(
					...token.content
						.replace(/\n$/, "")
						.split("\n")
						.map(
							(line) =>
								`<a:p>${run(line, { ...PLAIN_NOTES, code: true })}</a:p>`,
						),
				);
				break;
			case "heading_close":
			case "heading_open":
				heading = token.nesting === 1;
				break;
			case "html_block":
				paragraphs.push(...htmlParagraphs(token.content));
				break;
			case "inline": {
				const list = lists.at(-1);
				const level = lists.length;
				const numbered = list?.ordered === true && itemStarts;
				const start = numbering(
					level,
					list?.number ?? 0,
					numbered ? NOTES_NUMBERING : undefined,
				);
				const marker = numbered
					? `<a:buAutoNum type="${NOTES_NUMBERING}" startAt="${String(start)}"/>`
					: itemStarts
						? '<a:buChar char="•"/>'
						: "<a:buNone/>";
				if (list && numbered) {
					list.number++;
				}

				const properties = list
					? `<a:pPr marL="${String(level * NOTES_INDENT)}" indent="${itemStarts ? String(-NOTES_INDENT) : "0"}">${marker}</a:pPr>`
					: "";
				paragraphs.push(
					`<a:p>${properties}${inlineRuns(token.children ?? [], heading)}</a:p>`,
				);
				itemStarts = false;
				break;
			}

			case "list_item_open":
				itemStarts = true;
				break;
		}
	}

	return paragraphs;
}

async function read(zip: JSZip, name: string) {
	const file = zip.file(name);
	if (!file) {
		throw new Error(`The package has no ${name}.`);
	}

	return file.async("string");
}

/** Drops content types for parts and extensions the package doesn't have, and declares JPEGs as image/jpeg rather than pptxgenjs's image/jpg. */
async function tidyContentTypes(zip: JSZip) {
	const extensions = new Set(
		Object.keys(zip.files).map((file) =>
			path.extname(file).slice(1).toLowerCase(),
		),
	);
	zip.file(
		CONTENT_TYPES,
		(await read(zip, CONTENT_TYPES))
			.replace(
				/<Override PartName="\/([^"]+)"[^>]*\/>/g,
				(override, part: string) => (zip.file(part) ? override : ""),
			)
			.replace(
				/<Default Extension="([^"]+)"[^>]*\/>/g,
				(declaration, extension: string) =>
					extensions.has(extension.toLowerCase()) ? declaration : "",
			)
			.replace('ContentType="image/jpg"', 'ContentType="image/jpeg"'),
	);
}

/** Escapes text for XML exactly as pptxgenjs does, so names can be found again. */
const escapeXml = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");

const unescapeXml = (value: string) =>
	value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");

function gradientFillXml({ angle, stops }: Gradient) {
	const stopXml = stops
		.map((stop) => {
			const alpha = stop.transparency > 0 ? alphaXml(stop.transparency) : "";
			return `<a:gs pos="${String(Math.round(stop.position * 1000))}"><a:srgbClr val="${stop.color}">${alpha}</a:srgbClr></a:gs>`;
		})
		.join("");
	return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${stopXml}</a:gsLst><a:lin ang="${String(Math.round(normalizeDegrees(angle - 90) * 60000))}" scaled="0"/></a:gradFill>`;
}

/** Builds a slide's p:timing: one click group per click, each fading shapes or paragraphs in or out. */
function timingXml(
	effects: Effect[],
	ids: Map<string, string>,
	shapes: Set<string>,
) {
	const shapeIdOf = (effect: Effect) => {
		const shapeId = ids.get(escapeXml(effect.name));
		if (!shapeId) {
			throw new Error(
				`Click ${String(effect.click)}: no shape named "${effect.name}".`,
			);
		}

		return shapeId;
	};

	const sorted = effects.toSorted((a, b) => a.click - b.click);
	const shapeGroups = new Map<string, number>();
	for (const effect of sorted.filter(
		({ paragraph }) => paragraph === undefined,
	)) {
		const shapeId = shapeIdOf(effect);
		shapeGroups.set(shapeId, (shapeGroups.get(shapeId) ?? 0) + 1);
	}

	const groups = new Map<string, number>();
	const animations = sorted.map((effect) => {
		const shapeId = shapeIdOf(effect);
		const key = `${shapeId}:${String(effect.paragraph ?? "shape")}`;
		const count = groups.get(key) ?? 0;
		groups.set(key, count + 1);
		return {
			...effect,
			groupId:
				effect.paragraph === undefined
					? count
					: (shapeGroups.get(shapeId) ?? 0) + count,
			shapeId,
		};
	});

	let id = 3;
	const nextId = () => String(id++);
	const body = [...new Set(animations.map(({ click }) => click))]
		.map((click) => {
			const inner = animations
				.filter((animation) => animation.click === click)
				.map((animation, index) => {
					const target = `<p:tgtEl><p:spTgt spid="${animation.shapeId}">${animation.paragraph === undefined ? "" : `<p:txEl><p:pRg st="${String(animation.paragraph)}" end="${String(animation.paragraph)}"/></p:txEl>`}</p:spTgt></p:tgtEl>`;
					const visibility = (value: string, delay: number) =>
						`<p:set><p:cBhvr><p:cTn id="${nextId()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${String(delay)}"/></p:stCondLst></p:cTn>${target}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${value}"/></p:to></p:set>`;
					const fade = (direction: string) =>
						`<p:animEffect transition="${direction}" filter="fade"><p:cBhvr><p:cTn id="${nextId()}" dur="${String(FADE_DURATION)}"/>${target}</p:cBhvr></p:animEffect>`;
					const effectId = nextId();
					const children =
						animation.type === "entr"
							? visibility("visible", 0) + fade("in")
							: fade("out") + visibility("hidden", FADE_DURATION - 1);
					return `<p:par><p:cTn id="${effectId}" presetID="10" presetClass="${animation.type}" presetSubtype="0" fill="hold" grpId="${String(animation.groupId)}" nodeType="${index === 0 ? "clickEffect" : "withEffect"}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${children}</p:childTnLst></p:cTn></p:par>`;
				})
				.join("");
			const outer = nextId();
			const group = nextId();
			return `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${group}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
		})
		.join("");

	const builds = new Map(
		animations
			.filter(({ shapeId }) => shapes.has(shapeId))
			.map((animation) => [
				`${animation.shapeId}:${String(animation.groupId)}`,
				`<p:bldP spid="${animation.shapeId}" grpId="${String(animation.groupId)}" ${animation.paragraph === undefined ? 'animBg="1"' : 'build="p"'}/>`,
			]),
	);
	const buildList = [...builds.values()].join("");
	return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${buildList ? `<p:bldLst>${buildList}</p:bldLst>` : ""}</p:timing>`;
}
