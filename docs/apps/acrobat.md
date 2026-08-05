# Adobe Acrobat

> App automation profile. Status: buildout-only
> Owner code: `src/lib/adobeCreativeCloudApps.ts` (`adobe_acrobat` + `adobe_acrobat_reader` profiles) — no app-native executors yet. Last reviewed: 2026-07-06.

## What chat can do today

Nothing app-native yet — generic desktop ladder only (a11y/vision) plus the
buildout path:

- Observe: `desktop.file_stat` (the PDF), `desktop.window_state`, `desktop.read_a11y_tree` (page/form structure), `desktop.screenshot`.
- Careful UI steps: `desktop.set_element_value` / `desktop.type_text` / `desktop.menu_click` for explicit, approval-gated form-fill or menu actions.
- Route: `agent.build_app_capability` for field inventory, batch operations, OCR, combine/split.

Note: many "PDF tasks" don't need Acrobat at all — local file tools
(`desktop.file_*`, `desktop.convert_image`) or a scripted CLI lane are often
the better route, and chat should prefer them when the ask is file-level.

## Control surfaces (ranked)

| Surface | External drive? | 2025-2026 reality |
|---|---|---|
| Acrobat JavaScript API | Partial (not built) | The real automation surface (fields, annotations, doc ops; JS 1.7/1.8-era). On macOS Acrobat's AppleScript dictionary can execute JavaScript (`do script`), but the dictionary is limited and aging — usable for a bounded adapter, not general control. |
| Action Wizard (batch actions) | Partial | Canned in-app batch sequences (OCR, optimize, export); triggered via UI only. |
| Generic desktop ladder (a11y/vision) | Yes | Page/form reads and menu-driven combine/export with approval. |
| PDF Services / Document Cloud APIs | Yes (HTTP) | Adobe's cloud PDF lane exists but is a separate credentialed service; not wired into this repo. |

## Recipes

Honest routing today:

1. "Fill out this PDF form" — `read_a11y_tree` to enumerate visible fields → approval with the field/value list → `set_element_value`/`type_text` per field → `screenshot` + saved-copy `file_stat`. Signature fields always stop for the user.
2. "What fields does this form have?" — a11y read today (visible fields only); a complete inventory needs the JS API adapter (buildout).
3. "Combine these three PDFs into one" — approval → menu-driven combine via a11y, output `file_stat`; or route to local-file/CLI lane when fidelity allows.
4. "OCR this scanned PDF" — buildout or Action Wizard via approved UI steps; verify with extracted-text sample + output `file_stat`.
5. "Redact the SSNs in this document" — never automated blind: approval-gated, buildout-only, and requires verified redaction evidence before any save.

## Approval & evidence rules

- Approval gates (app profile): redaction, signature, form submission, save over source, combine/split output.
- Reader profile is stricter: fill/annotate only explicit fields; no destructive Pro operations.
- Evidence: page count or form-field inventory, exported/optimized PDF `file_stat`, visible page screenshot.
- Save-over-source is never implicit; outputs go to verified paths. Signatures and submissions remain human actions.

## Gaps & buildout

No gap contract filed yet — `designAppAdapterGaps.ts` covers only
Photoshop/InDesign, so Acrobat requests stop at the generic
`agent.build_app_capability` route from the `adobeCreativeCloudApps.ts` plan.

A connected-agent buildout must produce:

- A bounded adapter driving Acrobat's JavaScript API (field inventory, fill, flatten/export) through the macOS AppleScript `do script` hook, with document-identity fail-closed checks and no implicit save.
- Bridge endpoints + client fns + `openswanToolRuntime.ts` registration with approval-gated mutations, plus focused smokes (refuse ambiguous field targets; require output `file_stat` before ready_to_retry).
- A clear split so file-level PDF work routes to local tools instead of the app.

## Source refs

- https://opensource.adobe.com/dc-acrobat-sdk-docs/library/jsapiref/index.html
- https://opensource.adobe.com/dc-acrobat-sdk-docs/library/jsdevguide/index.html
- https://opensource.adobe.com/dc-acrobat-sdk-docs/acrobatsdk/
