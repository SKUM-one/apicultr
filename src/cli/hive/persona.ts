import { parseArgs } from "node:util";
import { computeGrid } from "../../backends/native-mac/grid.ts";
import { NativeMacBackend } from "../../backends/native-mac/index.ts";
import { TmuxBackend } from "../../backends/tmux/index.ts";
import { buildCodenameIndex } from "../../core/addressing.ts";
import { createRuntime, discoverHive } from "../../core/runtime.ts";
import type { Command, CommandContext } from "../command-router.ts";

async function handleList(ctx: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args: ctx.commandArgv,
    options: { json: { type: "boolean" }, hive: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const root = (values["hive"] as string | undefined) ?? discoverHive();
  if (!root) {
    ctx.logger.error("no hive.toml found.");
    return 1;
  }
  const runtime = createRuntime();
  const hive = await runtime.loadHive(root);
  if (values["json"] === true) {
    ctx.logger.json({
      hive: hive.root.config.hive.name,
      personas: hive.personas.map((p) => ({
        address: p.canonicalAddress,
        role: p.role,
        codename: p.codename,
        workspace: p.workspaceAbs,
        identityDoc: p.identityDocAbs,
        manages: p.manages,
        reportsTo: p.reports_to,
      })),
    });
    return 0;
  }
  ctx.logger.print(`hive: ${hive.root.config.hive.name}`);
  for (const p of hive.personas) {
    const cn = p.codename ? ` (${p.codename})` : "";
    ctx.logger.print(`  ${p.canonicalAddress}${cn} -- ${p.role}`);
  }
  return 0;
}

async function handleRestart(ctx: CommandContext): Promise<number> {
  const { positionals, values } = parseArgs({
    args: ctx.commandArgv,
    options: { hive: { type: "string" } },
    strict: true,
    allowPositionals: true,
  });
  const target = positionals[0];
  if (!target) {
    ctx.logger.error("hive persona restart <persona> — persona is required");
    return 2;
  }
  const root = (values["hive"] as string | undefined) ?? discoverHive();
  if (!root) {
    ctx.logger.error("no hive.toml found.");
    return 1;
  }
  const runtime = createRuntime();
  const hive = await runtime.loadHive(root);
  const idx = buildCodenameIndex(
    hive.personas.map((p) => ({ address: p.canonicalAddress, codename: p.codename })),
  );
  const resolved = idx.resolve(target);
  if (!resolved) {
    ctx.logger.error(`unknown persona: ${target}`);
    return 1;
  }
  const persona = hive.personas.find((p) => p.canonicalAddress === resolved);
  if (!persona) {
    ctx.logger.error(`persona ${resolved} disappeared from composite hive`);
    return 1;
  }
  const backend = await runtime.selectBackend(hive.root.config.runtime.backend);
  await backend.restart(persona);

  // After kill, respawn. tmux can respawn standalone; native needs grid placement, so we
  // delegate by reaching into the concrete backend type.
  if (backend instanceof TmuxBackend) {
    await backend.respawnPersonaWindow(persona);
  } else if (backend instanceof NativeMacBackend) {
    const display = await backend.queryDisplay();
    const layout = computeGrid(
      hive.personas.length,
      display,
      hive.root.config.runtime.native.target_window_size_px,
    );
    const idxInHive = hive.personas.findIndex((p) => p.canonicalAddress === resolved);
    const cell = layout.cells[idxInHive];
    if (!cell) {
      ctx.logger.error("could not compute replacement grid cell for persona");
      return 1;
    }
    await backend.spawnPersonaWindow(persona, cell, hive);
  }
  ctx.logger.print(`restarted ${persona.canonicalAddress}.`);
  return 0;
}

export const personaCommand: Command = {
  name: "persona",
  summary: "Manage personas: list, restart",
  usage: "hive persona <list|restart>",
  subcommands: {
    list: {
      name: "list",
      summary: "List personas in the current hive (read-only)",
      usage: "hive persona list [--hive <dir>] [--json]",
      handler: handleList,
    },
    restart: {
      name: "restart",
      summary: "Kill a persona's window/process and respawn with the same config",
      usage: "hive persona restart <persona> [--hive <dir>]",
      handler: handleRestart,
    },
  },
};
