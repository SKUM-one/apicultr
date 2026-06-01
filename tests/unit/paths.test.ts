import { describe, expect, it } from "bun:test";
import { hivePaths, isoDate, slugify, windowsToWslPath } from "../../src/core/paths.ts";

describe("slugify", () => {
  it("lower-cases and replaces non-alphanumeric", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });
  it("collapses runs of non-alphanumeric to single hyphen", () => {
    expect(slugify("a  b -- c")).toBe("a-b-c");
  });
  it("strips leading/trailing hyphens", () => {
    expect(slugify("---abc---")).toBe("abc");
  });
  it("truncates", () => {
    expect(slugify("a".repeat(100), 10)).toBe("aaaaaaaaaa");
  });
  it("falls back to 'untitled' when input has nothing usable", () => {
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
  });
});

describe("isoDate", () => {
  it("formats as YYYY-MM-DD", () => {
    const out = isoDate(new Date(Date.UTC(2026, 4, 31)));
    expect(out).toBe("2026-05-31");
  });
  it("zero-pads month/day", () => {
    expect(isoDate(new Date(Date.UTC(2026, 0, 7)))).toBe("2026-01-07");
  });
});

describe("hivePaths", () => {
  it("returns canonical subpaths under the root", () => {
    const p = hivePaths("/tmp/h");
    expect(p.hiveToml).toBe("/tmp/h/hive.toml");
    expect(p.personasDir).toBe("/tmp/h/personas");
    expect(p.briefsDir).toBe("/tmp/h/.hive/briefs");
    expect(p.dispatchLock).toBe("/tmp/h/.hive/dispatch.lock");
  });
});

describe("windowsToWslPath", () => {
  it("converts C:\\ paths", () => {
    expect(windowsToWslPath("C:\\Users\\mick")).toBe("/mnt/c/Users/mick");
  });
  it("converts forward-slash mixed-style Windows paths", () => {
    expect(windowsToWslPath("D:/projects/foo")).toBe("/mnt/d/projects/foo");
  });
  it("lowers the drive letter", () => {
    expect(windowsToWslPath("C:/x")).toBe("/mnt/c/x");
  });
  it("leaves POSIX paths alone", () => {
    expect(windowsToWslPath("/Users/mick")).toBe("/Users/mick");
  });
});
