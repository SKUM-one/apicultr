import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClaudeCommand, buildClaudeCommand } from "../../core/claude.ts";
import { execCapture, which } from "../../core/exec.ts";
import type { CompositeHive, NamespacedPersona } from "../../core/sub-hive.ts";
import { compareVersions, extractVersionToken } from "../../core/versions.ts";
import type {
  Backend,
  BackendCapabilities,
  BackendFactory,
  DispatchOptions,
  PersonaHealth,
} from "../base.ts";

/**
 * tmux backend: one tmux session per hive (prefix `apicultr-`), one window per persona
 * (window name == persona's namespaced address with `:` replaced by `--`, since tmux
 * window names disallow colons).
 *
 * Dispatch: write content to a temp buffer file, `tmux load-buffer`, `tmux paste-buffer
 * -t <session>:<window>`, then `tmux send-keys Enter`. Byte-perfect for multi-line UTF-8.
 *
 * Health: `tmux capture-pane -p` returns the visible pane text; we look for the claude
 * prompt marker, plan-mode confirmation patterns, and recency of last activity.
 */

const SESSION_PREFIX = "apicultr-";
const MIN_TMUX = "1.9";

export class TmuxBackend implements Backend {
  readonly capabilities: BackendCapabilities = {
    name: "tmux",
    description: "One tmux session per hive, one window per persona. Cross-platform.",
    available: true,
  };

  constructor(
    private readonly opts: {
      /** Absolute path to the running `hive` binary, for PATH extension in child claude shells. */
      hiveBinaryPath: string;
      /** Stall threshold (ms) — health goes `stalled` after this much silence. Default 10 min. */
      stallThresholdMs?: number;
    },
  ) {}

  async start(hive: CompositeHive): Promise<void> {
    const session = sessionName(hive.root.config.hive.name);
    await this.ensureSession(session);
    for (const persona of hive.personas) {
      await this.spawnPersonaWindow(session, persona, hive);
    }
  }

  async close(hive: CompositeHive, opts: { force?: boolean } = {}): Promise<void> {
    const session = sessionName(hive.root.config.hive.name);
    if (!opts.force) {
      // Soft-mode: in v1, no in-flight detection beyond the dispatch lock. The lock
      // governs serialization; an active dispatch here means the lock is held elsewhere
      // and kill-session would still race. We accept that and document it.
    }
    await execCapture("tmux", ["kill-session", "-t", session]);
  }

  async dispatch(
    persona: NamespacedPersona,
    content: string,
    _opts: DispatchOptions = {},
  ): Promise<void> {
    const session = currentSessionForPersona(persona);
    const window = windowName(persona);
    const target = `${session}:${window}`;
    const tmpfile = join(tmpdir(), `apicultr-buf-${process.pid}-${Date.now()}.txt`);
    await writeFile(tmpfile, content, "utf8");
    try {
      const loaded = await execCapture("tmux", ["load-buffer", "-b", target, tmpfile]);
      if (loaded.exitCode !== 0) {
        throw new Error(`tmux load-buffer failed: ${loaded.stderr.trim()}`);
      }
      const pasted = await execCapture("tmux", ["paste-buffer", "-b", target, "-t", target, "-d"]);
      if (pasted.exitCode !== 0) {
        throw new Error(`tmux paste-buffer failed: ${pasted.stderr.trim()}`);
      }
      const sent = await execCapture("tmux", ["send-keys", "-t", target, "Enter"]);
      if (sent.exitCode !== 0) {
        throw new Error(`tmux send-keys failed: ${sent.stderr.trim()}`);
      }
    } finally {
      try {
        await unlink(tmpfile);
      } catch {
        // best-effort cleanup
      }
    }
  }

  async focus(persona: NamespacedPersona): Promise<void> {
    const session = currentSessionForPersona(persona);
    const window = windowName(persona);
    await execCapture("tmux", ["select-window", "-t", `${session}:${window}`]);
  }

