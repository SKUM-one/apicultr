import { isAbsolute, resolve } from "node:path";
import {
  type HiveToml,
  type LoadedHive,
  type PersonaConfig,
  type SubHiveConfig,
  loadHiveConfig,
} from "./config.ts";

/**
 * Sub-hive composition: a parent hive's `[[sub_hives]]` blocks reference child hive
 * directories, each with its own `hive.toml`. We recursively load them and namespace
 * their persona addresses under the sub-hive name (`<sub>:<address>`), so the parent's
 * commands can refer to any persona anywhere in the tree without collisions.
 *
 * Cycle detection: a sub-hive may not (transitively) include its own ancestor.
 */

export interface CompositeHive {
  /** The root (top-level) hive. */
  root: LoadedHive;
  /** All loaded sub-hives, keyed by their namespace prefix. */
  subHives: ReadonlyMap<string, LoadedHive>;
  /** A flattened persona list: every persona in every hive, with namespaced addresses. */
  personas: NamespacedPersona[];
  /** Auto-generated parent->child edges joining each sub-hive's chief to its `attach_under`. */
  composedEdges: ComposedEdge[];
}

export interface NamespacedPersona extends PersonaConfig {
  /** The canonical, possibly namespaced address (e.g. `kant-codes:chief-001`). */
  canonicalAddress: string;
  /** The sub-hive prefix, if any. */
  subHive: string | undefined;
  /** Where the persona's workspace dir lives on disk (absolute). */
  workspaceAbs: string;
  /** Absolute path to the persona's identity doc. */
  identityDocAbs: string;
}

export interface ComposedEdge {
  /** Parent address (must exist in the parent hive). */
  parent: string;
  /** Child address (the sub-hive's chief, namespaced). */
  child: string;
}

export class SubHiveCycleError extends Error {
  constructor(public readonly chain: string[]) {
    super(`sub-hive cycle detected: ${chain.join(" -> ")}`);
    this.name = "SubHiveCycleError";
  }
}

export interface LoadCompositeOptions {
  /** Max recursion depth. Default 8. */
  maxDepth?: number;
}

export async function loadCompositeHive(
  rootFile: string,
  opts: LoadCompositeOptions = {},
): Promise<CompositeHive> {
  const maxDepth = opts.maxDepth ?? 8;
  const root = await loadHiveConfig(rootFile);
  const subHives = new Map<string, LoadedHive>();
  const visited = new Set<string>([root.file]);
  await loadSubHivesRecursive(root, subHives, visited, [root.file], 1, maxDepth);

  const personas: NamespacedPersona[] = [];
  for (const p of root.config.personas) {
    personas.push(materialisePersona(p, undefined, root));
  }
  for (const [prefix, hive] of subHives) {
    for (const p of hive.config.personas) {
      personas.push(materialisePersona(p, prefix, hive));
    }
  }

  const composedEdges = composeEdges(root.config, subHives);

  return { root, subHives, personas, composedEdges };
}

async function loadSubHivesRecursive(
  parent: LoadedHive,
  acc: Map<string, LoadedHive>,
  visited: Set<string>,
  chain: string[],
  depth: number,
  maxDepth: number,
): Promise<void> {
  if (depth > maxDepth) {
    throw new SubHiveCycleError([...chain, "(max depth exceeded)"]);
  }
  for (const sub of parent.config.sub_hives) {
    const path = resolveSubHivePath(parent, sub);
    const file = `${path}/hive.toml`;
    if (visited.has(file)) {
      throw new SubHiveCycleError([...chain, file]);
    }
    visited.add(file);

    const loaded = await loadHiveConfig(file);
    const prefix = computeNamespacePrefix(sub.name, acc);
    acc.set(prefix, loaded);

    await loadSubHivesRecursive(loaded, acc, visited, [...chain, file], depth + 1, maxDepth);
  }
}

function resolveSubHivePath(parent: LoadedHive, sub: SubHiveConfig): string {
  return isAbsolute(sub.path) ? sub.path : resolve(parent.root, sub.path);
}

/**
 * Produce a unique namespace prefix for a sub-hive. Collisions across sibling sub-hives
 * are caught earlier by config validation (`duplicate sub-hive name`), so this only
 * needs to handle nested re-use of a name — we suffix `-2`, `-3` if necessary.
 */
function computeNamespacePrefix(name: string, existing: Map<string, LoadedHive>): string {
  if (!existing.has(name)) return name;
  let i = 2;
  while (existing.has(`${name}-${i}`)) i += 1;
  return `${name}-${i}`;
}

function materialisePersona(
  p: PersonaConfig,
  subHive: string | undefined,
  hive: LoadedHive,
): NamespacedPersona {
  const canonicalAddress = subHive ? `${subHive}:${p.address}` : p.address;
  const workspaceAbs = p.workspace
    ? isAbsolute(p.workspace)
      ? p.workspace
      : resolve(hive.root, p.workspace)
    : resolve(hive.root, p.address);
  const identityDocAbs = isAbsolute(p.identity_doc)
    ? p.identity_doc
    : resolve(hive.root, p.identity_doc);
  return {
    ...p,
    canonicalAddress,
    subHive,
    workspaceAbs,
    identityDocAbs,
  };
}

function composeEdges(
  rootConfig: HiveToml,
  subHives: ReadonlyMap<string, LoadedHive>,
): ComposedEdge[] {
  const edges: ComposedEdge[] = [];
  for (const sub of rootConfig.sub_hives) {
    if (!sub.attach_under) continue;
    const loaded = subHives.get(sub.name);
    if (!loaded) continue;
    const subChief = loaded.config.personas.find((p) => p.role === "chief");
    if (!subChief) continue;
    edges.push({
      parent: sub.attach_under,
      child: `${sub.name}:${subChief.address}`,
    });
  }
  return edges;
}
