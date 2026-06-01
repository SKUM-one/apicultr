import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { TomlError, parse as parseToml } from "smol-toml";
import { z } from "zod";
import { isValidAddress } from "./addressing.ts";
import { hivePaths } from "./paths.ts";

/**
 * hive.toml schema validation. The customer hand-edits this file, so error messages are
 * load-bearing: we want "line 14, column 8: backend must be one of native|tmux|auto"
 * not just "invalid input".
 *
 * Strategy:
 *  - Parse with smol-toml (returns line + col on TOML syntax errors).
 *  - Validate with Zod (returns structured field paths on schema errors).
 *  - Walk the raw TOML text post-hoc to map a Zod issue's field path to a line/col, so
 *    the customer sees "line 14, column 8" even for semantic errors.
 */

// ─── Zod schemas ────────────────────────────────────────────────────────────

const TopologyShape = z.enum(["hub-spoke", "hierarchical", "pipeline", "event-driven"]);
const HumanDispatch = z.enum(["any", "chief-only", "named"]);
const BackendKind = z.enum(["native", "tmux", "auto"]);

const HiveSection = z.object({
  name: z.string().min(1, "hive.name must be a non-empty string"),
  description: z.string().optional(),
  workspace_root: z.string().default("."),
});

const TopologySection = z
  .object({
    shape: TopologyShape.default("hierarchical"),
    human_dispatch: HumanDispatch.default("any"),
  })
  .default({});

const RuntimeNativeSection = z
  .object({
    target_window_size_px: z
      .tuple([z.number().int().positive(), z.number().int().positive()])
      .default([480, 320]),
    overlay_opacity: z.number().min(0).max(1).default(0.5),
    overlay_focus_opacity: z.number().min(0).max(1).default(0.95),
    use_blur: z.boolean().default(true),
  })
  .default({});

const RuntimeSection = z
  .object({
    backend: BackendKind.default("auto"),
    default_model: z.string().default("claude-opus-4-7"),
    acknowledged_dangerous: z.boolean().default(false),
    native: RuntimeNativeSection,
  })
  .default({});

const PersonaSection = z
  .object({
    address: z.string().refine(isValidAddress, {
      message: "address must match <role>-NNN (e.g. chief-001 or lead-frontend-007)",
    }),
    role: z.string().min(1, "role is required"),
    codename: z.string().optional(),
    identity_doc: z.string().min(1, "identity_doc is required"),
    workspace: z.string().optional(),
    model: z.string().optional(),
    manages: z.array(z.string().refine(isValidAddress)).default([]),
    reports_to: z.string().refine(isValidAddress).optional(),
    tools_needed: z.array(z.string()).default([]),
  })
  .strict();

const SubHiveSection = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/i, "sub-hive name must be alphanumeric + hyphen"),
    path: z.string().min(1),
    attach_under: z.string().refine(isValidAddress).optional(),
  })
  .strict();

const BriefsSection = z
  .object({
    path_template: z.string().default(".hive/briefs/{persona}/{date}-{slug}.md"),
  })
  .default({});

const ReportsSection = z
  .object({
    path_template: z.string().default(".hive/reports/{persona}/{date}-{checkpoint}.md"),
  })
  .default({});

const HiveTomlSchema = z
  .object({
    hive: HiveSection,
    topology: TopologySection,
    runtime: RuntimeSection,
    personas: z.array(PersonaSection).min(1, "at least one persona is required"),
    sub_hives: z.array(SubHiveSection).default([]),
    briefs: BriefsSection,
    reports: ReportsSection,
  })
  .strict();

export type HiveToml = z.infer<typeof HiveTomlSchema>;
export type PersonaConfig = z.infer<typeof PersonaSection>;
export type SubHiveConfig = z.infer<typeof SubHiveSection>;
export type RuntimeConfig = z.infer<typeof RuntimeSection>;
export type TopologyConfig = z.infer<typeof TopologySection>;

// ─── Error type ─────────────────────────────────────────────────────────────

export interface ConfigIssue {
  /** Path-style field locator, e.g. `personas[2].address`. */
  path: string;
  message: string;
  /** 1-based line number when known. */
  line?: number;
  /** 1-based column when known. */
  column?: number;
}

