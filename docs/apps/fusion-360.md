# Fusion 360 (Autodesk Fusion)

> App automation profile. Status: buildout-only
> Owner code: `src/lib/appAutomationControlSurfaces.ts` (`fusion_api_scripts_addins` candidate), `src/lib/engineeringCadOperationRunbooks.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- No Fusion-native executor tool exists. Live Fusion work is the generic ladder only:
  `desktop.launch_app`/`desktop.focus_app`, `desktop.window_state`, `desktop.read_a11y_tree`,
  `desktop.menu_click`, `desktop.screenshot` — observation and menu-backed reversible steps
  with approval. Editing an existing design fails closed to `agent.build_app_capability`
  instead of clicking canvas coordinates.
- Fusion exports are fully workable without Fusion: `desktop.cad_inspect_file` reads
  STEP/STL/DXF structure; `desktop.cad_compile` engine `freecadcmd` converts STEP/IGES →
  STEP/STL/DXF locally.
- "Design a NEW part from a description" does not need Fusion: the `model_or_bim_edit` runbook
  routes it to `desktop.cad_compile` engine `openscad` (generated `.scad` → STL + PNG proof).
- Mesh proof of exported STL: `desktop.cad_compile` engine `blender` (headless bpy mesh
  convert + PNG render) — shipping now (P16).

## Control surfaces (ranked)

1. `fusion_api_scripts_addins` (primary, 100) — in-process Python/C++ API via scripts/add-ins.
   Requires a running GUI and manual per-machine script install; Fusion has NO headless
   desktop mode (P15 research verdict).
2. `autodesk_ai_mcp_assistant` (secondary, 68; 108 when the task asks for MCP/Assistant) —
   Autodesk MCP servers list Fusion "direct design interaction"; needs server config,
   permissions, and an editable-result guarantee.
3. `vendor_script_or_plugin_api` (72) — documented SDK routes for one-off recipes.
4. `autodesk_aps_automation_api` (78 batch/cloud, else 64) — the cloud Fusion Automation API
   is TypeScript-only and consumes Flex tokens; P15 verdict: skip until demand.
5. `os_accessibility` (52) → `semantic_desktop` (42) → `screenshot_coordinate_fallback` (10),
   `connected_agent_buildout` (35).

## Recipes

- Inspect an exported model: `desktop.file_stat` → `desktop.file_read` →
  `desktop.cad_inspect_file` (STEP schema/products, STL triangles/bbox) — no app needed.
- New part from description: `buildOpenScadCompilePlan` (`src/lib/cadCodeExecutor.ts`) →
  `desktop.file_write_text` the `.scad` → `approvals.request` → `desktop.cad_compile` engine
  `openscad` for STL, again for PNG proof → `desktop.file_stat` both outputs.
- Convert a Fusion STEP export: approval → `buildFreeCadPythonScript` →
  `desktop.file_write_text` → `desktop.cad_compile` engine `freecadcmd` → `desktop.file_stat`.
  STL → STEP (mesh → B-rep) is honestly unsupported (`mesh_to_brep_not_supported`).
- Live Fusion observation: `desktop.window_state` + `desktop.read_a11y_tree` +
  `desktop.screenshot` to confirm the active design/component before recommending user action
  or delegating adapter buildout.

## Approval & evidence rules

- Model/CAM/parameter mutation, script/add-in execution, and export all require
  `approvals.request` (high risk in `model_or_bim_edit` / `export_plot` runbooks).
- Evidence: observe-before (window_state, a11y, screenshot), target component/body identity
  verified, verify-after (parameter/dimension evidence, screenshot, `desktop.file_stat`),
  compile receipts for local code-CAD lanes.
- Fail closed: ambiguous component/body selection, unknown units/tolerance, no app-native
  adapter for the requested mutation, missing approval.

## Gaps & buildout

- First executor candidates: (a) an installed Fusion add-in exposing scripted design edits
  (per-machine install is the cost), (b) a configured Autodesk Fusion MCP server,
  (c) the cloud Automation API — deferred: TypeScript-only + Flex-token billing.
- Until one exists, every existing-design mutation is `agent.build_app_capability` buildout
  by design; only observation, menu-backed reversible steps, and file-level work execute.

## Source refs

- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15: "Autodesk APS / Fusion Automation API — skip
  until demand; Fusion desktop API has no headless mode")
- `APP_AUTOMATION_RESEARCH_REFS.fusionApi` / `.autodeskMcpServers` / `.autodeskAssistant` /
  `.autodeskAutomationApi` in `src/lib/appAutomationControlSurfaces.ts` (official Autodesk URLs)
