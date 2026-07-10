# Adobe Photoshop

> App automation profile. Status: executable
> Owner code: `src/lib/photoshopExtendScriptAdapters.ts`, `scripts/claude-bridge.js`, `src/lib/desktopBridge.ts`, `src/lib/openswanToolRuntime.ts`, plus the design-app family (`designAppAutomation.ts`, `designAppAdapterGaps.ts`, `designAppOperationRunbooks.ts`, `designAppCreativeAi.ts`, `designAppExecutionPipeline.ts`, `adobeCreativeCloudApps.ts`). Last reviewed: 2026-07-06.

## What chat can do today

Every tool below is real ExtendScript (JSX) sent through AppleScript `do javascript`
by the local desktop bridge. Mutations are approval-gated and NEVER auto-save.

Shipped (P15 and earlier):

- `desktop.photoshop_document_status` — active document identity, dimensions, color mode, saved/modified state.
- `desktop.photoshop_layer_inventory` — layer tree with kind, visibility, locks, masks, text items.
- `desktop.photoshop_set_layer_state` — show/hide/lock/unlock a named layer.
- `desktop.photoshop_update_text_layer` — replace the contents of a named text layer.
- `desktop.photoshop_place_asset` — place an image file into the document as a new layer.
- `desktop.photoshop_export_proof` — raster proof export (the approved way to get pixels out).
- `desktop.photoshop_apply_adjustment_layer` — additive levels/curves/hue_saturation/brightness_contrast/black_white adjustment layers; never modifies existing ones.
- `desktop.photoshop_apply_selection_or_mask` — Select Subject; `select_only` reports bounds, `mask_layer` applies a non-destructive reveal-selection mask. The deterministic core of "remove the background"; never deletes pixels.
- `desktop.photoshop_resize_canvas_or_image` — image_resize / canvas_resize (9-grid anchor) / crop_to_selection (fails closed without a selection).

Shipping now (P16):

- `desktop.photoshop_manage_layers` — rename/duplicate/reorder/group. NO delete or merge, by design.
- `desktop.photoshop_transform_layer` — move/scale/rotate a named layer.
- `desktop.photoshop_convert_color_mode` — RGB/CMYK/Grayscale conversion.

## Control surfaces (ranked)

| Surface | External drive? | 2025-2026 reality |
|---|---|---|
| ExtendScript via AppleScript `do javascript` | Yes (built) | Still supported in 2026; the most reliable external drive; zero install; one macOS TCC Automation grant. |
| UXP scripting (`.psjs`, batchPlay, executeAsModal) | No | The modern in-app surface, but `.psjs` cannot be invoked from outside Photoshop; external control would need a resident UXP plugin. |
| Actions / droplets | Partial | Recorded actions replay, but are brittle and non-parametric; not used by the bridge. |
| Photoshop API (Firefly Services, cloud) | Yes (HTTP) | The only headless Photoshop, incl. `/v2/execute-actions`; enterprise-gated (~$1k/mo) — deferred, see `docs/apps/firefly-services.md`. |
| Generic desktop ladder (a11y/vision) | Yes | Read fallback only; blind canvas/menu clicks for pixel mutation are refused by fail-closed rules. |

## Recipes

1. "Change the headline on this banner to 'Summer Sale'" — `photoshop_document_status` → `photoshop_layer_inventory` → approval → `photoshop_update_text_layer` → refreshed inventory → `photoshop_export_proof`.
2. "Remove the background from this product shot" — status + inventory → `photoshop_apply_selection_or_mask` (`mask_layer`) → `photoshop_export_proof`. It masks; it never deletes pixels.
3. "Make it brighter / make it black and white" — `photoshop_apply_adjustment_layer` (additive) → refreshed inventory → `photoshop_export_proof`.
4. "Resize to 1080x1350 and give me a JPEG" — `photoshop_resize_canvas_or_image` → `photoshop_export_proof` (export is its own approved step).
5. "Drop the new logo into the top-right corner" — `photoshop_place_asset` → `photoshop_transform_layer` (P16) to position/scale → `photoshop_export_proof`.
6. "Tidy layers into groups and convert to CMYK for print" — `photoshop_manage_layers` + `photoshop_convert_color_mode` (both P16) → `photoshop_document_status` confirms the mode.

## Approval & evidence rules

- Every mutating tool is approval-gated (approvalMode `ask` via the desktop mutation policy). Status/inventory reads are low-risk observation steps.
- NEVER auto-saves: the JSX builders emit no `doc.save()`/`saveAs()` (smoke-asserted). Saving or exporting is always a separately approved step.
- Document-mismatch fail-closed: tools verify the active document matches the staged file before mutating; args are JSON.stringify-escaped.
- Evidence contract (runbooks + `computerTaskEvidenceContract.ts`): before/after document status and layer inventory, raster proof via `photoshop_export_proof`, `desktop.file_stat` on outputs.
- macOS: first use needs the TCC Automation (Apple Events) grant; the bridge must be restarted (`npm run bridge`) after new endpoints land.

## Gaps & buildout

Still gaps by design (exact names from `designAppAdapterGaps.ts`):

- `desktop.photoshop_generative_fill_or_remove` — needs Firefly or batchPlay-in-UXP; not reachable from external ExtendScript.
- `desktop.photoshop_generative_expand` — same class (enterprise-gated cloud lane).
- `desktop.firefly_generate_image_asset`, `desktop.firefly_batch_generate_variants` — cloud creative-AI lane, deferred (see firefly-services.md).
- `desktop.photoshop_apply_layer_effects` — layer styles need batchPlay action descriptors.
- `desktop.photoshop_manage_artboards`, `desktop.photoshop_manage_smart_objects` — unshipped.

P16 removes `manage_layers`, `transform_layer`, and `convert_color_mode` from the gap map as those tools ship.

Buildout recipe (from `docs/CAD_ADOBE_EXECUTION_LAYER.md`): JSX builder in
`photoshopExtendScriptAdapters.ts` + LOCKSTEP copy in `scripts/claude-bridge.js`
+ endpoint + client fn + the 8 registration seams in `openswanToolRuntime.ts`,
remove the op from `photoshopGap`, update the runbook, add a smoke. Never emit
save/close/quit from JSX.

## Source refs

- https://developer.adobe.com/photoshop/uxp/scripting/
- https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/executeasmodal/
- https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/
- https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/layer/
- https://developer.adobe.com/firefly-services/docs/photoshop/
- https://helpx.adobe.com/photoshop/using/scripting.html
