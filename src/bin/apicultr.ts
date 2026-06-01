#!/usr/bin/env bun
import { runBinary, type BinarySpec } from "../cli/command-router.ts";
import { versionCommand } from "../cli/apicultr/version.ts";
import { updateCommand } from "../cli/apicultr/update.ts";
import { uninstallCommand } from "../cli/apicultr/uninstall.ts";
import { accountCommand } from "../cli/apicultr/account.ts";

export const apicultrSpec: BinarySpec = {
  name: "apicultr",
  tagline: "the keeper. you are the king.",
  commands: {
    version: versionCommand,
    update: updateCommand,
    uninstall: uninstallCommand,
    account: accountCommand,
  },
};

if (import.meta.main) {
  const code = await runBinary(apicultrSpec, process.argv.slice(2));
  process.exit(code);
}
