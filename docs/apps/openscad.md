# OpenSCAD

> App automation profile. Status: executable
> Owner code: `src/lib/cadCodeExecutor.ts` (OpenSCAD compile plans + arg allowlist), `src/lib/engineeringCadOperationRunbooks.ts` (model_or_bim_edit new-part lane), bridge endpoint `/desktop/cad_compile` in `scripts/claude-bridge.js`. Last reviewed: 2026-07-06.

## What chat can do today

OpenSCAD is this repo's primary code-CAD engine (P15 BUILT verdict): the highest-reliability
path for agent-generated parts, fully headless and deterministic.

- Compile generated `.scad` programs to STL / 3MF / DXF / PNG via `desktop.cad_compile`
  engine `openscad`. `buildOpenScadCompilePlan` produces deterministic file names (slug from
  the brief + optional caller stamp), staged with `desktop.file_write_text`.
- Parameter overrides ride as `-Dname=value` args — value must be a plain number, `true`, or
  `false` (strings rejected); names match `[A-Za-z_][A-Za-z0-9_]*`. Invalid params are dropped
  with an explanatory note, never mangled into argv.
- PNG proof renders headlessly with `--render --imgsize=1024,768` — note the comma form
  `--imgsize=W,H` (the real CLI syntax, not `WxH`), each axis bounded 16..8192.
- Strict extraArgs allowlist (`isAllowedOpenScadExtraArg`): only `-D...`, `--render`,
  `--imgsize=W,H`. Shell metacharacters, extra `-o`, `--export-format` are all rejected;
  the bridge re-checks the same allowlist in LOCKSTEP.
- Missing install fails honestly: `engine_not_installed` + `brew install --cask openscad`.
  P15 research note: the nightly (Manifold backend) renders ~100x faster than stable.

## Control surfaces (ranked)

1. `desktop.cad_compile` engine `openscad` — the executable surface (no GUI ever opens).
2. `vendor_script_or_plugin_api` — documented OpenSCAD CLI recipes beyond the allowlist
   require extending the executor (LOCKSTEP rule), not ad-hoc flags.
3. Generic ladder (`os_accessibility` 52 / `semantic_desktop` 42 /
   `screenshot_coordinate_fallback` 10) — rarely relevant; the GUI is not part of the loop.
   Router note: plain "openscad" phrasing routes to the generic app family; CAD-keyword tasks
   route to `engineering_cad_app` — the executor tools work from either.

## Recipes

- New part from description (`model_or_bim_edit` runbook lane): write the `.scad` program →
  `approvals.request` → compile STL → compile PNG proof → `desktop.file_stat` both +
  `buildCadCompileReceipt`. Iterate on compiler errors from `stderrExcerpt` (≤300 chars).
- Parametric variant sweep: same source, one compile per `-D` override set (deterministic
  names via `stamp`), receipts per output.
- 2D profile export: DXF output is 2D-only — the program must produce a 2D profile (e.g.
  `projection(cut=true)` of the model); the plan notes say this explicitly.
- Downstream conversion: STL/3MF out only — no STEP. Mesh → B-rep is honestly refused
  (`mesh_to_brep_not_supported` in `resolveCadEngineForTask`); route STEP asks to real B-rep
  sources via FreeCAD. Alternate mesh formats/renders: `desktop.cad_compile` engine `blender`
  (headless bpy mesh convert + PNG render) — shipping now (P16).
- Inspect a compiled STL without recompiling: `desktop.cad_inspect_file` (triangle count,
  bbox for ASCII; size-formula count for binary).

## Approval & evidence rules

- Compiles write files → `approvals.request` before `desktop.cad_compile` (desktop mutation
  policy, approvalMode `ask`). The staged `.scad` write via `desktop.file_write_text` is part
  of the approved plan.
- Evidence: generated source receipt, compile exit code, output `desktop.file_stat`, PNG
  render proof, bounded `buildCadCompileReceipt` in persisted metadata.
- Units honesty: STL/3MF geometry is unitless; OpenSCAD numbers are conventionally
  millimeters — state the convention in the proof (plan notes enforce the reminder).
- Fail closed: invalid workDir (plan returns bare names + a resolve-a-staging-folder note),
  disallowed extraArgs, missing approval, exit code ≠ 0 without a fresh-error iteration plan.

## Gaps & buildout

- No STEP/B-rep output — permanent engine limitation, not a bug; say so instead of promising
  conversion.
- SVG/OFF/AMF are bridge-legal output extensions but the plan builder only emits
  stl/png/dxf/3mf; extending it follows the P15 LOCKSTEP extension rules.
- No GUI preview/camera control beyond `--imgsize` defaults; richer renders belong to the
  blender engine (P16).

## Source refs

- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15: verdicts, shipped executor, extension rules)
- `src/lib/cadCodeExecutor.ts` (allowlists, plan builders, receipts)
- `scripts/cad-code-executor-smoketest.ts` (`npm run smoke:cad-code-executor`)
