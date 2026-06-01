import { type ParseArgsConfig, parseArgs } from "node:util";
import { type Logger, createLogger } from "../core/logger.ts";
import { APICULTR_VERSION } from "../core/version.ts";

export interface CommandContext {
  argv: string[];
  flags: GlobalFlags;
  logger: Logger;
  binary: string;
  commandPath: string[];
  /** Raw argv minus the consumed global flags and the dispatched command name. */
  commandArgv: string[];
}

export type CommandHandler = (ctx: CommandContext) => Promise<number> | number;

export interface Command {
  name: string;
  summary: string;
  usage?: string;
  description?: string;
  handler?: CommandHandler;
  subcommands?: Record<string, Command>;
}

export interface BinarySpec {
  name: string;
  tagline: string;
  commands: Record<string, Command>;
}

export interface GlobalFlags {
  help: boolean;
  version: boolean;
  verbose: boolean;
  quiet: boolean;
  config: string | undefined;
}

const GLOBAL_VALUE_FLAGS = new Set(["--config"]);

interface ArgvSplit {
  globalArgv: string[];
  commandName: string | undefined;
  commandArgv: string[];
}

/**
 * Split argv into [global flags] [command] [rest]. We can't simply parseArgs the whole
 * argv because we don't yet know which command's flag schema to apply. Strategy: walk
 * argv left-to-right consuming known global flags (and their values) until we hit the
 * first positional; that positional is the command name.
 */
export function splitArgv(argv: string[]): ArgvSplit {
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === undefined) break;
    if (tok === "--") {
      return {
        globalArgv: argv.slice(0, i),
        commandName: argv[i + 1],
        commandArgv: argv.slice(i + 2),
      };
    }
    if (tok.startsWith("-")) {
      if (tok.startsWith("--") && !tok.includes("=") && GLOBAL_VALUE_FLAGS.has(tok)) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    return {
      globalArgv: argv.slice(0, i),
      commandName: tok,
      commandArgv: argv.slice(i + 1),
    };
  }
  return { globalArgv: argv, commandName: undefined, commandArgv: [] };
}

export function parseGlobalFlags(globalArgv: string[]): GlobalFlags {
  const config: ParseArgsConfig = {
    args: globalArgv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "V" },
      verbose: { type: "boolean", short: "v" },
      quiet: { type: "boolean", short: "q" },
      config: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  };
  const { values } = parseArgs(config);
  const configVal = values["config"];
  return {
    help: values["help"] === true,
    version: values["version"] === true,
    verbose: values["verbose"] === true,
    quiet: values["quiet"] === true,
    config: typeof configVal === "string" ? configVal : undefined,
  };
}

function formatBinaryHelp(spec: BinarySpec): string {
  const lines: string[] = [];
  lines.push(`${spec.name} — ${spec.tagline}`);
  lines.push("");
  lines.push(`Usage: ${spec.name} [global flags] <command> [command flags] [args...]`);
  lines.push("");
  lines.push("Commands:");
  const names = Object.keys(spec.commands).sort();
  const pad = Math.max(...names.map((n) => n.length));
  for (const name of names) {
    const cmd = spec.commands[name];
    if (!cmd) continue;
    lines.push(`  ${name.padEnd(pad)}  ${cmd.summary}`);
  }
  lines.push("");
  lines.push("Global flags:");
  lines.push("  -h, --help        Show help for the binary or a command");
  lines.push("  -V, --version     Print binary version and exit");
  lines.push("  -v, --verbose     Verbose logging");
  lines.push("  -q, --quiet       Suppress non-error output");
  lines.push("      --config PATH Use the named config file");
  lines.push("");
  lines.push(`Run \`${spec.name} <command> --help\` for command-specific help.`);
  return lines.join("\n");
}

