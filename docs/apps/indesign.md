# Adobe InDesign

> App automation profile. Status: executable
> Owner code: `scripts/claude-bridge.js` (JSX via AppleScript `do script ... language javascript`), `src/lib/desktopBridge.ts`, `src/lib/openswanToolRuntime.ts`, plus the design-app family (`designAppAutomation.ts`, `designAppAdapterGaps.ts`, `designAppOperationRunbooks.ts`, `designAppCreativeAi.ts`, `designAppExecutionPipeline.ts`, `adobeCreativeCloudApps.ts`). Last reviewed: 2026-07-06.

## What chat can do today

Nine real bridge tools, all ExtendScript against the InDesign DOM, driven
externally through AppleScript. Mutations are approval-gated; nothing auto-saves.

- `desktop.indesign_document_status` — active document identity, pages, links/fonts state.
- `desktop.indesign_text_inventory` — stories/text frames with contents and overset state.
- `desktop.indesign_set_layer_state` — show/hide/lock/unlock a named layer.
- `desktop.indesign_update_text_layer` — replace copy in a named text frame/layer.
- `desktop.indesign_batch_update_text_layers` — apply a mapping of copy changes in one pass.
- `desktop.indesign_batch_find_change` — scoped find/change across the document.
- `desktop.indesign_relink_asset` — relink a placed asset to a new file (file checked first).
- `desktop.indesign_package_document` — package for print/handoff (fonts + links).
- `desktop.indesign_export_proof` — export a proof (PDF/raster) to a verified path.

## Control surfaces (ranked)

| Surface | External drive? | 2025-2026 reality |
|---|---|---|
| ExtendScript via AppleScript `do script … language javascript` | Yes (built) | Still supported in 2026; the proven external lane all nine tools use; one TCC Automation grant. |
| UXP scripting (`.idjs`) | No | Modern in-app surface; not externally invokable — same limitation as Photoshop `.psjs`. Gap contracts cite the UXP DOM, but shipped executors ride ExtendScript against the same DOM objects. |
| InDesign APIs (Firefly Services, cloud) | Yes (HTTP) | Cloud data merge/renditions/custom scripts; enterprise-gated — deferred, see `docs/apps/firefly-services.md`. |
| Generic desktop ladder (a11y/vision) | Yes | Read fallback; blind coordinate clicks for layout mutation are explicitly refused. |

## Recipes

1. "Update the price on this flyer to $49" — `indesign_document_status` → `indesign_text_inventory` → approval → `indesign_update_text_layer` → refreshed inventory (overset check) → `indesign_export_proof`.
2. "Change every 2025 to 2026 across the doc" — status + inventory → approval → `indesign_batch_find_change` → refreshed inventory → `indesign_export_proof`.
3. "Apply this copy deck to the named text layers" — `indesign_batch_update_text_layers` with the mapping → overset check → proof.
4. "Swap the hero image for the new photo" — `desktop.file_stat` on the new asset → approval → `indesign_relink_asset` → `indesign_export_proof`.
5. "Hide the FPO layer and give me a proof PDF" — `indesign_set_layer_state` → `indesign_export_proof`.
6. "Package this for the printer" — approval → `indesign_package_document` → `desktop.file_stat` on the package folder as proof.

## Approval & evidence rules

- Approval gates (app profile): text/link mutation, save, export, package, running new scripts.
- Nothing auto-saves; export/package are separately approved steps with verified output paths.
- Fail-closed: stop on document mismatch with the staged file, ambiguous frame/layer targets, locked/master/hidden objects without approval, or post-change overset text.
- Evidence: refreshed document status + text inventory (proving no unexpected overset/reflow) after every mutation, plus proof export or package `file_stat`.
- Runbooks in `designAppOperationRunbooks.ts` enforce resolve → observe → approve → mutate → export/package → verify → recover.

## Gaps & buildout

Exact missing tool names from `designAppAdapterGaps.ts` (each has a full typed
contract: prerequisites, evidence, smokes, fail-closed rules, retry prompt):

- `desktop.indesign_resize_layout` — page/spread/frame geometry changes.
- `desktop.indesign_apply_text_style` — apply/define paragraph/character styles.
- `desktop.indesign_manage_pages` — add/delete/move pages, master/parent assignment.
- `desktop.indesign_manage_tables` — create/edit/populate/format tables.
- `desktop.indesign_resolve_fonts` — activate/sync/substitute fonts.
- `desktop.indesign_manage_hyperlinks` — hyperlinks, cross-references, bookmarks.
- `desktop.indesign_build_toc` — TOC/index/running headers.
- `desktop.indesign_manage_text_flow` — thread/unthread, autoflow, overset fixes.
- `desktop.indesign_manage_swatches` — swatches, spot colors, inks.
- `desktop.indesign_generate_image_for_frame` — Firefly-generated asset into a frame (cloud lane).
- `desktop.indesign_generative_expand_asset` — generative expand of a placed asset (cloud lane).
- `desktop.indesign_data_merge_variants` — data-merge campaign variants.

A connected-agent buildout must extend the existing bridge/OpenSwan routing (no
parallel runtime), satisfy the contract's focused smoke cases, and return
`ready_to_retry` only with before/after inventory + proof evidence. The proven
executable pattern is the Photoshop P15 lane: JSX builder + bridge endpoint +
client fn + runtime registration + smoke.

## Source refs

- https://developer.adobe.com/indesign/dom/api/
- https://developer.adobe.com/indesign/uxp/scripts/
- https://developer.adobe.com/indesign/dom/api/d/Document/
- https://developer.adobe.com/indesign/dom/api/t/TextFrame/
- https://developer.adobe.com/firefly-services/docs/indesign-apis/
- https://helpx.adobe.com/indesign/using/scripting.html
