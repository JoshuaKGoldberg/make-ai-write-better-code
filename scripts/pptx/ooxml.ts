/**
 * PresentationML post-processing for what pptxgenjs can't express or gets wrong: click
 * animations, transitions, gradient fills, bullet styling, kerning, rounded picture
 * corners, decorative pictures, slide titles, one paragraph-properties element per
 * paragraph, the theme and master, notes paragraphs, deduplicated media, accurate content
 * types, and byte-identical output for identical input.
 */
import JSZip from "jszip";
import { createHash } from "node:crypto";
import path from "node:path";

import type { Gradient } from "./model.ts";

import { transitionXml } from "./transitions.ts";

export interface Effect {
	/** The click it plays on, from 1. */
	click: number;
	/** The shape's name, as given to pptxgenjs. */
	name: string;
	/** Animate one paragraph (a list item) instead of the whole shape. */
	paragraph?: number;
	type: "entr" | "exit";
}

export type Gradients = ReturnType<typeof createGradients>;

export interface PackageOptions {
	/** The slide background, as a PNG. */
	background: Buffer;
	emuPerPixel: number;
	gradients: Gradients;
	/** The font for `code` in speaker notes. */
	monospace: string;
	/** Each PowerPoint slide's patches, in order. */
	slides: SlidePatch[];
	theme: Theme;
}

export interface SlidePatch {
	effects: Effect[];
	lists: {
		/** The markers' color, when it isn't the text's. */
		color?: string;
		/** Whether the marker is a disc, circle, or square, which PowerPoint draws in Arial. */
		keyword: boolean;
		name: string;
	}[];
	pictureCorners: { name: string; radius: number }[];
	/** The name of the shape that's the slide's title. */
	title?: string;
	/** The Slidev transition into the slide, if any. */
	transition?: string;
}

/** The colors new content in PowerPoint starts from, as hex. */
export interface Theme {
	background: string;
	link?: string;
	text: string;
}

/** A stand-in language that marks a run to be shown capitalized (`cap="all"`). */
export const UPPERCASE_LANG = "x-pptx-uppercase";

/** Alt text that marks a picture as decorative, so screen readers skip it. */
export const DECORATIVE = "pptx:decorative";

/** Zip entries and document properties get this date, so the same deck always writes the same bytes. */
const PACKAGE_DATE = "1980-01-01T00:00:00Z";

const FADE_DURATION = 300;

const TITLE_PLACEHOLDER = '<p:nvPr><p:ph type="title"/></p:nvPr>';

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
			let out = xml;
			for (const { gradient, sentinel } of byKey.values()) {
				out = out.replace(
					new RegExp(
						`<a:solidFill><a:srgbClr val="${sentinel}"(?:/>|>(?:<a:alpha val="\\d+"/>)?</a:srgbClr>)</a:solidFill>`,
						"g",
					),
					gradientFillXml(gradient),
				);
			}

			return out;
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

const hex = (value: number) =>
	value.toString(16).toUpperCase().padStart(6, "0");