function formatCommandHelp(binary: string, path: string[], cmd: Command): string {
  const fullName = [binary, ...path].join(" ");
  const lines: string[] = [];
  lines.push(`${fullName} — ${cmd.summary}`);
  lines.push("");
  lines.push(`Usage: ${cmd.usage ?? `${fullName} [flags]`}`);
  if (cmd.description) {
    lines.push("");
    lines.push(cmd.description);
  }
  if (cmd.subcommands) {
    lines.push("");
    lines.push("Subcommands:");
    const names = Object.keys(cmd.subcommands).sort();
    const pad = Math.max(...names.map((n) => n.length));
    for (const name of names) {
      const sub = cmd.subcommands[name];
      if (!sub) continue;
      lines.push(`  ${name.padEnd(pad)}  ${sub.summary}`);
    }
  }
  return lines.join("\n");
}

interface ResolvedCommand {
  command: Command;
  path: string[];
  remainingArgv: string[];
}

function resolveCommand(
  spec: BinarySpec,
  name: string,
  argv: string[],
): ResolvedCommand | undefined {
  const top = spec.commands[name];
  if (!top) return undefined;
  let current: Command = top;
  const path: string[] = [name];
  let rest = argv;
  while (current.subcommands && rest.length > 0) {
    const next = rest[0];
    if (next === undefined || next.startsWith("-")) break;
    const sub = current.subcommands[next];
    if (!sub) break;
    current = sub;
    path.push(next);
    rest = rest.slice(1);
  }
  return { command: current, path, remainingArgv: rest };
}

function suggest(name: string, choices: string[]): string | undefined {
  let best: { choice: string; score: number } | undefined;
  for (const choice of choices) {
    const score = lcsDistance(name, choice);
    if (best === undefined || score < best.score) best = { choice, score };
  }
  return best && best.score <= Math.max(2, Math.floor(name.length / 3)) ? best.choice : undefined;
}

function lcsDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0] ?? 0;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min((dp[j] ?? 0) + 1, (dp[j - 1] ?? 0) + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n] ?? 0;
}

export async function runBinary(spec: BinarySpec, argv: string[]): Promise<number> {
  let split: ArgvSplit;
  let globalFlags: GlobalFlags;
  try {
    split = splitArgv(argv);
    globalFlags = parseGlobalFlags(split.globalArgv);
  } catch (err) {
    const logger = createLogger("normal");
    logger.error(err instanceof Error ? err.message : String(err));
    logger.info(`Run \`${spec.name} --help\` for usage.`);
    return 2;
  }

  const logger = createLogger(
    globalFlags.quiet ? "quiet" : globalFlags.verbose ? "verbose" : "normal",
  );

  if (globalFlags.version) {
    logger.print(`${spec.name} ${APICULTR_VERSION}`);
    return 0;
  }

  if (split.commandName === undefined) {
    logger.print(formatBinaryHelp(spec));
    return globalFlags.help ? 0 : 0;
  }

  const resolved = resolveCommand(spec, split.commandName, split.commandArgv);
  if (!resolved) {
    logger.error(`unknown command: ${split.commandName}`);
    const hint = suggest(split.commandName, Object.keys(spec.commands));
    if (hint) logger.info(`did you mean \`${spec.name} ${hint}\`?`);
    logger.info(`Run \`${spec.name} --help\` for the command list.`);
    return 2;
  }

  if (
    globalFlags.help ||
    resolved.remainingArgv.includes("--help") ||
    resolved.remainingArgv.includes("-h")
  ) {
    logger.print(formatCommandHelp(spec.name, resolved.path, resolved.command));
    return 0;
  }

  if (!resolved.command.handler) {
    if (resolved.command.subcommands) {
      logger.error(`\`${spec.name} ${resolved.path.join(" ")}\` requires a subcommand`);
      logger.print(formatCommandHelp(spec.name, resolved.path, resolved.command));
      return 2;
    }
    logger.error(`command \`${resolved.path.join(" ")}\` has no handler (internal error)`);
    return 70;
  }

  const ctx: CommandContext = {
    argv,
    flags: globalFlags,
    logger,
    binary: spec.name,
    commandPath: resolved.path,
    commandArgv: resolved.remainingArgv,
  };

  try {
    const code = await resolved.command.handler(ctx);
    return typeof code === "number" ? code : 0;
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    if (globalFlags.verbose && err instanceof Error && err.stack) {
      logger.debug(err.stack);
    }
    return 1;
  }
}
