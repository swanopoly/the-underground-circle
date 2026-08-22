# Smoke runner (`scripts/run-smokes.mjs`)

`npm run smoke:all` uses `scripts/run-smokes.mjs` to discover every registered
`smoke:*` suite, run the whole set with bounded concurrency, and report every
failure. This replaces the former hand-maintained `&&` chain, which stopped at
the first failure and repeatedly drifted behind package registration.

The runner is plain Node ESM — no tsx, no typecheck, no build step. Register a
new suite once in `package.json`; the full sweep picks it up automatically.

```bash
node scripts/run-smokes.mjs                      # run every registered suite
node scripts/run-smokes.mjs --list               # what would run + drift report
node scripts/run-smokes.mjs --filter memory      # just the memory suites
node scripts/run-smokes.mjs --json /tmp/smokes.json
```

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--filter <substring>` | – | Match suite name, file, or command (case-insensitive). Repeatable; OR'ed. |
| `--list` | – | Print the selected suites plus the drift report, then exit. |
| `--concurrency <n>` | `min(4, cpus-1)` | Parallel suites. Each one spawns `npx tsx`. |
| `--timeout <ms\|30s\|2m>` | `120000` | Per-suite timeout, enforced in Node (macOS has no GNU `timeout`). |
| `--tail <n>` | `20` | Output lines shown per failing suite. |
| `--slowest <n>` | `10` | Slowest suites listed. |
| `--json <path>` | – | Machine-readable report. |
| `--fail-on-drift` | off | Registration drift becomes a failing exit code. |
| `--no-drift` | – | Skip the drift scan. |

Env fallbacks: `SMOKE_CONCURRENCY`, `SMOKE_TIMEOUT_MS` (flags win).

Exit codes: `0` clean · `1` a suite failed or timed out · `2` bad usage ·
`3` drift with `--fail-on-drift` · `130` interrupted.

## Registration drift

Suites are discovered by parsing `package.json` `scripts` — never a hardcoded
list, because a hardcoded list is how this repo grew a registration hole. The
runner also reports the drift itself:

- `scripts/*-smoketest.*` files with **no** `smoke:*` entry (they never run),
- `smoke:*` entries pointing at a **missing** file,
- registered suites **absent from `smoke:all`** if someone restores a legacy
  static chain instead of the discovery runner.

Pure `smoke:*` aggregates and any script that invokes this runner are skipped
automatically, so they never recurse. Hybrid scripts that run prerequisites
and their own `*-smoketest` file remain discoverable suites; the full sweep
flattens their already-scheduled smoke prerequisites so each test runs once.

## Notes

- Each suite runs in its own detached process group; a timeout kills the whole
  group (`sh` → `npx` → `tsx` → `node`), SIGTERM then SIGKILL.
- Per-suite output is capped (last 64 KB retained, single lines clamped), so a
  suite that prints hundreds of megabytes cannot exhaust memory.
- Suites that print nothing, die by signal, or fail to spawn are reported as
  ordinary results rather than breaking the run.
