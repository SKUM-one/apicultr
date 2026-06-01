import { describe, expect, it } from "bun:test";
import { compareVersions, extractVersionToken } from "../../src/core/versions.ts";

describe("extractVersionToken", () => {
  it("parses tmux -V output", () => {
    expect(extractVersionToken("tmux 3.6b")).toBe("3.6b");
  });
  it("parses tmux 1.9 (old)", () => {
    expect(extractVersionToken("tmux 1.9a")).toBe("1.9a");
  });
  it("parses bun --version output", () => {
    expect(extractVersionToken("1.3.14")).toBe("1.3.14");
  });
  it("parses claude --version output", () => {
    expect(extractVersionToken("2.1.142 (Claude Code)")).toBe("2.1.142");
  });
  it("returns undefined for empty", () => {
    expect(extractVersionToken("")).toBeUndefined();
  });
});

describe("compareVersions", () => {
  it("treats equal versions as 0", () => {
    expect(compareVersions("1.3.14", "1.3.14")).toBe(0);
  });
  it("treats newer as 1", () => {
    expect(compareVersions("3.6", "1.9")).toBe(1);
  });
  it("treats older as -1", () => {
    expect(compareVersions("1.8", "1.9")).toBe(-1);
  });
  it("handles different-length version strings", () => {
    expect(compareVersions("1.9", "1.9.0")).toBe(0);
    expect(compareVersions("1.10", "1.9")).toBe(1);
  });
  it("treats non-numeric suffixes as 0 in their slot", () => {
    expect(compareVersions("3.6b", "3.6")).toBe(0);
  });
});