  async attach(hive: CompositeHive, persona?: NamespacedPersona): Promise<void> {
    const session = sessionName(hive.root.config.hive.name);
    if (persona) {
      await this.focus(persona);
    }
    // tmux attach requires an interactive terminal; this is a stub for tests, the CLI
    // wraps it with execvp(3)-style replacement so the user sees the attached session.
    await execCapture("tmux", ["attach-session", "-t", session]);
  }

  async restart(persona: NamespacedPersona): Promise<void> {
    const session = currentSessionForPersona(persona);
    const window = windowName(persona);
    const target = `${session}:${window}`;
    await execCapture("tmux", ["kill-window", "-t", target]);
    // The CLI handler calls `respawnPersonaWindow` next; we deliberately don't respawn
    // here so the native and tmux flows stay symmetric (native needs grid info the
    // backend can't recompute on its own).
  }

  /**
   * Public-from-tests: respawn a previously-killed persona window without rebuilding the
   * whole hive. The CLI's `hive persona restart` uses this after `restart`. Stored on the
   * backend so it can be invoked without re-loading the full hive composite.
   */
  async respawnPersonaWindow(persona: NamespacedPersona): Promise<void> {
    const session = currentSessionForPersona(persona);
    // Without the hive composite here, we delegate the actual model/identity wiring to the
    // CLI; this method only restores the window with a fresh claude shell using the
    // persona's stored workspace.
    const cmd: ClaudeCommand = buildClaudeCommand(persona, {
      defaultModel: persona.model ?? "claude-opus-4-7",
      hiveBinaryPath: this.opts.hiveBinaryPath,
    });
    const envPrefix = envForShell(cmd.env);
    const shell = `${envPrefix} ${cmd.shellCommand}`;
    await execCapture("tmux", [
      "new-window",
      "-d",
      "-t",
      session,
      "-n",
      windowName(persona),
      "-c",
      cmd.cwd,
      shell,
    ]);
  }

  async healthCheck(persona: NamespacedPersona): Promise<PersonaHealth> {
    const session = currentSessionForPersona(persona);
    const window = windowName(persona);
    const target = `${session}:${window}`;
    const stallMs = this.opts.stallThresholdMs ?? 10 * 60_000;
    const now = Date.now();

    const list = await execCapture("tmux", [
      "list-windows",
      "-t",
      session,
      "-F",
      "#{window_name}|#{window_activity}",
    ]);
    if (list.exitCode !== 0) {
      return {
        address: persona.canonicalAddress,
        state: "dead",
        sampledAt: now,
        detail: "session missing",
      };
    }
    const entry = list.stdout.split("\n").find((line) => line.startsWith(`${window}|`));
    if (!entry) {
      return {
        address: persona.canonicalAddress,
        state: "dead",
        sampledAt: now,
        detail: "window missing",
      };
    }
    const activityToken = entry.split("|")[1]?.trim() ?? "";
    const activitySec = Number.parseInt(activityToken, 10);
    const lastActivityMs = Number.isFinite(activitySec) ? activitySec * 1000 : now;

    const pane = await execCapture("tmux", ["capture-pane", "-p", "-t", target, "-S", "-50"]);
    const text = pane.stdout;
    const state = classifyPane(text, now - lastActivityMs, stallMs);
    return {
      address: persona.canonicalAddress,
      state,
      sampledAt: now,
      detail: `last activity ${Math.round((now - lastActivityMs) / 1000)}s ago`,
    };
  }

  // ─── internals ────────────────────────────────────────────────────────

  private async ensureSession(session: string): Promise<void> {
    const has = await execCapture("tmux", ["has-session", "-t", session]);
    if (has.exitCode === 0) return;
    // Bootstrap with a detached, no-window session and a placeholder window we kill once
    // a real persona window arrives. Simpler: start the session with the first persona's
    // window; but bootstrap-with-placeholder keeps spawnPersonaWindow uniform.
    const created = await execCapture("tmux", [
      "new-session",
      "-d",
      "-s",
      session,
      "-n",
      "__apicultr_bootstrap",
    ]);
    if (created.exitCode !== 0) {
      throw new Error(`failed to create tmux session ${session}: ${created.stderr.trim()}`);
    }
  }