export class ConfigError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: ConfigIssue[],
  ) {
    super(ConfigError.format(file, issues));
    this.name = "ConfigError";
  }

  static format(file: string, issues: ConfigIssue[]): string {
    const header = `invalid hive config: ${file}`;
    const body = issues.map((iss) => {
      const loc = iss.line ? ` (line ${iss.line}${iss.column ? `, col ${iss.column}` : ""})` : "";
      return `  - ${iss.path}${loc}: ${iss.message}`;
    });
    return [header, ...body].join("\n");
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface LoadedHive {
  /** Absolute path to the hive root directory. */
  root: string;
  /** Absolute path to hive.toml. */
  file: string;
  /** Raw TOML text (so we can map field paths to lines for diagnostics). */
  source: string;
  /** Validated and normalised config. */
  config: HiveToml;
  /** Convenience: resolved paths under the hive root. */
  paths: ReturnType<typeof hivePaths>;
}

export async function loadHiveConfig(file: string): Promise<LoadedHive> {
  const abs = isAbsolute(file) ? file : resolve(process.cwd(), file);
  const source = await readFile(abs, "utf8");
  return parseHiveConfig(source, abs);
}

export function parseHiveConfig(source: string, file: string): LoadedHive {
  let raw: unknown;
  try {
    raw = parseToml(source);
  } catch (err) {
    if (err instanceof TomlError) {
      throw new ConfigError(file, [
        {
          path: "(syntax)",
          message: err.message.replace(/^TomlError:\s*/, ""),
          line: err.line + 1,
          column: err.column + 1,
        },
      ]);
    }
    throw new ConfigError(file, [
      { path: "(syntax)", message: err instanceof Error ? err.message : String(err) },
    ]);
  }

  const result = HiveTomlSchema.safeParse(raw);
  if (!result.success) {
    const issues: ConfigIssue[] = result.error.issues.map((iss) => {
      const path = iss.path
        .map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`))
        .join("")
        .replace(/^\./, "");
      const located = locateInSource(source, iss.path);
      const issue: ConfigIssue = {
        path: path || "(root)",
        message: iss.message,
      };
      if (located?.line !== undefined) issue.line = located.line;
      if (located?.column !== undefined) issue.column = located.column;
      return issue;
    });
    throw new ConfigError(file, issues);
  }

  const config = result.data;
  const cross = validateCrossReferences(config);
  if (cross.length > 0) {
    throw new ConfigError(file, cross);
  }

  return {
    root: dirname(file),
    file,
    source,
    config,
    paths: hivePaths(dirname(file)),
  };
}

/**
 * Cross-reference validation: every `manages` and `reports_to` must point at a declared
 * persona address; codenames must be unique; sub-hive names must be unique; `attach_under`
 * must point at a declared chief/lead in the parent.
 */
function validateCrossReferences(config: HiveToml): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const addresses = new Set<string>(config.personas.map((p) => p.address));
  const codenameSeen = new Map<string, number>();

  config.personas.forEach((p, i) => {
    if (p.codename) {
      const key = p.codename.trim().toLowerCase();
      const prev = codenameSeen.get(key);
      if (prev !== undefined) {
        issues.push({
          path: `personas[${i}].codename`,
          message: `codename "${p.codename}" already used by personas[${prev}]`,
        });
      } else {
        codenameSeen.set(key, i);
      }
    }
    p.manages.forEach((addr, j) => {
      if (!addresses.has(addr)) {
        issues.push({
          path: `personas[${i}].manages[${j}]`,
          message: `references unknown address "${addr}"`,
        });
      }
      if (addr === p.address) {
        issues.push({
          path: `personas[${i}].manages[${j}]`,
          message: "persona cannot manage itself",
        });
      }
    });
    if (p.reports_to && !addresses.has(p.reports_to)) {
      issues.push({
        path: `personas[${i}].reports_to`,
        message: `references unknown address "${p.reports_to}"`,
      });
    }
  });

  const subNames = new Set<string>();
  config.sub_hives.forEach((s, i) => {
    if (subNames.has(s.name)) {
      issues.push({
        path: `sub_hives[${i}].name`,
        message: `duplicate sub-hive name "${s.name}"`,
      });
    } else {
      subNames.add(s.name);
    }
    if (s.attach_under && !addresses.has(s.attach_under)) {
      issues.push({
        path: `sub_hives[${i}].attach_under`,
        message: `references unknown parent address "${s.attach_under}"`,
      });
    }
  });

  return issues;
}

/**
 * Best-effort line/col location for a Zod issue path inside TOML source. We search for
 * the most-specific anchor we can find: the leaf field name on a line, or the closest
 * matching `[[personas]]` block. Returns undefined if no anchor can be found.
 */
function locateInSource(
  source: string,
  path: ReadonlyArray<PropertyKey>,
): { line: number; column: number } | undefined {
  if (path.length === 0) return undefined;
  const lines = source.split("\n");
  const last = path[path.length - 1];

  if (typeof last === "string") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const m = line.match(new RegExp(`^\\s*${last}\\s*=`));
      if (m) {
        const col = (line.indexOf(last) ?? 0) + 1;
        return { line: i + 1, column: col };
      }
    }
  }

  if (typeof last === "number" && path.length >= 2) {
    const tableKey = path[path.length - 2];
    if (typeof tableKey === "string") {
      let count = 0;
      const anchor = `[[${tableKey}]]`;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]?.trim() === anchor) {
          if (count === last) return { line: i + 1, column: 1 };
          count++;
        }
      }
    }
  }

  return undefined;
}

/** Type guard for the discriminated runtime config. */
export function isHiveToml(value: unknown): value is HiveToml {
  return HiveTomlSchema.safeParse(value).success;
}
