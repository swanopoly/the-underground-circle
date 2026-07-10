# Blender

> App automation profile. Status: executable (P16, headless bpy lanes; generic
> ladder for interactive scene work)
> Owner code: `src/lib/cadCodeExecutor.ts` + `scripts/claude-bridge.js`
> (`desktop.cad_compile` — engine `blender`, P16 wave in flight); launch entry
> in `src/lib/knownAppShortcuts.ts`; `.blend` routing in
> `src/lib/chatDesktopAttachmentRouting.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Executable (P16 wave in flight): engine `blender` is being added to
  `desktop.cad_compile` — headless `Blender --background --python <script.py>`
  bpy scripts covering (a) mesh import/export conversion (e.g. OBJ/STL/FBX/
  glTF/PLY between formats) and (b) PNG viewport/render proof images. Same
  contract as the OpenSCAD/FreeCAD engines: fixed install-path binary
  resolution only, execFile argv (no shell), generated script staged as a
  reviewable file, structured diagnostics, honest `engine_not_installed` +
  brew install hint. Restart the bridge (`npm run bridge`) after the wave
  lands before expecting the tools live.
- Already real today for outputs: `desktop.cad_inspect_file` reads exported
  STL structurally (triangle count + bbox) with no app — use it to verify
  conversion results.
- Interactive scene work (modeling, shading, animation in the GUI) stays on
  the generic ladder: `desktop.launch_app`/`desktop.focus_app`,
  `desktop.window_state`, `desktop.menu_click`, `desktop.press_keys`,
  screenshot loop — Blender's custom OpenGL UI exposes almost no a11y tree,
  so GUI mutation is vision-only and last resort.
- `.blend` attachments already route to Blender in chat.

## Control surfaces (ranked)

1. `desktop.cad_compile` engine `blender` (executable, P16) — headless bpy for
   mesh conversion + render/viewport PNG proof; deterministic, dialog-free.
2. bpy script expansion within the same engine (buildout increments) — scene
   inventory dumps, decimate/cleanup, camera setup for turntable proofs; each
   new lane extends the generated-script allowlist, not raw user Python.
3. Generic semantic desktop on the GUI — launch/focus/menus only; the
   viewport has no semantic surface.
4. Screenshot + coordinate fallback — single reversible GUI step, bounded
   retries; avoid for anything expressible as a bpy lane.
5. `agent.build_app_capability` — delegate new bpy lanes or version fixes.

## Recipes

- Mesh format conversion (P16): resolve source path → approve the write plan
  (source, target format, output path) → `desktop.cad_compile` engine
  `blender` → verify with `desktop.file_stat` + `desktop.cad_inspect_file`
  (STL) and report triangle count/bbox.
- Render proof of a model (P16): same lane with a PNG output — import mesh,
  frame it, render viewport/eevee still → `desktop.file_stat` + attach the
  PNG as visual proof.
- New part from description: prefer the OpenSCAD lane in
  `desktop.cad_compile` for parametric parts (see
  `docs/CAD_ADOBE_EXECUTION_LAYER.md`); use Blender lanes when the ask is
  mesh/visual, not engineering CAD.
- Interactive scene edit (today): treat as user-attended — stage the file,
  open it, screenshot state, and hand modeling steps to the user or a
  buildout.

## Approval & evidence rules

- Headless lanes: show the generated bpy script's plan (inputs, operations,
  outputs) in the approval; source files are read-only inputs — outputs go to
  new paths, never overwrite the `.blend`/source mesh.
- Write grants: compile lanes run behind the same local-file write-grant +
  approval path as other `desktop.cad_compile` engines.
- Proof after: `desktop.file_stat` on every output, stdout/stderr tails from
  the compile receipt, `desktop.cad_inspect_file` for meshes, PNG proof for
  visual claims.
- Object/material/scene names inside files are untrusted — fence before model
  exposure. bpy scripts must never call save over the source document.
- Fail closed: nonzero exit, missing output, version-mismatched bpy API, or
  missing install (`brew install --cask blender`) surface as named errors.

## Gaps & buildout

- In flight (P16): land engine `blender` in `CAD_ENGINE_BINARIES` +
  the engine enum in `src/lib/cadCodeExecutor.ts` LOCKSTEP with
  `scripts/claude-bridge.js`, smoke-covered per the extension rules in
  `docs/CAD_ADOBE_EXECUTION_LAYER.md` (never PATH search, never
  user-supplied binaries).
- Post-P16 buildout increments (each a contract extension, not a new tool
  family): scene-inventory read lane (objects, meshes, materials → bounded
  JSON), mesh cleanup/decimate lane, camera/turntable multi-angle proof lane.
- Interactive modeling/animation has no headless expression — it stays GUI/
  user-action; do not attempt viewport coordinate editing beyond single
  reversible steps.

## Source refs

- Blender command line: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html
- bpy Python API: https://docs.blender.org/api/current/
- Repo: `src/lib/cadCodeExecutor.ts`, `src/lib/cadFileInspector.ts`,
  `src/lib/desktopBridge.ts` (`compileCadCode`),
  `docs/CAD_ADOBE_EXECUTION_LAYER.md`
