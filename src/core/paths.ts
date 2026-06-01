import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, normalize, resolve } from "node:path";

/**
 * apicultr is POSIX-internal: hive.toml paths, brief paths, lock paths are all stored and
 * compared as POSIX strings. WSL conversion happens at the user-input boundary
 * (CLI argv, env vars) and only on Windows hosts.
 */

/** Detect WSL by sniffing /proc/sys/kernel/osrelease for "microsoft" or "WSL". */
export function isWSL(): boolean {
  if (process.platform !== "linux") return false;
  try {
    if (!existsSync("/proc/sys/kernel/osrelease")) return false;
    const txt = require("node:fs").readFileSync("/proc/sys/kernel/osrelease", "utf8") as string;
    return /microsoft|wsl/i.test(txt);
  } catch {
    return false;
  }
}

/**
 * Convert a Windows-style absolute path to a WSL POSIX path:
 *   C:\Users\mick -> /mnt/c/Users/mick
 *   D:/projects/foo -> /mnt/d/projects/foo
 * Returns the input unchanged if it doesn't look like a Windows path.
 */
export function windowsToWslPath(p: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!match) return p;
  const drive = match[1]?.toLowerCase();
  const rest = (match[2] ?? "").replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

/**
 * Normalise a user-supplied path: expand ~, convert Windows paths under WSL, resolve to
 * absolute against cwd. Always returns a POSIX-style absolute path.
 */
export function normaliseUserPath(input: string, cwd: string = process.cwd()): string {
  let p = input;
  if (p.startsWith("~/") || p === "~") {
    p = p === "~" ? homedir() : `${homedir()}/${p.slice(2)}`;
  }
  if (isWSL()) {
    p = windowsToWslPath(p);
  }
  if (!isAbsolute(p)) {
    p = resolve(cwd, p);
  }
  return normalize(p);
}

/** Standard subdirectories inside a hive root. */
export interface HivePaths {
  root: string;
  hiveToml: string;
  personasDir: string;
  hiveDir: string;
  briefsDir: string;
  reportsDir: string;
  dispatchLock: string;
}

export function hivePaths(root: string): HivePaths {
  const r = normalize(root);
  return {
    root: r,
    hiveToml: `${r}/hive.toml`,
    personasDir: `${r}/personas`,
    hiveDir: `${r}/.hive`,
    briefsDir: `${r}/.hive/briefs`,
    reportsDir: `${r}/.hive/reports`,
    dispatchLock: `${r}/.hive/dispatch.lock`,
  };
}

/**
 * Slugify a free-form string for use as a filename component. Lower-case, ASCII only,
 * non-alphanumeric collapsed to single hyphens, length-capped.
 */
export function slugify(input: string, maxLen = 60): string {
  const lower = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "");
  const ascii = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const truncated = ascii.length > maxLen ? ascii.slice(0, maxLen).replace(/-+$/, "") : ascii;
  return truncated || "untitled";
}

/** ISO date in YYYY-MM-DD form, in UTC, for predictable filenames across time zones. */
export function isoDate(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
