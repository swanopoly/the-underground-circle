# AutoCAD

> App automation profile. Status: partial
> Owner code: `src/lib/appAutomationControlSurfaces.ts` (`autocad_lisp_dotnet_api` candidate), `src/lib/engineeringCadOperationRunbooks.ts`, `src/lib/cadFileInspector.ts` (DXF). Last reviewed: 2026-07-06.

## What chat can do today

- Read-only DXF inspection with no app open: `desktop.cad_inspect_file` parses layers, entity
  counts by type, `$INSUNITS` units, and `$ACADVER` version. DWG is binary and honestly
  unsupported locally — ask for a DXF export first.
- DXF conversion without AutoCAD: `desktop.cad_compile` engine `freecadcmd` converts
  DXF → STEP/STL/DXF when FreeCAD is installed (fixed-path binary; honest
  `engine_not_installed` + brew hint when absent).
- Live-app work through the generic desktop ladder: `desktop.launch_app`/`desktop.focus_app`,
  verify the active drawing with `desktop.window_state`, read palettes/dialogs with
  `desktop.read_a11y_tree` (Δ-diff on consecutive reads), then type native commands into the
  AutoCAD command line via `desktop.type_text` — the runbooks' act route for drafting, layer,
  and export steps. One approved step at a time, screenshot-verified.
- Runbooks fire on autocad/dwg/dxf/model-space/paper-space tasks: `inspect_measure`,
  `draft_2d_geometry`, `update_dimensions_layers`, `export_plot`, `batch_convert_or_translate`.

## Control surfaces (ranked)

1. `autocad_lisp_dotnet_api` (primary, 100) — typed command line + AutoLISP; AutoLISP runs in
   AutoCAD for Mac, while .NET/ObjectARX add-ins are Windows-side buildout targets.
2. `vendor_script_or_plugin_api` (secondary, 72) — script (.scr) files and documented command recipes.
3. `autodesk_ai_mcp_assistant` (secondary, 68; primary 108 only when the task asks for
   MCP/Assistant) — governed Autodesk AI surfaces where the product/version supports them.
4. `autodesk_aps_automation_api` (secondary 78 with batch/cloud keywords, else fallback 64) —
   APS Design Automation. Deferred per P15: token billing + dev-hub enrollment friction.
5. `os_accessibility` (52) → `semantic_desktop` (42) → `screenshot_coordinate_fallback` (10),
   with `connected_agent_buildout` (35) for missing adapters.

## Recipes

- Inspect a DXF: `desktop.file_stat` → `desktop.file_read` → `desktop.cad_inspect_file` →
  report units/layers/entities, flagging units-unknown when `$INSUNITS` is missing.
- Command-line drafting or layer edit: observe (`desktop.window_state` +
  `desktop.read_a11y_tree` + `desktop.screenshot`) → `approvals.request` → `desktop.type_text`
  one command with explicit coordinates/lengths/layer names → verify screenshot + command feedback.
- Plot/export: approval with exact format and destination → typed export/plot command or
  verified dialog via `desktop.click_element` → `desktop.file_stat` proof of the output.
- Batch DXF convert locally: approval → generate a FreeCAD script per file
  (`buildFreeCadPythonScript` in `src/lib/cadCodeExecutor.ts`) → `desktop.file_write_text` →
  `desktop.cad_compile` engine `freecadcmd` → `desktop.file_stat` each output.

## Approval & evidence rules

- `inspect_measure` is read_only: no approval; `desktop.cad_inspect_file` is auto-approved.
- Any drawing mutation or file write needs `approvals.request` first (draft/update = review
  risk; export/batch = high risk in the runbooks).
- Evidence: observe-before (file_stat, window_state, a11y tree, screenshot), units cited or
  fail closed, one-step act, verify-after (screenshot + `desktop.file_stat`), bounded compile
  receipts (`buildCadCompileReceipt`: engine/exitOk/outputExists/bytes/stderr excerpt).
- Fail closed on: active drawing mismatch, unknown units/scale, ambiguous layer/object target,
  locked/frozen layer, missing approval.

## Gaps & buildout

- No AutoLISP runner tool exists yet — typed commands via the ladder are the only live-app act
  route. An `.lsp` script-runner adapter is the natural first buildout
  (`agent.build_app_capability`).
- DWG read/write locally: unsupported (no DWG parser; FreeCAD input list excludes it). Route
  through DXF export, or APS Design Automation once credentialed and upload-approved.
- APS cloud executor: deferred (P15) — needs Marketplace credential integration, explicit
  upload approval, and job-status evidence.

## Source refs

- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15 verdicts: local code-CAD BUILT, APS skip-until-demand)
- `APP_AUTOMATION_RESEARCH_REFS.autocadApi` / `.autocadAutolisp` / `.autocadDotNetApi` /
  `.autodeskAutomationApi` / `.autodeskMcpServers` in `src/lib/appAutomationControlSurfaces.ts`
  (official Autodesk URLs, last reviewed 2026-06-18)
