# Direct Desktop Task Expansion Research

Date: 2026-06-16

## Why This Matters

The Pearson PNG issue exposed a general rule:

> If the user names a desktop app but the requested outcome is a bounded file or OS operation, route to the deterministic bridge tool first and verify the artifact. Use the app only when the app's document state, layers, UI, account state, or creative semantics are required.

This keeps chat from driving fragile app dialogs for tasks that can be done more safely with file tools. It also gives the user a real proof receipt instead of a model sentence that says "Done."

## Current Pattern

The shipped image-conversion route now works like this:

1. `computerTaskPlanner` detects a direct local image format conversion.
2. `chatComputerRequestRouter` exposes ordered action items:
   - `desktop.file_search`
   - `desktop.file_stat`
   - `desktop.convert_image`
   - `desktop.file_stat`
3. `ChatTab` short-circuits before the generic agent and calls the direct runtime.
4. The runtime only reports success after output path, target format, and byte size are returned.
5. `chatComputerOutcomeUx` refuses compact success when proof is missing.

This pattern should become the template for similar requests.

The same direct runtime path now also covers bounded local file operations:

- `desktop.file_rename`
- `desktop.file_copy`
- `desktop.file_trash`
- `desktop.file_mkdir`
- `desktop.file_write_text`
- `desktop.open_path` when the request contains a concrete path, common local folder, or filename plus folder scope

## Decision Rule

Use a direct bridge tool when all of these are true:

- The user asked for a simple local result: convert, rename, copy, open, create, write, archive, list, read, inspect, or verify.
- The source and target can be resolved to local paths, clipboard state, browser state, or a scriptable first-party app.
- The operation can return a typed receipt: path, size, modified time, URL, app/window identity, note id/title, or browser/upload proof.
- The app name is incidental: "in Photoshop," "in Finder," "in Preview," "in Notes," or "in Excel" describes the user's mental model, not necessarily the safest control surface.

Use the desktop app workflow when any of these are true:

- The user needs app-specific document state: Photoshop layers, masks, selections, text layers, active PSD, InDesign text frames, links, fonts, preflight, page ranges, CAD objects, spreadsheet formulas, or IDE project state.
- The user asks for visual edits, creative edits, generative/content-aware operations, layout changes, account operations, posting, sending, checkout, upload, publish, or destructive/overwrite work.
- The result cannot be verified with a direct tool receipt.

## AI Need Tiers

| Tier | When To Use AI | Examples | Default Runtime |
|---|---|---|---|
| No AI needed | The request is a bounded OS/file/browser-status action with typed inputs and proof receipts. | Convert image format, rename/copy/trash a file, create a folder, write a plain text file, open a path, list browser tabs, read clipboard, run a named shortcut. | Direct bridge tool, no model loop after routing. |
| AI assisted | The task needs a model to choose semantic controls, interpret app/browser state, or monitor a workflow, but actions are still deterministic tool calls. | Log into a site and update a product, use an unfamiliar app UI, extract fields from a document, navigate a multi-step browser flow. | Model/agent plans and observes; bridge/browser tools execute with approvals and proof. |
| AI required | The requested output depends on generation, reasoning, research, recovery, or building a missing capability. | Generate an image/background, write marketing copy, research vendors, debug a failed bridge, build an app adapter, create a CAD/music/design artifact from intent. | Model/agent is part of execution; deterministic tools only provide observations, edits, and verification. |

## Expansion Matrix

| User Ask Family | Examples | Preferred Direct Path | Proof Required | App Needed When |
|---|---|---|---|---|
| Image format conversion | "Open X in Photoshop and save as PNG/JPG", "convert this screenshot to jpg" | `desktop.convert_image` | output path, format, byte size | user asks for layers, edits, masks, crop, resize, color, active PSD export |
| File rename/copy/move/trash | "Open Finder and rename X to Y", "duplicate this PDF on Desktop" | `desktop.file_search` -> `desktop.file_rename` / `desktop.file_copy` / `desktop.file_trash` -> `desktop.file_stat` | source path, destination path, post-action stat | user needs Finder visual organization, tags, labels, cloud conflict resolution |
| Folder creation | "Open Finder and make a Project Assets folder" | `desktop.file_mkdir` -> `desktop.file_stat` | folder path exists | user needs Finder sidebar, cloud-drive sharing, permissions UI |
| Text file creation/append | "Open TextEdit and make notes.txt with hello" | `desktop.file_write_text` | path, bytes written, final size | rich text, document formatting, app-specific template |
| Open file/folder | "Open this PDF in Preview", "show Downloads in Finder" | `desktop.open_path` with optional `appName` | path opened, appName echo, optional window state | user needs to interact further inside the app |
| Clipboard updates | "Open Notes and copy this checklist to clipboard" | `desktop.clipboard_write` | clipboard write receipt/readback when safe | user needs paste into a specific app field |
| Notes simple note | "Open Notes and create a note that says..." | `desktop.notes_create` or `desktop.run_applescript` recipe | note creation receipt plus app focus/window proof when available | user needs formatting, folder choice, attachments, sharing |
| Browser tab/status reads | "Open Chrome and tell me what tabs are open" | `desktop.list_browser_tabs` | browser/title/url list | user needs page interaction or login workflow |
| Local file upload to web | "Upload the Desktop image to Shopify" | `desktop.file_search` -> `desktop.file_stat` -> browser upload tool | matched path, upload tool receipt, DOM/screenshot proof | drag/drop-only UI or human verification |
| Shortcut execution | "Open Shortcuts and run Resize Images" | `desktop.shortcuts_run` | shortcut name, exit status/output | shortcut prompts for manual choices |
| Read-only Adobe status | "Check InDesign missing links", "show Photoshop layers" | app-native status/inventory bridge tools | document/layer/text/link inventory | mutation/export/edit requested |
| Adobe text/find-change | "Change disclaimer in banner.indd..." | InDesign script-backed update/find-change route | before/after text inventory plus file stat when saved/exported | layout/design judgement or unsupported operation |
| Proof/package/export from design apps | "Export this InDesign proof PDF", "package document" | app-native export/package tools | output proof/package file stat plus document status | missing adapter or unresolved production blockers |

