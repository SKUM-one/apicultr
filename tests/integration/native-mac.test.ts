import { afterEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { type IntegrationFixture, makeFixtureHive, runHive } from "./_helpers.ts";

/**
 * Native-Mac integration tests. These actually spawn visible Terminal.app windows,
 * which is disruptive on a developer's main screen and unreliable on CI. Skipped by
 * default; opt in by exporting `APICULTR_TEST_NATIVE=1`.
 */
const RUN_NATIVE = process.env["APICULTR_TEST_NATIVE"] === "1";
const isMac = process.platform === "darwin";

const cleanups: IntegrationFixture[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const f = cleanups.pop();
    if (f) await f.cleanup();
  }
});

async function closeRogueTerminals(titles: string[]): Promise<void> {
  // Belt-and-braces cleanup in case the test crashed mid-way and left windows open.
  for (const title of titles) {
    await new Promise<void>((resolve) => {
      const child = spawn("osascript", [
        "-e",
        `tell application "Terminal" to try
  close (every window whose custom title is "${title}") saving no
end try`,
      ]);
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  }
}

if (!isMac || !RUN_NATIVE) {
  describe.skip("native-mac backend (skipped: not macOS or APICULTR_TEST_NATIVE!=1)", () => {
    it("placeholder", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("native-mac backend lifecycle", () => {
    it("up + dispatch + down opens, paste-targets, and closes Terminal windows", async () => {
      const fixture = await makeFixtureHive({
        name: "native-int",
        backend: "native",
        personas: [
          { address: "chief-001", role: "chief", manages: ["worker-001"] },
          { address: "worker-001", role: "worker", reportsTo: "chief-001" },
        ],
      });
      cleanups.push(fixture);
      cleanups.push({
        hiveDir: "",
        hiveName: "",
        binDir: "",
        cleanup: () => closeRogueTerminals(["chief-001", "worker-001"]),
      });

      const up = await runHive(fixture, ["up"]);
      expect(up.exitCode).toBe(0);

      await new Promise((r) => setTimeout(r, 1500));

      const dispatch = await runHive(fixture, ["dispatch", "worker-001"], {
        stdin: "native dispatch test payload\n",
      });
      expect(dispatch.exitCode).toBe(0);

      const down = await runHive(fixture, ["down"]);
      expect(down.exitCode).toBe(0);
    }, 30_000);

    it("backend reports native available on darwin", async () => {
      const fixture = await makeFixtureHive();
      cleanups.push(fixture);
      const out = await runHive(fixture, ["backend", "--json"]);
      const parsed = JSON.parse(out.stdout) as {
        backends: Array<{ name: string; available: boolean }>;
      };
      const native = parsed.backends.find((b) => b.name === "native-mac");
      expect(native?.available).toBe(true);
    });
  });
}
