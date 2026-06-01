import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Cross-platform advisory lock implemented with a sentinel file. We use O_EXCL via the
 * `wx` flag: only one process can create the sentinel; everyone else loops.
 *
 * The sentinel contains the holder's PID + timestamp. If we find a sentinel whose PID
 * is dead, we steal the lock (the holder crashed without cleaning up).
 *
 * This is the bee-keeping equivalent of the legacy swarm-shell.zsh `sleep 1.5`
 * discipline, lifted into the runtime so dispatchers (human or persona) never have to
 * think about it.
 */

export interface LockOptions {
  /** Maximum total time to wait for the lock before throwing. Default 30_000 ms. */
  timeoutMs?: number;
  /** Polling interval between acquisition attempts. Default 50 ms with jitter. */
  pollMs?: number;
  /** Override for tests. Defaults to `process.pid`. */
  pidOverride?: number;
  /** Override for tests. Defaults to `(pid) => true unless ESRCH`. */
  isAlive?: (pid: number) => boolean;
}

export class DispatchLockTimeoutError extends Error {
  constructor(
    public readonly path: string,
    public readonly timeoutMs: number,
    public readonly holder: LockHolder | undefined,
  ) {
    const holderDesc = holder
      ? `${holder.pid}@${new Date(holder.acquiredAt).toISOString()}`
      : "unknown";
    super(
      `dispatch queue stalled: lock at ${path} held by ${holderDesc} for longer than ${timeoutMs}ms`,
    );
    this.name = "DispatchLockTimeoutError";
  }
}

export interface LockHolder {
  pid: number;
  acquiredAt: number;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM means the process exists but isn't ours; treat as alive.
    return true;
  }
}

async function tryRead(path: string): Promise<LockHolder | undefined> {
  try {
    const txt = await readFile(path, "utf8");
    const data = JSON.parse(txt) as LockHolder;
    if (typeof data.pid === "number" && typeof data.acquiredAt === "number") {
      return data;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function tryClaim(path: string, holder: LockHolder): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(holder), { flag: "wx" });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    throw err;
  }
}

/**
 * Run `fn` while holding the lock at `lockPath`. The lock is released even if `fn` throws.
 * If the lock can't be acquired before `timeoutMs`, `DispatchLockTimeoutError` is thrown
 * with the suspected holder.
 */
export async function withDispatchLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pollMs = opts.pollMs ?? 50;
  const pid = opts.pidOverride ?? process.pid;
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const deadline = Date.now() + timeoutMs;
  const holder: LockHolder = { pid, acquiredAt: Date.now() };
  let suspectedHolder: LockHolder | undefined;

  while (true) {
    if (await tryClaim(lockPath, holder)) {
      try {
        return await fn();
      } finally {
        try {
          await unlink(lockPath);
        } catch {
          // best-effort cleanup; another process may have stolen the dead lock
        }
      }
    }

    suspectedHolder = await tryRead(lockPath);
    if (suspectedHolder && !isAlive(suspectedHolder.pid)) {
      // Steal: holder is dead. Best-effort unlink then retry.
      try {
        await unlink(lockPath);
      } catch {
        // someone else stole it; just loop
      }
      continue;
    }

    if (Date.now() >= deadline) {
      throw new DispatchLockTimeoutError(lockPath, timeoutMs, suspectedHolder);
    }

    const jitter = Math.random() * pollMs;
    await new Promise((r) => setTimeout(r, pollMs + jitter));
  }
}
