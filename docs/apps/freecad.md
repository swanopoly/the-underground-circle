# FreeCAD

> App automation profile. Status: executable
> Owner code: `src/lib/cadCodeExecutor.ts` (freecadcmd planning/validation), `src/lib/engineeringCadOperationRunbooks.ts`, bridge endpoint `/desktop/cad_compile` in `scripts/claude-bridge.js`. Last reviewed: 2026-07-06.

## What chat can do today

FreeCAD is this repo's primary local full-CAD engine (P15 BUILT verdict; FreeCAD 1.1 headless
via `freecadcmd`). Executable now, no GUI session needed:

- Convert: STEP/STP/IGES/IGS/FCStd/DXF in → STEP/STP/STL/DXF out. Chat generates a Python
  script with `buildFreeCadPythonScript`, stages it with `desktop.file_write_text`, runs
  `desktop.cad_compile` engine `freecadcmd`, and proves the output with `desktop.file_stat`
  (the bridge response's `output.exists` is the receipt).
- Inspect: the generated inspect script prints a bounded JSON summary behind the
  `UC_CAD_JSON:` sentinel — object count, shape count, invalid-shape count, bbox, up to 20
  labels — parsed by `parseFreeCadInspectOutput`. Never guesses; returns null on garbage.
- Safety shape: binaries resolve from fixed install paths only (never PATH or user-supplied),
  execFile argv (no shell), paths embedded only as escaped Python string literals (non-BMP
  code points rejected), App-level modules only (`FreeCAD`/`Part`/`Mesh`/`importDXF`).
- Missing install fails honestly: `engine_not_installed` + `brew install --cask freecad` hint
  (`describeCadInstallGuidance`). Restart the bridge (`npm run bridge`) after upgrades.

## Control surfaces (ranked)

1. `desktop.cad_compile` engine `freecadcmd` — headless convert/inspect (the executable surface).
2. `vendor_script_or_plugin_api` (72, top ranked candidate for FreeCAD tasks) — FreeCAD's
   Python console/macro surface inside the GUI, for operations beyond the generated scripts.
3. `os_accessibility` (52) → `semantic_desktop` (42) → `screenshot_coordinate_fallback` (10)
   for GUI-session work; `connected_agent_buildout` (35) for new script recipes.

## Recipes

- Batch convert (`batch_convert_or_translate` runbook lane, preferred before any cloud
  route): `approvals.request` (source list + output folder) → per file:
  `buildFreeCadPythonScript({ operation: 'convert', inputPath, outputPath })` →
  `desktop.file_write_text` → `desktop.cad_compile` → `desktop.file_stat`; reconcile
  source/output counts.
- Measure/verify a STEP or FCStd (`inspect_measure`): try `desktop.cad_inspect_file` first
  (STEP text parse, no engine needed); use the freecadcmd inspect script when shape-level
  validity/bbox is required. Report bbox in document units with ambiguity flagged.
- Visual proof: `freecadcmd` cannot render thumbnails (headless — FreeCADGui/TechDraw absent;
  `buildFreeCadPythonScript` returns `{ unsupported: true }` for 'thumbnail' instead of
  pretending). Convert to STL and render the PNG via `desktop.cad_compile` engine `blender`
  (headless bpy mesh convert + PNG render) — shipping now (P16) — or compile code-CAD sources
  via OpenSCAD `--render` PNG.

## Approval & evidence rules

- Conversions and any file write are approval-gated (`approvals.request`; the tool registers
  under the desktop mutation policy, approvalMode `ask`). Inspect lanes are read-oriented but
  still run a subprocess — the runbooks keep them inside the observed, scoped work folder.
- Evidence: generated-script receipt, exit code, `output.exists`, output `desktop.file_stat`,
  and the bounded `buildCadCompileReceipt` (engine/exitOk/outputExists/bytes/stderr ≤300 chars)
  for persisted chat metadata.
- Fail closed: input extension outside the allowlist, output extension outside
  STEP/STP/STL/DXF, mesh → B-rep asks (`mesh_to_brep_not_supported` — STL→STEP is modeling
  work, not conversion), path validation failure, missing approval.

## Gaps & buildout

- No parametric editing of FCStd documents yet (the generated scripts convert/inspect; they do
  not mutate feature trees). A "FreeCAD edit recipe" is a natural `agent.build_app_capability`
  wave — new engines/recipes must extend `CAD_ENGINE_BINARIES` + the engine enum in LOCKSTEP
  with the bridge (P15 extension rules).
- TechDraw drawing exports: GUI-dependent, unavailable headless — honest limitation.

## Source refs

- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15: research verdict, shipped executor, extension rules)
- `src/lib/cadCodeExecutor.ts` header comments (honest limitations)
- `scripts/cad-code-executor-smoketest.ts` (`npm run smoke:cad-code-executor`)
