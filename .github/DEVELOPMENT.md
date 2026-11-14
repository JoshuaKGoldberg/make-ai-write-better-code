# Development

After [forking the repo from GitHub](https://help.github.com/articles/fork-a-repo), [installing pnpm](https://pnpm.io/installation), and switching to the Node.js version in [`.nvmrc`](../.nvmrc) (such as with [nvm](https://github.com/nvm-sh/nvm)'s `nvm use`):

```shell
git clone https://github.com/(your-name-here)/make-ai-write-better-code
cd make-ai-write-better-code
pnpm install
```

> This repository includes a list of suggested VS Code extensions.
> It's a good idea to use [VS Code](https://code.visualstudio.com) and accept its suggestion to install them, as they'll help with development.

## Building

Run [Slidev](https://sli.dev) to build the deck into a static site in `dist/`:

```shell
pnpm build
```

### PowerPoint

`pnpm build:pptx` builds the deck into a native, editable PowerPoint file in `dist/`, with no browser involved.
The pipeline in [`scripts/pptx/`](../scripts/pptx) renders each slide and click state with Vite's server-side rendering, lays it out with [takumi](https://www.npmjs.com/package/@takumi-rs/core), and writes native text, lists, shapes, and pictures with [PptxGenJS](https://gitbrent.github.io/PptxGenJS).

Run its CLI directly for more options, such as building a range of slides or one slide per click:

```shell
node scripts/pptx/bin.ts --help
```

Text is measured with the fonts installed on your machine, so builds are most faithful on macOS, which has the deck's monospace and symbol fonts.
Exit code 1 means an error left content out of the file; warnings mean content is there but may look different.

[`scripts/pptx/fixture/`](../scripts/pptx/fixture) is a small deck the tests build to cover Slidev features this deck doesn't use.

## Formatting

[Prettier](https://prettier.io) is used to format code.
It should be applied automatically when you save files in VS Code or make a Git commit.

To manually reformat all files, you can run:

```shell
pnpm format --write
```

## Linting

This package includes several forms of linting to enforce consistent code quality and styling.
Each should be shown in VS Code, and can be run manually on the command-line:

- `pnpm lint` ([ESLint](https://eslint.org) with [typescript-eslint](https://typescript-eslint.io)): Lints source files, including JavaScript, Markdown, TypeScript, and Vue
- `pnpm lint:knip` ([knip](https://github.com/webpro/knip)): Detects unused files, dependencies, and code exports
- `pnpm lint:spelling` ([cspell](https://cspell.org)): Spell checks across all source files

Read the individual documentation for each linter to understand how it can be configured and used best.

For example, ESLint can be run with `--fix` to auto-fix some lint rule complaints:

```shell
pnpm run lint --fix
```

## Testing

[Vitest](https://vitest.dev) is used for tests.
You can run it locally on the command-line:

```shell
pnpm run test
```

Add the `--coverage` flag to compute test coverage and place reports in the `coverage/` directory:

```shell
pnpm run test --coverage
```

Note that [console-fail-test](https://github.com/JoshuaKGoldberg/console-fail-test) is enabled for all test runs.
Calls to `console.log`, `console.warn`, and other console methods will cause a test to fail.

### Debugging Tests

This repository includes a [VS Code launch configuration](https://code.visualstudio.com/docs/editor/debugging) for debugging unit tests.
To launch it, open a test file, then run _Debug Current Test File_ from the VS Code Debug panel (or press F5).

## Type Checking

You should be able to see suggestions from [TypeScript](https://typescriptlang.org) in your editor for all open files.

However, it can be useful to run the TypeScript command-line (`tsc`) to type check all TypeScript files:

```shell
pnpm tsc
```

Add `--watch` to keep the type checker running in a watch mode that updates the display as you save files:

```shell
pnpm tsc --watch
```
