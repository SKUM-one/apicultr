import { describe, expect, it } from "bun:test";
import type { PersonaConfig } from "../../src/core/config.ts";
import { HierarchyError, buildHierarchy } from "../../src/core/hierarchy.ts";

function persona(address: string, manages: string[] = [], reports_to?: string): PersonaConfig {
  const out: PersonaConfig = {
    address,
    role: address.split("-")[0] ?? "x",
    identity_doc: "x.md",
    manages,
    tools_needed: [],
  };
  if (reports_to !== undefined) out.reports_to = reports_to;
  return out;
}

describe("buildHierarchy", () => {
  it("builds a hub-spoke hierarchy", () => {
    const h = buildHierarchy([
      persona("chief-001", ["worker-001", "worker-002"]),
      persona("worker-001"),
      persona("worker-002"),
    ]);
    expect(h.roots).toEqual(["chief-001"]);
    expect(h.leaves.sort()).toEqual(["worker-001", "worker-002"]);
    expect(h.children("chief-001").sort()).toEqual(["worker-001", "worker-002"]);
    expect(h.parent("worker-001")).toBe("chief-001");
    expect(h.descendants("chief-001").sort()).toEqual(["worker-001", "worker-002"]);
    expect(h.ancestors("worker-001")).toEqual(["chief-001"]);
  });

  it("builds a 3-tier hierarchical structure", () => {
    const h = buildHierarchy([
      persona("chief-001", ["lead-frontend-001"]),
      persona("lead-frontend-001", ["frontend-001", "frontend-002"]),
      persona("frontend-001"),
      persona("frontend-002"),
    ]);
    expect(h.descendants("chief-001").sort()).toEqual([
      "frontend-001",
      "frontend-002",
      "lead-frontend-001",
    ]);
    expect(h.ancestors("frontend-001")).toEqual(["lead-frontend-001", "chief-001"]);
    expect(h.dispatchAllowed("lead-frontend-001").sort()).toEqual(["frontend-001", "frontend-002"]);
  });

  it("renders as ASCII tree", () => {
    const h = buildHierarchy([
      persona("chief-001", ["lead-frontend-001"]),
      persona("lead-frontend-001", ["frontend-001"]),
      persona("frontend-001"),
    ]);
    const tree = h.renderTree();
    expect(tree).toContain("chief-001");
    expect(tree).toContain("lead-frontend-001");
    expect(tree).toContain("frontend-001");
    expect(tree).toContain("└──");
  });

  it("detects cycles", () => {
    expect(() =>
      buildHierarchy([persona("a-001", ["b-001"]), persona("b-001", ["a-001"])]),
    ).toThrow(HierarchyError);
  });

  it("rejects manages-of-unknown-address", () => {
    expect(() => buildHierarchy([persona("chief-001", ["ghost-001"])])).toThrow(HierarchyError);
  });

  it("rejects conflicting reports_to and manages", () => {
    expect(() =>
      buildHierarchy([
        persona("a-001", ["c-001"]),
        persona("b-001"),
        persona("c-001", [], "b-001"),
      ]),
    ).toThrow(HierarchyError);
  });

  it("rejects duplicate addresses", () => {
    expect(() => buildHierarchy([persona("a-001"), persona("a-001")])).toThrow(HierarchyError);
  });
});
