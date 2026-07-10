# Revit

> App automation profile. Status: buildout-only
> Owner code: `src/lib/appAutomationControlSurfaces.ts` (`revit_api_addin` candidate), `src/lib/engineeringCadOperationRunbooks.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Honest platform note: Revit is Windows-only. There is no macOS Revit, so on this Mac there
  is no live-app surface — none. A VM-hosted session is opaque pixels to
  `desktop.read_a11y_tree`; only `desktop.screenshot` observation of the VM window works, and
  mutating through it is last-resort by policy.
- File-level work executes today: `desktop.cad_inspect_file` reads DXF exports (layers,
  entities, `$INSUNITS`) and STEP where a workflow produces one. IFC and native .rvt/.rfa are
  honestly unreadable locally — no parser exists in this repo.
- DXF exports convert locally: `desktop.cad_compile` engine `freecadcmd`
  (DXF → STEP/STL/DXF) after approval.
- BIM-edit requests fail closed to `agent.build_app_capability` with the `model_or_bim_edit`
  runbook's worksharing/approval framing — no pretend clicking.

## Control surfaces (ranked)

1. `revit_api_addin` (primary, 100) — the Revit API/add-in model (C#/.NET; Dynamo and pyRevit
   sit on it) for elements, families, views/sheets, data extraction, controlled export.
   Windows-host buildout target, reachable only through a connected agent on that machine.
2. `autodesk_ai_mcp_assistant` (secondary, 68; 108 when asked for) — Autodesk MCP/Assistant
   surfaces as product support lands; governance + editable-result confirmation required.
3. `autodesk_aps_automation_api` (78 batch/cloud, else 64) — APS Design Automation for Revit
   is the cloud headless route; deferred per P15 (token billing + enrollment friction).
4. `vendor_script_or_plugin_api` (72) — journal/macro recipes, same Windows constraint.
5. `os_accessibility` (52) / `semantic_desktop` (42) — unavailable for VM guests in practice;
   `screenshot_coordinate_fallback` (10); `connected_agent_buildout` (35).

## Recipes

- Review an exported drawing: `desktop.file_stat` → `desktop.file_read` →
  `desktop.cad_inspect_file` on the DXF → report layers/entities/units; flag units-unknown
  when `$INSUNITS` is absent.
- Convert a DXF deliverable: `approvals.request` → `buildFreeCadPythonScript` →
  `desktop.file_write_text` → `desktop.cad_compile` engine `freecadcmd` →
  `desktop.file_stat` proof.
- Model/BIM edit request: verify inputs (model identity, element/family target, worksharing
  state) are even knowable from here; if not, stop with the exact user action or delegate a
  Windows-host adapter buildout via `agent.build_app_capability` — never coordinate-click a
  BIM model.

## Approval & evidence rules

- BIM element/family/view/sheet mutation, sync/save/export, and add-in execution are high
  risk: `approvals.request` before act, always.
- Evidence: active model/view/sheet identity, worksharing/model-lock state, target element
  identity verified once; verify-after with element/family state, proof screenshot, and
  `desktop.file_stat` for exports.
- Fail closed: worksharing state unclear, target element ambiguous, units unknown, no
  app-native adapter, missing approval — all listed in the `model_or_bim_edit` runbook.

## Gaps & buildout

- Everything mutating is buildout: a connected agent on a Windows host driving the Revit API
  (add-in or pyRevit script runner) with a focused smoke, or an APS Design Automation
  executor once credentials/upload approvals exist in the Marketplace.
- IFC inspection support in `cadFileInspector.ts` would unlock read-only BIM review on Mac —
  candidate future wave, not promised.

## Source refs

- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15: APS skip-until-demand rationale)
- `APP_AUTOMATION_RESEARCH_REFS.revitApi` / `.autodeskAutomationApi` / `.autodeskMcpServers`
  in `src/lib/appAutomationControlSurfaces.ts` (official Autodesk URLs)
- `APP_AUTOMATION_RESEARCH_REFS.windowsUiAutomation` (Windows-host fallback for buildout)
