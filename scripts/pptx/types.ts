export interface BuildPptxOptions {
	/** The color scheme to export in; defaults to the deck's `colorSchema` (light unless it's "dark"). */
	colorScheme?: "dark" | "light";
	/** The Slidev entry, relative to `root`; defaults to "slides.md". */
	entry?: string;
	/** The .pptx file to write. */
	out: string;
	/** The deck's directory; defaults to the working directory. */
	root?: string;
	/** Whether to write one static slide per click state instead of animating clicks, for comparing against Slidev's renders. */
	slidePerClick?: boolean;
	/** Only these slide numbers (1-based). */
	slides?: number[];
	/** A directory to keep intermediate files in: the model and rendered images. Defaults to a temporary directory, removed once built. */
	work?: string;
}

/** Something in the deck that may not have exported as it looks in Slidev. */
export interface BuildPptxProblem {
	/** The click state it happened in, when it's specific to one. */
	click?: number;
	message: string;
	/** The 1-based slide number. */
	slide: number;
}

export interface BuildPptxResult {
	problems: BuildPptxProblem[];
	/** How many PowerPoint slides were written: one per Slidev slide, or one per click state with `slidePerClick`. */
	slides: number;
}
