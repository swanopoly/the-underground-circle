# KiCad

> App automation profile. Status: buildout-only
> Owner code: none yet. Last reviewed: 2026-07-06.

## What chat can do today

- Router honesty: `appAutomationControlSurfaces.ts` does not detect "kicad" — KiCad tasks
  land in the generic native-app family, not the engineering/CAD family, so no CAD runbooks
  or CAD-specific candidates fire. Live work is the generic ladder only:
  `desktop.launch_app`/`desktop.focus_app`, `desktop.window_state`, `desktop.read_a11y_tree`,
  `desktop.menu_click`, `desktop.screenshot`, with `approvals.request` before anything
  mutating and `desktop.file_stat` proof for outputs.
- File-level lanes that do execute: `desktop.cad_inspect_file` reads a KiCad-exported STEP
  (schema/products) or DXF (layers/entities/units). Gerber/drill files are plain text —
  `desktop.file_read` can excerpt them — but no structural parser exists (honest).
  Native `.kicad_pcb`/`.kicad_sch` are s-expression text; readable, not parsed.
- `desktop.cad_compile` has no KiCad engine today.

## Control surfaces (ranked)

1. `kicad-cli` — genuinely headless since KiCad 7, expanded in 8/9: `pcb export
   gerbers|drill|step|dxf|pdf|svg|pos`, `pcb drc --exit-code-violations`, `sch erc`,
   `sch export pdf|svg|netlist|bom`, and KiCad 9 jobsets (`jobset run`) for bundled
   fab-output pipelines. This is the strong future executor — same shape as the OpenSCAD/
   FreeCAD engines (fixed binary path inside KiCad.app, strict arg allowlist, receipts) —
   **buildout-only today**.
2. Python surfaces — `pcbnew` scripting and the KiCad 9 IPC API (attachable headless via the
   newer `api-server` mode) for edits beyond exports; buildout target behind the CLI.
3. Generic ladder (`os_accessibility`-grade a11y reads, `semantic_desktop` menus,
   `screenshot_coordinate_fallback` last resort) — the only live-app surface now.
4. `agent.build_app_capability` — the path that turns 1–2 into bound tools.

## Recipes

- Verify fab outputs someone exported: `desktop.file_stat` each gerber/drill file →
  `desktop.file_read` header excerpts → `desktop.cad_inspect_file` on the STEP/DXF where
  present → report counts and basenames; no pretend DRC verdicts.
- Board 3D handoff: user (or future CLI executor) exports STEP → `desktop.cad_inspect_file`
  → optional `desktop.cad_compile` engine `freecadcmd` conversion to STL →
  `desktop.file_stat` proof.
- GUI-session step (open a board, run DRC visually): ladder observation → `approvals.request`
  → `desktop.menu_click` the named menu item → screenshot + a11y recheck; stop and report if
  dialogs are ambiguous.

## Approval & evidence rules

- Anything that writes fab outputs, modifies a board/schematic, or runs a script needs
  `approvals.request` first; read-only file inspection does not.
- Evidence: source project files staged and cited, output folder approved, per-file
  `desktop.file_stat`, DRC/ERC report files (not screenshots of dialogs) once the CLI
  executor exists; screenshots for GUI-session steps.
- Fail closed: project file missing, output folder unapproved, ambiguous layer/board state,
  no executor for the requested batch operation (say "buildout needed", do not click-storm).

## Gaps & buildout

- The `kicad-cli` engine for `desktop.cad_compile` (or a sibling tool) is the highest-value
  buildout in this family: exports + DRC/ERC with `--exit-code-violations` map perfectly onto
  the compile-receipt evidence shape (exit code + output file_stat + report artifact).
  Follow the P15 extension rules: fixed `CAD_ENGINE_BINARIES` path, LOCKSTEP bridge
  validators, smoke coverage.
- Router detection ("kicad", `.kicad_pcb`, gerber keywords → engineering family + a ranked
  candidate) should land with that executor.

## Source refs

- KiCad CLI official docs (9.0): https://docs.kicad.org/9.0/en/cli/cli.html
- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15 extension rules for new CAD engines)
- `src/lib/cadCodeExecutor.ts` (the engine pattern a KiCad executor must follow)
