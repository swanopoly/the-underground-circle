# Autodesk Maya

> App automation profile. Status: buildout-only (license-gated headless lanes)
> Owner code: none yet — `.ma`/`.mb` attachments route to Autodesk Maya via
> `src/lib/chatDesktopAttachmentRouting.ts`; execution falls to the generic
> ladder in `src/lib/computerAppTaskStrategy.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Generic desktop ladder only: `desktop.launch_app`/`desktop.focus_app`,
  `desktop.window_state`, `desktop.menu_click`, `desktop.press_keys`,
  screenshot loop; Maya's Qt UI exposes partial a11y (menus/outliner rows may
  read; the viewport does not) — verify per panel. Mutations approval-gated,
  single reversible steps.
- Deterministic file ops: `desktop.file_search`/`desktop.file_stat` for
  scenes (`.ma`/`.mb`), textures, and render outputs; `.ma` is ASCII, so a
  bounded `desktop.file_read` (fenced) gives coarse structural evidence.
  Exported STL meshes verify via `desktop.cad_inspect_file` with no app.
- No `desktop.maya_*` bridge tools exist yet — the headless lanes below are
  researched but not built; all of them require an Autodesk license.

## Control surfaces (ranked)

1. `mayapy` + `maya.standalone` (buildout; the headline lane) — the bundled
   interpreter at `/Applications/Autodesk/maya<version>/Maya.app/Contents/
   bin/mayapy` runs full `maya.cmds` without the GUI: open a scene, inventory
   nodes, export (OBJ/FBX/Alembic/STL via plugins), save copies. Fully
   headless and deterministic; generated script is the unit of review.
2. `Render` CLI batch render (buildout) — same `bin/` folder ships the Render
   command (`Render -r <renderer> -s <start> -e <end> <scene>`): headless
   batch renders using scene settings. Caveat: Arnold batch/command-line
   rendering requires an Arnold license — without it output is watermarked;
   report that honestly instead of shipping watermarked frames as proof.
3. `maya -batch -command` MEL lane — legacy batch execution; prefer mayapy.
4. Generic semantic desktop — launch/focus/menus/outliner where a11y allows.
5. Screenshot + coordinate fallback — single reversible step, bounded retries.
6. `agent.build_app_capability` — delegate the mayapy/Render buildout.

## Recipes

- Scene inventory (post-buildout, read-only): mayapy script opens the scene
  (`cmds.file(open)`) and returns bounded JSON (node counts, cameras, frame
  range, renderer) — observe-before evidence, auto-approvable read lane.
- Mesh export (post-buildout): mayapy export of selected/all geometry to an
  approved NEW path → `desktop.file_stat` + `desktop.cad_inspect_file` (STL)
  or importer-side check (OBJ/FBX) → report counts/bbox.
- Batch render (post-buildout): echo scene + renderer + frame range + output
  dir in the approval → `Render` CLI → verify frames with `desktop.file_stat`
  + attach one frame as proof; renderer log tail in the receipt.
- Today, interactive: open the scene, screenshot-verify state, hand modeling
  and render clicks to the user, verify outputs via file ops.

## Approval & evidence rules

- Observe before acting: scripted lanes echo the resolved scene path and
  scene identity in the approval text (wrong-scene fail-closed rule, as in
  the Photoshop adapters); interactive lanes need fresh window state +
  screenshot.
- Approval before any mutation/expensive action: scene opens that trigger
  reference/plugin loads, exports, renders (license seats + hours of
  compute + disk), and any script that writes. Scripts never save over the
  source scene; exports/copies go to new approved paths.
- Proof after: `desktop.file_stat` per output, one frame or mesh-inspection
  result attached, stdout/renderer-log tails in receipts.
- Node/material/reference names and `.ma` file text are untrusted — fence
  before model exposure. Scene files can carry scriptJobs/scriptNodes:
  opening untrusted scenes executes code risk — open unknown-origin scenes
  only with script-node evaluation disabled in the generated mayapy lane,
  and say so in the approval.
- Fail closed: missing install/version folder, unlicensed Maya or Arnold,
  plugin-load failures, or renders exiting nonzero/frameless stop the run
  with named errors (`engine_not_installed`, `license_required`).

## Gaps & buildout

- A connected-agent buildout must produce a `desktop.maya_*` bridge tool
  family: `inspect`/`export` over mayapy running generated, reviewable
  scripts with `maya.standalone.initialize()`, and `render` over the Render
  CLI — binaries resolved from the versioned
  `/Applications/Autodesk/maya<version>/` folder by explicit enumeration
  (never PATH search), execFile argv, strict per-lane flag allowlists,
  bounded timeouts, structured diagnostics, LOCKSTEP client/bridge validators
  + smokes per `docs/CAD_ADOBE_EXECUTION_LAYER.md`, honest named errors for
  missing install/license, and script-node-safe scene opening as the default.
- Creative modeling/rigging/animation stays interactive/user-action; the
  adapter targets inventory, export, and render determinism first.

## Source refs

- Maya scripting (Python/mayapy): https://help.autodesk.com/view/MAYAUL/2026/ENU/?guid=GUID-C0F27A50-3DD6-454C-A4D1-9E3C44B3C990
- Maya command line rendering: https://help.autodesk.com/view/MAYAUL/2026/ENU/
- Repo: `src/lib/chatDesktopAttachmentRouting.ts`, `src/lib/cadFileInspector.ts`,
  `src/lib/desktopBridge.ts`, `docs/CAD_ADOBE_EXECUTION_LAYER.md`