/** Applies a slide's animations, transition, and styling patches to its XML. */
export function patchSlide(
	xml: string,
	patch: SlidePatch,
	gradients: Gradients,
	emuPerPixel: number,
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

	let out = xml.replace(
		"</p:clrMapOvr>",
		`</p:clrMapOvr>${transitionXml(patch.transition)}${patch.effects.length ? timingXml(patch.effects, ids, shapes) : ""}`,
	);

	for (const { name, radius } of patch.pictureCorners) {
		out = replaceShape(out, name, (picture) => {
			const extent = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(picture);
			if (!extent) {
				throw new Error(`Picture "${name}" has no size.`);
			}

			const adjust = Math.round(
				((radius * emuPerPixel) /
					Math.min(Number(extent[1]), Number(extent[2]))) *
					100000,
			);
			return picture.replace(
				/<a:prstGeom prst="rect">.*?<\/a:prstGeom>/s,
				`<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${String(adjust)}"/></a:avLst></a:prstGeom>`,
			);
		});
	}

	// Arial's ● at 60% best matches a browser's disc marker in size and height (measured in
	// PowerPoint), and its ○ and ■ its circle and square.
	for (const { color, keyword, name } of patch.lists) {
		const bulletColor = color
			? `<a:buClr><a:srgbClr val="${color.toUpperCase()}"/></a:buClr>`
			: "";
		const size = keyword
			? '<a:buSzPct val="60000"/><a:buFont typeface="Arial"/>'
			: '<a:buSzPct val="100000"/>';
		out = replaceShape(out, name, (shape) =>
			shape.replace(
				/<a:buSzPct val="100000"\/>(?=<a:buChar char="&#x(?!00A0;)|<a:buFont typeface="\+mj-lt"\/><a:buAutoNum)/g,
				bulletColor + size,
			),
		);
	}

	if (patch.title) {
		out = replaceShape(out, patch.title, (shape) =>
			shape
				.replace(
					'<p:cNvSpPr txBox="1"/>',
					'<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>',
				)
				.replace("<p:nvPr></p:nvPr>", TITLE_PLACEHOLDER),
		);
	}

	out = out.replaceAll(`lang="${UPPERCASE_LANG}"`, 'lang="en-US" cap="all"');

	// Browsers kern text by default; PowerPoint only kerns runs that ask for it. pptxgenjs
	// also turns kerning off for letter-spaced runs, where browsers apply both.
	out = out
		.replace(
			/<a:rPr lang="en-US"(?![^>]*\bkern=)/g,
			'<a:rPr lang="en-US" kern="100"',
		)
		.replaceAll(' kern="0"', ' kern="100"');
	return gradients.apply(
		markDecorative(endParagraphProperties(singleParagraphProperties(out))),
	);
}

function markDecorative(xml: string) {
	return xml.replace(
		new RegExp(
			`(<p:cNvPr [^>]*?)descr="${DECORATIVE}"([^>]*>)(.*?)</p:cNvPr>`,
			"gs",
		),
		(_, start: string, end: string, body: string) =>
			`${start}descr=""${end}${body}<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst></p:cNvPr>`,
	);
}

/** Replaces the shape or picture with this name. */
function replaceShape(
	xml: string,
	name: string,
	replace: (shape: string) => string,
) {
	const at = xml.indexOf(` name="${escapeXml(name)}"`);
	const start = Math.max(
		xml.lastIndexOf("<p:sp>", at),
		xml.lastIndexOf("<p:pic>", at),
	);
	if (at < 0 || start < 0) {
		throw new Error(`No shape named "${name}".`);
	}

	const close = xml.startsWith("<p:sp>", start) ? "</p:sp>" : "</p:pic>";
	const end = xml.indexOf(close, at) + close.length;
	return xml.slice(0, start) + replace(xml.slice(start, end)) + xml.slice(end);
}

/**
 * Keeps only each paragraph's leading properties element: pptxgenjs writes them before
 * every run, but a paragraph may only have one, as its first child.
 */
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

/** Patches every slide, then tidies the package and writes it with fixed dates. */
export async function finishPackage(
	zip: JSZip,
	{
		background,
		emuPerPixel,
		gradients,
		monospace,
		slides,
		theme,
	}: PackageOptions,
) {
	for (const [index, patch] of slides.entries()) {
		const name = `ppt/slides/slide${String(index + 1)}.xml`;
		zip.file(
			name,
			patchSlide(await read(zip, name), patch, gradients, emuPerPixel),
		);
	}

	await applyTheme(zip, theme, background);
	await deduplicateMedia(zip);
	await tidyContentTypes(zip);
	await splitNotesParagraphs(zip, monospace);
	zip.file(
		"docProps/core.xml",
		(await read(zip, "docProps/core.xml")).replace(
			/(<dcterms:(?:created|modified)\b[^>]*>)[^<]*/g,
			`$1${PACKAGE_DATE}`,
		),
	);

	// A fresh package has no folder entries, which break some cloud editors.
	const output = new JSZip();
	for (const file of zip.file(/./)) {
		output.file(file.name, await file.async("uint8array"), {
			createFolders: false,
			date: new Date(PACKAGE_DATE),
		});
	}

	return output.generateAsync({ compression: "DEFLATE", type: "nodebuffer" });
}

/**
 * Gives the theme the deck's colors, and the master the deck's background and a title
 * placeholder. Its one layout, pptxgenjs's default, inherits both.
 */
async function applyTheme(zip: JSZip, theme: Theme, background: Buffer) {
	const [dark, light] =
		luminance(theme.background) < luminance(theme.text)
			? [theme.background, theme.text]
			: [theme.text, theme.background];
	const colors: Partial<Record<string, string>> = {
		dk1: dark,
		dk2: dark,
		folHlink: theme.link,
		hlink: theme.link,
		lt1: light,
		lt2: light,
	};
	const themeFile = "ppt/theme/theme1.xml";
	zip.file(
		themeFile,
		(await read(zip, themeFile)).replace(
			/<a:(dk1|lt1|dk2|lt2|hlink|folHlink)>.*?<\/a:\1>/g,
			(element, name: string) => {
				const color = colors[name];
				return color
					? `<a:${name}><a:srgbClr val="${color.toUpperCase()}"/></a:${name}>`
					: element;
			},
		),
	);

	const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(
		await read(zip, "ppt/presentation.xml"),
	);
	if (!size) {
		throw new Error("The presentation has no slide size.");
	}

	const [width, height] = [Number(size[1]), Number(size[2])];
	const titleShape = (properties: string, body: string) =>
		`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>${TITLE_PLACEHOLDER}</p:nvSpPr>${properties}<p:txBody>${body}<a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;

	const masterFile = "ppt/slideMasters/slideMaster1.xml";
	const masterRels = "ppt/slideMasters/_rels/slideMaster1.xml.rels";
	const rels = await read(zip, masterRels);
	const backgroundId = `rId${String(
		Math.max(
			...[...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1])),
		) + 1,
	)}`;
	zip.file("ppt/media/background.png", background);
	zip.file(
		masterRels,
		rels.replace(
			"</Relationships>",
			`<Relationship Id="${backgroundId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/background.png"/></Relationships>`,
		),
	);
	const master = (await read(zip, masterFile))
		.replace(
			"<p:cSld>",
			`<p:cSld><p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${backgroundId}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`,
		)
		.replace(
			"</p:grpSpPr>",
			`</p:grpSpPr>${titleShape(
				`<p:spPr><a:xfrm><a:off x="${String(Math.round(width * 0.05))}" y="${String(Math.round(height * 0.05))}"/><a:ext cx="${String(Math.round(width * 0.9))}" cy="${String(Math.round(height * 0.15))}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`,
				'<a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"/>',
			)}`,
		);
	zip.file(
		masterFile,
		dark === theme.background
			? master.replace(
					'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"',
					'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"',
				)
			: master,
	);

	const layoutFile = "ppt/slideLayouts/slideLayout1.xml";
	zip.file(
		layoutFile,
		(await read(zip, layoutFile))
			.replace(
				/<p:cSld name="[^"]*"><p:bg>.*?<\/p:bg>/s,
				'<p:cSld name="Title Only">',
			)
			.replace(
				"</p:grpSpPr>",
				`</p:grpSpPr>${titleShape("<p:spPr/>", "<a:bodyPr/>")}`,
			),
	);
}

const luminance = (color: string) =>
	[0.299, 0.587, 0.114].reduce(
		(sum, weight, index) =>
			sum + weight * parseInt(color.slice(index * 2, index * 2 + 2), 16),
		0,
	);

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
		let out = xml;
		for (const [duplicate, kept] of replacements) {
			out = out.replaceAll(
				`../media/${path.posix.basename(duplicate)}"`,
				`../media/${path.posix.basename(kept)}"`,
			);
		}

		if (out !== xml) {
			zip.file(file.name, out);
		}
	}

	for (const duplicate of replacements.keys()) {
		zip.remove(duplicate);
	}
}

