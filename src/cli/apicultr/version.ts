import { parseArgs } from "node:util";
import { APICULTR_VERSION } from "../../core/version.ts";
import {
  type ToolVersion,
  detectBun,
  detectClaude,
  detectTerminalApp,
  detectTmux,
} from "../../core/versions.ts";
import type { Command, CommandContext } from "../command-router.ts";

async function handle(ctx: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args: ctx.commandArgv,
    options: { json: { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  });

  const [bun, tmux, claude, terminal] = await Promise.all([
    detectBun(),
    detectTmux(),
    detectClaude(),
    detectTerminalApp(),
  ]);

  const tools: ToolVersion[] = [bun, tmux, claude];
  if (process.platform === "darwin") tools.push(terminal);

  if (values.json === true) {
    ctx.logger.json({
      apicultr: APICULTR_VERSION,
      platform: process.platform,
      arch: process.arch,
      tools: Object.fromEntries(tools.map((t) => [t.name, t])),
    });
    return 0;
  }

  ctx.logger.print(`apicultr  ${APICULTR_VERSION}`);
  ctx.logger.print(`platform  ${process.platform}/${process.arch}`);
  ctx.logger.print("");
  ctx.logger.print("toolchain:");
  const pad = Math.max(...tools.map((t) => t.name.length));
  for (const tool of tools) {
    const v = tool.version ?? "not found";
    ctx.logger.print(`  ${tool.name.padEnd(pad)}  ${v}`);
  }
  return 0;
}

export const versionCommand: Command = {
  name: "version",
  summary: "Print apicultr + toolchain versions",
  usage: "apicultr version [--json]",
  description:
    "Reports apicultr, bun, tmux, claude and (on macOS) Terminal.app versions and paths.",
  handler: handle,
};
