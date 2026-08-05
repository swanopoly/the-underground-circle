# Adobe Premiere Pro

> App automation profile. Status: buildout-only
> Owner code: `src/lib/adobeCreativeCloudApps.ts` (`adobe_premiere_pro` profile) — no app-native executors yet. Last reviewed: 2026-07-06.

## What chat can do today

Nothing app-native yet — generic desktop ladder only (a11y/vision) plus the
buildout path:

- Observe: `desktop.file_stat` (the .prproj/media), `desktop.window_state`, `desktop.read_a11y_tree`, `desktop.screenshot`.
- Route: `agent.build_app_capability` for any timeline edit, relink, caption, or export.

There is no `desktop.premiere_*` tool in `openswanToolRuntime.ts`. Timeline
mutation through blind clicks is refused.

## Control surfaces (ranked)

| Surface | External drive? | 2025-2026 reality |
|---|---|---|
| UXP plugins (Premiere 25.6+) | No | UXP is Premiere's current extensibility standard, approaching CEP/ExtendScript parity — but it runs as installed plugins and is not externally invokable. New buildout work should target UXP APIs. |
| ExtendScript/CEP (legacy) | Partial | Still present during the UXP transition; external one-shot drive is fragile and effectively undocumented — not a lane worth building on in 2026. |
| Media Encoder handoff | Partial | Export via the AME queue is the realistic render lane; UI-driven today (see also `adobe_media_encoder` profile: `command_line`/`batch_processor` surfaces). |
| Generic desktop ladder (a11y/vision) | Yes | Project/sequence reads and screenshots; edits refused blind. |

## Recipes

Honest routing today (no executors):

1. "Export sequence 'Final v3' as H.264" — `file_stat` the project → confirm the active project/sequence via `window_state` + `read_a11y_tree` → stop → `agent.build_app_capability` (target: a UXP-plugin-backed export/queue channel or an AME handoff adapter). Render/export needs approval first.
2. "Add captions to this sequence" — observe → stop → buildout; caption/timeline mutation has no deterministic surface today.
3. "Which sequence is open, and is anything offline?" — best-effort `read_a11y_tree` + `screenshot` today; a reliable answer needs the plugin channel.
4. "Relink the offline media in this project" — buildout-only; media relink is approval-gated and needs file-level evidence (`file_stat` per relinked asset).

## Approval & evidence rules

- Approval gates (app profile): timeline edits, media relink, render/export, overwrite project/media.
- Verification signals: active project/sequence name, timeline screenshot, exported media `file_stat`.
- Any future adapter follows the shared pipeline: observe before, approve before mutating/rendering, proof after (exported file `file_stat`), fail closed on project/sequence mismatch, never overwrite source media.

## Gaps & buildout

No gap contract filed yet — `designAppAdapterGaps.ts` covers only
Photoshop/InDesign, so Premiere requests stop at the generic
`agent.build_app_capability` route from the `adobeCreativeCloudApps.ts` plan.

A connected-agent buildout must produce:

- A resident UXP plugin (Premiere 25.6+) exposing a bounded local control channel (project/sequence inventory, targeted edits, export/queue submission) — this is the supported 2026 direction; do not invest in new CEP.
- Bridge endpoints + client fns + `openswanToolRuntime.ts` registration with approval-gated mutations, plus focused smokes (refuse ambiguous sequence/clip targets, require export proof before ready_to_retry).
- Optionally an AME queue adapter for renders, since exports terminate there.

## Source refs

- https://developer.adobe.com/premiere-pro/uxp/
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/
- https://developer.adobe.com/premiere-pro/uxp/changelog/
