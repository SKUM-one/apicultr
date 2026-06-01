import { parseArgs } from "node:util";
import { createRuntime, discoverHive } from "../../core/runtime.ts";
import type { Command, CommandContext } from "../command-router.ts";

async function handle(ctx: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args: ctx.commandArgv,
    options: { json: { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  });
  const runtime = createRuntime();
  const factories = runtime.factories();
  const caps = await Promise.all(factories.map((f) => f.capabilities()));

  const root = discoverHive();
  let activeBackend: string | undefined;
  if (root) {
    try {
      const hive = await runtime.loadHive(root);
      const backend = await runtime.selectBackend(hive.root.config.runtime.backend);
      activeBackend = backend.capabilities.name;
    } catch {
      // hive present but unloadable; leave activeBackend undefined
    }
  }

  if (values["json"] === true) {
    ctx.logger.json({
      activeBackend,
      backends: caps,
    });
    return 0;
  }
  ctx.logger.print(`active backend: ${activeBackend ?? "(no hive in cwd)"}`);
  ctx.logger.print("");
  ctx.logger.print("available backends:");
  for (const c of caps) {
    const status = c.available ? "OK" : "unavailable";
    ctx.logger.print(`  ${c.name.padEnd(11)}  [${status}]  ${c.description}`);
    if (!c.available && c.unavailableReason) {
      ctx.logger.print(`               reason: ${c.unavailableReason}`);
    }
  }
  return 0;
}

export const backendCommand: Command = {
  name: "backend",
  summary: "Print which backend is in use and what alternatives the system supports",
  usage: "hive backend [--json]",
  handler: handle,
};
