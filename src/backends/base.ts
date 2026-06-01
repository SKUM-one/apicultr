import type { CompositeHive, NamespacedPersona } from "../core/sub-hive.ts";

/**
 * The backend interface every window-system implementation must satisfy. tmux and
 * native-Mac share these primitives; future iTerm2-native / Ghostty backends will plug
 * in by implementing the same shape.
 *
 * Backends are deliberately stateless across processes: `start` writes whatever state it
 * needs to disk (tmux uses tmux's own session registry; native uses Terminal.app's window
 * list keyed by custom title). Any later command (`dispatch`, `status`, etc.) re-reads
 * from that state, so each invocation of `hive` is self-contained.
 */

export type HealthState = "running" | "ready" | "busy" | "blocked" | "stalled" | "dead";

export interface PersonaHealth {
  address: string;
  state: HealthState;
  /** When this signal was sampled (epoch ms). */
  sampledAt: number;
  /** Human-readable detail, e.g. "claude prompt visible" or "no output for 12m". */
  detail?: string;
}

export interface DispatchOptions {
  /** When dispatched from another persona, the source's address. Used for audit logging. */
  fromPersona?: string;
  /** Absolute path the brief was written to (purely informational; the content is what dispatches). */
  briefPath?: string;
}

export interface BackendCapabilities {
  /** The name customers see in `hive backend`. */
  name: "native-mac" | "tmux";
  /** Human description. */
  description: string;
  /** True if this backend can run on the current platform with the current tooling. */
  available: boolean;
  /** When `available === false`, why. */
  unavailableReason?: string;
}

export interface Backend {
  readonly capabilities: BackendCapabilities;

  /** Spawn one window/pane per persona and start each persona's `claude` process. */
  start(hive: CompositeHive): Promise<void>;

  /** Tear down every window/pane belonging to the hive. */
  close(hive: CompositeHive, opts?: { force?: boolean }): Promise<void>;

  /** Deliver `content` into the persona's claude session. */
  dispatch(persona: NamespacedPersona, content: string, opts?: DispatchOptions): Promise<void>;

  /** Bring the persona's window/pane to focus. */
  focus(persona: NamespacedPersona): Promise<void>;

  /** Bring the whole hive to focus. */
  attach(hive: CompositeHive, persona?: NamespacedPersona): Promise<void>;

  /** Kill the persona's window/pane + claude process and respawn it. */
  restart(persona: NamespacedPersona): Promise<void>;

  /** Sample one persona's health. */
  healthCheck(persona: NamespacedPersona): Promise<PersonaHealth>;
}

export interface BackendFactory {
  capabilities(): Promise<BackendCapabilities>;
  create(): Backend;
}