/**
 * Splits speaker notes into one paragraph per line: pptxgenjs writes them as a single
 * run with raw line breaks. Blank lines stay as empty paragraphs between paragraphs.
 */
async function splitNotesParagraphs(zip: JSZip, monospace: string) {
	for (const file of zip.file(/^ppt\/notesSlides\/notesSlide\d+\.xml$/)) {
		const xml = await file.async("string");
		const out = xml.replace(
			/<a:p><a:r>(<a:rPr [^>]*\/>)<a:t>([^<]*)<\/a:t><\/a:r>(<a:endParaRPr [^>]*\/>)<\/a:p>/g,
			(paragraph, properties: string, text: string, end: string) =>
				/[\r\n]/.test(text)
					? text
							.split(/\r?\n/)
							.map((line) =>
								line
									? `<a:p>${notesRuns(line, properties, monospace)}</a:p>`
									: `<a:p>${end}</a:p>`,
							)
							.join("")
					: paragraph,
		);
		if (out !== xml) {
			zip.file(file.name, out);
		}
	}
}

/** A notes line's runs, with Markdown's inline `code`, **bold**, and *italic* formatted. */
function notesRuns(line: string, properties: string, monospace: string) {
	const run = (text: string, format: "b" | "code" | "i" | undefined) => {
		const formatted =
			format === "code"
				? properties.replace(
						"/>",
						`><a:latin typeface="${escapeXml(monospace)}"/></a:rPr>`,
					)
				: format
					? properties.replace("<a:rPr ", `<a:rPr ${format}="1" `)
					: properties;
		return `<a:r>${formatted}<a:t>${text}</a:t></a:r>`;
	};

	let out = "";
	let index = 0;
	for (const match of line.matchAll(
		/`(?<code>[^`]+)`|\*\*(?<bold>[^*]+)\*\*|\*(?<starred>[^*\s][^*]*)\*|\b_(?<underscored>[^_\s][^_]*)_\b/g,
	)) {
		if (match.index > index) {
			out += run(line.slice(index, match.index), undefined);
		}

		const { bold, code, starred, underscored } = match.groups ?? {};
		out += code
			? run(code, "code")
			: bold
				? run(bold, "b")
				: run(starred || underscored, "i");
		index = match.index + match[0].length;
	}

	return out + (index < line.length ? run(line.slice(index), undefined) : "");
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
	const name = "[Content_Types].xml";
	const extensions = new Set(
		Object.keys(zip.files).map((file) =>
			path.extname(file).slice(1).toLowerCase(),
		),
	);
	zip.file(
		name,
		(await read(zip, name))
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

/** Escapes text for an XML attribute exactly as pptxgenjs does, so names can be found again. */
const escapeXml = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");

function gradientFillXml({ angle, stops }: Gradient) {
	const stopXml = stops
		.map((stop) => {
			const alpha =
				stop.transparency > 0
					? `<a:alpha val="${String(Math.round((100 - stop.transparency) * 1000))}"/>`
					: "";
			return `<a:gs pos="${String(Math.round(stop.position * 1000))}"><a:srgbClr val="${stop.hex.toUpperCase()}">${alpha}</a:srgbClr></a:gs>`;
		})
		.join("");
	return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${stopXml}</a:gsLst><a:lin ang="${String(Math.round(normalizeDegrees(angle - 90) * 60000))}" scaled="1"/></a:gradFill>`;
}

