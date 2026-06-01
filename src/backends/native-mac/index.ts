import { spawn } from "node:child_process";
import { buildClaudeCommand } from "../../core/claude.ts";
import { execCapture, which } from "../../core/exec.ts";
import type { CompositeHive, NamespacedPersona } from "../../core/sub-hive.ts";
import type {
  Backend,
  BackendCapabilities,
  BackendFactory,
  DispatchOptions,
  PersonaHealth,
} from "../base.ts";
import {
  type DisplayBounds,
  type GridCellPlacement,
  computeGrid,
  parseDisplayBounds,
} from "./grid.ts";

import closeByTitlesScript from "./applescripts/close-by-titles.applescript" with { type: "text" };
import focusAndPasteScript from "./applescripts/focus-and-paste.applescript" with { type: "text" };
import launchWindowScript from "./applescripts/launch-window.applescript" with { type: "text" };
import paneContentsScript from "./applescripts/pane-contents.applescript" with { type: "text" };
import queryDisplayScript from "./applescripts/query-display.applescript" with { type: "text" };
import windowExistsScript from "./applescripts/window-exists.applescript" with { type: "text" };

/**
 * Native-Mac backend: one Terminal.app window per persona, arranged in a grid sized to
 * the active display at start time. Chief and king-terminal overlays use 50% opacity +
 * vibrancy blur per spec; workers run at 100% opacity. AppleScript snippets live in
 * `./applescripts/*.applescript` (text-imported and embedded into the binary at compile
 * time) and are invoked via osascript over stdin so we never have to inline AppleScript
 * in TS string literals.
 *
 * Focus-rise-on-focus (workers should dim until you click in) is deferred to v1.x —
 * requires a polling daemon or AppleScript event handler. v1 ships static opacity.
 */

export interface NativeMacOptions {
  hiveBinaryPath: string;
  /** Stall threshold (ms). Default 10 min. */
  stallThresholdMs?: number;
  /** Override the display bounds query (for tests + deterministic CI). */
  displayOverride?: DisplayBounds;
}

export class NativeMacBackend implements Backend {
  readonly capabilities: BackendCapabilities =
    process.platform === "darwin"
      ? {
          name: "native-mac",
          description:
            "One Terminal.app window per persona, arranged in a grid. Floating-overlay UX for the Chief.",
          available: true,
        }
      : {
          name: "native-mac",
          description:
            "One Terminal.app window per persona, arranged in a grid. Floating-overlay UX for the Chief.",
          available: false,
          unavailableReason: "macOS only",
        };

  constructor(private readonly opts: NativeMacOptions) {}

  async start(hive: CompositeHive): Promise<void> {
    const display = await this.queryDisplay();
    const targetSize = hive.root.config.runtime.native.target_window_size_px;
    const layout = computeGrid(hive.personas.length, display, targetSize);

    for (let i = 0; i < hive.personas.length; i++) {
      const persona = hive.personas[i];
      const cell = layout.cells[i];
      if (!persona || !cell) continue;
      await this.spawnPersonaWindow(persona, cell, hive);
    }
  }

  async close(hive: CompositeHive, _opts: { force?: boolean } = {}): Promise<void> {
    const titles = hive.personas.map((p) => p.canonicalAddress);
    if (titles.length === 0) return;
    await runOsascript(closeByTitlesScript, titles);
  }

  async dispatch(
    persona: NamespacedPersona,
    content: string,
    _opts: DispatchOptions = {},
  ): Promise<void> {
    // pbcopy the content first; focus-and-paste.applescript reads from the clipboard.
    await pbcopy(content);
    const res = await runOsascript(focusAndPasteScript, [persona.canonicalAddress]);
    if (res.exitCode !== 0) {
      throw new Error(`focus-and-paste failed: ${res.stderr.trim() || res.stdout.trim()}`);
    }
    if (res.stdout.startsWith("not_found")) {
      throw new Error(`persona window not found: ${persona.canonicalAddress}`);
    }
    if (res.stdout.startsWith("aborted")) {
      throw new Error(res.stdout.trim());
    }
  }

  async focus(persona: NamespacedPersona): Promise<void> {
    // We piggy-back on focus-and-paste's focus step by running a tiny inline activation.
    // For pure focus (no paste), use a minimal osascript invocation; we avoid an extra
    // file just for this since `tell app to activate; set frontmost...` is two lines.
    const script = `tell application "Terminal"
  activate
  try
    set targetWindow to first window whose custom title is item 1 of (input as list)
    set frontmost of targetWindow to true
    set index of targetWindow to 1
    return "ok"
  on error
    return "not_found"
  end try
end tell`;
    // Use args via stdin pattern: pass title as argv item 1.
    const res = await runOsascriptInline(script, [persona.canonicalAddress]);
    if (res.exitCode !== 0 || res.stdout.trim() === "not_found") {
      throw new Error(`persona window not found: ${persona.canonicalAddress}`);
    }
  }

  async attach(hive: CompositeHive, persona?: NamespacedPersona): Promise<void> {
    // Native: bring Terminal to the front, raise hive windows. If a persona is named,
    // raise that one specifically.
    if (persona) {
      await this.focus(persona);
      return;
    }
    // No persona: raise all hive windows in z-order. For v1, we simply activate Terminal
    // and let the Chief's window (the first in the list) come to focus.
    const chief = hive.personas.find((p) => p.role === "chief");
    if (chief) {
      await this.focus(chief);
    }
  }

