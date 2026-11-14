import * as csstree from "css-tree";
import { imageSize as measureImage } from "image-size";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveInitialLength } from "./cascade.ts";

export interface Assets {
	/** A file already loaded by `load`. */
	get(url: string): Buffer | undefined;
	/** Loads a file by the URL a page refers to it by, or undefined if it can't be found. */
	load(url: string): Promise<Buffer | undefined>;
	/** Writes a loaded file to the work directory (named by its content), returning the path. */
	save(url: string): string | undefined;
}

export interface AssetsOptions {
	/** The deck's public directory, served at the root. */
	publicDir: string;
	/** The deck's directory, which Vite also serves at the root. */
	root: string;
	/** Where `save` writes files. */
	work: string;
}

const NATIVE_FORMATS = new Set(["bmp", "gif", "jpeg", "png"]);
const SVG =
	/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--.*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg\b/is;

export function createAssets({ publicDir, root, work }: AssetsOptions): Assets {
	const files = createCache(async (url: string) => {
		const comma = url.indexOf(",");
		if (url.startsWith("data:") && comma > 0) {
			const body = url.slice(comma + 1);
			return url.slice(0, comma).endsWith(";base64")
				? Buffer.from(body, "base64")
				: decodePercents(body);
		}

		if (/^(?:https?:)?\/\//i.test(url)) {
			try {
				const response = await fetch(
					url.startsWith("//") ? `https:${url}` : url,
					{ signal: AbortSignal.timeout(30_000) },
				);
				return response.ok
					? Buffer.from(await response.arrayBuffer())
					: undefined;
			} catch {
				return undefined;
			}
		}

		const file = localFile(url, { publicDir, root });
		return file ? fs.promises.readFile(file) : undefined;
	});
	const saved = new Map<string, string>();

	return {
		get: files.get,
		load: files.load,
		save(url) {
			const data = files.get(url);
			if (!data) {
				return undefined;
			}

			let file = saved.get(url);
			if (!file) {
				const hash = createHash("sha1").update(data).digest("hex").slice(0, 12);
				const extension =
					imageFormat(data) ??
					(path.extname(withoutQuery(url)).slice(1) || "bin");
				file = path.join(work, "assets", `${hash}.${extension}`);
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, data);
				saved.set(url, file);
			}

			return file;
		},
	};
}

/** Memoizes an async loader, keeping each settled value for synchronous reads. */
export function createCache<Key, Value>(load: (key: Key) => Promise<Value>) {
	const promises = new Map<Key, Promise<Value>>();
	const values = new Map<Key, Value>();
	return {
		get: (key: Key) => values.get(key),
		load: (key: Key) => {
			let promise = promises.get(key);
			if (!promise) {
				promise = load(key).then((value) => {
					values.set(key, value);
					return value;
				});
				promises.set(key, promise);
			}

			return promise;
		},
	};
}

/** The URLs in a CSS value's url() functions. */
export function cssUrls(value: string) {
	const urls: string[] = [];
	csstree.walk(csstree.parse(value, { context: "value" }), {
		enter(node) {
			urls.push(node.value);
		},
		visit: "Url",
	});
	return urls;
}

/** Recognizes an image format by its contents. */
export function imageFormat(data: Buffer) {
	return isSvg(data) ? "svg" : rasterOf(data)?.format;
}

/** Reads an image's natural size, or undefined when it isn't a whole image. */
export function imageSize(data: Buffer) {
	if (isSvg(data)) {
		return svgSize(data.toString("utf8"));
	}

	const raster = rasterOf(data);
	return raster && { height: raster.height, width: raster.width };
}

/** Whether PowerPoint displays an image's format natively. */
export const isNativeImage = (data: Buffer) =>
	NATIVE_FORMATS.has(imageFormat(data) ?? "");

export function withoutQuery(url: string) {
	return url.replace(/[?#].*$/, "");
}

function decodePercents(text: string) {
	return Buffer.concat(
		text
			.split(/(%[\da-f]{2})/i)
			.map((part, index) =>
				index % 2 ? Buffer.from(part.slice(1), "hex") : Buffer.from(part),
			),
	);
}

function isSvg(data: Buffer) {
	return SVG.test(data.toString("utf8", 0, 1024));
}

function localFile(
	url: string,
	{ publicDir, root }: Pick<AssetsOptions, "publicDir" | "root">,
) {
	const pathname = decodePercents(withoutQuery(url)).toString();
	const candidates = pathname.startsWith("/@fs/")
		? [pathname.slice("/@fs".length).replace(/^\/(?=[a-z]:)/i, "")]
		: [path.join(publicDir, pathname), path.join(root, pathname)];
	return candidates.find((candidate) =>
		fs.statSync(candidate, { throwIfNoEntry: false })?.isFile(),
	);
}

function rasterOf(data: Buffer) {
	try {
		// image-size reads past the end of a Buffer that shares Node's pool, so measure a copy.
		const { height, type, width } = measureImage(Uint8Array.from(data));
		return { format: type === "jpg" ? "jpeg" : type, height, width };
	} catch {
		return undefined;
	}
}

function svgSize(svg: string) {
	const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
	const attribute = (name: string) =>
		new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
	const length = (name: string) => {
		const value = attribute(name)?.trim();
		return value && !value.endsWith("%")
			? resolveInitialLength(value, { height: 0, width: 0 }) || undefined
			: undefined;
	};

	const [, , viewWidth, viewHeight] =
		attribute("viewBox")
			?.trim()
			.split(/[\s,]+/)
			.map(Number) ?? [];
	const ratio = viewWidth && viewHeight ? viewWidth / viewHeight : undefined;
	const attributeWidth = length("width");
	const attributeHeight = length("height");
	const width =
		attributeWidth ??
		(attributeHeight && ratio ? attributeHeight * ratio : viewWidth);
	const height =
		attributeHeight ??
		(attributeWidth && ratio ? attributeWidth / ratio : viewHeight);
	return width && height ? { height, width } : undefined;
}
