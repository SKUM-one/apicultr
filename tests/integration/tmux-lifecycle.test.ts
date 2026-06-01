import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import {
  type IntegrationFixture,
  makeFixtureHive,
  runHive,
  tmuxCapturePane,
  tmuxHasSession,
  waitFor,
} from "./_helpers.ts";

const cleanups: IntegrationFixture[] = [];

beforeAll(async () => {
  // Ensure the binary is built before running. The CI matrix builds first; locally we
  // do a one-shot build at module load to keep iteration cycles tight.
  await new Promise<void>((resolve, reject) => {
    const child = spawn("bun", ["run", "build"], {
      cwd: new URL("../..", import.meta.url).pathname,
      stdio: "ignore",
    });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`build failed: ${code}`)),
    );
    child.on("error", reject);
  });
});

afterEach(async () => {
  while (cleanups.length > 0) {
    const f = cleanups.pop();
    if (f) await f.cleanup();
  }
});

describe("tmux backend lifecycle", () => {
  it("up + status + dispatch + down on a hub-spoke hive", async () => {
    const fixture = await makeFixtureHive({
      name: "hubspoke",
      backend: "tmux",
      personas: [
        { address: "chief-001", role: "chief", manages: ["worker-001", "worker-002"] },
        { address: "worker-001", role: "worker", reportsTo: "chief-001" },
        { address: "worker-002", role: "worker", reportsTo: "chief-001" },
      ],
    });
    cleanups.push(fixture);

    const up = await runHive(fixture, ["up"]);
    expect(up.exitCode).toBe(0);
    expect(up.stdout).toContain("3 persona windows spawned");
    expect(await tmuxHasSession("apicultr-hubspoke")).toBe(true);

    // Each persona's mock-claude should print its ready marker once the window's shell
    // runs the command.
    expect(
      await waitFor(async () => {
        const pane = await tmuxCapturePane("apicultr-hubspoke:chief-001");
        return pane.includes("mock-claude: ready");
      }),
    ).toBe(true);

    const status = await runHive(fixture, ["status", "--json"]);
    expect(status.exitCode).toBe(0);
    const parsed = JSON.parse(status.stdout) as {
      personas: Array<{ address: string; health: { state: string } }>;
    };
    expect(parsed.personas).toHaveLength(3);
    expect(
      parsed.personas.every((p) => ["running", "ready", "busy"].includes(p.health.state)),
    ).toBe(true);

    const dispatch = await runHive(fixture, ["dispatch", "worker-001"], {
      stdin: "Hello, worker-001! Please build the form.",
    });
    expect(dispatch.exitCode).toBe(0);
    expect(dispatch.stdout).toContain("dispatched to worker-001");

    expect(
      await waitFor(async () => {
        const pane = await tmuxCapturePane("apicultr-hubspoke:worker-001");
        return pane.includes("pasted: Hello, worker-001");
      }),
    ).toBe(true);

    const down = await runHive(fixture, ["down"]);
    expect(down.exitCode).toBe(0);
    expect(await tmuxHasSession("apicultr-hubspoke")).toBe(false);
  });

  it("hierarchical hive: dispatch by codename and via persona-to-persona PATH guarantee", async () => {
    const fixture = await makeFixtureHive({
      name: "hier",
      backend: "tmux",
      personas: [
        { address: "chief-001", role: "chief", manages: ["lead-frontend-001"] },
        {
          address: "lead-frontend-001",
          role: "lead-frontend",
          codename: "Mira",
          manages: ["frontend-001"],
          reportsTo: "chief-001",
        },
        { address: "frontend-001", role: "frontend", reportsTo: "lead-frontend-001" },
      ],
    });
    cleanups.push(fixture);

    await runHive(fixture, ["up"]);
    expect(await tmuxHasSession("apicultr-hier")).toBe(true);

    // Dispatch by codename should reach lead-frontend-001.
    const byCodename = await runHive(fixture, ["dispatch", "mira"], {
      stdin: "lead, kick off the form\n",
    });
    expect(byCodename.exitCode).toBe(0);
    expect(byCodename.stdout).toContain("dispatched to lead-frontend-001");

    // Dispatch by address should reach frontend-001.
    const byAddress = await runHive(fixture, ["dispatch", "frontend-001"], {
      stdin: "worker, do the thing\n",
    });
    expect(byAddress.exitCode).toBe(0);
  });

  it("route prints ancestors, descendants, and dispatch set", async () => {
    const fixture = await makeFixtureHive({
      name: "route",
      backend: "tmux",
      personas: [
        { address: "chief-001", role: "chief", manages: ["lead-frontend-001"] },
        {
          address: "lead-frontend-001",
          role: "lead-frontend",
          manages: ["frontend-001"],
          reportsTo: "chief-001",
        },
        { address: "frontend-001", role: "frontend", reportsTo: "lead-frontend-001" },
      ],
    });
    cleanups.push(fixture);
    const out = await runHive(fixture, ["route", "lead-frontend-001"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("chief-001");
    expect(out.stdout).toContain("frontend-001");
  });

  it("status --tree renders the hierarchy", async () => {
    const fixture = await makeFixtureHive({
      name: "tree",
      backend: "tmux",
      personas: [
        { address: "chief-001", role: "chief", manages: ["worker-001", "worker-002"] },
        { address: "worker-001", role: "worker", reportsTo: "chief-001" },
        { address: "worker-002", role: "worker", reportsTo: "chief-001" },
      ],
    });
    cleanups.push(fixture);
    await runHive(fixture, ["up"]);
    const tree = await runHive(fixture, ["status", "--tree"]);
    expect(tree.exitCode).toBe(0);
    expect(tree.stdout).toContain("chief-001");
    expect(tree.stdout).toContain("worker-001");
    expect(tree.stdout).toContain("worker-002");
    expect(tree.stdout).toMatch(/├──|└──/);
  });

  it("persona list and persona restart", async () => {
    const fixture = await makeFixtureHive({
      name: "restart",
      backend: "tmux",
      personas: [
        { address: "chief-001", role: "chief", manages: ["worker-001"] },
        { address: "worker-001", role: "worker", reportsTo: "chief-001" },
      ],
    });
    cleanups.push(fixture);
    await runHive(fixture, ["up"]);

    const list = await runHive(fixture, ["persona", "list", "--json"]);
    expect(list.exitCode).toBe(0);
    const parsed = JSON.parse(list.stdout) as { personas: Array<{ address: string }> };
    expect(parsed.personas.map((p) => p.address).sort()).toEqual(["chief-001", "worker-001"]);

    const restart = await runHive(fixture, ["persona", "restart", "worker-001"]);
    expect(restart.exitCode).toBe(0);
    expect(restart.stdout).toContain("restarted worker-001");

    expect(
      await waitFor(async () => {
        const pane = await tmuxCapturePane("apicultr-restart:worker-001");
        return pane.includes("mock-claude: ready");
      }),
    ).toBe(true);
  });

  it("dispatch sequencing: 5 parallel dispatches all arrive intact", async () => {
    const fixture = await makeFixtureHive({
      name: "seq",
      backend: "tmux",
      personas: [
        { address: "chief-001", role: "chief", manages: ["worker-001"] },
        { address: "worker-001", role: "worker", reportsTo: "chief-001" },
      ],
    });
    cleanups.push(fixture);
    await runHive(fixture, ["up"]);

    const briefs = ["brief-a", "brief-b", "brief-c", "brief-d", "brief-e"];
    await Promise.all(
      briefs.map((b) => runHive(fixture, ["dispatch", "worker-001"], { stdin: `${b}-line\n` })),
    );

    expect(
      await waitFor(async () => {
        const pane = await tmuxCapturePane("apicultr-seq:worker-001");
        return briefs.every((b) => pane.includes(`pasted: ${b}-line`));
      }),
    ).toBe(true);
  });

  it("backend command reports tmux available", async () => {
    const fixture = await makeFixtureHive();
    cleanups.push(fixture);
    const out = await runHive(fixture, ["backend", "--json"]);
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout) as {
      backends: Array<{ name: string; available: boolean }>;
    };
    const tmuxCap = parsed.backends.find((b) => b.name === "tmux");
    expect(tmuxCap?.available).toBe(true);
  });
});