  async restart(persona: NamespacedPersona): Promise<void> {
    await runOsascript(closeByTitlesScript, [persona.canonicalAddress]);
    // The CLI re-loads the hive and calls spawnPersonaWindow with the original placement;
    // backend-level restart from a single persona handle can't recover the grid placement
    // because layout is derived from the full personas list. The CLI handles that.
  }

  async healthCheck(persona: NamespacedPersona): Promise<PersonaHealth> {
    const now = Date.now();
    const exists = await runOsascript(windowExistsScript, [persona.canonicalAddress]);
    if (exists.exitCode !== 0 || exists.stdout.trim() !== "yes") {
      return {
        address: persona.canonicalAddress,
        state: "dead",
        sampledAt: now,
        detail: "window missing",
      };
    }
    const contents = await runOsascript(paneContentsScript, [persona.canonicalAddress]);
    if (contents.exitCode !== 0) {
      return {
        address: persona.canonicalAddress,
        state: "running",
        sampledAt: now,
        detail: "contents unreadable",
      };
    }
    const text = contents.stdout;
    if (/Do you want to proceed\?|approve|\[y\/N\]/i.test(text)) {
      return { address: persona.canonicalAddress, state: "blocked", sampledAt: now };
    }
    if (/\n[>›❯]\s*$/.test(text) || /\n│\s*>\s*$/.test(text)) {
      return { address: persona.canonicalAddress, state: "ready", sampledAt: now };
    }
    return { address: persona.canonicalAddress, state: "busy", sampledAt: now };
  }

  /**
   * Public method (used by `hive persona restart`): respawn a persona window at a freshly
   * computed grid cell. The CLI re-queries the display + persona list before calling.
   */
  async spawnPersonaWindow(
    persona: NamespacedPersona,
    cell: GridCellPlacement,
    hive: CompositeHive,
  ): Promise<void> {
    const isOverlay = persona.role === "chief";
    const bgAlpha = isOverlay ? hive.root.config.runtime.native.overlay_opacity : 1.0;
    const useBlur = isOverlay && hive.root.config.runtime.native.use_blur ? "yes" : "no";
    const cmd = buildClaudeCommand(persona, {
      defaultModel: hive.root.config.runtime.default_model,
      hiveBinaryPath: this.opts.hiveBinaryPath,
    });
    const envPrefix = envForShell(cmd.env);
    const fullCommand = `${envPrefix} ${cmd.shellCommand}`;
    const res = await runOsascript(launchWindowScript, [
      persona.canonicalAddress,
      bgAlpha.toFixed(2),
      useBlur,
      cmd.cwd,
      fullCommand,
      String(cell.x),
      String(cell.y),
      String(cell.width),
      String(cell.height),
    ]);
    if (res.exitCode !== 0) {
      throw new Error(
        `failed to launch window for ${persona.canonicalAddress}: ${res.stderr.trim() || res.stdout.trim()}`,
      );
    }
  }

  async queryDisplay(): Promise<DisplayBounds> {
    if (this.opts.displayOverride) return this.opts.displayOverride;
    const res = await runOsascript(queryDisplayScript, []);
    if (res.exitCode !== 0) {
      throw new Error(`query-display failed: ${res.stderr.trim()}`);
    }
    const parsed = parseDisplayBounds(res.stdout);
    if (!parsed) throw new Error(`query-display returned unparseable bounds: ${res.stdout.trim()}`);
    return parsed;
  }
}

// ─── osascript helpers ──────────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runOsascript(script: string, args: string[]): Promise<ExecResult> {
  return runOsascriptWith(["-", ...args], script);
}

async function runOsascriptInline(script: string, args: string[]): Promise<ExecResult> {
  return runOsascriptWith(["-e", script, ...args], "");
}

function runOsascriptWith(args: string[], stdinContent: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    if (stdinContent.length > 0) child.stdin.write(stdinContent);
    child.stdin.end();
  });
}

async function pbcopy(content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pbcopy", []);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pbcopy exited ${code}`));
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

function envForShell(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${shellQuote(v)}`)
    .join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/@:=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// ─── Factory ────────────────────────────────────────────────────────────

export function nativeMacFactory(opts: NativeMacOptions): BackendFactory {
  return {
    async capabilities(): Promise<BackendCapabilities> {
      if (process.platform !== "darwin") {
        return {
          name: "native-mac",
          description: "macOS Terminal.app backend",
          available: false,
          unavailableReason: "not macOS",
        };
      }
      const osascript = await which("osascript");
      if (!osascript) {
        return {
          name: "native-mac",
          description: "macOS Terminal.app backend",
          available: false,
          unavailableReason: "osascript not on PATH",
        };
      }
      const probe = await execCapture("osascript", ["-e", "return 1+1"], { timeoutMs: 3000 });
      if (probe.exitCode !== 0 || probe.stdout.trim() !== "2") {
        return {
          name: "native-mac",
          description: "macOS Terminal.app backend",
          available: false,
          unavailableReason: "osascript probe failed",
        };
      }
      return {
        name: "native-mac",
        description: `Terminal.app via osascript (${osascript})`,
        available: true,
      };
    },
    create(): Backend {
      return new NativeMacBackend(opts);
    },
  };
}
