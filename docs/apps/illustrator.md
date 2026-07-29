# Adobe Illustrator

> App automation profile. Status: executable
> Owner code: `src/lib/illustratorExtendScriptAdapters.ts` (pure JSX source of truth, LOCKSTEP with `scripts/claude-bridge.js`), `src/lib/desktopBridge.ts`, `src/lib/openswanToolRuntime.ts`, `src/lib/adobeCreativeCloudApps.ts` (`adobe_illustrator` profile), `src/lib/appAutomationControlSurfaces.ts`. Last reviewed: 2026-07-29.

## What chat can do today

Five real bridge tools, all ExtendScript against the Illustrator DOM, driven
externally through AppleScript (the same proven lane as Photoshop/InDesign).
Mutations are approval-gated; nothing auto-saves.

- `desktop.illustrator_document_status` — active document identity, artboards/layers state (read-only observation).
- `desktop.illustrator_text_inventory` — text frames with name/layer/contents and locked/hidden state (read-only; bounded 60 frames × 600 chars).
- `desktop.illustrator_set_layer_state` — show/hide/lock/unlock ONE exactly-named layer; duplicate names fail closed; success is the re-read after-state.
- `desktop.illustrator_update_text_layer` — replace copy in ONE exactly-named text frame (or the frame on an exactly-named layer); locked/hidden/ambiguous targets fail closed; success requires the same-frame re-read to equal the requested copy.
- `desktop.illustrator_export_proof` — approved PNG/SVG proof export to a verified path (PDF excluded by design — it would re-associate the source).

Wired end to end 2026-07-29: pure smoke-tested JSX builders
(`illustratorExtendScriptAdapters.ts`), byte-identical LOCKSTEP twins + three
`POST /desktop/illustrator_*` endpoints in `claude-bridge.js`, typed
`desktopBridge` clients, and approval-gated runtime tools. The three new lanes
are source/contract-verified; no live Illustrator run has exercised them yet.
The `text` embed goes through `jsxLiteral` (U+2028/U+2029-safe), because copy
is arbitrary user text and bare JSON.stringify would emit those separators raw
and break the ES3 string literal.

Everything else is the generic desktop ladder — `desktop.file_stat`,
`desktop.window_state`, `desktop.read_a11y_tree`, `desktop.screenshot` for
observation — plus the `agent.build_app_capability` buildout path. Blind canvas
editing is refused.

## Control surfaces (ranked)

| Surface | External drive? | 2025-2026 reality |
|---|---|---|
| ExtendScript via AppleScript `do javascript` | Yes (P16 builds on it) | Still supported in 2026 — Illustrator scripting is ExtendScript/VBScript/AppleScript; File > Scripts even loads `.scpt` AppleScript files directly. Same proven lane as Photoshop/InDesign. |
| UXP | No | Illustrator has NO public UXP scripting surface (as of 2026); ExtendScript remains the only scripting API. |
| Actions panel | Partial | Recorded actions replay menu/tool sequences; non-parametric, not bridged. |
| Generic desktop ladder (a11y/vision) | Yes | Reads and screenshots work; path/anchor mutation via blind clicks is refused by fail-safe rules. |

## Recipes

1. "What artboards and layers are in this .ai file?" — `desktop.file_stat` → `desktop.illustrator_document_status`.
2. "Export a PNG proof of the logo" — `illustrator_document_status` → approval → `desktop.illustrator_export_proof` → `desktop.file_stat` on the output.
3. "Change the headline / fix the tagline copy" — `illustrator_text_inventory` (find the exact frame/layer name) → approval → `illustrator_update_text_layer` → the tool's same-frame re-read is the proof; export a proof if the user wants a visual. Locked/hidden targets route through `illustrator_set_layer_state` first.
4. "Hide the guides layer / unlock the art layer" — `illustrator_document_status` or `text_inventory` for the exact name → approval → `illustrator_set_layer_state` (before/after booleans are the receipt).
5. "Recolor the logo to brand blue" — still buildout-only: observe (status + screenshot) → stop → `agent.build_app_capability` proposing an ExtendScript recolor adapter. No blind clicking on paths or swatches.
6. "Outline the fonts / expand strokes for the printer" — buildout-only (destructive vector ops need a dedicated adapter plus approval); interim answer is a proof export plus clear "needs adapter" status.
7. "Convert this .ai to PDF/SVG deliverable" — `illustrator_export_proof` where the format is supported (PNG/SVG); PDF stays excluded by design.

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
