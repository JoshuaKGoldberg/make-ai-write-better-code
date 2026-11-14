import { cli } from "./cli.ts";

process.exitCode = await cli(process.argv.slice(2));
