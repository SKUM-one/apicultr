import { notImplemented } from "../_stubs.ts";
import type { Command } from "../command-router.ts";

export const uninstallCommand: Command = {
  name: "uninstall",
  summary: "Remove apicultr + hive binaries (checkpoint C)",
  usage: "apicultr uninstall",
  handler: notImplemented("c"),
};
