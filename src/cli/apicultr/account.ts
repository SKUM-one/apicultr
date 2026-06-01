import { notImplemented } from "../_stubs.ts";
import type { Command } from "../command-router.ts";

export const accountCommand: Command = {
  name: "account",
  summary: "Licence + activation management (checkpoint C)",
  usage: "apicultr account <status|activate>",
  subcommands: {
    status: {
      name: "status",
      summary: "Show licence / subscription state",
      handler: notImplemented("c"),
    },
    activate: {
      name: "activate",
      summary: "Activate an apicultr key",
      usage: "apicultr account activate <key>",
      handler: notImplemented("c"),
    },
  },
};
