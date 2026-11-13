/**
 * PresentationML post-processing for what pptxgenjs can't express or gets wrong: click
 * animations, transitions, gradient fills, bullet styling, kerning, rounded picture
 * corners, decorative pictures, one paragraph-properties element per paragraph, notes
 * paragraphs, deduplicated media, and accurate content types.
 */
import type JSZip from "jszip";

import { createHash } from "node:crypto";
import path from "node:path";

import type { Gradient } from "./model.ts";

export interface Effect {
	/** Set while building the timing XML. */
	groupId?: number;
	/** The shape's name, as given to pptxgenjs. */
	name: string;
	/** Animate one paragraph (a list item) instead of the whole shape. */
	paragraph?: number;
	/** Set once shape names are resolved to ids. */
	shapeId?: string;
	type: "entr" | "exit";
}

export interface SlidePatch {
	bullets: { color: string; name: string }[];
	/** Effects per click number (1-based). */
	effects: Map<number, Effect[]>;
	pictureCorners: { name: string; radius: number }[];
}

/** One placeholder color per gradient, which post-processing swaps for a real gradFill. */
export class GradientRegistry {
	readonly #byKey = new Map<string, { gradient: Gradient; sentinel: string }>();

	/** Replaces placeholder fills in slide XML with the gradients they stand for. */
	apply(xml: string) {
		let out = xml;
		for (const { gradient, sentinel } of this.#byKey.values()) {
			out = out.replace(
				new RegExp(
					`<a:solidFill><a:srgbClr val="${sentinel}"(?:/>|>(?:<a:alpha val="\\d+"/>)?</a:srgbClr>)</a:solidFill>`,
					"g",
				),
				gradientFillXml(gradient),
			);
		}

		return out;
	}

	sentinel(gradient: Gradient) {
		const key = JSON.stringify(gradient);
		let entry = this.#byKey.get(key);
		if (!entry) {
			entry = {
				gradient,
				sentinel: `FE${(0xa000 + this.#byKey.size).toString(16).toUpperCase()}`,
			};
			this.#byKey.set(key, entry);
		}

		return entry.sentinel;
	}
}

/** Applies a slide's animations, transition, and styling patches to its XML. */
export function patchSlide(
	xml: string,
	patch: SlidePatch,
	gradients: GradientRegistry,
	emuPerPx: number,
) {
	const ids = new Map<string, string>();
	const kinds = new Map<string, string>();
	for (const match of xml.matchAll(
		/<p:(sp|pic)>\s*<p:nv(?:Sp|Pic)Pr>\s*<p:cNvPr id="(\d+)" name="([^"]+)"/g,
	)) {
		ids.set(unescapeXml(match[3]), match[2]);
		kinds.set(match[2], match[1]);
	}

	for (const [click, effects] of patch.effects) {
		for (const effect of effects) {
			effect.shapeId = ids.get(effect.name);
			if (!effect.shapeId) {
				throw new Error(
					`Click ${String(click)}: no shape named "${effect.name}".`,
				);
			}
		}
	}

	const transition = `<p:transition spd="fast"><p:fade/></p:transition>`;
	let out = xml.replace(
		"</p:clrMapOvr>",
		`</p:clrMapOvr>${transition}${patch.effects.size ? timingXml(patch.effects, kinds) : ""}`,
	);

	for (const { name, radius } of patch.pictureCorners) {
		const start = out.indexOf(`name="${escapeXml(name)}"`);
		const geometry = out.indexOf('<a:prstGeom prst="rect">', start);
		const end = out.indexOf("</a:prstGeom>", geometry);
		if (start < 0 || geometry < 0 || end < 0) {
			continue;
		}

		const extent = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(
			out.slice(start, geometry),
		);
		const shorter = extent ? Math.min(Number(extent[1]), Number(extent[2])) : 1;
		const adjust = Math.round(((radius * emuPerPx) / shorter) * 100000);
		out = `${out.slice(0, geometry)}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${String(adjust)}"/></a:avLst>${out.slice(end)}`;
	}

	for (const { color, name } of patch.bullets) {
		const start = out.lastIndexOf(
			"<p:sp>",
			out.indexOf(`name="${escapeXml(name)}"`),
		);
		const end = out.indexOf("</p:sp>", start);
		if (start < 0 || end < 0) {
			continue;
		}

		// Arial's ● at 60% best matches a browser's disc marker in size and height (measured in PowerPoint).
		const shape = out
			.slice(start, end)
			.replaceAll(
				'<a:buSzPct val="100000"/><a:buChar char="&#x2022;"',
				`<a:buClr><a:srgbClr val="${color.toUpperCase()}"/></a:buClr><a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="&#x25CF;"`,
			);
		out = out.slice(0, start) + shape + out.slice(end);
	}

	// Browsers kern text by default; PowerPoint only kerns runs that ask for it. pptxgenjs
	// also turns kerning off for letter-spaced runs, where browsers apply both.
	out = out
		.replace(
			/<a:rPr lang="en-US"(?![^>]*\bkern=)/g,
			'<a:rPr lang="en-US" kern="100"',
		)
		.replaceAll(' kern="0"', ' kern="100"');
	return gradients.apply(markDecorative(singleParagraphProperties(out)));
}