  private async spawnPersonaWindow(
    session: string,
    persona: NamespacedPersona,
    hive: CompositeHive,
  ): Promise<void> {
    const cmd = buildClaudeCommand(persona, {
      defaultModel: hive.root.config.runtime.default_model,
      hiveBinaryPath: this.opts.hiveBinaryPath,
    });
    const envPrefix = envForShell(cmd.env);
    const shell = `${envPrefix} ${cmd.shellCommand}`;
    const created = await execCapture("tmux", [
      "new-window",
      "-d",
      "-t",
      session,
      "-n",
      windowName(persona),
      "-c",
      cmd.cwd,
      shell,
    ]);
    if (created.exitCode !== 0) {
      throw new Error(
        `failed to spawn window for ${persona.canonicalAddress}: ${created.stderr.trim()}`,
      );
    }
    // Best-effort: drop the bootstrap window once we have a real one. Quiet failure if
    // it's already gone (e.g. on second call).
    await execCapture("tmux", ["kill-window", "-t", `${session}:__apicultr_bootstrap`]);
  }
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

function sessionName(hiveName: string): string {
  const safe = hiveName.replace(/[^A-Za-z0-9_-]/g, "-");
  return `${SESSION_PREFIX}${safe}`;
}

function windowName(persona: NamespacedPersona): string {
  // tmux window names disallow `:` since `target = session:window`. Replace with `--`.
  return persona.canonicalAddress.replace(/:/g, "--");
}

function currentSessionForPersona(persona: NamespacedPersona): string {
  // A persona belongs to exactly one tmux session, identified by the root hive's name.
  // We embed it in the persona's workspaceAbs via the hive root directory. The simplest
  // resolution: walk up from workspaceAbs to find the directory containing hive.toml
  // and use that dir's basename. For the persona-restart flow we use the parent hive.
  // For dispatch from another process (e.g. persona-to-persona) we re-derive here.
  //
  // Implementation: cache via `APICULTR_TMUX_SESSION` env on spawn. Until then we use
  // the persona.workspaceAbs ancestor heuristic.
  const fromEnv = process.env["APICULTR_TMUX_SESSION"];
  if (fromEnv) return fromEnv;
  // Fall back: assume the workspace parent's basename names the hive.
  const parts = persona.workspaceAbs.split("/");
  // workspaceAbs is .../<hive-root>/<persona-address>
  const hiveDir = parts[parts.length - 2] ?? "default";
  return sessionName(hiveDir);
}

function classifyPane(
  text: string,
  silenceMs: number,
  stallThresholdMs: number,
): "running" | "ready" | "busy" | "blocked" | "stalled" {
  if (/Do you want to proceed\?|approve|\[y\/N\]/i.test(text)) return "blocked";
  if (silenceMs > stallThresholdMs) return "stalled";
  // Claude Code's REPL prompt is detectable by the trailing `>` prompt line; heuristic.
  if (/\n[>›❯]\s*$/.test(text) || /\n│\s*>\s*$/.test(text)) return "ready";
  return "busy";
}

// ─── Factory ────────────────────────────────────────────────────────────

export function tmuxFactory(hiveBinaryPath: string): BackendFactory {
  return {
    async capabilities(): Promise<BackendCapabilities> {
      const path = await which("tmux");
      if (!path) {
        return {
          name: "tmux",
          description: "One tmux session per hive, one window per persona. Cross-platform.",
          available: false,
          unavailableReason: "tmux not found on PATH",
        };
      }
      const res = await execCapture("tmux", ["-V"], { timeoutMs: 5000 });
      const ver = extractVersionToken(res.stdout);
      if (!ver || compareVersions(ver, MIN_TMUX) < 0) {
        return {
          name: "tmux",
          description: "One tmux session per hive, one window per persona. Cross-platform.",
          available: false,
          unavailableReason: `tmux ${ver ?? "(unknown)"} < required ${MIN_TMUX}`,
        };
      }
      return {
        name: "tmux",
        description: `tmux ${ver} at ${path}`,
        available: true,
      };
    },
    create(): Backend {
      return new TmuxBackend({ hiveBinaryPath });
    },
  };
}
