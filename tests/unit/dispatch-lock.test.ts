import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DispatchLockTimeoutError, withDispatchLock } from "../../src/core/dispatch-lock.ts";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "apicultr-lock-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("withDispatchLock", () => {
  it("serialises concurrent calls", async () => {
    await withTempDir(async (dir) => {
      const lockPath = join(dir, "dispatch.lock");
      const events: string[] = [];
      const work = (id: string) =>
        withDispatchLock(lockPath, async () => {
          events.push(`start-${id}`);
          await new Promise((r) => setTimeout(r, 25));
          events.push(`end-${id}`);
        });
      await Promise.all([work("a"), work("b"), work("c")]);
      // Each call must completely finish before the next starts.
      for (let i = 0; i < events.length; i += 2) {
        const start = events[i];
        const end = events[i + 1];
        expect(start?.startsWith("start-")).toBe(true);
        expect(end?.startsWith("end-")).toBe(true);
        expect(start?.slice(6)).toBe(end?.slice(4));
      }
    });
  });

  it("times out when the holder appears alive past the deadline", async () => {
    await withTempDir(async (dir) => {
      const lockPath = join(dir, "dispatch.lock");
      // Hold the lock with a long-running fn while a parallel attempt times out.
      const holder = withDispatchLock(lockPath, () => new Promise((r) => setTimeout(r, 500)));
      // Give the holder a moment to claim
      await new Promise((r) => setTimeout(r, 30));
      let caught: unknown;
      try {
        await withDispatchLock(lockPath, async () => "should not run", {
          timeoutMs: 50,
          pollMs: 10,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DispatchLockTimeoutError);
      await holder;
    });
  });

  it("steals the lock when the holder PID is dead", async () => {
    await withTempDir(async (dir) => {
      const lockPath = join(dir, "dispatch.lock");
      // Pre-populate the lock with a fake holder whose PID we'll report as dead.
      const { writeFile } = await import("node:fs/promises");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(lockPath, JSON.stringify({ pid: 999_999, acquiredAt: Date.now() }));
      let ran = false;
      await withDispatchLock(
        lockPath,
        async () => {
          ran = true;
        },
        {
          isAlive: () => false,
        },
      );
      expect(ran).toBe(true);
    });
  });

  it("releases the lock on success", async () => {
    await withTempDir(async (dir) => {
      const lockPath = join(dir, "dispatch.lock");
      await withDispatchLock(lockPath, async () => "first");
      // A second call should claim cleanly.
      const second = await withDispatchLock(lockPath, async () => "second");
      expect(second).toBe("second");
    });
  });

  it("releases the lock when the wrapped fn throws", async () => {
    await withTempDir(async (dir) => {
      const lockPath = join(dir, "dispatch.lock");
      await expect(
        withDispatchLock(lockPath, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      // Re-acquire to prove it was released.
      await withDispatchLock(lockPath, async () => undefined);
    });
  });
});
