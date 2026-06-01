import type { PersonaConfig } from "./config.ts";

/**
 * The hive's directed acyclic graph of authority. `manages` edges are authoritative;
 * `reports_to` is informational and validated against the inverse. We surface:
 *  - ancestors / descendants for any address
 *  - the dispatch-allowed set for any persona (defaults to its descendants, per spec
 *    "orchestrator-by-role")
 *  - tree rendering for `hive status --tree`
 *  - cycle detection (a hive with a cycle is invalid)
 */

export interface HierarchyNode {
  address: string;
  role: string;
  codename: string | undefined;
  manages: string[];
  reportsTo: string | undefined;
}

export interface HierarchyOptions {
  /** When provided, treat this address as the implicit root for tree rendering. */
  rootHint?: string;
}

export class HierarchyError extends Error {
  constructor(
    message: string,
    public readonly addresses: string[] = [],
  ) {
    super(message);
    this.name = "HierarchyError";
  }
}

export interface Hierarchy {
  nodes: ReadonlyMap<string, HierarchyNode>;
  /** Addresses with no `reports_to` and no manager. Usually one (the Chief). */
  roots: string[];
  /** Addresses with no `manages` entries. */
  leaves: string[];

  get(address: string): HierarchyNode | undefined;
  parent(address: string): string | undefined;
  children(address: string): string[];
  ancestors(address: string): string[];
  descendants(address: string): string[];
  /** The set this persona is allowed to dispatch to. Currently == descendants. */
  dispatchAllowed(address: string): string[];

  /** Render as an ASCII tree from `rootHint` (or every root if none). */
  renderTree(opts?: { showCodenames?: boolean; rootHint?: string }): string;
}

export function buildHierarchy(personas: ReadonlyArray<PersonaConfig>): Hierarchy {
  const nodes = new Map<string, HierarchyNode>();

  for (const p of personas) {
    if (nodes.has(p.address)) {
      throw new HierarchyError(`duplicate address: ${p.address}`, [p.address]);
    }
    nodes.set(p.address, {
      address: p.address,
      role: p.role,
      codename: p.codename,
      manages: [...p.manages],
      reportsTo: p.reports_to,
    });
  }

  // Verify reports_to matches an inverse manages, fill in missing reports_to silently.
  for (const node of nodes.values()) {
    for (const childAddr of node.manages) {
      const child = nodes.get(childAddr);
      if (!child) {
        throw new HierarchyError(
          `${node.address} manages ${childAddr} but that address is not declared`,
          [node.address, childAddr],
        );
      }
      if (child.reportsTo && child.reportsTo !== node.address) {
        throw new HierarchyError(
          `${child.address} reports_to ${child.reportsTo} but is also managed by ${node.address}`,
          [child.address, node.address, child.reportsTo],
        );
      }
      child.reportsTo = node.address;
    }
  }

  const cycle = findCycle(nodes);
  if (cycle) {
    throw new HierarchyError(`cycle detected in hierarchy: ${cycle.join(" -> ")}`, cycle);
  }

  const roots: string[] = [];
  const leaves: string[] = [];
  for (const node of nodes.values()) {
    if (!node.reportsTo) roots.push(node.address);
    if (node.manages.length === 0) leaves.push(node.address);
  }

  function children(address: string): string[] {
    return nodes.get(address)?.manages ?? [];
  }

  function parent(address: string): string | undefined {
    return nodes.get(address)?.reportsTo;
  }

  function ancestors(address: string): string[] {
    const out: string[] = [];
    let cur = parent(address);
    while (cur) {
      out.push(cur);
      cur = parent(cur);
    }
    return out;
  }

  function descendants(address: string): string[] {
    const out: string[] = [];
    const stack = [...children(address)];
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next) continue;
      out.push(next);
      stack.push(...children(next));
    }
    return out;
  }

  function renderTree(opts: { showCodenames?: boolean; rootHint?: string } = {}): string {
    const startRoots = opts.rootHint && nodes.has(opts.rootHint) ? [opts.rootHint] : roots;
    const lines: string[] = [];
    for (const root of startRoots) {
      renderNode(root, "", true, true, lines, opts.showCodenames ?? false);
    }
    return lines.join("\n");
  }

  function renderNode(
    address: string,
    prefix: string,
    isLast: boolean,
    isRoot: boolean,
    out: string[],
    showCodenames: boolean,
  ): void {
    const node = nodes.get(address);
    if (!node) return;
    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    const label =
      showCodenames && node.codename ? `${node.address} (${node.codename})` : node.address;
    out.push(`${prefix}${connector}${label}`);
    const nextPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
    const kids = children(address);
    kids.forEach((k, i) =>
      renderNode(k, nextPrefix, i === kids.length - 1, false, out, showCodenames),
    );
  }

  return {
    nodes,
    roots,
    leaves,
    get: (a) => nodes.get(a),
    parent,
    children,
    ancestors,
    descendants,
    dispatchAllowed: descendants,
    renderTree,
  };
}

function findCycle(nodes: ReadonlyMap<string, HierarchyNode>): string[] | undefined {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const a of nodes.keys()) colour.set(a, WHITE);

  for (const start of nodes.keys()) {
    if (colour.get(start) !== WHITE) continue;
    const stack: Array<{ addr: string; iter: Iterator<string> }> = [
      { addr: start, iter: (nodes.get(start)?.manages ?? []).values() },
    ];
    const path: string[] = [start];
    colour.set(start, GREY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top) break;
      const next = top.iter.next();
      if (next.done) {
        colour.set(top.addr, BLACK);
        stack.pop();
        path.pop();
        continue;
      }
      const child = next.value;
      const c = colour.get(child);
      if (c === GREY) {
        const cycleStart = path.indexOf(child);
        return cycleStart >= 0 ? [...path.slice(cycleStart), child] : [child];
      }
      if (c === WHITE) {
        colour.set(child, GREY);
        path.push(child);
        stack.push({ addr: child, iter: (nodes.get(child)?.manages ?? []).values() });
      }
    }
  }
  return undefined;
}
