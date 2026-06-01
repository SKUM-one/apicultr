import { execCapture, which } from "./exec.ts";

export interface ToolVersion {
  name: string;
  version: string | undefined;
  path: string | undefined;
  detail?: string;
}

/**
 * Parse a `tmux -V` style line: returns the first dotted-numeric token, or the raw line
 * if nothing parses. Returned strings exclude leading "v" or "version".
 */
export function extractVersionToken(raw: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/[\dvV]?(\d+(?:\.\d+)+(?:[A-Za-z][\w.-]*)?)/);
  if (match?.[1]) return match[1];
  return trimmed.split(/\s+/)[0];
}

/** Compare two dotted-numeric versions. Returns -1, 0, 1. Unknown suffixes treated as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

export async function detectBun(): Promise<ToolVersion> {
  const path = await which("bun");
  if (!path) return { name: "bun", version: undefined, path: undefined };
  try {
    const res = await execCapture("bun", ["--version"], { timeoutMs: 5000 });
    return {
      name: "bun",
      version: extractVersionToken(res.stdout),
      path,
    };
  } catch (err) {
    return { name: "bun", version: undefined, path, detail: String(err) };
  }
}

export async function detectTmux(): Promise<ToolVersion> {
  const path = await which("tmux");
  if (!path) return { name: "tmux", version: undefined, path: undefined };
  try {
    const res = await execCapture("tmux", ["-V"], { timeoutMs: 5000 });
    return {
      name: "tmux",
      version: extractVersionToken(res.stdout),
      path,
    };
  } catch (err) {
    return { name: "tmux", version: undefined, path, detail: String(err) };
  }
}

export async function detectClaude(): Promise<ToolVersion> {
  const path = await which("claude");
  if (!path) return { name: "claude", version: undefined, path: undefined };
  try {
    const res = await execCapture("claude", ["--version"], { timeoutMs: 10000 });
    const first = res.stdout.split("\n").find((l) => l.trim().length > 0) ?? "";
    return {
      name: "claude",
      version: extractVersionToken(first),
      path,
    };
  } catch (err) {
    return { name: "claude", version: undefined, path, detail: String(err) };
  }
}

const TERMINAL_PATHS = [
  "/System/Applications/Utilities/Terminal.app",
  "/Applications/Utilities/Terminal.app",
];

export async function detectTerminalApp(): Promise<ToolVersion> {
  if (process.platform !== "darwin") {
    return { name: "Terminal.app", version: undefined, path: undefined, detail: "not macOS" };
  }
  for (const p of TERMINAL_PATHS) {
    try {
      const plist = `${p}/Contents/Info.plist`;
      const res = await execCapture(
        "/usr/bin/defaults",
        ["read", plist, "CFBundleShortVersionString"],
        { timeoutMs: 5000 },
      );
      if (res.exitCode === 0) {
        return { name: "Terminal.app", version: res.stdout.trim() || undefined, path: p };
      }
    } catch {
      // try next path
    }
  }
  return { name: "Terminal.app", version: undefined, path: undefined };
}
