# Affinity Photo

> App automation profile. Status: partial (generic ladder is the ceiling today)
> Owner code: none yet — routes as a generic native app via
> `src/lib/computerAppTaskStrategy.ts` + `src/lib/appAutomationControlSurfaces.ts`.
> Last reviewed: 2026-07-06.

## What chat can do today

- Honest baseline: Affinity Photo has NO public scripting API — no AppleScript
  automation dictionary, no Python/JS document DOM, and no headless CLI as of
  2026. Unlike Photoshop there is no ExtendScript-style external drive.
- Chat therefore runs the generic desktop ladder: `desktop.launch_app`/
  `desktop.focus_app`, `desktop.window_state`, `desktop.read_a11y_tree` for
  panels/menus/dialogs, `desktop.menu_click`, `desktop.click_element`/
  `desktop.set_element_value`, `desktop.press_keys`, and the screenshot loop
  for canvas state — all mutations approval-gated.
- Deterministic file ops around the app: `desktop.file_search`/
  `desktop.file_stat` for `.afphoto` sources and outputs, and
  `desktop.convert_image` (sips-backed) for format conversion of exported
  rasters without opening any app — often the better lane for plain
  "convert/resize this image" asks.
- In-app macros and File > New Batch Job exist but are user-driven surfaces:
  chat can navigate to them via a11y with approval, not invoke them headlessly.
- No `desktop.affinity_*` bridge tools exist yet.

## Control surfaces (ranked)

1. Generic semantic desktop (primary today) — menus, adjustment panels, layer
   list, develop/liquify persona switches, export and batch-job dialogs via
   a11y; one reversible step at a time with before/after a11y diff.
2. Screenshot + coordinate fallback — brush/selection/retouch canvas work has
   no semantic surface; single reversible step, bounded retries.
3. Vendor "AI Connector for Claude" MCP (beta, researched; buildout) —
   Affinity by Canva 3.2.1+ ships an MCP integration for building/running
   automation (batch edits, print prep) inside Affinity. Must confirm version
   support, beta terms, and user enablement; connector-built scripts are
   approval-gated mutations.
4. `agent.build_app_capability` — buildout ceiling is hardened a11y/macro
   recipes or the vendor MCP lane; no script bridge is possible today.

## Recipes

- Export edited photo (today): confirm the active document via
  `desktop.window_state` → approve → `desktop.menu_click` File > Export… →
  set format/path in the dialog via a11y → confirm → `desktop.file_stat` on
  the output + success-state screenshot.
- Non-destructive adjustment (today): add an adjustment layer through the
  Layer menu / Adjustments panel via a11y (additive only, mirroring the
  Photoshop adjustment-layer house rule: never modify existing layers) →
  verify with layer-panel a11y diff + canvas screenshot.
- Plain image conversion/resize (today, app-free): skip Affinity entirely —
  `desktop.convert_image` on the source file, `desktop.file_stat` proof.
- Batch job (today, assisted): stage File > New Batch Job via a11y, show the
  configured source/destination/format for approval before pressing OK.

## Approval & evidence rules

- Observe before acting: `desktop.window_state` + fresh `desktop.read_a11y_tree`
  + `desktop.screenshot`; re-observe after each dialog or persona switch.
- Approval before any mutation: pixel edits, adjustment layers, macro runs,
  batch jobs, MCP-connector scripts, and every save/export/write. Destructive
  ops (flatten, crop-delete, develop overwrite) need the destructive-action
  callout in the approval text.
- Proof after: canvas/panel screenshot, `desktop.file_stat` per output file,
  a11y before/after diff outcome (`no_change` after a mutation = failure).
- File names, layer names, and EXIF-derived strings are untrusted — fence
  before model exposure.
- Fail closed on ambiguous targets (multiple similar layers, active modal
  dialogs, stale observations) — stop and report rather than guess.

## Gaps & buildout

- No scripting API means no `desktop.affinity_photo_*` script bridge is
  currently possible. A connected-agent buildout must instead produce
  (a) hardened a11y/menu recipes for export, adjustment-layer, and batch-job
  flows — pinned to an Affinity version, smoke-tested, failing closed on UI
  drift — or (b) an adapter over the vendor Claude MCP connector once beta
  terms and tool coverage are confirmed, with connector-generated scripts
  surfaced for approval before execution.
- Batch raster pipelines should prefer scriptable peers today: GIMP headless
  batch (`docs/apps/gimp.md`) or `desktop.convert_image` for conversions.
- Re-review when Serif/Canva ship a public scripting API; that upgrades this
  profile to a script-bridge buildout candidate.

## Source refs

- Affinity (by Canva) product/integrations: https://www.affinity.studio/
- Affinity April 2026 automation announcement:
  https://www.affinity.studio/blog/affinity-update-april-2026
- Apple UI scripting and Accessibility:
  https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html
- Repo: `src/lib/desktopBridge.ts` (`convertImage`), `src/lib/a11yTreeDiff.ts`,
  `docs/CAD_ADOBE_EXECUTION_LAYER.md`
