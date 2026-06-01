import { parseArgs } from "node:util";
import { buildCodenameIndex } from "../../core/addressing.ts";
import { buildHierarchy } from "../../core/hierarchy.ts";
import { createRuntime, discoverHive } from "../../core/runtime.ts";
import type { Command, CommandContext } from "../command-router.ts";

async function handle(ctx: CommandContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: ctx.commandArgv,
    options: { hive: { type: "string" } },
    strict: true,
    allowPositionals: true,
  });
  const target = positionals[0];
  if (!target) {
    ctx.logger.error("hive route <persona> — persona is required");
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
  ctx.logger.print(`persona: ${persona.canonicalAddress}`);
  if (persona.codename) ctx.logger.print(`codename: ${persona.codename}`);
  ctx.logger.print(`role: ${persona.role}`);
  const ancestors = hierarchy.ancestors(persona.canonicalAddress);
  const descendants = hierarchy.descendants(persona.canonicalAddress);
  ctx.logger.print(`reports to: ${ancestors[0] ?? "(the King)"}`);
  ctx.logger.print(`ancestors: ${ancestors.length ? ancestors.join(" -> ") : "(none)"}`);
  ctx.logger.print(
    `may dispatch to: ${descendants.length ? descendants.join(", ") : "(none — leaf)"}`,
  );
  return 0;
}

export const routeCommand: Command = {
  name: "route",
  summary: "Show a persona's role, ancestors, descendants, and dispatch-allowed set",
  usage: "hive route <persona> [--hive <dir>]",
  handler: handle,
};
