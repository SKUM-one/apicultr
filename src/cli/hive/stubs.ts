import { notImplemented } from "../_stubs.ts";
import type { Command } from "../command-router.ts";

export const initCommand: Command = {
  name: "init",
  summary: "Scaffold a new hive (checkpoint B)",
  usage: "hive init <name> [--template <template>] [--path <path>] [--backend native|tmux|auto]",
  handler: notImplemented("b"),
};

export const upCommand: Command = {
  name: "up",
  summary: "Start the hive (checkpoint B)",
  usage: "hive up [<name>] [--detach]",
  handler: notImplemented("b"),
};

export const dispatchCommand: Command = {
  name: "dispatch",
  summary: "Send a brief to a persona (checkpoint B)",
  usage: "hive dispatch <persona> [--hive <name>] [--brief <file>]",
  handler: notImplemented("b"),
};

export const attachCommand: Command = {
  name: "attach",
  summary: "Focus the hive's windows (checkpoint B)",
  usage: "hive attach [<persona>] [--hive <name>]",
  handler: notImplemented("b"),
};

export const downCommand: Command = {
  name: "down",
  summary: "Tear down the hive (checkpoint B)",
  usage: "hive down [<name>] [--force]",
  handler: notImplemented("b"),
};

export const statusCommand: Command = {
  name: "status",
  summary: "List active hives + per-persona health (checkpoint B)",
  usage: "hive status [<name>] [--json] [--tree]",
  handler: notImplemented("b"),
};

export const routeCommand: Command = {
  name: "route",
  summary: "Print a persona's address and who they may dispatch to (checkpoint B)",
  usage: "hive route <persona> [--hive <name>]",
  handler: notImplemented("b"),
};

export const backendCommand: Command = {
  name: "backend",
  summary: "Print active backend and detected alternatives (checkpoint B)",
  usage: "hive backend",
  handler: notImplemented("b"),
};

export const personaCommand: Command = {
  name: "persona",
  summary: "Manage personas (checkpoint B)",
  usage: "hive persona <list|restart>",
  subcommands: {
    list: {
      name: "list",
      summary: "List personas in the current hive (checkpoint B)",
      handler: notImplemented("b"),
    },
    restart: {
      name: "restart",
      summary: "Restart a persona's claude process (checkpoint B)",
      usage: "hive persona restart <persona>",
      handler: notImplemented("b"),
    },
  },
};
