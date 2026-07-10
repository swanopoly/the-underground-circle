# SOLIDWORKS

> App automation profile. Status: buildout-only
> Owner code: `src/lib/appAutomationControlSurfaces.ts` (`solidworks_com_api` candidate), `src/lib/engineeringCadOperationRunbooks.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Honest platform note: SOLIDWORKS is Windows-only (COM/VBA/API). There is no macOS build, so
  on this Mac there is no live-app surface at all — a SOLIDWORKS session inside a VM
  (Parallels/VMware) is opaque pixels to `desktop.read_a11y_tree`; only
  `desktop.screenshot`-level observation of the VM window is possible, and mutation through it
  is last-resort by policy.
- What executes today is file-level: `desktop.cad_inspect_file` reads exported STEP (schema,
  product count, header) and STL (triangle count, bbox for ASCII; size-formula count for
  binary) with no app. `desktop.cad_compile` engine `freecadcmd` converts exported
  STEP/IGES → STEP/STL/DXF. Native .sldprt/.sldasm/.slddrw are honestly unreadable locally.
- New-part-from-description asks route to `desktop.cad_compile` engine `openscad`
  (STL + PNG proof) via the `model_or_bim_edit` runbook — no SOLIDWORKS needed.
- Mesh proof/convert of exported STL: `desktop.cad_compile` engine `blender` (headless bpy
  mesh convert + PNG render) — shipping now (P16).

## Control surfaces (ranked)

1. `solidworks_com_api` (primary, 100) — the documented API/COM object model + VBA macros for
   parts/assemblies/drawings/configurations/exports. Windows-only; on a Windows host this is
   the buildout target, reachable from here only through a connected agent on that machine.
2. `vendor_script_or_plugin_api` (72) — macro (.swp) recipes and documented export routes,
   same Windows constraint.
3. `os_accessibility` (52) / `semantic_desktop` (42) — effectively unavailable for VM-hosted
   sessions (macOS a11y cannot see inside the guest OS); generic ladder only, and honestly weak.
4. `screenshot_coordinate_fallback` (10) — one reversible visual step, last resort.
5. `connected_agent_buildout` (35) — the realistic mutation path today.

## Recipes

- Inspect an exported part: `desktop.file_stat` → `desktop.file_read` →
  `desktop.cad_inspect_file` → report products/triangles/bbox with the units caveat
  (STL is unitless; STEP header cited).
- Convert STEP/IGES export: `approvals.request` → `buildFreeCadPythonScript`
  (`src/lib/cadCodeExecutor.ts`) → `desktop.file_write_text` → `desktop.cad_compile` engine
  `freecadcmd` → `desktop.file_stat` proof. STL → STEP is honestly refused
  (`mesh_to_brep_not_supported`).
- Windows-host mutation (dimensions, configurations, drawing sheets): delegate
  `agent.build_app_capability` to build a macro/COM adapter on the machine that runs
  SOLIDWORKS, with a focused smoke before retrying the user task.

## Approval & evidence rules

- All model/drawing mutation, macro execution, and export/save-as require `approvals.request`
  first (`model_or_bim_edit` and `export_plot` are high risk).
- Evidence: document type + active configuration/sheet verified before any act; verify-after
  with dimension/feature state, screenshot proof, and `desktop.file_stat` for outputs;
  compile receipts for local conversion lanes.
- Fail closed: document type or configuration unknown, ambiguous target
  dimension/feature, VM-only visibility for a mutating step, missing approval.

## Gaps & buildout

- No SOLIDWORKS adapter exists and none can run on this Mac. Buildout requires a connected
  agent on a Windows host driving the COM/VBA macro surface (record → edit → run → smoke).
- Until then: file-level inspection/conversion and honest "needs the Windows machine or an
  export" replies are the ceiling. Say "generic ladder only, and it cannot see inside a VM"
  rather than implying live control.

## Source refs

- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15: local code-CAD BUILT; app-native SOLIDWORKS
  executor not built)
- `APP_AUTOMATION_RESEARCH_REFS.solidworksApi` / `.solidworksMacros` in
  `src/lib/appAutomationControlSurfaces.ts` (official SOLIDWORKS API/macro docs)
- `APP_AUTOMATION_RESEARCH_REFS.windowsUiAutomation` (Windows-host UIA fallback for buildout)
