import type { Token } from "markdown-exit";

import JSZip from "jszip";
import { createMarkdownExit } from "markdown-exit";
import { createHash } from "node:crypto";
import path from "node:path";

import type { Gradient } from "./model.ts";

import { transitionXml } from "./transitions.ts";

export type Gradients = ReturnType<typeof createGradients>;

/** How post-processing styles a list paragraph's marker: no marker, Arial's disc, circle, or square, a number, or another character. */
export type ListMarker = "keyword" | "none" | "number" | "string";

export interface SlidePatch {
	/** Names of shapes screen readers should skip. */
	decorative: string[];
	effects: Effect[];
	lists: {
		/** The markers' color, when it isn't the text's. */
		color?: string;
		/** Each paragraph's marker, in order. */
		markers: ListMarker[];
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

/** What new content in PowerPoint starts from: the theme, the master's styles, and the document's properties. */
export interface Theme {
	/** Colors as hex, most used first, for up to six accents. */
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
	majorFont?: string;
	/** The body font. */
	minorFont?: string;
	name: string;
	text: string;
	title?: TitleLook;
}

/** Where a slide's title sits and how it's styled, in EMU and PowerPoint's units. */
export interface TitleLook {
	align: "ctr" | "just" | "l" | "r";
	color: string;
	cx: number;
	cy: number;
	font: string;
	/** In 1000ths of a percent. */
	lineSpacing?: number;
	/** In 100ths of a point. */
	size: number;
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

const hex = (value: number) =>
	value.toString(16).toUpperCase().padStart(6, "0");

/** Applies a slide's animations, transition, and styling patches to its XML. */
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
	);

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
			patchOnce(
				patchOnce(
					shape,
					'<p:cNvSpPr txBox="1"/>',
					'<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>',
				),
				"<p:nvPr></p:nvPr>",
				TITLE_PLACEHOLDER,
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

	patched = patched
		.replaceAll(
			`lang="${UPPERCASE_LANG}" altLang="en-US"`,
			'lang="en-US" cap="all"',
		)
		.replaceAll("<a:ln></a:ln>", "<a:ln><a:noFill/></a:ln>")
		// Browsers kern text by default; PowerPoint only kerns runs that ask for it. pptxgenjs
		// also turns kerning off for letter-spaced runs, where browsers apply both.
		.replace(
			/<a:rPr lang="en-US"(?![^>]*\bkern=)/g,
			'<a:rPr lang="en-US" kern="100"',
		)
		.replaceAll(' kern="0"', ' kern="100"');
	return themeReferences(
		gradients.apply(endParagraphProperties(patched)),
		theme,
	);
}

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

/** Replaces the shape or picture with this name. */
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

/** Styles each list paragraph's marker. */
function styleMarkers(
	shape: string,
	markers: ListMarker[],
	color: string | undefined,
) {
	const bulletColor = color
		? `<a:buClr><a:srgbClr val="${color.toUpperCase()}"/></a:buClr>`
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

// pptxgenjs writes paragraph properties before every run, but a paragraph may only have one, as its first child.
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
				new RegExp(
					`<a:srgbClr val="${color.toUpperCase()}"(/>|>(.*?)</a:srgbClr>)`,
					"s",
				),
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

	// A fresh package has no folder entries, which break some cloud editors.
	const output = new JSZip();
	for (const file of zip.file(/./)) {
		output.file(file.name, await file.async("uint8array"), {
			createFolders: false,
			date: new Date(REPRODUCIBLE_DATE),
		});
	}

	return output.generateAsync({ compression: "DEFLATE", type: "nodebuffer" });
}

/** Points every hyperlink to the same target at one relationship. */
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

	const [dark, light] = darkAndLight(theme);
	const colors: [string, string | undefined][] = [
		["dk1", dark],
		["lt1", light],
		["hlink", theme.link],
		["folHlink", theme.link],
		...theme.accents
			.slice(0, 6)
			.map((color, index): [string, string] => [
				`accent${String(index + 1)}`,
				color,
			]),
	];
	let patched = original;
	for (const [name, color] of colors) {
		if (color) {
			patched = patchOnce(
				patched,
				new RegExp(`<a:${name}>.*?</a:${name}>`),
				`<a:${name}><a:srgbClr val="${color.toUpperCase()}"/></a:${name}>`,
			);
		}
	}

	for (const [scheme, font] of [
		["majorFont", theme.majorFont],
		["minorFont", theme.minorFont],
	] as const) {
		if (font) {
			patched = patchOnce(
				patched,
				new RegExp(
					`<a:${scheme}><a:latin [^>]*/><a:ea typeface=""/><a:cs typeface=""/>`,
				),
				`<a:${scheme}>${["latin", "ea", "cs"].map((script) => `<a:${script} typeface="${escapeXml(font)}"/>`).join("")}`,
			);
		}
	}

	const name = escapeXml(theme.name);
	zip.file(
		slideTheme,
		[
			/(<a:theme\b[^>]*) name="Office Theme"/,
			/(<a:clrScheme) name="Office"/,
			/(<a:fontScheme) name="Office"/,
			/(<thm15:themeFamily\b[^>]*) name="Office Theme"/,
		].reduce(
			(xml, element) =>
				patchOnce(xml, element, (_, start) => `${start} name="${name}"`),
			patched,
		),
	);
}

const darkAndLight = ({ background, text }: Theme) =>
	luminance(background) < luminance(text)
		? [background, text]
		: [text, background];

const luminance = (color: string) =>
	[0.299, 0.587, 0.114].reduce(
		(sum, weight, index) =>
			sum + weight * parseInt(color.slice(index * 2, index * 2 + 2), 16),
		0,
	);

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

