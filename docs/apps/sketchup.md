# SketchUp

> App automation profile. Status: buildout-only
> Owner code: `src/lib/appAutomationControlSurfaces.ts` (target-name detection only — no dedicated candidate), `src/lib/engineeringCadOperationRunbooks.ts` (generic CAD runbooks). Last reviewed: 2026-07-06.

## What chat can do today

- The router detects SketchUp (`targetName: 'SketchUp'`, engineering/CAD family) but there is
  no SketchUp-specific candidate or adapter — the ranked plan tops out at the generic
  `vendor_script_or_plugin_api` surface (72). Live work is honestly generic ladder only:
  `desktop.launch_app`/`desktop.focus_app`, `desktop.window_state`, `desktop.read_a11y_tree`,
  `desktop.menu_click`, `desktop.screenshot`, one approved reversible step at a time.
- Exported meshes are workable without SketchUp: `desktop.cad_inspect_file` reads STL
  (triangles/bbox); DXF exports read too (layers/entities/units). Native `.skp` is honestly
  unreadable locally. Mesh convert + PNG render proof of exported STL/OBJ meshes:
  `desktop.cad_compile` engine `blender` (headless bpy) — shipping now (P16).
- New-part-from-description asks route to `desktop.cad_compile` engine `openscad`
  (STL + PNG proof) via the `model_or_bim_edit` runbook — no SketchUp needed.

## Control surfaces (ranked)

1. `vendor_script_or_plugin_api` (72, top-ranked for SketchUp tasks) — the SketchUp Ruby API
   runs in-app (extensions / Extension Warehouse); it is the real automation surface, but
   there is no supported headless mode on Mac desktop, so reaching it means an installed
   extension or user-run script — buildout, not a bound tool.
2. `os_accessibility` (52) → `semantic_desktop` (42) — menus, dialogs, export panels of the
   running app.
3. `screenshot_coordinate_fallback` (10) — last resort, one reversible step.
4. `connected_agent_buildout` (35) — Ruby-extension adapter buildout.
5. SketchUp for Web (Free/Go) exists as a browser variant; web-phrased tasks can use the
   browser DOM/CDP pipeline instead of the desktop ladder.

## Recipes

- Review an exported model: `desktop.file_stat` → `desktop.file_read` →
  `desktop.cad_inspect_file` on the STL/DXF → report triangles/bbox or layers/units with the
  unitless-STL caveat.
- Menu-backed export from a live session: observe (window + a11y + screenshot) →
  `approvals.request` → `desktop.menu_click` the named export item → verified dialog fields
  via `desktop.click_element`/`desktop.set_element_value` → `desktop.file_stat` proof.
- Geometry edits (walls, components, groups): no deterministic surface exists — fail closed
  to `agent.build_app_capability` (Ruby extension exposing the specific operation, smoke
  first) or return the exact user action. Do not draw by coordinates.
- Render/convert an exported mesh: `approvals.request` → `desktop.cad_compile` engine
  `blender` for STL/OBJ convert + PNG proof (P16) → `desktop.file_stat`.

## Approval & evidence rules

- Model mutation, extension/script execution, and export/save all need `approvals.request`
  first (high risk for `model_or_bim_edit` / `export_plot`).
- Evidence: active document identity, units/scale cited or fail closed, verify-after
  screenshot + a11y recheck + output `desktop.file_stat`; compile receipts for blender/
  openscad lanes.
- Fail closed: ambiguous component/group target, unknown units, unverifiable dialog state,
  missing approval.

## Gaps & buildout

- Ruby-extension adapter (small localhost-command or file-drop extension exposing named
  operations) is the only path to deterministic SketchUp mutation; buildout via
  `agent.build_app_capability` with official Ruby API docs + a smoke.
- `.skp` structural inspection is unsupported locally — request STL/DXF/DAE exports.
- No headless SketchUp on Mac desktop — batch jobs must go through exports or the web
  variant; say so instead of promising queued automation.

## Source refs

- SketchUp Ruby API (official): https://ruby.sketchup.com/
- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15 extension rules; blender engine P16)
- `src/lib/appAutomationControlSurfaces.ts` (`detectCadTargetName`, `engineeringCadCandidates`)
