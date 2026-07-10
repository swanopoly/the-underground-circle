# Rhino (Rhinoceros 3D)

> App automation profile. Status: partial
> Owner code: `src/lib/appAutomationControlSurfaces.ts` (`rhino_common_api` candidate), `src/lib/engineeringCadOperationRunbooks.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Rhino 8 runs natively on this Mac, and its command line is a real semantic surface: after
  observing with `desktop.window_state` + `desktop.read_a11y_tree` + `desktop.screenshot`,
  chat can type native commands (with explicit coordinates, object/layer names) via
  `desktop.type_text` — the runbooks' act route for `inspect_measure`, `draft_2d_geometry`,
  `update_dimensions_layers`, and `export_plot`. One approved step, screenshot-verified.
- Exported geometry is workable without Rhino: `desktop.cad_inspect_file` reads STL
  (triangles/bbox) and STEP (schema/products); DXF exports read too. Native `.3dm` is
  honestly unreadable locally. `desktop.cad_compile` engine `freecadcmd` converts STEP/IGES
  exports; engine `blender` (headless bpy mesh convert + PNG render) covers exported
  OBJ/STL proof — shipping now (P16).
- New-part-from-description routes to `desktop.cad_compile` engine `openscad`
  (STL + PNG proof) rather than freehand modeling in Rhino.

## Control surfaces (ranked)

1. `rhino_common_api` (primary, 100) — RhinoCommon / `rhinoscriptsyntax`. Rhino 8 ships a
   cross-platform ScriptEditor (Python 3 CPython + C#) on Mac; scripts run inside the app.
   External drive is limited: the `rhinocode` CLI (Rhino ≥8.11, at
   `/Applications/Rhino 8.app/Contents/Resources/bin`) can run scripts in a RUNNING Rhino
   after `StartScriptServer` — a near-term executor buildout, not wired today. True headless
   (Rhino.Compute / Rhino.Inside) is Windows/Linux only — not available on this Mac.
2. `vendor_script_or_plugin_api` (72) — documented command/macro recipes and plugin surfaces.
3. `os_accessibility` (52) → `semantic_desktop` (42) — menus, dialogs, export panels.
4. `screenshot_coordinate_fallback` (10) — last resort; `connected_agent_buildout` (35) for
   the rhinocode adapter.

## Recipes

- Measure/audit a model: observe → typed read-only commands (list/measure/layer state) via
  `desktop.type_text` → cite units (verify model units first — the candidate's required
  evidence) → screenshot proof. For exported STL/STEP, prefer `desktop.cad_inspect_file`.
- Geometry or layer edit: `approvals.request` → one precise typed command (never freehand
  canvas clicks) → verify command feedback + screenshot + object/layer recheck.
- Export: approval with format/path → typed export command or verified dialog →
  `desktop.file_stat` proof.
- Script-sized work (batch renames, layer sweeps): today that is a user-run ScriptEditor
  script chat drafts, or `agent.build_app_capability` to wire the `rhinocode` CLI runner;
  do not paste multi-line scripts blind through `desktop.type_text`.

## Approval & evidence rules

- Geometry mutation, script/command execution that changes state, and export/write need
  `approvals.request` (review/high risk per runbook).
- Evidence: active model + units verified before act; target objects/layers named or
  selected with proof; verify-after command transcript, screenshot, `desktop.file_stat` for
  outputs.
- Fail closed: model units unknown, object/selection identity unverifiable, command produced
  unexpected geometry, missing approval.

## Gaps & buildout

- `rhinocode` CLI executor (script server + fixed binary path + arg allowlist, per P15
  extension rules) is the highest-value buildout: it upgrades Rhino from typed-command
  partial to script-grade executable on Mac.
- `.3dm` structural inspection is unsupported locally — request STEP/STL/DXF exports.
- Headless/batch Rhino on Mac does not exist (Compute is Windows/Linux) — say so instead of
  queueing fake batch jobs.

## Source refs

- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15 verdicts, extension rules)
- `APP_AUTOMATION_RESEARCH_REFS.rhinoCommon` in `src/lib/appAutomationControlSurfaces.ts`
- RhinoCode CLI guide: https://developer.rhino3d.com/guides/scripting/advanced-cli/
- Rhino.Compute FAQ (Windows-only headless): https://developer.rhino3d.com/guides/compute/compute-faq/
