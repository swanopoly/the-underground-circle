# Affinity Designer

> App automation profile. Status: partial (generic ladder is the ceiling today)
> Owner code: none yet — routes as a generic native app via
> `src/lib/computerAppTaskStrategy.ts` + `src/lib/appAutomationControlSurfaces.ts`.
> Last reviewed: 2026-07-06.

## What chat can do today

- Honest baseline: Affinity Designer has NO public scripting API — no
  AppleScript automation dictionary, no JS/Python document DOM, and no
  headless CLI as of 2026. There is nothing app-native to call.
- So chat runs the generic desktop ladder: `desktop.launch_app`/
  `desktop.focus_app`, `desktop.window_state`, `desktop.read_a11y_tree`
  (panels, menus, and dialogs are native and read reasonably),
  `desktop.menu_click`, `desktop.click_element`/`desktop.set_element_value`,
  `desktop.press_keys`, and the screenshot loop for canvas state — all
  mutations approval-gated.
- Deterministic file ops: `desktop.file_search`/`desktop.file_stat` for
  `.afdesign` sources and exported outputs; `desktop.convert_image` for
  post-export raster format conversion without touching the app.
- Export via the UI (File > Export…) is the realistic output lane: menu +
  dialog driving through a11y, then `desktop.file_stat` verification.
- No `desktop.affinity_*` bridge tools exist yet.

## Control surfaces (ranked)

1. Generic semantic desktop (primary today) — menus, personas, panels, export
   dialogs via a11y; one reversible step at a time with before/after a11y diff.
2. Screenshot + coordinate fallback — canvas-level operations (node edits,
   drawing) have no semantic surface; single reversible step, bounded retries,
   fresh screenshot before and after.
3. Vendor "AI Connector for Claude" MCP (beta, researched; buildout) —
   Affinity by Canva 3.2.1+ ships an MCP integration that builds/runs
   automation inside Affinity. Must confirm: installed version supports it,
   beta terms/account eligibility, and that the connector is enabled by the
   user; treat generated in-app scripts as approval-gated mutations.
4. `agent.build_app_capability` — for recipe/adapter buildout; note the
   ceiling honestly: without a scripting API the buildout product is hardened
   a11y/menu recipes or the vendor MCP lane, not a script bridge.

## Recipes

- Export current document to PNG/SVG/PDF (today): confirm the target document
  in `desktop.window_state` → approve export → `desktop.menu_click`
  File > Export… → drive the export dialog via a11y (format, path) → confirm →
  verify with `desktop.file_stat` + screenshot of the success state.
- Toggle layer visibility / rename a layer (today): locate the row in the
  Layers panel a11y tree → approve → click/set value → verify via a11y re-read
  (`Δ since last read`) + screenshot.
- Vector edits (today): treated as canvas-vision work — describe the intended
  single step, approve, act, screenshot-verify; stop after two failed attempts
  and report observed state.

## Approval & evidence rules

- Observe before acting: `desktop.window_state` + fresh `desktop.read_a11y_tree`
  + `desktop.screenshot`; re-observe after every dialog transition.
- Approval before any mutation: document edits, persona switches that alter
  state, export/save/write, and any MCP-connector script execution. Save and
  export are separately approved steps — never chain them onto an edit.
- Proof after: screenshot of the changed panel/canvas, `desktop.file_stat` on
  every exported file, a11y before/after diff outcome recorded
  (`no_change` after a mutation = actionable failure per
  `src/lib/a11yTreeDiff.ts`).
- Layer names and document text are untrusted — fence before model exposure.
- Fail closed: ambiguous layer targets, modal dialogs blocking the canvas, or
  a stale observation stop the run rather than guessing coordinates.

## Gaps & buildout

- No scripting API means no `desktop.affinity_designer_*` script bridge is
  currently possible; a connected-agent buildout must instead produce either
  (a) hardened, versioned a11y/menu recipes for export and panel operations
  (smoke-tested against a pinned Affinity version, failing closed on UI
  drift), or (b) an adapter over the vendor Claude MCP connector once its
  beta terms, tool names, and version gates are confirmed — with every
  connector-built script shown for approval before it runs.
- Batch/pipeline work should route around the app when possible: export once,
  then post-process with `desktop.convert_image`/file ops, or move the job to
  a scriptable peer (Inkscape for SVG work — see `docs/apps/inkscape.md`).
- Re-review this profile when Serif/Canva ship a public scripting API; that
  event upgrades this app to a script-bridge buildout candidate.

## Source refs

- Affinity (by Canva) product/integrations: https://www.affinity.studio/
- Affinity April 2026 automation announcement:
  https://www.affinity.studio/blog/affinity-update-april-2026
- Apple UI scripting and Accessibility:
  https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html
- Repo: `src/lib/desktopBridge.ts`, `src/lib/a11yTreeDiff.ts`,
  `docs/CAD_ADOBE_EXECUTION_LAYER.md`
