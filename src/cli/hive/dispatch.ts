import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { buildCodenameIndex } from "../../core/addressing.ts";
import { withDispatchLock } from "../../core/dispatch-lock.ts";
import { isoDate, slugify } from "../../core/paths.ts";
import { createRuntime, discoverHive } from "../../core/runtime.ts";
import type { Command, CommandContext } from "../command-router.ts";

interface DispatchOptions {
  target: string;
  hive: string | undefined;
  briefFile: string | undefined;
}

function parseDispatchArgs(argv: string[]): DispatchOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      hive: { type: "string" },
      brief: { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });
  const target = positionals[0];
  if (!target) throw new Error("hive dispatch <persona> — persona address or codename is required");
  return {
    target,
    hive: values["hive"] as string | undefined,
    briefFile: values["brief"] as string | undefined,
  };
}

async function readBriefContent(opts: DispatchOptions): Promise<string> {
  if (opts.briefFile) {
    return readFile(opts.briefFile, "utf8");
  }
  // stdin: collect chunks
  if (process.stdin.isTTY) {
    throw new Error(
      'no brief provided. Pipe content via stdin or pass --brief <file>. Example:\n  echo "build the form" | hive dispatch frontend-001',
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function briefTitle(content: string): string {
  // Use the first non-empty line as the brief slug seed.
  const lines = content.split("\n").map((l) => l.trim());
  for (const line of lines) {
    if (line) return line.replace(/^#+\s*/, "");
  }
  return "brief";
}

async function handle(ctx: CommandContext): Promise<number> {
  let opts: DispatchOptions;
  try {
    opts = parseDispatchArgs(ctx.commandArgv);
  } catch (err) {
    ctx.logger.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const root = opts.hive ?? discoverHive();
  if (!root) {
    ctx.logger.error("no hive.toml found. Pass --hive <dir> or `cd` into a hive directory.");
    return 1;
  }
  const runtime = createRuntime();
  const hive = await runtime.loadHive(root);

  const index = buildCodenameIndex(
    hive.personas.map((p) => ({ address: p.canonicalAddress, codename: p.codename })),
  );
  const resolved = index.resolve(opts.target);
  if (!resolved) {
    ctx.logger.error(
      `unknown persona: ${opts.target}. Known addresses: ${index.addresses().join(", ")}. Known codenames: ${index.codenames().join(", ") || "(none)"}`,
    );
    return 1;
  }
  const persona = hive.personas.find((p) => p.canonicalAddress === resolved);
  if (!persona) {
    ctx.logger.error(`persona ${resolved} disappeared from composite hive`);
    return 1;
  }

  const content = await readBriefContent(opts);
  if (!content.trim()) {
    ctx.logger.error("brief content is empty.");
    return 2;
  }

  const slug = slugify(briefTitle(content));
  const date = isoDate();
  const briefPath = `${hive.root.paths.briefsDir}/${persona.canonicalAddress.replace(/:/g, "--")}/${date}-${slug}.md`;
  await mkdir(dirname(briefPath), { recursive: true });
  await writeFile(briefPath, content);

  const backend = await runtime.selectBackend(hive.root.config.runtime.backend);
  const sourcePersona = process.env["APICULTR_PERSONA"];
  await withDispatchLock(hive.root.paths.dispatchLock, async () => {
    const dispatchOpts: { fromPersona?: string; briefPath?: string } = { briefPath };
    if (sourcePersona) dispatchOpts.fromPersona = sourcePersona;
    await backend.dispatch(persona, content, dispatchOpts);
  });

  ctx.logger.print(`dispatched to ${persona.canonicalAddress}: ${briefPath}`);
  if (sourcePersona) {
    ctx.logger.info(`  (source: ${sourcePersona})`);
  }
  return 0;
}

export const dispatchCommand: Command = {
  name: "dispatch",
  summary: "Send a brief to a persona (auto-sequenced via .hive/dispatch.lock)",
  usage: "hive dispatch <persona> [--hive <dir>] [--brief <file>]",
  description:
    "Reads the brief from stdin (default) or --brief <file>, writes it to .hive/briefs/<persona>/<date>-<slug>.md, then delivers it via the active backend. Concurrent dispatches queue on a per-hive lock so the clipboard cannot race.",
  handler: handle,
};
