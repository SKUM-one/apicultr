import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompositeHive } from "../../src/core/sub-hive.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    if (c) await c();
  }
});

async function scaffoldParent(dir: string): Promise<void> {
  await mkdir(join(dir, "personas"), { recursive: true });
  await mkdir(join(dir, "kant-codes"), { recursive: true });
  await mkdir(join(dir, "kant-codes/personas"), { recursive: true });
  await writeFile(join(dir, "personas/chief.md"), "# chief");
  await writeFile(join(dir, "kant-codes/personas/chief.md"), "# kant chief");
  await writeFile(
    join(dir, "hive.toml"),
    `
[hive]
name = "parent"
[runtime]
acknowledged_dangerous = true
[[personas]]
address = "chief-001"
role = "chief"
identity_doc = "personas/chief.md"
[[sub_hives]]
name = "kant-codes"
path = "./kant-codes"
attach_under = "chief-001"
`,
  );
  await writeFile(
    join(dir, "kant-codes/hive.toml"),
    `
[hive]
name = "kant-codes"
[runtime]
acknowledged_dangerous = true
[[personas]]
address = "chief-001"
role = "chief"
identity_doc = "personas/chief.md"
manages = ["worker-001"]
[[personas]]
address = "worker-001"
role = "worker"
identity_doc = "personas/chief.md"
reports_to = "chief-001"
`,
  );
}

describe("sub-hive composition", () => {
  it("loads a parent + sub-hive with namespaced addresses + composed edges", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apicultr-subhive-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await scaffoldParent(dir);

    const composite = await loadCompositeHive(join(dir, "hive.toml"));
    expect(composite.subHives.has("kant-codes")).toBe(true);

    const addresses = composite.personas.map((p) => p.canonicalAddress).sort();
    expect(addresses).toEqual(["chief-001", "kant-codes:chief-001", "kant-codes:worker-001"]);

    // The parent chief should have an auto-composed edge to the sub-hive's chief.
    expect(composite.composedEdges).toEqual([
      { parent: "chief-001", child: "kant-codes:chief-001" },
    ]);
  });

  it("detects cycles in sub-hive composition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apicultr-cycle-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await mkdir(join(dir, "personas"), { recursive: true });
    await mkdir(join(dir, "child"), { recursive: true });
    await mkdir(join(dir, "child/personas"), { recursive: true });
    await writeFile(join(dir, "personas/c.md"), "x");
    await writeFile(join(dir, "child/personas/c.md"), "x");
    await writeFile(
      join(dir, "hive.toml"),
      `[hive]\nname="parent"\n[[personas]]\naddress="chief-001"\nrole="chief"\nidentity_doc="personas/c.md"\n[[sub_hives]]\nname="child"\npath="./child"\n`,
    );
    // The child references the parent — direct cycle.
    await writeFile(
      join(dir, "child/hive.toml"),
      `[hive]\nname="child"\n[[personas]]\naddress="chief-001"\nrole="chief"\nidentity_doc="personas/c.md"\n[[sub_hives]]\nname="parent"\npath=".."\n`,
    );
    await expect(loadCompositeHive(join(dir, "hive.toml"))).rejects.toThrow(/cycle/i);
  });
});
