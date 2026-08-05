# Adobe Lightroom Classic

> App automation profile. Status: buildout-only
> Owner code: `src/lib/adobeCreativeCloudApps.ts` (`adobe_lightroom_classic` profile) — no app-native executors yet. Last reviewed: 2026-07-06.

## What chat can do today

Nothing app-native yet — generic desktop ladder only (a11y/vision) plus the
buildout path:

- Observe: `desktop.file_stat` (catalog/output folders), `desktop.window_state`, `desktop.screenshot`.
- Careful UI steps: `desktop.menu_click` / `desktop.read_a11y_tree` for simple, approval-gated menu actions (e.g. a preset-driven export), verified by output `file_stat`.
- Route: `agent.build_app_capability` for anything batch, develop, or catalog-mutating.

There is no `desktop.lightroom_*` tool in `openswanToolRuntime.ts`.

## Control surfaces (ranked)

| Surface | External drive? | 2025-2026 reality |
|---|---|---|
| Lua plug-in SDK | No | The only real automation surface (LrDevelopController, LrPhoto, export services) — but plugins run INSIDE Lightroom Classic; there is no external invocation. Driving LrC externally means building and installing a plugin that opens a local channel. |
| Generic desktop ladder (a11y/vision) | Yes | The only day-one surface: menus/panels are readable and clickable, but develop sliders and grid selections are brittle — small approved steps only. |
| Export/develop presets via UI | Partial | Preset-driven exports through File > Export keep UI automation bounded and verifiable. |
| AppleScript | No | LrC has no meaningful AppleScript dictionary. |

## Recipes

Honest routing today:

1. "Export the selected photos as JPEGs to ~/Desktop/out" — confirm selection via `screenshot` → approval → `menu_click` File > Export with an existing preset (a11y-driven, one dialog at a time) → `desktop.file_stat` on the output folder. Brittle; offer the plugin buildout for repeat use.
2. "Apply the 'Punch' preset to this album" — buildout-only: needs an LrC Lua plugin (LrDevelopController) the user installs; blind develop-slider control is refused.
3. "How many photos are selected / which catalog is open?" — `window_state` + `screenshot` read today.
4. "Batch-add keywords / rename these photos" — buildout-only; catalog metadata writes are approval-gated and need per-file evidence.
5. "Cull rejects from this shoot" — refused as blind automation; delete/reject is approval-gated and should stay a human or plugin-verified action.

## Approval & evidence rules

- Approval gates (app profile): batch metadata edits, delete/reject photos, export/overwrite photos, catalog mutation.
- Verification signals: selected photo count, catalog/output folder `file_stat`, exported image samples.
- UI-ladder actions must be one reversible step at a time with before/after screenshots; stop if the visible catalog/selection does not match the request.
- Catalog files (.lrcat) are never touched directly on disk.

## Gaps & buildout

No gap contract filed yet — `designAppAdapterGaps.ts` covers only
Photoshop/InDesign, so Lightroom Classic requests stop at the generic
`agent.build_app_capability` route from the `adobeCreativeCloudApps.ts` plan.

A connected-agent buildout must produce:

- An installable LrC plugin (Lua SDK) exposing a bounded local channel (selection/catalog inventory, preset application, export jobs) — the SDK guide + API reference ship inside Adobe's SDK download.
- Bridge endpoints + client fns + `openswanToolRuntime.ts` registration with approval-gated mutations; catalog mutation fails closed on catalog mismatch.
- Focused smokes: refuse ambiguous photo/album targets; require exported-file `file_stat` evidence before ready_to_retry.

## Source refs

- https://developer.adobe.com/lightroom-classic/
- https://developer.adobe.com/apis/creativecloud/lightroomclassic.html
