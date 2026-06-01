/**
 * Persona addresses. Canonical format: `<role>-NNN`, where role is itself hyphen-allowed
 * (e.g. `lead-frontend`). The parser MUST split on the LAST hyphen so
 * `lead-frontend-001` -> {role: "lead-frontend", index: 1}.
 *
 * Sub-hive composition: addresses may be prefixed with a sub-hive name and a colon, e.g.
 * `kant-codes:lead-frontend-001`. The colon is the namespace separator.
 */

export interface ParsedAddress {
  /** Sub-hive name if the address was namespaced, else undefined. */
  subHive: string | undefined;
  /** The role token: `chief`, `lead-frontend`, `frontend`, etc. */
  role: string;
  /** Zero-or-positive integer index. */
  index: number;
  /** The unqualified `<role>-NNN` form. */
  local: string;
  /** The original input (trimmed). */
  raw: string;
}

const PADDING = 3;

/** Format an index with the canonical 3-digit zero-padding, growing past 999 as needed. */
export function formatIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`invalid persona index: ${index}`);
  }
  const s = String(index);
  return s.length < PADDING ? s.padStart(PADDING, "0") : s;
}

export function formatAddress(role: string, index: number, subHive?: string): string {
  const local = `${role}-${formatIndex(index)}`;
  return subHive ? `${subHive}:${local}` : local;
}

/**
 * Parse an address into its parts. Returns undefined for malformed input. Accepts the
 * sub-hive namespace prefix, the role-NNN body, and tolerates surrounding whitespace.
 *
 * Splits on the LAST hyphen to find the index, so role tokens may themselves contain
 * hyphens (`lead-frontend-001`).
 */
export function parseAddress(input: string): ParsedAddress | undefined {
  const raw = input.trim();
  if (!raw) return undefined;

  let subHive: string | undefined;
  let body = raw;
  const colon = raw.indexOf(":");
  if (colon >= 0) {
    subHive = raw.slice(0, colon).trim();
    body = raw.slice(colon + 1).trim();
    if (!subHive || !body) return undefined;
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(subHive)) return undefined;
  }

  const lastHyphen = body.lastIndexOf("-");
  if (lastHyphen <= 0 || lastHyphen === body.length - 1) return undefined;
  const role = body.slice(0, lastHyphen);
  const indexStr = body.slice(lastHyphen + 1);
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/i.test(role)) return undefined;
  if (!/^\d+$/.test(indexStr)) return undefined;
  const index = Number.parseInt(indexStr, 10);
  if (!Number.isFinite(index) || index < 0) return undefined;

  return {
    subHive,
    role,
    index,
    local: `${role}-${indexStr}`,
    raw,
  };
}

export function isValidAddress(input: string): boolean {
  return parseAddress(input) !== undefined;
}

export interface CodenameIndex {
  /** Resolve a token (address OR codename) to a canonical address. Undefined if no match. */
  resolve(input: string): string | undefined;
  /** All known canonical addresses. */
  addresses(): string[];
  /** All known codenames (lowercased). */
  codenames(): string[];
}

export interface PersonaForIndex {
  address: string;
  codename?: string | undefined;
}

/**
 * Build an index that resolves both canonical addresses and (case-insensitive) codenames
 * to the canonical address. Codenames must be unique within a hive; duplicates throw at
 * build time.
 */
export function buildCodenameIndex(personas: ReadonlyArray<PersonaForIndex>): CodenameIndex {
  const addressSet = new Set<string>();
  const codenameMap = new Map<string, string>();

  for (const p of personas) {
    if (!isValidAddress(p.address)) {
      throw new Error(`invalid persona address: ${p.address}`);
    }
    addressSet.add(p.address);
    if (p.codename) {
      const key = p.codename.trim().toLowerCase();
      if (!key) continue;
      const existing = codenameMap.get(key);
      if (existing && existing !== p.address) {
        throw new Error(`codename collision: "${p.codename}" already used by ${existing}`);
      }
      codenameMap.set(key, p.address);
    }
  }

  return {
    resolve(input: string): string | undefined {
      const trimmed = input.trim();
      if (!trimmed) return undefined;
      if (addressSet.has(trimmed)) return trimmed;
      const parsed = parseAddress(trimmed);
      if (parsed && addressSet.has(parsed.raw)) return parsed.raw;
      const codenameHit = codenameMap.get(trimmed.toLowerCase());
      if (codenameHit) return codenameHit;
      return undefined;
    },
    addresses(): string[] {
      return Array.from(addressSet).sort();
    },
    codenames(): string[] {
      return Array.from(codenameMap.keys()).sort();
    },
  };
}
