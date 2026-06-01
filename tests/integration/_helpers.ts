import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const MOCK_CLAUDE = join(REPO_ROOT, "tests/integration/fixtures/mock-claude.sh");

export interface IntegrationFixture {
  hiveDir: string;
  hiveName: string;
  binDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Build a temporary hive on disk + a tiny PATH shim where `claude` is the mock script.
 * Returns the hive root, the PATH-prepend dir, and a cleanup hook.
 *
 * The generated hive uses tmux backend by default and acknowledged_dangerous = true so
 * tests can just call `hive up` without extra ceremony.
 */
export async function makeFixtureHive(
  spec: { name: string; personas: PersonaSpec[]; backend?: "tmux" | "native" | "auto" } = {
    name: "test",
    personas: [
      { address: "chief-001", role: "chief", manages: ["worker-001"] },
      { address: "worker-001", role: "worker", reportsTo: "chief-001" },
    ],
  },
): Promise<IntegrationFixture> {
  const tmpRoot = await mkdtemp(join(tmpdir(), "apicultr-int-"));
  const hiveDir = join(tmpRoot, spec.name);
  const binDir = join(tmpRoot, "bin");
  await mkdir(hiveDir, { recursive: true });
  await mkdir(join(hiveDir, "personas"), { recursive: true });
  await mkdir(join(hiveDir, ".hive/briefs"), { recursive: true });
  await mkdir(join(hiveDir, ".hive/reports"), { recursive: true });
  await mkdir(binDir, { recursive: true });

  // Install the mock claude under our PATH shim dir.
  const mockTarget = join(binDir, "claude");
  const mockSrc = await Bun.file(MOCK_CLAUDE).text();
  await writeFile(mockTarget, mockSrc);
  await chmod(mockTarget, 0o755);

  for (const p of spec.personas) {
    await mkdir(join(hiveDir, p.address), { recursive: true });
  }

  const personasToml = spec.personas
    .map((p) => {
      const lines = [
        "[[personas]]",
        `address = "${p.address}"`,
        `role = "${p.role}"`,
        `identity_doc = "personas/${p.role}.md"`,
        `workspace = "./${p.address}"`,
      ];
      if (p.codename) lines.push(`codename = "${p.codename}"`);
      if (p.manages && p.manages.length > 0) {
        lines.push(`manages = [${p.manages.map((m) => `"${m}"`).join(", ")}]`);
      }
      if (p.reportsTo) lines.push(`reports_to = "${p.reportsTo}"`);
      return lines.join("\n");
    })
    .join("\n\n");

  const toml = `
[hive]
name = "${spec.name}"
description = "integration test hive"
workspace_root = "."

[topology]
shape = "hierarchical"
human_dispatch = "any"

[runtime]
backend = "${spec.backend ?? "tmux"}"
default_model = "mock-model"
acknowledged_dangerous = true

[runtime.native]
target_window_size_px = [400, 300]
overlay_opacity = 0.5
overlay_focus_opacity = 0.95
use_blur = true

${personasToml}
`;

  await writeFile(join(hiveDir, "hive.toml"), toml);
  for (const p of spec.personas) {
    await writeFile(
      join(hiveDir, "personas", `${p.role}.md`),
      `---\nrole: ${p.role}\n---\n\n# ${p.role}\n\nIntegration test persona.\n`,
    );
  }

  return {
    hiveDir,
    hiveName: spec.name,
    binDir,
    async cleanup() {
      // Best-effort: kill the tmux session if it exists, then wipe the dir.
      const sess = `apicultr-${spec.name}`;
      await new Promise<void>((r) => {
        const child = spawn("tmux", ["kill-session", "-t", sess], { stdio: "ignore" });
        child.on("close", () => r());
        child.on("error", () => r());
      });
      await rm(tmpRoot, { recursive: true, force: true });
    },
  };
}

export interface PersonaSpec {
  address: string;
  role: string;
  codename?: string;
  manages?: string[];
  reportsTo?: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the compiled hive binary against the fixture, with the fixture's bin shim prepended
 * to PATH so spawned shells find mock-claude as `claude`.
 */
export async function runHive(
  fixture: IntegrationFixture,
  args: string[],
  opts: { stdin?: string; cwd?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
  const binPath = join(REPO_ROOT, "bin/hive");
  const env: Record<string, string> = {
    ...process.env,
    ...opts.env,
    PATH: `${fixture.binDir}:${process.env["PATH"] ?? ""}`,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, {
      cwd: opts.cwd ?? fixture.hiveDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}

export async function tmuxHasSession(session: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("tmux", ["has-session", "-t", session]);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

export async function tmuxCapturePane(target: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("tmux", ["capture-pane", "-p", "-t", target, "-S", "-200"]);
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", () => resolve(out));
    child.on("error", () => resolve(""));
  });
}

export async function waitFor(
  cond: () => Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeout = opts.timeoutMs ?? 5_000;
  const interval = opts.intervalMs ?? 100;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}
