/** A problem that stops `buildPptx` before it builds anything, such as an invalid option or an unsupported Slidev version. */
export class BuildPptxError extends Error {
	override name = "BuildPptxError";
}
