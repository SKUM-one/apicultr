import { describe, expect, it } from "bun:test";
import { apicultrSpec } from "../../src/bin/apicultr.ts";
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

describe("apicultr version", () => {
  it("prints structured JSON with --json", async () => {
    const r = await captureOutput(() => runBinary(apicultrSpec, ["version", "--json"]));
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out) as {
      apicultr: string;
      tools: Record<string, { name: string; version: string | undefined }>;
    };
    expect(parsed.apicultr).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.tools).toHaveProperty("bun");
    expect(parsed.tools).toHaveProperty("tmux");
    expect(parsed.tools).toHaveProperty("claude");
    if (process.platform === "darwin") {
      expect("Terminal.app" in parsed.tools).toBe(true);
    }
  });

  it("prints a human-readable toolchain table by default", async () => {
    const r = await captureOutput(() => runBinary(apicultrSpec, ["version"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("apicultr");
    expect(r.out).toContain("toolchain:");
  });
});
