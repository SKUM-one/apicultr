import { notImplemented } from "../_stubs.ts";
import type { Command } from "../command-router.ts";

export const updateCommand: Command = {
  name: "update",
  summary: "Self-update apicultr + hive binaries (checkpoint C)",
  usage: "apicultr update [--channel <stable|beta>]",
  handler: notImplemented("c"),
};
