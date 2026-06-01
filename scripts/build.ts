#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { $ } from "bun";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = `${ROOT}bin`;

async function build(entry: string, outName: string): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const outFile = `${OUT_DIR}/${outName}`;
  process.stderr.write(`building ${outName} from ${entry}...\n`);
  await $`bun build --compile --target=bun ${entry} --outfile ${outFile}`.cwd(ROOT);
  process.stderr.write(`  -> ${outFile}\n`);
}

await build("src/bin/apicultr.ts", "apicultr");
await build("src/bin/hive.ts", "hive");
process.stderr.write("\nbuild complete.\n");
