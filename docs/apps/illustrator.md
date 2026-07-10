# Adobe Illustrator

> App automation profile. Status: partial
> Owner code: `src/lib/adobeCreativeCloudApps.ts` (`adobe_illustrator` profile), `src/lib/appAutomationControlSurfaces.ts`; P16 executors land in `scripts/claude-bridge.js` + `src/lib/openswanToolRuntime.ts`. Last reviewed: 2026-07-06.

## What chat can do today

Shipping now (P16):

- `desktop.illustrator_document_status` — active document identity, artboards/layers state (read-only observation).
- `desktop.illustrator_export_proof` — approved proof export (PNG/PDF/SVG-class deliverable to a verified path).

Everything else is the generic desktop ladder — `desktop.file_stat`,
`desktop.window_state`, `desktop.read_a11y_tree`, `desktop.screenshot` for
observation — plus the `agent.build_app_capability` buildout path. No vector
mutation tools exist yet, and blind canvas editing is refused.

## Control surfaces (ranked)

| Surface | External drive? | 2025-2026 reality |
|---|---|---|
| ExtendScript via AppleScript `do javascript` | Yes (P16 builds on it) | Still supported in 2026 — Illustrator scripting is ExtendScript/VBScript/AppleScript; File > Scripts even loads `.scpt` AppleScript files directly. Same proven lane as Photoshop/InDesign. |
| UXP | No | Illustrator has NO public UXP scripting surface (as of 2026); ExtendScript remains the only scripting API. |
| Actions panel | Partial | Recorded actions replay menu/tool sequences; non-parametric, not bridged. |
| Generic desktop ladder (a11y/vision) | Yes | Reads and screenshots work; path/anchor mutation via blind clicks is refused by fail-safe rules. |

## Recipes

1. "What artboards and layers are in this .ai file?" — `desktop.file_stat` → `desktop.illustrator_document_status` (P16). Before P16: `read_a11y_tree` + `screenshot` best effort.
2. "Export a PNG proof of the logo" — `illustrator_document_status` → approval → `desktop.illustrator_export_proof` → `desktop.file_stat` on the output.
3. "Recolor the logo to brand blue" — honest routing today: observe (status + screenshot) → stop → `agent.build_app_capability` proposing an ExtendScript recolor adapter. No blind clicking on paths or swatches.
4. "Outline the fonts / expand strokes for the printer" — buildout-only today (destructive vector ops need a script adapter plus approval); interim answer is a proof export plus clear "needs adapter" status.
5. "Convert this .ai to PDF/SVG deliverable" — `illustrator_export_proof` (P16) where the format is supported; otherwise buildout.

## Approval & evidence rules

- Approval gates (app profile): editing vector paths/layers, outline/expand/rasterize, save over source, export deliverable.
- Export is its own approved step with a verified output path; nothing auto-saves.
- Evidence: artboard/layer inventory (via `illustrator_document_status`), exported SVG/PDF/PNG `file_stat`, before/after screenshot.
- Fail-closed: stop on document mismatch with the staged file; re-observe rather than click blind when a semantic target is missing; same TCC Automation grant as the other Adobe tools.

## Gaps & buildout

No gap contract filed yet — `designAppAdapterGaps.ts` currently covers only
`adobe_photoshop` and `adobe_indesign`, so Illustrator mutations route through
the generic `agent.build_app_capability` path from the
`adobeCreativeCloudApps.ts` plan instead of a typed contract.

A connected-agent buildout must produce, per the P15 pattern:

- ExtendScript (JSX) builders for the requested op (e.g. recolor, artboard resize, outline text) with document-identity fail-closed checks and no save/close/quit emission.
- Bridge endpoint + client fn + the registration seams in `openswanToolRuntime.ts` (approval-gated mutation policy).
- An `adobe_illustrator` branch in `designAppAdapterGaps.ts` so future misses produce typed contracts instead of generic buildout.
- Focused smokes proving refusal of ambiguous targets and evidence-before-retry.

## Source refs

- https://helpx.adobe.com/illustrator/using/automation-scripts.html
- https://helpx.adobe.com/illustrator/using/automation-actions.html
- https://helpx.adobe.com/photoshop/using/scripting.html (cross-app AppleScript/JS scripting overview)
