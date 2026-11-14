/**
 * Loads the files a deck's pages refer to (images, fonts) the way its dev server
 * serves them: public files, Vite-served project and dependency files, data: URIs,
 * and remote URLs.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

export type ImageFormat =
	"avif" | "bmp" | "gif" | "jpeg" | "png" | "svg" | "webp";

export function createAssets({ publicDir, root, work }: AssetsOptions): Assets {
	const loaded = new Map<string, Promise<Buffer | undefined>>();
	const ready = new Map<string, Buffer | undefined>();
	const saved = new Map<string, string>();

	const read = async (url: string): Promise<Buffer | undefined> => {
		const comma = url.indexOf(",");
		if (url.startsWith("data:") && comma > 0) {
			const body = url.slice(comma + 1);
			return url.slice(0, comma).endsWith(";base64")
				? Buffer.from(body, "base64")
				: Buffer.from(decodeURIComponent(body));
		}

		if (/^(?:https?:)?\/\//i.test(url)) {
			try {
				const response = await fetch(
					url.startsWith("//") ? `https:${url}` : url,
					{
						signal: AbortSignal.timeout(30_000),
					},
				);
				return response.ok
					? Buffer.from(await response.arrayBuffer())
					: undefined;
			} catch {
				return undefined;
			}
		}

		const file = localFile(url, { publicDir, root });
		return file ? fs.readFileSync(file) : undefined;
	};

	return {
		get: (url) => ready.get(unquote(url)),
		load(url) {
			const key = unquote(url);
			let promise = loaded.get(key);
			if (!promise) {
				promise = read(key).then((buffer) => {
					ready.set(key, buffer);
					return buffer;
				});
				loaded.set(key, promise);
			}

			return promise;
		},
		save(url) {
			const key = unquote(url);
			const data = ready.get(key);
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

/** Recognizes an image format by its leading bytes. */
export function imageFormat(data: Buffer): ImageFormat | undefined {
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
			for (let i = 2; i + 9 < data.length;) {
				const marker = data[i + 1];
				if (
					marker >= 0xc0 &&
					marker <= 0xcf &&
					![0xc4, 0xc8, 0xcc].includes(marker)
				) {
					return { h: data.readUInt16BE(i + 5), w: data.readUInt16BE(i + 7) };
				}

				i += 2 + data.readUInt16BE(i + 2);
			}

			return undefined;
		case "png":
			return { h: data.readUInt32BE(20), w: data.readUInt32BE(16) };
		case "svg": {
			const tag = /<svg\b[^>]*>/i.exec(data.toString("utf8"))?.[0] ?? "";
			const attribute = (name: string) =>
				new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
			const viewBox = attribute("viewBox")
				?.trim()
				.split(/[\s,]+/)
				.map(Number);
			const w = parseFloat(attribute("width") ?? "") || viewBox?.[2];
			const h = parseFloat(attribute("height") ?? "") || viewBox?.[3];
			return w && h ? { h, w } : undefined;
		}
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

/** Where a page URL's file is on disk: public files first, then files Vite serves from the project or file system. */
function localFile(
	url: string,
	{ publicDir, root }: Pick<AssetsOptions, "publicDir" | "root">,
) {
	let pathname = url.replace(/[?#].*$/, "");
	try {
		pathname = decodeURIComponent(pathname);
	} catch {
		// Keep the path as written.
	}

	const candidates = pathname.startsWith("/@fs/")
		? [pathname.slice("/@fs".length)]
		: pathname.startsWith("/")
			? [path.join(publicDir, pathname), path.join(root, pathname), pathname]
			: [path.resolve(root, pathname)];
	return candidates.find(
		(candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
	);
}

const unquote = (url: string) => url.trim().replace(/^(["'])(.*)\1$/s, "$2");

/** The URLs in a CSS value's url() functions, unquoted. */
export function cssUrls(value: string): string[] {
	return [...value.matchAll(/url\(([^)]*)\)/g)].map(([, inner]) =>
		unquote(inner),
	);
}
