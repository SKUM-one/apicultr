#!/usr/bin/env bun
import { runBinary, type BinarySpec } from "../cli/command-router.ts";
import { doctorCommand } from "../cli/hive/doctor.ts";
import { initCommand } from "../cli/hive/init.ts";
import { upCommand } from "../cli/hive/up.ts";
import { downCommand } from "../cli/hive/down.ts";
import { dispatchCommand } from "../cli/hive/dispatch.ts";
import { attachCommand } from "../cli/hive/attach.ts";
import { statusCommand } from "../cli/hive/status.ts";
import { routeCommand } from "../cli/hive/route.ts";
import { backendCommand } from "../cli/hive/backend.ts";
import { personaCommand } from "../cli/hive/persona.ts";

export const hiveSpec: BinarySpec = {
  name: "hive",
  tagline: "command your hive.",
  commands: {
    init: initCommand,
    up: upCommand,
    dispatch: dispatchCommand,
    attach: attachCommand,
    down: downCommand,
    status: statusCommand,
    doctor: doctorCommand,
    route: routeCommand,
    backend: backendCommand,
    persona: personaCommand,
  },
};

if (import.meta.main) {
  const code = await runBinary(hiveSpec, process.argv.slice(2));
  process.exit(code);
}
