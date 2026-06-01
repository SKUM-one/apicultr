import { dirname } from "node:path";
import type { Hierarchy } from "./hierarchy.ts";
import type { NamespacedPersona } from "./sub-hive.ts";

/**
 * Builders for the `claude` command line and environment used by both backends.
 *
 * Two key invariants:
 *  1. Every persona runs `claude --model <model> --dangerously-skip-permissions`. The
 *     dangerous flag is required because workers write files and shell out without
 *     per-tool approval. The hive.toml's `acknowledged_dangerous` gate (checkpoint C)
 *     forces the user to explicitly opt in once per hive.
 *  2. The persona's PATH includes the directory where the `hive` binary lives, so any
 *     persona's claude session can dispatch downward (`hive dispatch frontend-007 < …`).
 *     This is what makes persona-to-persona dispatch a first-class primitive.
 */

export interface ClaudeCommand {
  /** Shell-quoted command string, ready for tmux send-keys or AppleScript `do script`. */
  shellCommand: string;
  /** Environment overrides to merge into the persona's shell. */
  env: Record<string, string>;
  /** Absolute working directory for the spawn. */
  cwd: string;
}

export interface BuildClaudeOptions {
  /** Default model fallback when persona.model is unset. */
  defaultModel: string;
  /** Absolute path to the `hive` binary; used to extend PATH. */
  hiveBinaryPath: string;
  /** Optional extra env to merge in. */
  extraEnv?: Record<string, string>;
}

export function buildClaudeCommand(
  persona: NamespacedPersona,
  opts: BuildClaudeOptions,
): ClaudeCommand {
  const model = persona.model ?? opts.defaultModel;
  const hiveBinDir = dirname(opts.hiveBinaryPath);
  const env: Record<string, string> = {
    APICULTR_PERSONA: persona.canonicalAddress,
    APICULTR_HIVE_ROOT: persona.workspaceAbs,
    PATH: extendPath(process.env["PATH"] ?? "", hiveBinDir),
    ...opts.extraEnv,
  };
  const shellCommand = `claude --model ${shellQuote(model)} --dangerously-skip-permissions`;
  return { shellCommand, env, cwd: persona.workspaceAbs };
}

function extendPath(current: string, additional: string): string {
  if (!current) return additional;
  const parts = current.split(":");
  if (parts.includes(additional)) return current;
  return `${additional}:${current}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/@:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Compose the initial system context message pre-pended into each persona's Claude Code
 * session at `hive up`. Three blocks, in order:
 *
 *   1. The persona's identity doc (verbatim).
 *   2. Auto-generated Hierarchy block: who you manage, who you report to, who the King is.
 *   3. Auto-generated Dispatch primitive block: how to `hive dispatch` from inside.
 */
export interface InitialMessageOptions {
  persona: NamespacedPersona;
  identityDocContent: string;
  hierarchy: Hierarchy;
  kingName?: string;
}

export function buildInitialMessage(opts: InitialMessageOptions): string {
  const { persona, identityDocContent, hierarchy } = opts;
  const king = opts.kingName ?? "the King";

  const node = hierarchy.get(persona.canonicalAddress);
  const manages = node?.manages ?? [];
  const reportsTo = node?.reportsTo;

  const lines: string[] = [];
  lines.push(identityDocContent.trim());
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("# Hierarchy");
  lines.push("");
  lines.push(`Your address: \`${persona.canonicalAddress}\``);
  lines.push(`Your role: \`${persona.role}\``);
  if (persona.codename) lines.push(`Your codename: \`${persona.codename}\``);
  if (reportsTo) {
    lines.push(`You report to: \`${reportsTo}\``);
  } else {
    lines.push(`You report to: ${king}.`);
  }
  if (manages.length > 0) {
    lines.push("You manage:");
    for (const m of manages) lines.push(`  - \`${m}\``);
  } else {
    lines.push("You manage: nobody. You are a leaf worker.");
  }
  lines.push("The King (the human running this hive) may dispatch directly to you at any time.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("# Dispatch primitive");
  lines.push("");
  lines.push("You can dispatch work to anyone you manage. Use the `hive` CLI:");
  lines.push("");
  lines.push("```sh");
  lines.push("hive dispatch <address-or-codename> --brief <path-to-brief.md>");
  lines.push("```");
  lines.push("");
  lines.push("Or pipe a brief in on stdin:");
  lines.push("");
  lines.push("```sh");
  lines.push("hive dispatch frontend-007 <<'EOF'");
  lines.push("Build the login form per design spec at docs/login.md.");
  lines.push("EOF");
  lines.push("```");
  lines.push("");
  lines.push(
    "Dispatch is auto-sequenced under the hood: concurrent calls queue rather than racing on the clipboard.",
  );
  lines.push(
    "Authorisation is soft in v1 (encoded here in your identity); hard enforcement lands in v1.x.",
  );
  lines.push("");
  return lines.join("\n");
}
