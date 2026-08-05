# MATLAB / Simulink

> App automation profile. Status: partial
> Owner code: `src/lib/appAutomationControlSurfaces.ts` (`matlab_mcp_agentic_toolkit` candidate), `src/lib/engineeringCadOperationRunbooks.ts` (`matlab_compute_simulation`, `matlab_code_test_review`). Last reviewed: 2026-07-06.

## What chat can do today

- Two dedicated MATLAB runbooks fire on matlab/simulink/mlx/slx tasks with MATLAB-specific
  observe steps (project/folder via `desktop.file_stat`, session/window via
  `desktop.window_state`, editor/command-window state via `desktop.read_a11y_tree`,
  figure/model proof via `desktop.screenshot`).
- IF the user has a MATLAB MCP server configured, the runbooks bind its tools directly:
  `MATLAB MCP detect_matlab_toolboxes` (constrain generated code to installed products),
  `MATLAB MCP check_matlab_code` (static analysis before execution),
  `MATLAB MCP evaluate_matlab_code` / `run_matlab_file` (bounded execution with captured
  output), `MATLAB MCP run_matlab_test_file` (test loops). Without that server, live-session
  work is the generic ladder plus user-run scripts chat drafts.
- Data/output verification is local either way: `desktop.file_stat` on written plots,
  reports, datasets, and models.

## Control surfaces (ranked)

1. `matlab_mcp_agentic_toolkit` (primary, 100) — MATLAB MCP Core Server tools + Agentic
   Toolkit skills; requires local MATLAB install/license, configured server, detected
   toolboxes, and approved generated-code execution.
2. `matlab -batch "stmt"` CLI — MathWorks' documented headless, non-interactive surface
   (exits with the statement's status; no desktop). Real and scriptable on macOS; noted as
   the near-term local executor to wire behind the bridge — not a bound tool today.
3. `vendor_script_or_plugin_api` (72) — documented MATLAB automation recipes.
4. `os_accessibility` (52) → `semantic_desktop` (42) → `screenshot_coordinate_fallback` (10);
   `connected_agent_buildout` (35) for the MCP/skill/CLI gaps.

## Recipes

- Computation/simulation (`matlab_compute_simulation`, review risk): detect toolboxes →
  `approvals.request` (inputs, outputs, assumptions) → one bounded
  `MATLAB MCP evaluate_matlab_code` / `run_matlab_file` step at a time, preserving command
  output → verify numerical results with units/tolerances, figure/Simulink proof screenshots,
  `desktop.file_stat` for written artifacts.
- Code/test/review (`matlab_code_test_review`, review risk): `MATLAB MCP check_matlab_code`
  static pass first → approval for source/test writes → `MATLAB MCP run_matlab_test_file` /
  `run_matlab_file`, iterating with the smallest change → final re-check + changed-file
  `desktop.file_stat` + visual proof for apps/figures/models.
- No MCP server present: draft the `.m`/test file, stage with `desktop.file_write_text`,
  and either walk the user through running it or propose the `matlab -batch` executor
  buildout — do not paste long code via `desktop.type_text` into the command window.

## Approval & evidence rules

- Approval before: running generated code with file writes/external access/long compute,
  editing Simulink/Simscape/Stateflow models, writing or replacing sources/tests/apps,
  installing packages/toolboxes, exporting plots/reports/datasets.
- Evidence: MATLAB version + toolbox detection, static-analysis output, command/test output
  with warnings/errors, result values with units/tolerance, output `desktop.file_stat`,
  figure/model screenshots.
- Fail closed: required toolbox unavailable, input data/model missing, solver assumptions or
  units unclear, unresolved generated-code errors, no MATLAB session/toolbox proof, missing
  approval. If generic prompting fails on MATLAB APIs, build/refine a MATLAB skill from the
  observed failure (MathWorks skill-engineering guidance) before retrying.

## Gaps & buildout

- `matlab -batch` bridge executor (fixed binary path + arg allowlist + receipts, per P15
  extension rules) — the highest-value near-term buildout; enables headless runs without MCP.
- MCP server presence is user infrastructure: detect, and fail closed with setup guidance
  instead of assuming the tools exist.
- Simulink model mutation has no typed adapter — approval + MCP script route or buildout only.

## Source refs

- `APP_AUTOMATION_RESEARCH_REFS.matlabMcpCoreServer` / `.matlabAgenticToolkit` /
  `.matlabAiSkillEngineering` in `src/lib/appAutomationControlSurfaces.ts` (official
  MathWorks URLs, reviewed 2026-06-18)
- `matlab -batch` reference: https://www.mathworks.com/help/matlab/ref/matlabmacos.html
- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15 extension rules for new engines)
