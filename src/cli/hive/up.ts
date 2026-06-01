import { parseArgs } from "node:util";
import { createRuntime, discoverHive } from "../../core/runtime.ts";
import type { Command, CommandContext } from "../command-router.ts";

interface UpOptions {
  hive: string | undefined;
  detach: boolean;
}

function parseUpArgs(argv: string[]): UpOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      detach: { type: "boolean" },
    },
    strict: true,
    allowPositionals: true,
  });
  return {
    hive: positionals[0],
    detach: values["detach"] === true,
  };
}

async function handle(ctx: CommandContext): Promise<number> {
  let opts: UpOptions;
  try {
    opts = parseUpArgs(ctx.commandArgv);
  } catch (err) {
    ctx.logger.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const root = opts.hive ?? discoverHive();
  if (!root) {
    ctx.logger.error(
      "no hive.toml found in cwd or any parent. Pass <hive> or `cd` into a hive directory.",
    );
    return 1;
  }

  const runtime = createRuntime();
  const hive = await runtime.loadHive(root);

  if (!hive.root.config.runtime.acknowledged_dangerous) {
    ctx.logger.error(
      "hive.toml does not have `acknowledged_dangerous = true`. apicultr will not spawn persona windows until this is set.",
    );
    ctx.logger.info("Set [runtime].acknowledged_dangerous = true and re-run.");
    return 1;
  }

  const backend = await runtime.selectBackend(hive.root.config.runtime.backend);
  ctx.logger.info(
    `bringing up ${hive.root.config.hive.name} on backend ${backend.capabilities.name}...`,
  );
  await backend.start(hive);
  ctx.logger.print(
    `hive up: ${hive.personas.length} persona windows spawned via ${backend.capabilities.name}.`,
  );
  if (!opts.detach) {
    ctx.logger.info(
      "(detach is the default; this returns immediately. `hive attach` to focus the hive.)",
    );
  }
  return 0;
}

export const upCommand: Command = {
  name: "up",
  summary: "Start the hive: spawn a window for each persona and launch its Claude Code session",
  usage: "hive up [<hive>] [--detach]",
  handler: handle,
};
