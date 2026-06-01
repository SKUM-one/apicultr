import { parseArgs } from "node:util";
import type { PersonaHealth } from "../../backends/base.ts";
import { buildHierarchy } from "../../core/hierarchy.ts";
import { createRuntime, discoverHive } from "../../core/runtime.ts";
import type { Command, CommandContext } from "../command-router.ts";

async function handle(ctx: CommandContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: ctx.commandArgv,
    options: {
      json: { type: "boolean" },
      tree: { type: "boolean" },
    },
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

  const health: PersonaHealth[] = await Promise.all(
    hive.personas.map((p) => backend.healthCheck(p)),
  );

  if (values["json"] === true) {
    ctx.logger.json({
      hive: hive.root.config.hive.name,
      backend: backend.capabilities.name,
      personas: hive.personas.map((p, i) => ({
        address: p.canonicalAddress,
        role: p.role,
        codename: p.codename,
        health: health[i],
      })),
    });
    return 0;
  }

  if (values["tree"] === true) {
    const hierarchy = buildHierarchy(
      hive.personas.map((p) => ({
        address: p.canonicalAddress,
        role: p.role,
        identity_doc: p.identity_doc,
        manages: p.manages.map((m) => (p.subHive ? `${p.subHive}:${m}` : m)),
        codename: p.codename,
        tools_needed: p.tools_needed,
        reports_to: p.reports_to
          ? p.subHive
            ? `${p.subHive}:${p.reports_to}`
            : p.reports_to
          : undefined,
      })),
    );
    ctx.logger.print(`hive: ${hive.root.config.hive.name} (backend: ${backend.capabilities.name})`);
    ctx.logger.print("");
    ctx.logger.print(hierarchy.renderTree({ showCodenames: true }));
    return 0;
  }

  ctx.logger.print(`hive: ${hive.root.config.hive.name} (backend: ${backend.capabilities.name})`);
  const pad = Math.max(...hive.personas.map((p) => p.canonicalAddress.length));
  for (let i = 0; i < hive.personas.length; i++) {
    const p = hive.personas[i];
    const h = health[i];
    if (!p || !h) continue;
    const label = p.codename ? `${p.canonicalAddress} (${p.codename})` : p.canonicalAddress;
    ctx.logger.print(
      `  ${label.padEnd(pad + 12)}  ${h.state}${h.detail ? `  -- ${h.detail}` : ""}`,
    );
  }
  return 0;
}

export const statusCommand: Command = {
  name: "status",
  summary: "List the hive's personas with per-persona health signals",
  usage: "hive status [<hive>] [--json] [--tree]",
  handler: handle,
};
