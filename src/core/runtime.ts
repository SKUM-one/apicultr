import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Backend, BackendCapabilities, BackendFactory } from "../backends/base.ts";
import { nativeMacFactory } from "../backends/native-mac/index.ts";
import { tmuxFactory } from "../backends/tmux/index.ts";
import type { CompositeHive } from "./sub-hive.ts";
import { loadCompositeHive } from "./sub-hive.ts";

/**
 * Per-process runtime glue. Holds the `hive` binary path (needed to extend persona PATHs)
 * and produces backend factories on demand. Locating the hive root is a separate concern:
 * `discoverHive` walks up from `cwd` looking for `hive.toml`.
 */

export interface Runtime {
  hiveBinaryPath: string;
  /** Get factories for every backend supported in v1. */
  factories(): BackendFactory[];
  /** Resolve which backend to use, given the hive's runtime config. */
  selectBackend(prefer: "native" | "tmux" | "auto"): Promise<Backend>;
  /** Load the composite hive (root + sub-hives) from a hive.toml path. */
  loadHive(hiveRoot: string): Promise<CompositeHive>;
}

export interface RuntimeOptions {
  /** Override the resolved `hive` binary path (used by tests). */
  hiveBinaryPath?: string;
}

export function createRuntime(opts: RuntimeOptions = {}): Runtime {
  const hiveBinaryPath = opts.hiveBinaryPath ?? process.execPath;
  const tmux = tmuxFactory(hiveBinaryPath);
  const native = nativeMacFactory({ hiveBinaryPath });

  return {
    hiveBinaryPath,
    factories(): BackendFactory[] {
      return [native, tmux];
    },
    async selectBackend(prefer): Promise<Backend> {
      const candidates: Array<{
        pref: number;
        factory: BackendFactory;
        caps: BackendCapabilities;
      }> = [];
      const factories = [native, tmux];
      for (const f of factories) {
        const caps = await f.capabilities();
        let pref: number;
        if (prefer === "auto") {
          pref =
            caps.name === "native-mac" && process.platform === "darwin"
              ? 0
              : caps.name === "tmux"
                ? 1
                : 99;
        } else if (prefer === "native") {
          pref = caps.name === "native-mac" ? 0 : 99;
        } else {
          pref = caps.name === "tmux" ? 0 : 99;
        }
        if (caps.available) {
          candidates.push({ pref, factory: f, caps });
        }
      }
      candidates.sort((a, b) => a.pref - b.pref);
      const chosen = candidates[0];
      if (!chosen || chosen.pref >= 99) {
        throw new Error(
          `no available backend matches preference "${prefer}". Run \`hive backend\` for what's detected.`,
        );
      }
      return chosen.factory.create();
    },
    async loadHive(hiveRoot: string): Promise<CompositeHive> {
      const file = resolve(hiveRoot, "hive.toml");
      return loadCompositeHive(file);
    },
  };
}

/**
 * Walk up from `start` looking for a directory containing `hive.toml`. Returns the
 * directory (not the file). Stops at filesystem root.
 */
export function discoverHive(start: string = process.cwd()): string | undefined {
  let cur = resolve(start);
  // Limit to a reasonable walk depth so a deeply nested cwd doesn't pin the loop.
  for (let i = 0; i < 32; i++) {
    if (existsSync(`${cur}/hive.toml`)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
  return undefined;
}