/** Builds a slide's p:timing: one click group per click, each fading shapes or paragraphs in or out. */
function timingXml(
	effects: Effect[],
	ids: Map<string, string>,
	shapes: Set<string>,
) {
	const groups = new Map<string, number>();
	const animations = effects
		.toSorted((a, b) => a.click - b.click)
		.map((effect) => {
			const shapeId = ids.get(escapeXml(effect.name));
			if (!shapeId) {
				throw new Error(
					`Click ${String(effect.click)}: no shape named "${effect.name}".`,
				);
			}

			const key = `${shapeId}:${String(effect.paragraph ?? "shape")}`;
			const groupId = groups.get(key) ?? 0;
			groups.set(key, groupId + 1);
			return { ...effect, groupId, shapeId };
		});

	let id = 3;
	const next = () => String(id++);
	const body = [...new Set(animations.map(({ click }) => click))]
		.map((click) => {
			const inner = animations
				.filter((animation) => animation.click === click)
				.map((animation, index) => {
					const target = `<p:tgtEl><p:spTgt spid="${animation.shapeId}">${animation.paragraph === undefined ? "" : `<p:txEl><p:pRg st="${String(animation.paragraph)}" end="${String(animation.paragraph)}"/></p:txEl>`}</p:spTgt></p:tgtEl>`;
					const visibility = (value: string, delay: number) =>
						`<p:set><p:cBhvr><p:cTn id="${next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${String(delay)}"/></p:stCondLst></p:cTn>${target}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${value}"/></p:to></p:set>`;
					const fade = (direction: string) =>
						`<p:animEffect transition="${direction}" filter="fade"><p:cBhvr><p:cTn id="${next()}" dur="${String(FADE_DURATION)}"/>${target}</p:cBhvr></p:animEffect>`;
					const effectId = next();
					const children =
						animation.type === "entr"
							? visibility("visible", 0) + fade("in")
							: fade("out") + visibility("hidden", FADE_DURATION - 1);
					return `<p:par><p:cTn id="${effectId}" presetID="10" presetClass="${animation.type}" presetSubtype="0" fill="hold" grpId="${String(animation.groupId)}" nodeType="${index === 0 ? "clickEffect" : "withEffect"}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${children}</p:childTnLst></p:cTn></p:par>`;
				})
				.join("");
			const outer = next();
			const group = next();
			return `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${group}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
		})
		.join("");

	// Shapes (not pictures) need a build entry per animation group.
	const builds = new Map(
		animations
			.filter(({ shapeId }) => shapes.has(shapeId))
			.map((animation) => [
				`${animation.shapeId}:${String(animation.groupId)}:${animation.paragraph === undefined ? "" : "p"}`,
				`<p:bldP spid="${animation.shapeId}" grpId="${String(animation.groupId)}" ${animation.paragraph === undefined ? 'animBg="1"' : 'build="p"'}/>`,
			]),
	);
	const buildList = [...builds.values()].join("");
	return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${buildList ? `<p:bldLst>${buildList}</p:bldLst>` : ""}</p:timing>`;
}
