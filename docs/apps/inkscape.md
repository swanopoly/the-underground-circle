# Inkscape

> App automation profile. Status: partial (real headless export lane ships;
> interactive editing still ladder)
> Owner code: `src/lib/designCliExecutor.ts` + `designExport` in
> `src/lib/desktopBridge.ts` + `/desktop/design_export` in
> `scripts/claude-bridge.js`; launch entry in `src/lib/knownAppShortcuts.ts`;
> interactive work falls to the generic ladder in
> `src/lib/computerAppTaskStrategy.ts`. Last reviewed: 2026-07-07.

## What chat can do today

- Headless export lane (real): `desktop.design_export` with engine
  `inkscape` renders an `.svg` source to `.png`, `.pdf`, or `.eps` —
  fixed binary path only (app bundle / homebrew / /usr/local candidates),
  execFile argv, no shell, write-grant gated, bounded diagnostics. Options
  are a strict allowlist: `widthPx`/`heightPx` (integers 16..16384, PNG
  raster sizing) and `pdfVersion` (1.4–1.7, .pdf outputs only). Missing app
  fails honestly as `engine_not_installed` with the brew hint. Plan/validate
  with `buildDesignExportPlan` in `src/lib/designCliExecutor.ts`.
- Generic desktop ladder for interactive work: `desktop.launch_app`/
  `desktop.focus_app`, `desktop.window_state`, `desktop.read_a11y_tree`
  (GTK — verify element exposure per build), `desktop.menu_click`,
  `desktop.press_keys`, screenshot loop; mutations approval-gated.
- Deterministic file ops: SVG sources are plain XML, so `desktop.file_read`
  gives real structural evidence (fenced as untrusted) and
  `desktop.file_stat`/`desktop.file_search` locate sources/outputs — the best
  observe-before evidence of any app in this family.
- Honest gaps: no `--export-id` single-object lane, no read-only `--query-*`
  lane, no `--actions` verb chains yet (see Gaps & buildout); canvas/node
  editing stays on the generic ladder.

## Control surfaces (ranked)

1. Headless CLI (shipped subset via `desktop.design_export`) — Inkscape 1.x
   is truly headless for conversion/export: the shipped lane runs
   `inkscape --export-filename <out> [--export-width/--export-height]
   [--export-pdf-version] <in.svg>`. The wider researched surface —
   `--export-dpi`, `--export-id=<node>` for single-object export,
   `--export-area-page|drawing`, `--export-text-to-path`, `--actions="…"`
   chains (e.g. `select-all;object-to-path;export-do`), read-only
   `--query-*` — remains buildout. No GUI, no dialogs — the same executor
   class as OpenSCAD in `desktop.cad_compile` (fixed binary path
   `/Applications/Inkscape.app/Contents/MacOS/inkscape`, execFile argv,
   strict flag allowlist).
2. Generic semantic desktop — menus/dialogs for interactive work; canvas node
   editing stays vision-assisted.
3. Screenshot + coordinate fallback — single reversible step, bounded retries.
4. `agent.build_app_capability` — delegate the CLI adapter buildout.

## Recipes

- SVG → PNG/PDF/EPS render (shipped, headless): resolve the source
  (`desktop.file_stat`, optional `desktop.file_read` structure check) →
  approve the write (source, format, width/height, output path) →
  `desktop.design_export` engine `inkscape` → verify `output.exists`/bytes
  from the response plus `desktop.file_stat` + preview screenshot.
- Export one object/layer by id (post-buildout): read the SVG to confirm the
  node id exists → approve → `--export-id` lane → verify output.
- Geometry query (post-buildout, read-only): `--query-width/height/x/y` for a
  node id — auto-approvable read lane, mirrors `desktop.cad_inspect_file`.
- Interactive path edit (today): a11y/menu single steps with screenshot
  verification; prefer editing the SVG XML via approved `desktop.file_write_text`
  to a NEW file when the change is expressible as markup.

## Approval & evidence rules

- Batch lanes: show the exact CLI plan (source, flags, output path) for
  approval before execution; outputs go to new paths, never overwrite the
  source SVG in place.
- Interactive lanes: fresh `desktop.window_state` + a11y read + screenshot
  before mutation; a11y before/after diff for panel state.
- Proof after: `desktop.file_stat` per output, CLI stdout/stderr tails in the
  receipt, preview screenshot for visual claims.
- SVG content (ids, labels, embedded text) is untrusted — fence before model
  exposure; SVGs can embed scripts/links, so never open exported SVG in a
  browser as "verification" without flagging it as untrusted content.
- Fail closed: nonzero exit, missing output file, or missing install surface
  honestly (install hint: `brew install --cask inkscape`).

## Gaps & buildout

- Shipped: `desktop.design_export` engine `inkscape` covers whole-document
  SVG → PNG/PDF/EPS on the `desktop.cad_compile` contract (fixed binary
  path, execFile argv, strict option allowlist, bounded timeouts, structured
  diagnostics, honest `engine_not_installed` + brew hint; LOCKSTEP
  validation in `src/lib/designCliExecutor.ts`, `src/lib/desktopBridge.ts`,
  and `scripts/claude-bridge.js` with smoke coverage in
  `scripts/design-cli-executor-smoketest.ts`).
- Remaining buildout extends that same lane (never a new one-off): dpi
  control, `--export-id` single-object export, `--export-area-page|drawing`,
  `--export-text-to-path`, read-only `--query-*` geometry, and a
  separately-gated `--actions` lane (verbs mutate documents — keep the verb
  allowlist tiny and reviewed), per `docs/CAD_ADOBE_EXECUTION_LAYER.md`
  extension rules.
- This adapter is the house SVG rasterizer: other app profiles (Affinity,
  Figma exports) can route SVG → PNG/PDF through it instead of driving GUIs.
- Freehand drawing and node-level canvas edits stay on the generic ladder or
  become approved XML edits to copies of the file.

## Source refs

- Inkscape command line: https://inkscape.org/doc/inkscape-man.html
- Inkscape 1.x CLI/actions wiki: https://wiki.inkscape.org/wiki/Using_the_Command_Line
- Repo: `src/lib/designCliExecutor.ts` (this lane's pure planner/validators),
  `src/lib/desktopBridge.ts` (`designExport`), `scripts/claude-bridge.js`
  (`/desktop/design_export`), `src/lib/cadCodeExecutor.ts` (pattern
  precedent), `docs/CAD_ADOBE_EXECUTION_LAYER.md`
