#!/usr/bin/env bun
import { runBinary, type BinarySpec } from "../cli/command-router.ts";
import { doctorCommand } from "../cli/hive/doctor.ts";
import {
  attachCommand,
  backendCommand,
  dispatchCommand,
  downCommand,
  initCommand,
  personaCommand,
  routeCommand,
  statusCommand,
  upCommand,
} from "../cli/hive/stubs.ts";

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
