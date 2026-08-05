# GIMP

> App automation profile. Status: buildout-only (strong executor candidate)
> Owner code: none yet — launch entry in `src/lib/knownAppShortcuts.ts`;
> execution falls to the generic ladder in
> `src/lib/computerAppTaskStrategy.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Generic desktop ladder only: `desktop.launch_app`/`desktop.focus_app`,
  `desktop.window_state`, `desktop.read_a11y_tree` (GTK a11y quality varies by
  build — verify panels actually expose rows before relying on them),
  `desktop.menu_click`, `desktop.press_keys`, screenshot loop for canvas
  state; mutations approval-gated.
- Deterministic file ops: `desktop.file_search`/`desktop.file_stat` for `.xcf`
  sources and outputs; `desktop.convert_image` for plain format conversion
  without launching GIMP at all.
- No `desktop.gimp_*` bridge tools exist yet — the headless batch lane below
  is researched but not built.

## Control surfaces (ranked)

1. Headless batch CLI (buildout; the headline lane) — GIMP runs real scripts
   without a GUI: `gimp -i -b '<script>' -b '(gimp-quit 0)'` (and the console
   binary variant in the app bundle). Script-Fu (TinyScheme) is the stable
   batch language; GIMP 3.0 (March 2025) adds a first-class Python 3 API via
   GObject Introspection for plug-in/script work. Deterministic
   open → operate → export pipelines (resize, crop, color ops, format export)
   with zero dialogs. Same executor class as OpenSCAD/FreeCAD in
   `desktop.cad_compile`: fixed binary path inside the installed app bundle,
   execFile argv, generated script file as the unit of review.
2. Script-Fu/Python-Fu console (in-app) — useful for user-attended recipe
   research; not an external drive.
3. Generic semantic desktop — menus and dialogs; canvas painting/selection
   stays vision-assisted.
4. Screenshot + coordinate fallback — single reversible step, bounded retries.
5. `agent.build_app_capability` — delegate the batch-adapter buildout.

## Recipes

- Batch resize/convert (post-buildout, headless): resolve source paths →
  approve the write plan (inputs, operations, output folder) → run the
  generated batch script → verify each output with `desktop.file_stat` +
  one preview screenshot; stdout/stderr tails in the receipt.
- Flatten + export `.xcf` to PNG (post-buildout): same shape — load, flatten,
  export to a NEW file (never overwrite the `.xcf` source), verify.
- Plain conversion (today, app-free): `desktop.convert_image` on the source,
  `desktop.file_stat` proof — prefer this when no GIMP-specific op is needed.
- Interactive edit (today): menu-driven single steps via a11y with screenshot
  verification; stop after two failed attempts.

## Approval & evidence rules

- Observe before acting (interactive lanes): `desktop.window_state` + fresh
  a11y read + screenshot; batch lanes instead show the full generated script
  and file plan for approval before execution.
- Approval before any mutation: every batch run (it writes files), every
  in-app edit, every export. Source files are read-only inputs — batch
  scripts must write outputs to new paths, never in-place.
- Proof after: `desktop.file_stat` per output, stdout/stderr tails, preview
  screenshot of one representative output.
- File names and any text rendered from images are untrusted — fence before
  model exposure.
- Fail closed: script errors, missing outputs, or a missing GIMP install must
  surface honestly (install hint: `brew install --cask gimp`), never retried
  blind.

## Gaps & buildout

- A connected-agent buildout must produce a `desktop.gimp_batch` (or
  `desktop.gimp_*`) bridge tool following the `desktop.cad_compile` contract:
  fixed binary path resolution inside `/Applications/GIMP.app` only (never
  PATH search), execFile argv with `-i` non-interactive mode, the generated
  Script-Fu/Python script staged as a reviewable source file, a strict
  operation allowlist to start (scale, crop, flatten, mode/format export),
  bounded timeouts, structured diagnostics (exit code, stderr tail, output
  file existence), and an honest `engine_not_installed` error + brew hint.
  LOCKSTEP validators in `src/lib` and `scripts/claude-bridge.js`, with smoke
  byte-identity checks, per the extension rules in
  `docs/CAD_ADOBE_EXECUTION_LAYER.md`.
- GIMP 3.0's Python API should be the second wave (richer ops, saner strings)
  once the Script-Fu lane proves out; confirm the installed major version at
  runtime and fail closed on 2.x/3.x script mismatches.
- Interactive canvas work (brushes, selections, healing) has no headless
  expression — it stays on the generic ladder or moves to user-action.

## Source refs

- GIMP batch mode: https://www.gimp.org/tutorials/Basic_Batch/
- GIMP Script-Fu reference: https://developer.gimp.org/api/script-fu/
- GIMP 3.0 release (Python/GObject API): https://www.gimp.org/news/
- Repo: `src/lib/cadCodeExecutor.ts` (fixed-path headless CLI precedent),
  `src/lib/desktopBridge.ts`, `docs/CAD_ADOBE_EXECUTION_LAYER.md`
