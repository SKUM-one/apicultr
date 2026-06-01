import { parseArgs } from "node:util";
import { createRuntime, discoverHive } from "../../core/runtime.ts";
import type { Command, CommandContext } from "../command-router.ts";

async function handle(ctx: CommandContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: ctx.commandArgv,
    options: { force: { type: "boolean" } },
    strict: true,
    allowPositionals: true,
  });
  const root = positionals[0] ?? discoverHive();
  if (!root) {
    ctx.logger.error("no hive.toml found. Pass <hive> or `cd` into a hive directory.");
    return 1;
  }
  const runtime = createRuntime();
  const hive = await runtime.loadHive(root);
  const backend = await runtime.selectBackend(hive.root.config.runtime.backend);
  ctx.logger.info(
    `tearing down ${hive.root.config.hive.name} on backend ${backend.capabilities.name}...`,
  );
  await backend.close(hive, { force: values["force"] === true });
  ctx.logger.print(`hive down: ${hive.personas.length} persona windows closed.`);
  return 0;
}

export const downCommand: Command = {
  name: "down",
  summary: "Tear down the hive: close every persona's window and end its Claude Code session",
  usage: "hive down [<hive>] [--force]",
  handler: handle,
};
