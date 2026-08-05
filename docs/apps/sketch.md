# Sketch

> App automation profile. Status: partial (real headless preview-export lane
> ships; artboard batch export + editing still buildout/ladder)
> Owner code: `src/lib/designCliExecutor.ts`, `designExport` in
> `src/lib/desktopBridge.ts`, `/desktop/design_export` in
> `scripts/claude-bridge.js`; `.sketch` attachments route via
> `src/lib/chatDesktopAttachmentRouting.ts`; interactive work falls to the
> ladder in `src/lib/computerAppTaskStrategy.ts`. Last reviewed: 2026-07-07.

## What chat can do today

- Headless preview export (real): `desktop.design_export` with engine
  `sketchtool` exports a `.sketch` document's PREVIEW image to `.png` via
  `sketchtool export preview` — fixed binary paths inside the Sketch app
  bundle only, execFile argv, no shell, write-grant gated, bounded
  diagnostics. Options allowlist: `format` ('png' only), `scale` (1|2|3 →
  `--max-size` 2048×scale; preview has no `--scales` multiplier). sketchtool
  names its own `preview.png` in the output folder; the bridge renames the
  fresh preview onto the requested outputPath and verifies it. v1 is ONE
  document-preview image — artboard/layer batch export is a follow-up lane.
  Missing app fails honestly as `engine_not_installed` pointing at sketch.com.
- Generic desktop ladder for interactive work: `desktop.launch_app`/
  `desktop.focus_app`, `desktop.window_state`, `desktop.read_a11y_tree`
  (Sketch is native AppKit, so inspector panels, layer list, and menus read
  well), `desktop.menu_click`, `desktop.click_element`/
  `desktop.set_element_value`, `desktop.press_keys`, screenshot loop for
  canvas state — mutations approval-gated.
- Deterministic file ops: `desktop.file_search`/`desktop.file_stat` to locate
  `.sketch` documents; the file itself is a ZIP of JSON, but no local parser
  tool exists yet — do not hand-unzip in ad-hoc steps.
- `desktop.run_applescript` can drive Sketch's scripting hooks today for
  small researched steps (approval-gated) — confirm the command exists in the
  dictionary via Script Editor research before use; the dictionary is small.
- Honest gaps: no `export artboards|layers|slices`, `list`, `dump`, or
  `metadata` lanes yet; document mutation stays on the ladder/plugin path.

## Control surfaces (ranked)

1. `sketchtool` CLI (shipped subset via `desktop.design_export`; the headline
   lane) — bundled at `Sketch.app/Contents/MacOS/sketchtool`; the shipped
   lane is headless `export preview`. The wider surface — `export artboards|
   layers|slices`, `list pages|artboards`, `dump` (document JSON),
   `metadata` — remains buildout. Reads and exports never open the GUI: this
   is the same fixed-binary-path headless CLI class as OpenSCAD/FreeCAD in
   `desktop.cad_compile`.
2. AppleScript / Apple Events (partial today) — Sketch is scriptable for a
   small command set; usable now via `desktop.run_applescript` after
   dictionary confirmation; needs the one-time TCC Automation grant.
3. Plugin API (JS, in-app; buildout) — full document mutation surface;
   `sketchtool run` can invoke plugin commands but launches the app, so treat
   it as app-attended, not headless.
4. Generic semantic desktop — native a11y is good for panels/menus/inspectors;
   canvas mutation stays vision-assisted.
5. Screenshot + coordinate fallback — single reversible step, bounded retries.
6. `agent.build_app_capability` — delegate the sketchtool adapter buildout.

## Recipes

- Document preview to PNG (shipped, headless): resolve the `.sketch` path
  (`desktop.file_stat`) → approve the export write (source, output path,
  scale) → `desktop.design_export` engine `sketchtool` → verify
  `output.exists`/bytes from the response plus `desktop.file_stat`; the
  preview is the last-edited page's snapshot, so say so in the proof.
- Export artboards to PNG (post-buildout, headless): resolve the `.sketch`
  path (`desktop.file_stat`) → approve the export write → run the sketchtool
  export lane with explicit `--output` folder + formats → verify each output
  with `desktop.file_stat` and attach one preview screenshot.
- Document inventory (post-buildout, read-only): sketchtool `list artboards` /
  `dump` subset → bounded JSON summary (pages, artboard names/sizes) with
  names fenced as untrusted.
- Rename a layer (today, interactive): focus Sketch → find the layer row in
  the a11y tree → approve → `desktop.set_element_value` on the name field →
  verify via a11y re-read (`Δ since last read`) + screenshot.

## Approval & evidence rules

- Observe before acting: `desktop.window_state` + fresh `desktop.read_a11y_tree`
  (before/after diff via `src/lib/a11yTreeDiff.ts`) + `desktop.screenshot` for
  canvas claims.
- Approval before any mutation: document edits, plugin/AppleScript execution,
  and every export/write (exports write files — same write-grant + approval
  path as other local file writes; never bundle save into an edit step).
- Proof after: output `desktop.file_stat` per exported file, screenshot of the
  changed canvas/panel, sketchtool stdout tail in the receipt.
- Layer/artboard/page names and document text are untrusted — fence before
  model exposure. Never emit save/close/quit from scripts (house JSX rule
  applies to AppleScript here too).

## Gaps & buildout

- Shipped: `desktop.design_export` engine `sketchtool` covers the document
  preview → PNG lane on the `desktop.cad_compile` contract (fixed app-bundle
  binary paths, execFile argv, strict option allowlist, bounded timeouts,
  structured diagnostics, honest `engine_not_installed`; LOCKSTEP validation
  in `src/lib/designCliExecutor.ts`, `src/lib/desktopBridge.ts`, and
  `scripts/claude-bridge.js` with smoke coverage in
  `scripts/design-cli-executor-smoketest.ts`).
- Remaining buildout extends that same lane (never a new one-off): the
  artboard-set export follow-up (`export artboards|layers|slices` with
  `--formats`/`--scales`/`--items`), plus read lanes (`list`, `metadata`,
  bounded `dump`) at read-only approval while export lanes stay behind write
  grants — a strict flag allowlist per subcommand.
- A second lane may wrap researched AppleScript recipes (open document, run
  export) as deterministic bridge endpoints once the dictionary coverage is
  confirmed per Sketch version.
- Full document mutation (insert/restyle layers) needs the JS Plugin API —
  a productized plugin plus `sketchtool run` invocation contract; defer until
  read/export lanes prove out.

## Source refs

- sketchtool CLI: https://developer.sketch.com/cli/
- Sketch plugin/scripting docs: https://developer.sketch.com/
- Apple automation scripting guide:
  https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/
- Repo: `src/lib/designCliExecutor.ts` (this lane's pure planner/validators),
  `src/lib/desktopBridge.ts` (`designExport`), `scripts/claude-bridge.js`
  (`/desktop/design_export`), `src/lib/cadCodeExecutor.ts` (pattern
  precedent), `docs/CAD_ADOBE_EXECUTION_LAYER.md`
