import { describe, expect, it } from "bun:test";
import { hiveSpec } from "../../src/bin/hive.ts";
import { runBinary } from "../../src/cli/command-router.ts";

function captureOutput(
  fn: () => Promise<number>,
): Promise<{ code: number; out: string; err: string }> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  return fn().then(
    (code) => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      return { code, out, err };
    },
    (e) => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      throw e;
    },
  );
}

describe("hive doctor", () => {
  it("produces structured JSON with --json and includes all checks", async () => {
    const r = await captureOutput(() => runBinary(hiveSpec, ["doctor", "--json"]));
    const parsed = JSON.parse(r.out) as {
      exitCode: number;
      platform: string;
      summary: { passed: number; warned: number; failed: number };
      checks: Array<{ id: string; severity: string; title: string; message: string }>;
    };
    expect(parsed.platform).toBe(process.platform);
    expect(parsed.checks.length).toBeGreaterThanOrEqual(6);
    const ids = parsed.checks.map((c) => c.id);
    expect(ids).toContain("fs.tmp");
    expect(ids).toContain("path.conflicts");
    expect(parsed.exitCode).toBe(r.code);
  });

  it("produces human-readable output without --json", async () => {
    const r = await captureOutput(() => runBinary(hiveSpec, ["doctor"]));
    expect(r.out).toContain("summary:");
    expect(r.out).toMatch(/doctor: (OK|FAIL)/);
  });
});