## Implementation Shape

Each direct task family should ship as four pieces:

1. **Pure classifier/extractor**
   - Lives in `src/lib/computerTaskPlanner.ts` or a focused helper.
   - Returns typed params, not just boolean intent.
   - Smoke-test with user phrasings that mention apps unnecessarily.

2. **Route action items**
   - Lives in `src/lib/chatComputerRequestRouter.ts`.
   - Converts the task to ordered actions with explicit proof.
   - Example: resolve -> stat -> mutate -> stat.

3. **Direct runtime executor**
   - Small module like `src/lib/directImageConversionRuntime.ts`.
   - Runs before `executeComputerTaskWithAgent`.
   - Fails closed when proof is missing.

4. **Outcome proof gate**
   - Lives in `src/lib/chatComputerOutcomeUx.ts`.
   - Compact success only when receipt proof is present.
   - Wrong app-specific recovery copy must be blocked for direct routes.

## High-Leverage Next Builds

1. **Direct local file mutation runtime**
   - Cover "open Finder and rename/copy/move/delete/make folder/write file."
   - Use existing bridge endpoints.
   - Proof: source and destination `file_stat`.
   - Risk: delete/move/overwrite must stay approval-gated.

2. **Direct open-path runtime**
   - Cover "open X in Preview/Photoshop/Finder" when the ask is only open/show.
   - Use `desktop.open_path`.
   - Proof: opened path, appName echo, optional `desktop.window_state`.

3. **Direct note/reminder/calendar recipes**
   - Notes already has `desktop.notes_create`.
   - Expand `desktop.run_applescript` recipes for Reminders and Calendar.
   - Proof: created item summary and app/script receipt.

4. **Expanded image transform tool**
   - Extend `desktop.convert_image` into `desktop.transform_image`.
   - Add resize, rotate, quality, metadata strip, thumbnail, and target folder.
   - Keep it non-clobbering by default.
   - Use Photoshop only for layer/document edits.

5. **Archive/compress/extract tool**
   - Add `desktop.archive_create` and `desktop.archive_extract`.
   - Cover "zip this folder", "unzip this file", "compress images for upload."
   - Proof: archive/extract path stats and file count.

6. **PDF utility tool**
   - Add read-only metadata/page count first.
   - Later add split/merge/compress only with approval and output proof.
   - Avoid Preview UI for simple PDF operations.

7. **Browser-file transfer direct path**
   - Strengthen upload/download routes so "use Finder to upload..." resolves the file directly and uses browser upload.
   - Proof: matched file stat, upload action receipt, DOM/screenshot proof.

## Guardrails

- Never silently overwrite. Add explicit overwrite detection and approval.
- Never claim completion from model text. Require receipts.
- Never use a direct tool when app-specific state matters.
- Never use coordinates if a direct tool, app script, DOM locator, or accessibility element exists.
- Persist the direct-route decision and proof so recovery can retry only the failed step.
- If the bridge health does not advertise the required tool, show a stale-bridge restart action instead of generic app failure.

## Suggested Phase Order

1. Generalize the direct-runtime pattern into a small registry:
   - matcher
   - extractor
   - executor
   - proof formatter
   - failure copy

2. Add direct local file mutation runtime using existing bridge tools.

3. Add direct open-path runtime.

4. Add Notes/Reminders/Calendar script recipes.

5. Add transform/archive/PDF bridge endpoints.

6. Add route smokes for 20 real user prompts that include unnecessary app names.

7. Add bridge-health stale-tool checks so a missing endpoint becomes a precise restart action.

## Test Prompts To Pin

- "Open Finder and rename landscaping-img.png on my desktop to landscaping-img-1.png."
- "Open Finder and duplicate invoice.pdf in Downloads."
- "Open TextEdit and make a file on my desktop called notes.txt that says hello."
- "Open Preview and save pearsoncdjr-img as a jpg."
- "Open Photoshop and convert pearsoncdjr-img to png."
- "Open Photoshop and crop pearsoncdjr-img." Must **not** use direct conversion.
- "Open Notes and create a note that says call dealer tomorrow."
- "Open Chrome and tell me all the tabs I have open."
- "Use Finder to upload the Desktop image to Shopify." Must resolve file directly, then browser upload.
- "Zip the Project Assets folder on my Desktop."
