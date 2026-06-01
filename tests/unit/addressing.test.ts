import { describe, expect, it } from "bun:test";
import {
  buildCodenameIndex,
  formatAddress,
  formatIndex,
  isValidAddress,
  parseAddress,
} from "../../src/core/addressing.ts";

describe("formatIndex", () => {
  it("pads to 3 digits", () => {
    expect(formatIndex(1)).toBe("001");
    expect(formatIndex(42)).toBe("042");
  });
  it("grows past 999 without padding", () => {
    expect(formatIndex(1000)).toBe("1000");
  });
  it("throws on negative or non-integer", () => {
    expect(() => formatIndex(-1)).toThrow();
    expect(() => formatIndex(1.5)).toThrow();
  });
});

describe("formatAddress", () => {
  it("combines role and padded index", () => {
    expect(formatAddress("chief", 1)).toBe("chief-001");
    expect(formatAddress("lead-frontend", 7)).toBe("lead-frontend-007");
  });
  it("prefixes sub-hive namespace with colon", () => {
    expect(formatAddress("frontend", 1, "kant-codes")).toBe("kant-codes:frontend-001");
  });
});

describe("parseAddress", () => {
  it("splits on the LAST hyphen for the index", () => {
    const p = parseAddress("lead-frontend-001");
    expect(p?.role).toBe("lead-frontend");
    expect(p?.index).toBe(1);
  });
  it("handles single-hyphen addresses", () => {
    const p = parseAddress("chief-001");
    expect(p?.role).toBe("chief");
    expect(p?.index).toBe(1);
  });
  it("parses 4-digit indexes (>999 growth)", () => {
    const p = parseAddress("frontend-1234");
    expect(p?.index).toBe(1234);
  });
  it("captures sub-hive prefix", () => {
    const p = parseAddress("kant-codes:lead-frontend-007");
    expect(p?.subHive).toBe("kant-codes");
    expect(p?.role).toBe("lead-frontend");
    expect(p?.index).toBe(7);
    expect(p?.local).toBe("lead-frontend-007");
  });
  it("rejects malformed inputs", () => {
    expect(parseAddress("")).toBeUndefined();
    expect(parseAddress("nohyphen")).toBeUndefined();
    expect(parseAddress("role-")).toBeUndefined();
    expect(parseAddress("role-abc")).toBeUndefined();
    expect(parseAddress(":lead-001")).toBeUndefined();
    expect(parseAddress("sub:")).toBeUndefined();
  });
});

describe("isValidAddress", () => {
  it("accepts canonical and namespaced forms", () => {
    expect(isValidAddress("chief-001")).toBe(true);
    expect(isValidAddress("lead-frontend-042")).toBe(true);
    expect(isValidAddress("kant:chief-001")).toBe(true);
  });
  it("rejects malformed strings", () => {
    expect(isValidAddress("Chief-001")).toBe(true); // case is tolerated for now
    expect(isValidAddress("chief-")).toBe(false);
    expect(isValidAddress("")).toBe(false);
  });
});

describe("buildCodenameIndex", () => {
  const personas = [
    { address: "chief-001", codename: "Atlas" },
    { address: "lead-frontend-001", codename: "Mira" },
    { address: "frontend-001" },
  ];

  it("resolves canonical addresses", () => {
    const idx = buildCodenameIndex(personas);
    expect(idx.resolve("frontend-001")).toBe("frontend-001");
  });
  it("resolves codenames case-insensitively", () => {
    const idx = buildCodenameIndex(personas);
    expect(idx.resolve("atlas")).toBe("chief-001");
    expect(idx.resolve("MIRA")).toBe("lead-frontend-001");
  });
  it("returns undefined for unknown tokens", () => {
    const idx = buildCodenameIndex(personas);
    expect(idx.resolve("nobody")).toBeUndefined();
    expect(idx.resolve("")).toBeUndefined();
  });
  it("throws on codename collisions", () => {
    expect(() =>
      buildCodenameIndex([
        { address: "a-001", codename: "Mira" },
        { address: "b-001", codename: "MIRA" },
      ]),
    ).toThrow();
  });
  it("throws on invalid persona addresses", () => {
    expect(() => buildCodenameIndex([{ address: "broken!", codename: "x" }])).toThrow();
  });
});
