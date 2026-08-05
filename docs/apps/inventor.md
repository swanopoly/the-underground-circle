# Inventor

> App automation profile. Status: buildout-only
> Owner code: `src/lib/appAutomationControlSurfaces.ts` (`inventor_api_ilogic` candidate), `src/lib/engineeringCadOperationRunbooks.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Honest platform note: Autodesk Inventor is Windows-only (iLogic rules, VBA, COM API,
  Apprentice server). No macOS build exists, so this Mac has no live-app surface; a VM window
  is pixels only to `desktop.read_a11y_tree`, and mutation through it is last-resort by policy.
- File-level work executes today: `desktop.cad_inspect_file` reads exported STEP (schema,
  product count) / STL (triangles, bbox) / DXF (layers, entities, units) with no app.
- Exports convert locally: `desktop.cad_compile` engine `freecadcmd` turns STEP/IGES/DXF
  exports into STEP/STL/DXF after approval. Native .ipt/.iam/.idw are honestly unreadable
  locally.
- New-part-from-description asks route to `desktop.cad_compile` engine `openscad`
  (STL + PNG proof, `model_or_bim_edit` runbook lane). Mesh convert/render proof of exported
  STL: `desktop.cad_compile` engine `blender` (headless bpy) — shipping now (P16).

## Control surfaces (ranked)

1. `inventor_api_ilogic` (primary, 100) — iLogic rules + the Inventor COM API for parts,
   assemblies, drawings, parameters, iProperties, and export automation. Windows-host
   buildout target, reachable from here only via a connected agent on that machine.
2. `autodesk_ai_mcp_assistant` (secondary, 68; 108 when the task asks) — Autodesk MCP/
   Assistant surfaces as product support lands.
3. `autodesk_aps_automation_api` (78 batch/cloud, else 64) — APS Design Automation for
   Inventor; deferred per P15 (token billing + enrollment friction).
4. `vendor_script_or_plugin_api` (72) — documented VBA/iLogic recipes, same Windows constraint.
5. `os_accessibility` (52) / `semantic_desktop` (42) — effectively unavailable across a VM
   boundary; `screenshot_coordinate_fallback` (10); `connected_agent_buildout` (35).

## Recipes

- Review an exported part/drawing: `desktop.file_stat` → `desktop.file_read` →
  `desktop.cad_inspect_file` → cite schema/products or layers/units; flag unknowns.
- Convert a STEP/DXF export: `approvals.request` → `buildFreeCadPythonScript`
  (`src/lib/cadCodeExecutor.ts`) → `desktop.file_write_text` → `desktop.cad_compile` engine
  `freecadcmd` → `desktop.file_stat` proof. STL → STEP honestly refused
  (`mesh_to_brep_not_supported`).
- Parameter/iProperty/drawing mutation: requires the Windows host — delegate
  `agent.build_app_capability` for an iLogic/COM adapter with a focused smoke, then retry
  with fresh observation. Do not simulate it from here.

## Approval & evidence rules

- Parameter/model/drawing mutation, rule/script execution, and save/export are high risk:
  `approvals.request` first (`model_or_bim_edit` / `export_plot` runbooks).
- Evidence: active document type verified (part vs assembly vs drawing), parameter identity
  and before/after values, verify-after screenshot + `desktop.file_stat`, compile receipts
  for local conversion lanes.
- Fail closed: document type unknown, parameter/target ambiguous, units unknown, VM-only
  visibility for a mutating step, missing approval.

## Gaps & buildout

- No Inventor adapter exists and none can run on this Mac. Realistic path: connected agent on
  the Windows machine running an iLogic rule runner or COM script surface, smoke-tested per
  the P15 extension rules; or an APS executor once credentialed and upload-approved.
- Until then the honest ceiling is exported-file inspection/conversion plus precise
  "needs the Windows machine or an export" guidance.

## Source refs

- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15 verdicts and extension rules)
- `APP_AUTOMATION_RESEARCH_REFS.inventorApi` / `.autodeskAutomationApi` /
  `.autodeskMcpServers` in `src/lib/appAutomationControlSurfaces.ts` (official Autodesk URLs)
- `APP_AUTOMATION_RESEARCH_REFS.windowsUiAutomation` (Windows-host fallback for buildout)
