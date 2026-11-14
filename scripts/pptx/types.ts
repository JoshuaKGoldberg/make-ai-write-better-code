export interface BuildPptxOptions {
	/** Whether to export in dark mode; defaults to whether the deck's `colorSchema` is "dark". */
	dark?: boolean;
	/** The deck's Markdown entry, relative to the working directory; defaults to "slides.md". */
	entry?: string;
	/** The .pptx file to write. */
	output: string;
	/** The slides to build, as a Slidev range such as "1,4-6"; defaults to all of them. */
	range?: string;
	/** Whether to write one static slide per click state instead of animating clicks. */
	withClicks?: boolean;
	/** A directory to keep intermediate files in: the model, rendered images, and Vite's cache. Defaults to a temporary directory, removed once built. */
	work?: string;
}

/** Something in the deck that may not have exported as it looks in Slidev. */
export interface BuildPptxProblem {
	/** The click state it happened in, when it's specific to one. */
	click?: number;
	message: string;
	/** "error" when content is missing from the PowerPoint, or "warning" when it's there but may look different. */
	severity: "error" | "warning";
	/** The 1-based slide number, when it's specific to one slide. */
	slide?: number;
}

export interface BuildPptxResult {
	problems: BuildPptxProblem[];
	/** How many PowerPoint slides were written: one per Slidev slide, or one per click state with `withClicks`. */
	slides: number;
}
