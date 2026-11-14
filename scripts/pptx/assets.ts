/**
 * Loads the files a deck's pages refer to (images, fonts) the way its dev server
 * serves them: public files, Vite-served project and dependency files, data: URIs,
 * and remote URLs.
 */
import * as csstree from "css-tree";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveLength } from "./cascade.ts";
import { unquote } from "./css.ts";

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
		get: (url) => files.get(unquote(url)),
		load: (url) => files.load(unquote(url)),
		save(url) {
			const key = unquote(url);
			const data = files.get(key);
			if (!data) {
				return undefined;
			}

			let file = saved.get(key);
			if (!file) {
				const hash = createHash("sha1").update(data).digest("hex").slice(0, 12);
				const extension =
					imageFormat(data) ??
					(path.extname(key.replace(/[?#].*$/, "")).slice(1) || "bin");
				file = path.join(work, "assets", `${hash}.${extension}`);
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, data);
				saved.set(key, file);
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

/** Recognizes an image format by its leading bytes. */
export function imageFormat(data: Buffer) {
	if (data.length >= 4 && data.readUInt32BE(0) === 0x89504e47) {
		return "png";
	}

	if (data[0] === 0xff && data[1] === 0xd8) {
		return "jpeg";
	}

	const head = data.toString("latin1", 0, 12);
	if (head.startsWith("GIF")) {
		return "gif";
	}

	if (head.startsWith("BM")) {
		return "bmp";
	}

	if (head.startsWith("RIFF") && head.slice(8) === "WEBP") {
		return "webp";
	}

	if (
		head.slice(4, 8) === "ftyp" &&
		/avi[fs]/.test(data.toString("latin1", 8, 32))
	) {
		return "avif";
	}

	return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--.*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg\b/is.test(
		data.toString("utf8", 0, 1024),
	)
		? "svg"
		: undefined;
}

/** Reads an image's natural size from its header (PNG, GIF, JPEG, WebP, BMP, or SVG). */
export function imageSize(data: Buffer): undefined | { h: number; w: number } {
	switch (imageFormat(data)) {
		case "bmp":
			return { h: Math.abs(data.readInt32LE(22)), w: data.readInt32LE(18) };
		case "gif":
			return { h: data.readUInt16LE(8), w: data.readUInt16LE(6) };
		case "jpeg":
			for (let offset = 2; offset + 9 < data.length;) {
				const marker = data[offset + 1];
				if (
					marker >= 0xc0 &&
					marker <= 0xcf &&
					![0xc4, 0xc8, 0xcc].includes(marker)
				) {
					return {
						h: data.readUInt16BE(offset + 5),
						w: data.readUInt16BE(offset + 7),
					};
				}

				offset += 2 + data.readUInt16BE(offset + 2);
			}

			return undefined;
		case "png":
			return { h: data.readUInt32BE(20), w: data.readUInt32BE(16) };
		case "svg":
			return svgSize(data.toString("utf8"));
		case "webp": {
			const chunk = data.toString("latin1", 12, 16);
			if (chunk === "VP8X") {
				return {
					h: 1 + data.readUIntLE(27, 3),
					w: 1 + data.readUIntLE(24, 3),
				};
			}

			if (chunk === "VP8L") {
				const bits = data.readUInt32LE(21);
				return { h: 1 + ((bits >> 14) & 0x3fff), w: 1 + (bits & 0x3fff) };
			}

			return {
				h: data.readUInt16LE(28) & 0x3fff,
				w: data.readUInt16LE(26) & 0x3fff,
			};
		}
		default:
			return undefined;
	}
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

/** Where a page URL's file is on disk: public files first, then files Vite serves from the project or file system. */
function localFile(
	url: string,
	{ publicDir, root }: Pick<AssetsOptions, "publicDir" | "root">,
) {
	const pathname = decodePercents(url.replace(/[?#].*$/, "")).toString();
	const candidates = pathname.startsWith("/@fs/")
		? [pathname.slice("/@fs".length).replace(/^\/(?=[a-z]:)/i, "")]
		: [path.join(publicDir, pathname), path.join(root, pathname)];
	return candidates.find((candidate) =>
		fs.statSync(candidate, { throwIfNoEntry: false })?.isFile(),
	);
}

function svgSize(svg: string) {
	const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
	const attribute = (name: string) =>
		new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
	const length = (name: string) => {
		const value = attribute(name)?.trim();
		return value && !value.endsWith("%")
			? resolveLength(value, {
					fontSize: 16,
					rootFontSize: 16,
					viewport: { height: 0, width: 0 },
				}) || undefined
			: undefined;
	};

	const [, , viewWidth, viewHeight] =
		attribute("viewBox")
			?.trim()
			.split(/[\s,]+/)
			.map(Number) ?? [];
	const ratio = viewWidth && viewHeight ? viewWidth / viewHeight : undefined;
	const width = length("width");
	const height = length("height");
	const w = width ?? (height && ratio ? height * ratio : viewWidth);
	const h = height ?? (width && ratio ? width / ratio : viewHeight);
	return w && h ? { h, w } : undefined;
}
