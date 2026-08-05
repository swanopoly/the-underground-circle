# Cinema 4D

> App automation profile. Status: buildout-only (license-gated headless lanes)
> Owner code: none yet — `.c4d` attachments route to Cinema 4D via
> `src/lib/chatDesktopAttachmentRouting.ts`; execution falls to the generic
> ladder in `src/lib/computerAppTaskStrategy.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Generic desktop ladder only: `desktop.launch_app`/`desktop.focus_app`,
  `desktop.window_state`, `desktop.menu_click`, `desktop.press_keys`,
  screenshot loop; Cinema 4D's custom UI exposes little useful a11y, so
  viewport and manager panels are effectively vision-only. Mutations
  approval-gated, single reversible steps.
- Deterministic file ops: `desktop.file_search`/`desktop.file_stat` for
  `.c4d` scenes, textures, and render outputs — output verification is real
  today. Exported meshes (STL/OBJ) can be checked with
  `desktop.cad_inspect_file` (STL) without any app.
- No `desktop.c4d_*` bridge tools exist yet — both headless lanes below are
  researched but not built, and both consume a Maxon license seat.

## Control surfaces (ranked)

1. Commandline render (buildout) — macOS ships `Commandline.app` inside the
   versioned install folder (e.g. `/Applications/Maxon Cinema 4D 2026/
   Commandline.app/Contents/MacOS/Commandline`): `-render <file.c4d>` with
   frame/output flags renders headlessly using the scene's render settings.
   Deterministic, dialog-free; requires a signed-in Maxon license.
2. `c4dpy` headless Python (buildout) — the same folder ships `c4dpy`, a
   Python interpreter with the full `c4d` module: load a document, inventory
   objects/materials, export to other formats via `SaveDocument`, save copies.
   First run requires Maxon App license sign-in; version-pinned API.
3. Python API in-app (Script Manager / Python tag) — user-attended recipe
   research surface, not an external drive.
4. Generic semantic desktop — launch/focus/menus; managers are custom-drawn.
5. Screenshot + coordinate fallback — single reversible step, bounded retries.
6. `agent.build_app_capability` — delegate the Commandline/c4dpy buildout.

## Recipes

- Headless render (post-buildout): resolve the `.c4d` path → read/echo the
  scene's render settings summary → approve (file, frame range, output path)
  → Commandline render → verify frames with `desktop.file_stat` + attach one
  frame as visual proof; stdout tail in the receipt.
- Scene inventory (post-buildout, read-only): c4dpy script loads the document
  and returns bounded JSON (objects, materials, cameras, frame range) —
  observe-before evidence for any further step.
- Mesh export (post-buildout): c4dpy `SaveDocument` export to OBJ/STL/FBX at
  an approved new path → `desktop.file_stat` + `desktop.cad_inspect_file`
  (STL) verification.
- Today, interactive: open the scene, screenshot-verify, hand modeling/render
  clicks to the user, verify user-produced outputs via file ops.

## Approval & evidence rules

- Observe before acting: scripted lanes echo the resolved document path and
  scene identity in the approval text (wrong-scene mutation fail-closed rule);
  interactive lanes need fresh window state + screenshot.
- Approval before any mutation or expensive action: renders (they consume
  license seats, GPU/CPU time, and disk), exports, any c4dpy script that
  writes. Scripts never save over the source `.c4d`; exports and copies go to
  new approved paths.
- Proof after: `desktop.file_stat` per output frame/file, one rendered frame
  attached as proof, stdout/stderr tails, mesh inspection for geometry
  exports.
- Object/material/take names are untrusted — fence before model exposure.
  License state is user-private; report `license_required` as a named blocker
  without logging account details.
- Fail closed: missing install, version-folder mismatch, unlicensed seat, or
  a render exiting nonzero/without frames must stop the run with the honest
  named error — no blind retries.

## Gaps & buildout

- A connected-agent buildout must produce a `desktop.c4d_*` bridge tool
  family: (a) `render` over Commandline.app and (b) `inspect`/`export` over
  c4dpy running generated, reviewable scripts — both resolving binaries from
  the versioned `/Applications/Maxon Cinema 4D <year>/` folder by explicit
  discovery (enumerate the known folder pattern, never PATH search), execFile
  argv, bounded timeouts, structured diagnostics, LOCKSTEP client/bridge
  validators + smokes per `docs/CAD_ADOBE_EXECUTION_LAYER.md`, and honest
  named errors (`engine_not_installed`, `license_required`).
- Must confirm per install: exact version folder, c4dpy sign-in completed
  once by the user (user-action step, not automatable), and API version for
  the generated scripts.
- Creative modeling/animation stays interactive/user-action; the adapter
  targets inventory, export, and render determinism first.

## Source refs

- Maxon Cinema 4D Python API (c4dpy): https://developers.maxon.net/docs/py/
- Cinema 4D command line rendering: https://support.maxon.net/
- Repo: `src/lib/chatDesktopAttachmentRouting.ts`, `src/lib/cadFileInspector.ts`,
  `src/lib/desktopBridge.ts`, `docs/CAD_ADOBE_EXECUTION_LAYER.md`