	const master = await read(zip, masterFile);
	const { title } = theme;
	const [width, height] = slideSizeOf(await read(zip, "ppt/presentation.xml"));
	const box = title ?? {
		cx: Math.round(width * 0.9),
		cy: Math.round(height * 0.15),
		x: Math.round(width * 0.05),
		y: Math.round(height * 0.05),
	};
	const withBackground = patchOnce(
		master,
		"<p:cSld>",
		`<p:cSld><p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${backgroundId}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`,
	);
	const withTitle = patchOnce(
		withBackground,
		"</p:grpSpPr>",
		`</p:grpSpPr>${titleShape(
			`<p:spPr><a:xfrm><a:off x="${String(box.x)}" y="${String(box.y)}"/><a:ext cx="${String(box.cx)}" cy="${String(box.cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`,
			'<a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"/>',
		)}`,
	);
	const styled = bodyDefaults(
		title ? titleStyle(withTitle, title, theme) : withTitle,
		"p:otherStyle",
		theme,
	);
	zip.file(
		masterFile,
		darkAndLight(theme)[0] === theme.background
			? patchOnce(
					styled,
					'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"',
					'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"',
				)
			: styled,
	);
}

/** Gives the master's title style a title's alignment, spacing, size, color, and font. */
function titleStyle(master: string, title: TitleLook, theme: Theme) {
	const color = title.color.toUpperCase();
	const replacements = [
		[' algn="ctr"', ` algn="${title.align}"`],
		["<a:spcBef>", `${lineSpacingXml(title.lineSpacing)}<a:spcBef>`],
		[' sz="4400"', ` sz="${String(title.size)}"`],
		[
			'<a:schemeClr val="tx1"/>',
			color === theme.text.toUpperCase()
				? '<a:schemeClr val="tx1"/>'
				: `<a:srgbClr val="${color}"/>`,
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

const slideSizeOf = (presentation: string) => {
	const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(presentation);
	if (!size) {
		throw new Error("The presentation has no slide size.");
	}

	return [Number(size[1]), Number(size[2])];
};

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

async function writePresentation(zip: JSZip, theme: Theme) {
	const presentationFile = "ppt/presentation.xml";
	zip.file(
		presentationFile,
		bodyDefaults(
			// pptxgenjs writes the notes size as the slide size turned sideways.
			patchOnce(
				await read(zip, presentationFile),
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

/** Points every relationship to identical media at one file. */
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

/** Writes a slide's speaker notes, formatting their Markdown. */
interface NotesFormat {
	bold: boolean;
	code: boolean;
	href?: string;
	italic: boolean;
	strike: boolean;
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
				paragraphs.join("") || '<a:p><a:endParaRPr lang="en-US"/></a:p>',
			),
		),
	);
	if (links.size) {
		zip.file(relsFile, rels);
	}
}

/** Notes paragraphs from Markdown: one per paragraph, heading, list item, and code line, with a blank paragraph wherever the source has blank lines. */
function notesParagraphs(
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

	const inlineRuns = (children: Token[], bold: boolean) => {
		const pieces: { format: NotesFormat; text: string }[] = [];
		const format: NotesFormat = {
			bold,
			code: false,
			italic: false,
			strike: false,
		};
		const add = (text: string, pieceFormat: NotesFormat) => {
			const last = pieces.at(-1);
			if (last && JSON.stringify(last.format) === JSON.stringify(pieceFormat)) {
				last.text += text;
			} else {
				pieces.push({ format: { ...pieceFormat }, text });
			}
		};

		let runs = "";
		const flush = () => {
			runs += pieces.map((piece) => run(piece.text, piece.format)).join("");
			pieces.length = 0;
		};

		for (const child of children) {
			switch (child.type) {
				case "code_inline":
					add(child.content, { ...format, code: true });
					break;
				case "em_close":
				case "em_open":
					format.italic = child.nesting === 1;
					break;
				case "hardbreak":
				case "softbreak":
					flush();
					runs += '<a:br><a:rPr lang="en-US" dirty="0"/></a:br>';
					break;
				case "image":
				case "text":
					add(child.content, format);
					break;
				case "link_close":
				case "link_open":
					format.href =
						child.nesting === 1
							? (child.attrGet("href") ?? undefined)
							: undefined;
					break;
				case "s_close":
				case "s_open":
					format.strike = child.nesting === 1;
					break;
				case "strong_close":
				case "strong_open":
					format.bold = bold || child.nesting === 1;
					break;
			}
		}

		flush();
		return runs;
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
				paragraphs.push('<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>');
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
								`<a:p>${run(line, { bold: false, code: true, italic: false, strike: false })}</a:p>`,
						),
				);
				break;
			case "heading_close":
			case "heading_open":
				heading = token.nesting === 1;
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

/** Drops content types for parts and extensions the package doesn't have, and fixes jpg's. */
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
			// pptxgenjs declares JPEGs as the nonstandard image/jpg.
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
			const alpha =
				stop.transparency > 0
					? `<a:alpha val="${String(Math.round((100 - stop.transparency) * 1000))}"/>`
					: "";
			return `<a:gs pos="${String(Math.round(stop.position * 1000))}"><a:srgbClr val="${stop.color.toUpperCase()}">${alpha}</a:srgbClr></a:gs>`;
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
