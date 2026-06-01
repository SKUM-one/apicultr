# apicultr

**apicultr keeps your hive. You are the king.**

A cross-platform multi-process agent swarm orchestrator. Spawns N independent Claude Code workers, each in its own terminal window (native Mac primary, tmux fallback), arranged in any hierarchy from a flat hub to a deeply nested org. Customer brings their own Claude Code.

## Two binaries

| Binary | Frequency | Purpose |
|---|---|---|
| `apicultr` | rare | Manage the product itself: install, update, uninstall, account |
| `hive` | daily | Command your hive: `init`, `up`, `dispatch`, `attach`, `status`, `doctor`, `down` |

You type `apicultr` perhaps once a month. You type `hive` every working day.

## Status: pre-alpha (checkpoint A of 3)

This repo is under active build against the v1 runtime brief at
`/Users/Shared/Projects/.swarm/briefs/_apicultr/runtime-mvp.md` and the spec at
`spec/v1.md` (canonical: `/Users/Shared/Projects/.swarm/specs/apicultr-v1.md`).

Checkpoint A (current): toolchain + binaries + `apicultr version` + `hive doctor`.
Checkpoint B: hive lifecycle on both backends, hierarchical topology, dispatch.
Checkpoint C: round-out + cross-platform + release bundling.

## Build from source

```sh
bun install
bun run build
./bin/apicultr version
./bin/hive doctor
```

## Tests

```sh
bun test
```

## Spec

`spec/v1.md` (symlink to the canonical doc).

## Licence

Apache-2.0. See [LICENSE](LICENSE).

The runtime is open source. Vertical templates (lead-gen, qa-pipeline, content-factory, customer-support-triage, etc.) are sold separately under commercial terms.
