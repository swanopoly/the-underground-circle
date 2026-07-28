# Smoke runner (`scripts/run-smokes.mjs`)

`npm run smoke:all` is one `&&` chain of every `smoke:*` script. It is the
project gate and its semantics are unchanged — but the first failing suite
aborts the chain, so every suite after it silently never runs and nothing says
so. That masking is how a real backoff bug survived for weeks.

`scripts/run-smokes.mjs` is the additive answer: run everything, report the
whole picture. Plain Node ESM — no tsx, no typecheck, no build step.

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
- registered suites **absent from the `smoke:all` chain** (invisible today,
  since the chain aborts long before anyone counts it).

`smoke:all` aggregates and any script that invokes this runner are skipped
automatically (detected by shape, not by name), so they never recurse.

## Notes

- Each suite runs in its own detached process group; a timeout kills the whole
  group (`sh` → `npx` → `tsx` → `node`), SIGTERM then SIGKILL.
- Per-suite output is capped (last 64 KB retained, single lines clamped), so a
  suite that prints hundreds of megabytes cannot exhaust memory.
- Suites that print nothing, die by signal, or fail to spawn are reported as
  ordinary results rather than breaking the run.