/** Alt text that marks a picture as decorative, so screen readers skip it. */
export const DECORATIVE = "pptx:decorative";

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

/**
 * Keeps only each paragraph's leading properties element. pptxgenjs writes paragraph
 * properties before every run, but a paragraph may only have one, as its first child.
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

/** Package-wide cleanup: deduplicates identical media, splits notes into paragraphs, prunes content types, and drops folder entries. */
export async function tidyPackage(zip: JSZip) {
	const canonical = new Map<string, string>();
	const replacements = new Map<string, string>();
	for (const name of Object.keys(zip.files).sort()) {
		const file = zip.file(name);
		if (!name.startsWith("ppt/media/") || !file) {
			continue;
		}

		const hash = createHash("sha256")
			.update(await file.async("nodebuffer"))
			.digest("hex");
		const kept = canonical.get(hash);
		if (kept) {
			replacements.set(name, kept);
		} else {
			canonical.set(hash, name);
		}
	}

	for (const name of Object.keys(zip.files).filter((n) =>
		n.endsWith(".rels"),
	)) {
		const file = zip.file(name);
		if (!file) {
			continue;
		}

		const xml = await file.async("string");
		let out = xml;
		for (const [duplicate, kept] of replacements) {
			out = out.replaceAll(
				`../media/${duplicate.slice("ppt/media/".length)}"`,
				`../media/${kept.slice("ppt/media/".length)}"`,
			);
		}

		if (out !== xml) {
			zip.file(name, out);
		}
	}

	for (const duplicate of replacements.keys()) {
		zip.remove(duplicate);
	}

	await tidyContentTypes(zip);
	await splitNotesParagraphs(zip);

	// Folder entries break some cloud editors; removing the entries keeps their files.
	for (const [name, entry] of Object.entries(zip.files)) {
		if (entry.dir) {
			Reflect.deleteProperty(zip.files, name);
		}
	}
}

/**
 * Splits speaker notes into one paragraph per line: pptxgenjs writes them as a single
 * run with raw line breaks. Blank lines stay as empty paragraphs between paragraphs.
 */
async function splitNotesParagraphs(zip: JSZip) {
	for (const name of Object.keys(zip.files)) {
		const file = zip.file(name);
		if (!file || !/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)) {
			continue;
		}

		const xml = await file.async("string");
		const out = xml.replace(
			/<a:p><a:r>(<a:rPr [^>]*\/>)<a:t>([^<]*)<\/a:t><\/a:r>(<a:endParaRPr [^>]*\/>)<\/a:p>/g,
			(paragraph, properties: string, text: string, end: string) =>
				/[\r\n]/.test(text)
					? text
							.split(/\r?\n/)
							.map((line) =>
								line
									? `<a:p>${notesRuns(line, properties)}</a:p>`
									: `<a:p>${end}</a:p>`,
							)
							.join("")
					: paragraph,
		);
		if (out !== xml) {
			zip.file(name, out);
		}
	}
}

/** A notes line's runs, with Markdown's inline `code`, **bold**, and *italic* formatted. */
function notesRuns(line: string, properties: string) {
	const run = (text: string, format: "b" | "code" | "i" | undefined) => {
		const rPr =
			format === "code"
				? properties.replace("/>", '><a:latin typeface="Menlo"/></a:rPr>')
				: format
					? properties.replace("<a:rPr ", `<a:rPr ${format}="1" `)
					: properties;
		return `<a:r>${rPr}<a:t>${text}</a:t></a:r>`;
	};

	let out = "";
	let index = 0;
	for (const match of line.matchAll(
		/`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\b_([^_\s][^_]*)_\b/g,
	)) {
		if (match.index > index) {
			out += run(line.slice(index, match.index), undefined);
		}

		const [whole, ...groups] = match;
		const text = groups.find(Boolean) ?? "";
		out += run(
			text,
			whole.startsWith("`") ? "code" : whole.startsWith("**") ? "b" : "i",
		);
		index = match.index + match[0].length;
	}

	return out + (index < line.length ? run(line.slice(index), undefined) : "");
}

