# Onshape

> App automation profile. Status: cloud-service
> Owner code: none yet (no dedicated router candidate; browser pipeline via `src/lib/computerUse.ts` + `supabase/functions/computer-use-agent/index.ts` when phrased as web work). Last reviewed: 2026-07-06.

## What chat can do today

- Onshape is browser-native SaaS — there is no desktop app to ladder into. Live work runs
  through the browser computer-use pipeline (planning/preview in `src/lib/computerUse.ts`,
  edge loop in `supabase/functions/computer-use-agent/index.ts`, Browserbase or browser
  bridge session) with credential opt-in, like any web app. That is vision/DOM-loop quality,
  not a typed executor.
- Router honesty: `appAutomationControlSurfaces.ts` does not detect "onshape" — plain
  mentions land in the generic app family; CAD-keyword or browser phrasing picks the
  engineering or browser family. No Onshape-specific runbook exists.
- Exported files are fully workable locally: `desktop.cad_inspect_file` reads STEP (schema,
  products) and STL (triangles/bbox); `desktop.cad_compile` engine `freecadcmd` converts
  STEP/IGES exports → STEP/STL/DXF. Mesh render/convert proof: `desktop.cad_compile` engine
  `blender` (headless bpy mesh convert + PNG render) — shipping now (P16).

## Control surfaces (ranked)

1. Browser DOM/CDP surface (`browser_dom_cdp`, primary for web phrasing) — drive
   cad.onshape.com UI with locator-grounded actions, credential opt-in, and origin policy.
2. Onshape REST API with API keys — the only full parametric CAD editable via pure HTTP
   (documents, part studios, features, export). **Deferred** (P15): the 2025 policy caps free
   plans at 2,500 API calls per YEAR, so an executor must be call-budgeted and
   Marketplace-key integrated before it ships.
3. FeatureScript — Onshape's parametric feature language; custom features run server-side
   inside documents. A buildout surface reached through the REST API or in-browser editor.
4. Local file lane (`desktop.cad_inspect_file`, `desktop.cad_compile`) for anything exported.
5. `connected_agent_buildout` for the call-budgeted REST adapter itself.

## Recipes

- Review a shared part: user exports STEP/STL (or the browser loop downloads it with
  approval) → `desktop.file_stat` → `desktop.cad_inspect_file` → report schema/product/
  triangle/bbox evidence, units caveat included.
- Convert an Onshape STEP export for another tool: `approvals.request` →
  `buildFreeCadPythonScript` → `desktop.file_write_text` → `desktop.cad_compile` engine
  `freecadcmd` → `desktop.file_stat` proof.
- Browser-session edit (sketch tweak, rename, export click-through): browser pipeline with
  fresh DOM/ARIA snapshot, actionability checks, approval before submit/export, screenshot +
  download `file_stat` proof. Keep steps single and reversible — Onshape has document history,
  which helps recovery, but the loop must not assume it.

## Approval & evidence rules

- Credential use (Onshape sign-in) is explicit opt-in through the browser pipeline's
  credential policy; never stored in prompts or persisted metadata.
- Any document mutation, export, or download needs `approvals.request` plus DOM/URL/title
  confirmation evidence; downloads verified with `desktop.file_stat`.
- Future REST executor: every call counts against the 2,500/year budget — evidence must
  include the call count per task, and the executor must fail closed when the budget or key
  is missing.

## Gaps & buildout

- Call-budgeted Onshape REST executor + Marketplace API-key integration: deferred (P15
  verdict). Design constraints: batch reads, cache document/version metadata, hard per-task
  call ceiling, honest budget-exhausted errors.
- Router detection for "onshape" (target name + candidates) does not exist yet — add it to
  `engineeringCadCandidates` when the executor lands, not before.
- FeatureScript authoring/eval adapter: buildout-only, behind the REST executor.

## Source refs

- `docs/CAD_ADOBE_EXECUTION_LAYER.md` (P15: "Onshape REST — Deferred… 2,500 calls/YEAR")
- Onshape developer docs: https://onshape-public.github.io/docs/ (REST API, API keys)
- FeatureScript reference: https://cad.onshape.com/FsDoc/
