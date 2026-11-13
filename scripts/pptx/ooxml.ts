/**
 * PresentationML post-processing for what pptxgenjs can't express: click
 * animations, transitions, gradient fills, bullet styling, kerning, rounded
 * picture corners, and deduplicated media.
 */
import type JSZip from "jszip";

import { createHash } from "node:crypto";

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
				`<a:buClr><a:srgbClr val="${color}"/></a:buClr><a:buSzPct val="60000"/><a:buFont typeface="Arial"/><a:buChar char="&#x25CF;"`,
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
	return gradients.apply(out);
}

/** Deduplicates identical media (pptxgenjs embeds a shared background once per slide) and drops folder entries. */
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

	// Folder entries break some cloud editors; removing the entries keeps their files.
	for (const [name, entry] of Object.entries(zip.files)) {
		if (entry.dir) {
			Reflect.deleteProperty(zip.files, name);
		}
	}
}

const escapeXml = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
const unescapeXml = (value: string) =>
	value
		.replace(/&quot;/g, '"')
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
