import { parseArgs } from "node:util";
import { buildCodenameIndex } from "../../core/addressing.ts";
import { createRuntime, discoverHive } from "../../core/runtime.ts";
import type { Command, CommandContext } from "../command-router.ts";

async function handle(ctx: CommandContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: ctx.commandArgv,
    options: { hive: { type: "string" } },
    strict: true,
    allowPositionals: true,
  });
  const root = (values["hive"] as string | undefined) ?? discoverHive();
  if (!root) {
    ctx.logger.error("no hive.toml found. Pass --hive <dir> or `cd` into a hive directory.");
    return 1;
  }
  const runtime = createRuntime();
  const hive = await runtime.loadHive(root);
  const backend = await runtime.selectBackend(hive.root.config.runtime.backend);

  const target = positionals[0];
  if (target) {
    const idx = buildCodenameIndex(
      hive.personas.map((p) => ({ address: p.canonicalAddress, codename: p.codename })),
    );
    const resolved = idx.resolve(target);
    if (!resolved) {
      ctx.logger.error(`unknown persona: ${target}`);
      return 1;
    }
    const persona = hive.personas.find((p) => p.canonicalAddress === resolved);
    if (persona) {
      await backend.attach(hive, persona);
      ctx.logger.print(`focused ${persona.canonicalAddress}.`);
      return 0;
    }
  }
  await backend.attach(hive);
  ctx.logger.print(`attached to ${hive.root.config.hive.name}.`);
  return 0;
}

export const attachCommand: Command = {
  name: "attach",
  summary: "Bring the hive (or a single persona) into focus",
  usage: "hive attach [<persona>] [--hive <dir>]",
  handler: handle,
};
