import { describe, expect, it } from "bun:test";
import {
  type BinarySpec,
  parseGlobalFlags,
  runBinary,
  splitArgv,
} from "../../src/cli/command-router.ts";

describe("splitArgv", () => {
  it("treats the first positional as the command name", () => {
    const out = splitArgv(["doctor", "--json"]);
    expect(out.commandName).toBe("doctor");
    expect(out.commandArgv).toEqual(["--json"]);
    expect(out.globalArgv).toEqual([]);
  });

  it("consumes global value flags before the command", () => {
    const out = splitArgv(["--config", "foo.toml", "doctor", "--json"]);
    expect(out.globalArgv).toEqual(["--config", "foo.toml"]);
    expect(out.commandName).toBe("doctor");
    expect(out.commandArgv).toEqual(["--json"]);
  });

  it("handles --config=foo.toml form", () => {
    const out = splitArgv(["--config=foo.toml", "doctor"]);
    expect(out.globalArgv).toEqual(["--config=foo.toml"]);
    expect(out.commandName).toBe("doctor");
  });

  it("returns no command name when only flags are given", () => {
    const out = splitArgv(["--help"]);
    expect(out.commandName).toBeUndefined();
    expect(out.globalArgv).toEqual(["--help"]);
  });

  it("supports -- as an explicit terminator", () => {
    const out = splitArgv(["--", "doctor", "--json"]);
    expect(out.commandName).toBe("doctor");
    expect(out.commandArgv).toEqual(["--json"]);
  });

  it("does not mistake a boolean short flag for the command", () => {
    const out = splitArgv(["-v", "doctor"]);
    expect(out.globalArgv).toEqual(["-v"]);
    expect(out.commandName).toBe("doctor");
  });
});

describe("parseGlobalFlags", () => {
  it("returns defaults for empty argv", () => {
    const f = parseGlobalFlags([]);
    expect(f.help).toBe(false);
    expect(f.version).toBe(false);
    expect(f.verbose).toBe(false);
    expect(f.quiet).toBe(false);
    expect(f.config).toBeUndefined();
  });

  it("parses --help, --version, --verbose, --quiet, --config", () => {
    const f = parseGlobalFlags(["--verbose", "--config", "x.toml"]);
    expect(f.verbose).toBe(true);
    expect(f.config).toBe("x.toml");
  });

  it("throws on unknown flags", () => {
    expect(() => parseGlobalFlags(["--nope"])).toThrow();
  });
});

function captureOutput(
  fn: () => Promise<number>,
): Promise<{ code: number; out: string; err: string }> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  return fn().then(
    (code) => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      return { code, out, err };
    },
    (e) => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      throw e;
    },
  );
}

const fixture: BinarySpec = {
  name: "demo",
  tagline: "test fixture",
  commands: {
    hello: {
      name: "hello",
      summary: "Say hello",
      handler: (ctx) => {
        ctx.logger.print(`hello ${ctx.commandArgv.join(" ")}`.trim());
        return 0;
      },
    },
    group: {
      name: "group",
      summary: "Group with subcommands",
      subcommands: {
        list: {
          name: "list",
          summary: "List things",
          handler: (ctx) => {
            ctx.logger.print("listed");
            return 0;
          },
        },
      },
    },
  },
};

describe("runBinary", () => {
  it("prints help when given --help and no command", async () => {
    const r = await captureOutput(() => runBinary(fixture, ["--help"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: demo");
    expect(r.out).toContain("hello");
  });

  it("prints version with --version", async () => {
    const r = await captureOutput(() => runBinary(fixture, ["--version"]));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^demo \d/);
  });

  it("routes to a command handler", async () => {
    const r = await captureOutput(() => runBinary(fixture, ["hello", "world"]));
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("hello world");
  });

  it("returns 2 for unknown commands and suggests a match", async () => {
    const r = await captureOutput(() => runBinary(fixture, ["helo"]));
    expect(r.code).toBe(2);
    expect(r.err).toContain("unknown command");
    expect(r.err).toContain("hello");
  });

  it("routes to nested subcommands", async () => {
    const r = await captureOutput(() => runBinary(fixture, ["group", "list"]));
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("listed");
  });

  it("shows subcommand help when an intermediate has no handler", async () => {
    const r = await captureOutput(() => runBinary(fixture, ["group"]));
    expect(r.code).toBe(2);
    expect(r.out).toContain("Subcommands:");
  });

  it("emits command help with --help on a command", async () => {
    const r = await captureOutput(() => runBinary(fixture, ["hello", "--help"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("demo hello");
  });
});