/** Drops content types for parts and extensions the package doesn't have, and fixes jpg's. */
async function tidyContentTypes(zip: JSZip) {
	const file = zip.file("[Content_Types].xml");
	if (!file) {
		return;
	}

	const names = Object.keys(zip.files);
	const extensions = new Set(
		names.map((name) => path.extname(name).slice(1).toLowerCase()),
	);
	const xml = (await file.async("string"))
		.replace(
			/<Override PartName="\/([^"]+)"[^>]*\/>/g,
			(override, part: string) => (zip.file(part) ? override : ""),
		)
		.replace(
			/<Default Extension="([^"]+)"[^>]*\/>/g,
			(declaration, extension: string) =>
				extensions.has(extension.toLowerCase()) ? declaration : "",
		)
		.replace('ContentType="image/jpg"', 'ContentType="image/jpeg"');
	zip.file("[Content_Types].xml", xml);
}

/** Escapes text for an XML attribute exactly as pptxgenjs does, so names can be found again. */
const escapeXml = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
const unescapeXml = (value: string) =>
	value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");

function gradientFillXml({ angle, stops }: Gradient) {
	const stopXml = stops
		.map((stop) => {
			const alpha =
				stop.a === undefined || stop.a >= 1
					? ""
					: `<a:alpha val="${String(Math.round(stop.a * 100000))}"/>`;
			return `<a:gs pos="${String(Math.round(stop.pos * 1000))}"><a:srgbClr val="${stop.hex.toUpperCase()}">${alpha}</a:srgbClr></a:gs>`;
		})
		.join("");
	// CSS angles start at "to top" (0deg); DrawingML angles start pointing right.
	return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${stopXml}</a:gsLst><a:lin ang="${String(Math.round(((angle - 90 + 360) % 360) * 60000))}" scaled="1"/></a:gradFill>`;
}

/** Builds a slide's p:timing: one click group per click, each fading shapes or paragraphs in or out. */
function timingXml(
	effectsByClick: Map<number, Effect[]>,
	shapeKinds: Map<string, string>,
) {
	let id = 3;
	const next = () => String(id++);
	const groups = new Map<string, number>();
	const target = (effect: Effect) =>
		`<p:tgtEl><p:spTgt spid="${effect.shapeId ?? ""}">${effect.paragraph === undefined ? "" : `<p:txEl><p:pRg st="${String(effect.paragraph)}" end="${String(effect.paragraph)}"/></p:txEl>`}</p:spTgt></p:tgtEl>`;
	let body = "";
	for (const click of [...effectsByClick.keys()].sort((a, b) => a - b)) {
		let inner = "";
		(effectsByClick.get(click) ?? []).forEach((effect, i) => {
			const key = `${effect.shapeId ?? ""}:${String(effect.paragraph ?? "shape")}`;
			const groupId = groups.get(key) ?? 0;
			groups.set(key, groupId + 1);
			effect.groupId = groupId;
			const visibility = (value: string, delay: number) =>
				`<p:set><p:cBhvr><p:cTn id="${next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${String(delay)}"/></p:stCondLst></p:cTn>${target(effect)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${value}"/></p:to></p:set>`;
			const fade = (direction: string) =>
				`<p:animEffect transition="${direction}" filter="fade"><p:cBhvr><p:cTn id="${next()}" dur="300"/>${target(effect)}</p:cBhvr></p:animEffect>`;
			const effectId = next();
			const children =
				effect.type === "entr"
					? visibility("visible", 0) + fade("in")
					: fade("out") + visibility("hidden", 299);
			inner += `<p:par><p:cTn id="${effectId}" presetID="10" presetClass="${effect.type}" presetSubtype="0" fill="hold" grpId="${String(groupId)}" nodeType="${i === 0 ? "clickEffect" : "withEffect"}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${children}</p:childTnLst></p:cTn></p:par>`;
		});
		const outer = next();
		const group = next();
		body += `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${group}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
	}

	// Shapes (not pictures) need a build entry per animation group.
	const builds = new Map<string, Effect>();
	for (const effects of effectsByClick.values()) {
		for (const effect of effects) {
			if (shapeKinds.get(effect.shapeId ?? "") === "sp") {
				builds.set(
					`${effect.shapeId ?? ""}:${String(effect.groupId)}:${effect.paragraph === undefined ? "" : "p"}`,
					effect,
				);
			}
		}
	}

	const buildList = [...builds.values()]
		.map(
			(effect) =>
				`<p:bldP spid="${effect.shapeId ?? ""}" grpId="${String(effect.groupId)}" ${effect.paragraph === undefined ? 'animBg="1"' : 'build="p"'}/>`,
		)
		.join("");
	return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${buildList ? `<p:bldLst>${buildList}</p:bldLst>` : ""}</p:timing>`;
}
