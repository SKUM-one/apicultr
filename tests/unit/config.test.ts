import { describe, expect, it } from "bun:test";
import { ConfigError, parseHiveConfig } from "../../src/core/config.ts";

const validConfig = `
[hive]
name = "test-hive"
description = "for tests"
workspace_root = "."

[topology]
shape = "hierarchical"
human_dispatch = "any"

[runtime]
backend = "tmux"
default_model = "claude-opus-4-7"
acknowledged_dangerous = true

[runtime.native]
target_window_size_px = [480, 320]
overlay_opacity = 0.5
overlay_focus_opacity = 0.95
use_blur = true

[[personas]]
address = "chief-001"
role = "chief"
identity_doc = "personas/chief.md"
workspace = "./chief-001"
model = "claude-opus-4-7"
manages = ["lead-frontend-001", "frontend-001"]

[[personas]]
address = "lead-frontend-001"
role = "lead-frontend"
identity_doc = "personas/lead.md"
manages = ["frontend-001"]
reports_to = "chief-001"

[[personas]]
address = "frontend-001"
role = "frontend"
identity_doc = "personas/worker.md"
reports_to = "lead-frontend-001"
codename = "Mira"
`;

describe("parseHiveConfig (valid)", () => {
  it("parses a complete hive.toml", () => {
    const out = parseHiveConfig(validConfig, "/tmp/hive.toml");
    expect(out.config.hive.name).toBe("test-hive");
    expect(out.config.personas).toHaveLength(3);
    expect(out.config.runtime.acknowledged_dangerous).toBe(true);
    expect(out.config.runtime.native.target_window_size_px).toEqual([480, 320]);
  });
  it("applies defaults for omitted sections", () => {
    const minimal = `
[hive]
name = "min"

[[personas]]
address = "chief-001"
role = "chief"
identity_doc = "personas/c.md"
`;
    const out = parseHiveConfig(minimal, "/tmp/x.toml");
    expect(out.config.topology.shape).toBe("hierarchical");
    expect(out.config.runtime.backend).toBe("auto");
    expect(out.config.runtime.acknowledged_dangerous).toBe(false);
  });
});

describe("parseHiveConfig (invalid)", () => {
  it("rejects when hive.name is missing", () => {
    let caught: ConfigError | undefined;
    try {
      parseHiveConfig(
        `[hive]\nname = ""\n[[personas]]\naddress="chief-001"\nrole="c"\nidentity_doc="x"\n`,
        "/tmp/x",
      );
    } catch (err) {
      caught = err as ConfigError;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught?.issues.some((i) => i.path.startsWith("hive.name"))).toBe(true);
  });
  it("rejects invalid backend", () => {
    let caught: ConfigError | undefined;
    try {
      parseHiveConfig(
        `
[hive]
name = "x"
[runtime]
backend = "ghostty"
[[personas]]
address = "chief-001"
role = "chief"
identity_doc = "x"
`,
        "/tmp/x",
      );
    } catch (err) {
      caught = err as ConfigError;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught?.issues.some((i) => i.path.includes("backend"))).toBe(true);
  });
  it("includes line numbers for field-level errors", () => {
    let caught: ConfigError | undefined;
    try {
      parseHiveConfig(
        `[hive]
name = "x"
[runtime]
backend = "ghostty"
[[personas]]
address = "chief-001"
role = "chief"
identity_doc = "x"
`,
        "/tmp/x",
      );
    } catch (err) {
      caught = err as ConfigError;
    }
    const issue = caught?.issues.find((i) => i.path.includes("backend"));
    expect(issue?.line).toBe(4);
  });
  it("rejects unknown manages target", () => {
    let caught: ConfigError | undefined;
    try {
      parseHiveConfig(
        `
[hive]
name = "x"
[[personas]]
address = "chief-001"
role = "chief"
identity_doc = "x"
manages = ["does-not-001"]
`,
        "/tmp/x",
      );
    } catch (err) {
      caught = err as ConfigError;
    }
    expect(caught?.issues.some((i) => i.message.includes("references unknown address"))).toBe(true);
  });
  it("rejects self-management", () => {
    let caught: ConfigError | undefined;
    try {
      parseHiveConfig(
        `
[hive]
name = "x"
[[personas]]
address = "chief-001"
role = "chief"
identity_doc = "x"
manages = ["chief-001"]
`,
        "/tmp/x",
      );
    } catch (err) {
      caught = err as ConfigError;
    }
    expect(caught?.issues.some((i) => i.message.includes("cannot manage itself"))).toBe(true);
  });
  it("rejects duplicate codenames", () => {
    let caught: ConfigError | undefined;
    try {
      parseHiveConfig(
        `
[hive]
name = "x"
[[personas]]
address = "chief-001"
role = "chief"
identity_doc = "x"
codename = "Mira"
[[personas]]
address = "worker-001"
role = "worker"
identity_doc = "x"
codename = "MIRA"
`,
        "/tmp/x",
      );
    } catch (err) {
      caught = err as ConfigError;
    }
    expect(caught?.issues.some((i) => i.message.includes("codename"))).toBe(true);
  });
  it("rejects TOML syntax errors with line/col", () => {
    let caught: ConfigError | undefined;
    try {
      parseHiveConfig(`[hive]\nname = "broken\n`, "/tmp/x");
    } catch (err) {
      caught = err as ConfigError;
    }
    expect(caught?.issues[0]?.line).toBeGreaterThan(0);
  });
});
