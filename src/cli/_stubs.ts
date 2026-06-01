import type { CommandContext, CommandHandler } from "./command-router.ts";

/**
 * A placeholder handler for commands declared in the v1 surface but not implemented in
 * the current checkpoint. Prints a friendly explanation and exits 2 (usage error) so it's
 * unmistakable in scripts that the command isn't ready yet.
 */
export function notImplemented(checkpoint: "b" | "c"): CommandHandler {
  return (ctx: CommandContext): number => {
    const path = ctx.commandPath.join(" ");
    ctx.logger.error(`\`${ctx.binary} ${path}\` is not implemented in this checkpoint`);
    ctx.logger.info(
      `Planned for checkpoint ${checkpoint.toUpperCase()} of the apicultr v1 runtime.`,
    );
    ctx.logger.info(
      "Track progress at /Users/Shared/Projects/.swarm/briefs/_apicultr/runtime-mvp.md",
    );
    return 2;
  };
}
