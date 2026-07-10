# Adobe Firefly Services

> App automation profile. Status: cloud-service (deferred adapter)
> Owner code: `src/lib/designAppCreativeAi.ts` (capabilities/recipes + `FIREFLY_API_REF`), `src/lib/designAppAdapterGaps.ts` (gap tool names), `src/lib/adobeCreativeCloudApps.ts` (`adobe_firefly` web profile). Last reviewed: 2026-07-06.

## What chat can do today

Nothing executable against the Firefly Services API — no adapter and no
credential lane exists (P15 research verdict: enterprise-gated, ~$1k/mo
minimum, sales cycle; deliberately deferred).

What chat DOES do today:

- Plans honestly: `designAppCreativeAi.ts` turns creative asks (text-to-image, generative fill/remove, generative expand, batch variants, InDesign data merge) into typed capability/recipe plans that stop at prompt approval + connected-agent buildout, naming the exact missing `desktop.*` tool.
- Interim lane: the firefly.adobe.com web UI via the browser pipeline (`adobe_firefly` profile observes `browser.verification_state` / `browser.dom_snapshot`), with paid/generative actions approval-gated.

## Control surfaces (ranked)

| Surface | External drive? | 2025-2026 reality |
|---|---|---|
| REST HTTP API (OAuth server-to-server) | Yes (not built) | The only headless Adobe imaging lane: Firefly image APIs, Photoshop API incl. `/v2/execute-actions`, InDesign APIs (data merge, renditions). Enterprise-gated at roughly $1k/mo minimum — adapter shape exists in gap contracts, deferred as the individual default. |
| firefly.adobe.com web UI | Browser pipeline | Consumer/credit-based generation; drivable through browser computer use with generative-action approvals and download verification. |
| In-app Firefly (Photoshop generative fill/expand) | No | Lives inside Photoshop's UI/UXP; not reachable from external ExtendScript — see `docs/apps/photoshop.md` gaps. |

## Recipes

Honest routing today (no executor):

1. "Generate 6 background variants for this pack shot" — creative-AI recipe plan (`photoshop.background_asset_pack` / `firefly.batch_asset_pack`) → prompt + output approval → stop at buildout (`desktop.firefly_generate_image_asset` missing), or run the browser-UI lane with per-generation approval and downloaded-file `file_stat` proof.
2. "Generative-expand this image to 16:9" — plan → gap `desktop.photoshop_generative_expand` (or `desktop.indesign_generative_expand_asset` for a placed frame) → buildout or browser lane; local `desktop.photoshop_resize_canvas_or_image` covers non-generative canvas extension now.
3. "Batch-generate campaign assets from this prompt list" — `firefly.batch_asset_generation` capability → gap `desktop.firefly_batch_generate_assets` → deferred; browser lane only for small counts.
4. "Put an AI-generated hero image into this InDesign frame" — `indesign.text_to_image_frame` capability → gap `desktop.indesign_generate_image_for_frame`; placement/relink would still verify through the shipped InDesign tools.

## Approval & evidence rules

- Prompt/data approval before any generation; sensitive reference images are gated.
- Cloud upload of user documents/assets is its own approval.
- Required evidence: generation receipt (prompt → output), output `file_stat`, placed/generated layer or frame evidence in the target app, proof export after placement.
- Web-UI lane gates: paid/generative action, publish/share/download final (profile `adobe_firefly`).
- Fail-closed: stop when prompt, variant matrix, generation receipt, or output file evidence is missing.

## Gaps & buildout

Exact gap tool names filed in this repo:

- `desktop.firefly_generate_image_asset` (from `designAppAdapterGaps.ts`)
- `desktop.firefly_batch_generate_variants` (from `designAppAdapterGaps.ts`)
- `desktop.firefly_batch_generate_assets` (from `designAppCreativeAi.ts`)
- Riding the same lane: `desktop.photoshop_generative_fill_or_remove`, `desktop.photoshop_generative_expand`, `desktop.indesign_generate_image_for_frame`, `desktop.indesign_generative_expand_asset`.

A buildout (when enterprise access exists) must produce: OAuth
server-to-server credential handling through the Marketplace key system (never
raw secrets in prompts/metadata), a call-budgeted client with receipts
(prompt → output URL/path), proof artifacts, placement verification through
the existing Photoshop/InDesign tools, and focused smokes. Until then this
stays a deferred cloud-service profile.

## Source refs

- https://developer.adobe.com/firefly-services/docs/firefly-api/
- https://developer.adobe.com/firefly-services/docs/firefly-api/api/
- https://developer.adobe.com/firefly-services/docs/photoshop/
- https://developer.adobe.com/firefly-services/docs/indesign-apis/
