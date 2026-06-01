import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a command and capture its output. Never throws on non-zero exit; the caller inspects
 * `exitCode`. Throws only if the binary itself can't be spawned (e.g. ENOENT).
 */
export async function execCapture(
  cmd: string,
  args: string[] = [],
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`command timed out: ${cmd} ${args.join(" ")}`));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

export async function which(cmd: string): Promise<string | undefined> {
  try {
    const res = await execCapture("/usr/bin/env", ["which", cmd]);
    if (res.exitCode !== 0) return undefined;
    const line = res.stdout.split("\n").find((l) => l.trim().length > 0);
    return line?.trim();
  } catch {
    return undefined;
  }
}

export async function whichAll(cmd: string): Promise<string[]> {
  try {
    const res = await execCapture("/usr/bin/env", ["which", "-a", cmd]);
    if (res.exitCode !== 0) return [];
    return res.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}
