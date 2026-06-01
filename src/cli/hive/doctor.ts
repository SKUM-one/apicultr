import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { execCapture, which, whichAll } from "../../core/exec.ts";
import { compareVersions, extractVersionToken } from "../../core/versions.ts";
import type { Command, CommandContext } from "../command-router.ts";

type Severity = "pass" | "warn" | "fail";

interface Check {
  id: string;
  title: string;
  severity: Severity;
  message: string;
  hint?: string;
}

const MIN_TMUX = "1.9";

async function checkTmux(): Promise<Check> {
  const path = await which("tmux");
  if (!path) {
    return {
      id: "tmux.present",
      title: "tmux installed",
      severity: "fail",
      message: "tmux not found on PATH",
      hint: "macOS: brew install tmux  •  Debian/Ubuntu: apt install tmux",
    };
  }
  try {
    const res = await execCapture("tmux", ["-V"], { timeoutMs: 5000 });
    const ver = extractVersionToken(res.stdout);
    if (!ver) {
      return {
        id: "tmux.version",
        title: "tmux version",
        severity: "fail",
        message: `could not parse tmux version from: ${res.stdout.trim()}`,
      };
    }
    if (compareVersions(ver, MIN_TMUX) < 0) {
      return {
        id: "tmux.version",
        title: "tmux version",
        severity: "fail",
        message: `tmux ${ver} is older than required ${MIN_TMUX}+`,
        hint: "Upgrade tmux: macOS `brew upgrade tmux`, Linux distro package or build from source",
      };
    }
    return {
      id: "tmux.version",
      title: "tmux version",
      severity: "pass",
      message: `tmux ${ver} at ${path}`,
    };
  } catch (err) {
    return {
      id: "tmux.version",
      title: "tmux version",
      severity: "fail",
      message: `tmux failed to run: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkClaude(): Promise<Check> {
  const path = await which("claude");
  if (!path) {
    return {
      id: "claude.present",
      title: "Claude Code installed",
      severity: "fail",
      message: "`claude` binary not found on PATH",
      hint: "Install Claude Code: https://docs.anthropic.com/claude-code",
    };
  }
  try {
    const res = await execCapture("claude", ["--version"], { timeoutMs: 10000 });
    if (res.exitCode !== 0) {
      return {
        id: "claude.runnable",
        title: "Claude Code runnable",
        severity: "warn",
        message: `claude exited ${res.exitCode}: ${res.stderr.trim() || res.stdout.trim()}`,
      };
    }
    const first = res.stdout.split("\n").find((l) => l.trim().length > 0) ?? "";
    return {
      id: "claude.runnable",
      title: "Claude Code runnable",
      severity: "pass",
      message: `${first.trim()} at ${path}`,
    };
  } catch (err) {
    return {
      id: "claude.runnable",
      title: "Claude Code runnable",
      severity: "fail",
      message: `claude failed to run: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkWritable(): Promise<Check> {
  try {
    const dir = await mkdtemp(join(tmpdir(), "apicultr-doctor-"));
    const probe = join(dir, "probe.txt");
    await writeFile(probe, "ok");
    await rm(dir, { recursive: true, force: true });
    return {
      id: "fs.tmp",
      title: "Temp directory writable",
      severity: "pass",
      message: `wrote + cleaned a probe under ${tmpdir()}`,
    };
  } catch (err) {
    return {
      id: "fs.tmp",
      title: "Temp directory writable",
      severity: "fail",
      message: `could not write to temp dir: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkCwdWritable(): Promise<Check> {
  try {
    const cwd = process.cwd();
    const probe = join(cwd, `.apicultr-doctor-probe-${process.pid}.tmp`);
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    return {
      id: "fs.cwd",
      title: "CWD writable",
      severity: "pass",
      message: `${cwd} is writable`,
    };
  } catch (err) {
    return {
      id: "fs.cwd",
      title: "CWD writable",
      severity: "warn",
      message: `current directory not writable: ${err instanceof Error ? err.message : String(err)}`,
      hint: "`hive init` writes to cwd by default; move to a writable dir first.",
    };
  }
}

async function checkTerminalApp(): Promise<Check> {
  if (process.platform !== "darwin") {
    return {
      id: "mac.terminal",
      title: "Terminal.app present",
      severity: "pass",
      message: "skipped (not macOS)",
    };
  }
  const candidates = [
    "/System/Applications/Utilities/Terminal.app",
    "/Applications/Utilities/Terminal.app",
  ];
  for (const c of candidates) {
    try {
      const res = await execCapture("/bin/test", ["-d", c]);
      if (res.exitCode === 0) {
        return { id: "mac.terminal", title: "Terminal.app present", severity: "pass", message: c };
      }
    } catch {
      // try next
    }
  }
  return {
    id: "mac.terminal",
    title: "Terminal.app present",
    severity: "fail",
    message: "Terminal.app not found in standard locations",
    hint: "Native backend requires Terminal.app. Tmux backend remains available.",
  };
}

async function checkOsascript(): Promise<Check> {
  if (process.platform !== "darwin") {
    return {
      id: "mac.osascript",
      title: "osascript runnable",
      severity: "pass",
      message: "skipped (not macOS)",
    };
  }
  const path = await which("osascript");
  if (!path) {
    return {
      id: "mac.osascript",
      title: "osascript runnable",
      severity: "fail",
      message: "osascript not found on PATH",
    };
  }
  try {
    const res = await execCapture("osascript", ["-e", "return 1+1"], { timeoutMs: 5000 });
    if (res.exitCode !== 0 || res.stdout.trim() !== "2") {
      return {
        id: "mac.osascript",
        title: "osascript runnable",
        severity: "fail",
        message: `osascript probe failed: stdout=${res.stdout.trim()} stderr=${res.stderr.trim()}`,
      };
    }
    return {
      id: "mac.osascript",
      title: "osascript runnable",
      severity: "pass",
      message: `osascript at ${path} executed probe`,
    };
  } catch (err) {
    return {
      id: "mac.osascript",
      title: "osascript runnable",
      severity: "fail",
      message: `osascript failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkPathConflicts(): Promise<Check> {
  const conflicts: string[] = [];
  for (const name of ["hive", "apicultr"]) {
    const all = await whichAll(name);
    if (all.length > 1) {
      conflicts.push(`multiple \`${name}\` binaries on PATH: ${all.join(", ")}`);
    }
  }
  const swarmDispatch = await which("swarm-dispatch");
  const launchSwarm = await which("launch-swarm");
  const swarmArrange = await which("swarm-arrange");
  const legacy: string[] = [];
  if (swarmDispatch) legacy.push(`swarm-dispatch -> ${swarmDispatch}`);
  if (launchSwarm) legacy.push(`launch-swarm -> ${launchSwarm}`);
  if (swarmArrange) legacy.push(`swarm-arrange -> ${swarmArrange}`);

  if (conflicts.length === 0 && legacy.length === 0) {
    return {
      id: "path.conflicts",
      title: "PATH free of conflicts",
      severity: "pass",
      message: "no duplicate hive/apicultr binaries; legacy swarm-shell.zsh not on PATH",
    };
  }
  const parts: string[] = [];
  if (conflicts.length > 0) parts.push(...conflicts);
  if (legacy.length > 0) {
    parts.push(
      `legacy swarm-shell.zsh symbols on PATH (informational, apicultr does not conflict): ${legacy.join("; ")}`,
    );
  }
  const check: Check = {
    id: "path.conflicts",
    title: "PATH check",
    severity: conflicts.length > 0 ? "warn" : "pass",
    message: parts.join(" | "),
  };
  if (conflicts.length > 0) {
    check.hint = "Remove duplicates from PATH or `brew unlink` competing installs.";
  }
  return check;
}

interface DoctorOptions {
  json: boolean;
}

function parseDoctorArgs(argv: string[]): DoctorOptions {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  });
  return { json: values.json === true };
}

function severitySymbol(s: Severity): string {
  switch (s) {
    case "pass":
      return "OK";
    case "warn":
      return "WARN";
    case "fail":
      return "FAIL";
  }
}

async function handle(ctx: CommandContext): Promise<number> {
  const opts = parseDoctorArgs(ctx.commandArgv);
  const checks = await Promise.all([
    checkTmux(),
    checkClaude(),
    checkWritable(),
    checkCwdWritable(),
    checkTerminalApp(),
    checkOsascript(),
    checkPathConflicts(),
  ]);

  const failed = checks.filter((c) => c.severity === "fail");
  const warned = checks.filter((c) => c.severity === "warn");
  const exitCode = failed.length > 0 ? 1 : 0;

  if (opts.json) {
    ctx.logger.json({
      exitCode,
      platform: process.platform,
      arch: process.arch,
      summary: {
        passed: checks.length - failed.length - warned.length,
        warned: warned.length,
        failed: failed.length,
      },
      checks,
    });
    return exitCode;
  }

  const pad = Math.max(...checks.map((c) => c.title.length));
  for (const c of checks) {
    ctx.logger.print(
      `[${severitySymbol(c.severity).padEnd(4)}] ${c.title.padEnd(pad)}  ${c.message}`,
    );
    if (c.hint && c.severity !== "pass") {
      ctx.logger.print(`         hint: ${c.hint}`);
    }
  }
  ctx.logger.print("");
  ctx.logger.print(
    `summary: ${checks.length - failed.length - warned.length} pass, ${warned.length} warn, ${failed.length} fail`,
  );
  if (exitCode === 0) {
    ctx.logger.print("doctor: OK");
  } else {
    ctx.logger.print("doctor: FAIL — fix the items marked FAIL and re-run `hive doctor`.");
  }
  return exitCode;
}

export const doctorCommand: Command = {
  name: "doctor",
  summary: "Pre-flight check: tmux, claude, filesystem, Mac backend prerequisites, PATH",
  usage: "hive doctor [--json]",
  description:
    "Verifies the host can run apicultr. Exits non-zero if any required check fails. `--json` emits a machine-readable report.",
  handler: handle,
};
