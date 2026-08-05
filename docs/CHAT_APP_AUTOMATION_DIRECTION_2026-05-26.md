# Chat + Desktop App Automation Direction 2026-05-26

## Decision

The main chat foundation should move toward a task operating system for real
computer/app work. The highest-priority product path is now deterministic
desktop-app automation, starting with Adobe InDesign marketing-banner/layout
edits and Adobe Photoshop image/composite edits that involve layers, text,
links/assets, masks/selections, generative fill, exports, and package handoff.

2026-05-27 focus: keep the broad Adobe Creative Cloud profile layer for
Illustrator, Premiere Pro, After Effects, Acrobat, Lightroom, Audition, and
other CC apps, but continue prioritizing the dedicated Photoshop and InDesign
lanes first. Those two apps have script-backed bridge tools today, so new work
should deepen their document/layer inventory, mutation receipts, proof review,
package/export handoff, and failure recovery before expanding more native
adapters.

## Research Basis

- Adobe's UXP InDesign docs say scripts are the quickest way to automate tasks,
  and InDesign v18.0+ supports UXP scripts:
  https://developer.adobe.com/indesign/uxp/scripts/
- The InDesign DOM reference exposes first-class objects for Document, Layer,
  TextFrame, Link, DataMerge, ExportFormat, and related layout APIs:
  https://developer.adobe.com/indesign/dom/api/
- Layer objects expose names, visibility, lock state, printable state, labels,
  duplication, movement, merging, and removal, so layer-aware inspection is a
  structured operation instead of a screenshot-only task:
  https://developer.adobe.com/indesign/dom/api/l/Layer/
- TextFrame objects expose `contents`, frame relationships, fill/stroke state,
  and methods, so named text-layer updates should be script-backed before UI
  clicks:
  https://developer.adobe.com/indesign/dom/api/t/TextFrame/
- Link objects expose relink/update/show/reveal operations, so replacing banner
  imagery should become a deterministic link workflow after file/path checks:
  https://developer.adobe.com/indesign/dom/api/l/Link/
- Document objects expose `exportFile(...)`, so proof PDF/PNG export should be a
  controlled document action with destination-file verification:
  https://developer.adobe.com/indesign/dom/api/d/Document/
- Photoshop's UXP scripting docs keep the broader Adobe direction consistent:
  use app-native DOM APIs first, and lower-level action descriptors such as
  batchPlay only where the DOM does not expose the needed operation:
  https://developer.adobe.com/photoshop/uxp/scripting/
- Photoshop document-changing automation should run inside modal execution
  scope, which is now represented in the control-surface ladder before any
  lower-level action descriptor or UI fallback:
  https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/executeasmodal/
- Adobe's cloud Photoshop and InDesign APIs are useful for renditions,
  server-side document operations, data merge/custom-script style pipelines, and
  repeatable batch workflows, but they require explicit upload/output approval
  and are not a substitute for local app/document state when the user uploaded a
  live file for local editing:
  https://developer.adobe.com/firefly-services/docs/photoshop/
  https://developer.adobe.com/firefly-services/docs/indesign/
- Native-app fallbacks should use OS automation/accessibility trees before
  coordinates: Apple automation/AppleScript when the macOS app exposes a
  scriptable surface, and Microsoft UI Automation for Windows app control.
  https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/
  https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32
- Browser-app tasks should use semantic DOM/CDP/ARIA plus resilient
  Playwright-style locators and actionability checks before screenshots or
  coordinate fallback. Locator/actionability failures should return structured
  recovery options instead of repeated blind retries.
  https://playwright.dev/docs/locators
  https://playwright.dev/docs/actionability

## Product Direction

Chat should keep ordinary conversation quiet, but when the user asks for a
desktop/app task it should build a hidden, structured execution envelope:

1. Classify scenario and task shape.
2. Resolve files, attachments, package folders, and grants.
3. Pick a strategy and grounding plan.
4. Prefer app-native scripting/DOM/API tools.
5. Fall back to accessibility/menu actions.
6. Use screenshot and coordinates only for visual proof or last-resort gaps.
7. Gate file mutations, relinks, save/export/package, publish, and destructive
   work behind approval.
8. Verify with app-native inventory, status, screenshots, exports, receipts,
   and file stats.
9. Persist the run ledger, proof artifacts, failures, and reusable workflow
   recipe.

## App-Wide Foundation

- Chat remains the main command surface. It should show only approval requests,
  proof, concise blockers, and explicitly requested debug detail.
- Chat request analysis is now explicit through
  `src/lib/chatComputerRequestRouter.ts`. When a message asks to operate
  another app, browser, local file, CAD/engineering tool, Adobe design file, or
  unfamiliar desktop program, the router builds one hidden best-path object
  before execution: task preview, selected pipeline, app/browser strategy,
  ordered Photoshop/InDesign pipeline when relevant, surface order, risk,
  approval reason, recommended tools, fallback pipelines, and completion-proof
  requirements. It deliberately leaves pure image generation, simple WordPress
  conversational actions, build-discovery prompts, bridge diagnostics, and
  workflow-recording prompts on their existing routes.
- `src/lib/chatComputerRequestUx.ts` owns the user-facing notice decision for
  those routes. Safe routes stay hidden until there is a result or blocker;
  approval routes expose one plain-language action, bridge check, compact
  proof, and badges; debug details stay available only when requested. Live
  computer handoff metadata and persisted chat rows now carry that same notice
  so browser/desktop approval copy stays consistent across first render,
  refresh, and recovery.
- `src/lib/computerTaskEvidenceContract.ts` owns the hidden proof contract for
  those same routes. Browser work requires semantic locators, actionability
  checks, origin/session proof, and human-verification stops. Photoshop and
  InDesign work requires app-native UXP/DOM/API control first, refreshed
  document/layer/text/link/preflight inventory, approval before mutation or
  output writes, proof artifacts, file stats, and fresh evidence before retry.
  Live handoff metadata and persisted chat rows carry a compact copy so refresh
  and recovery surfaces enforce the same proof contract.
- `src/lib/computerTaskEvidenceRecovery.ts` applies that proof contract when a
  task fails. It turns contract failures into user-safe recovery choices:
  retry once with fresh DOM/app/file evidence, ask the user to clear auth,
  verification, bridge, permission, or approval blockers, launch a connected
  agent only for a bounded missing-adapter repair, or stop with details. It
  also produces the required evidence tools and readiness state for the retry
  gate so missing or stale observations block another attempt.
- Office and run ledgers own deeper observability: selected strategy,
  grounding, bridge health, tool events, receipts, artifacts, retries, and
  connected-agent buildout state.
- The desktop/browser bridge owns local execution. Chat should be able to pair,
  recover, and retry bridge work without asking the user to copy internal
  commands unless local permissions or billing policy truly require them.
- Connected coding agents such as Codex, Claude Code, Cursor Composer, Gemini,
  OpenCode, and custom bridges should be used as capability builders when the
  app lacks a deterministic adapter, then the original task gets one bounded
  retry with the new adapter context.
- New app capabilities must ship with a smoke case that proves classification,
  required evidence, approval gates, and verification output for the user task.
- Photoshop/InDesign proof review must stay structured but quiet. The runtime
  should carry required evidence, approval-before steps, pass criteria,
  fail-closed blockers, and artifact kinds in metadata/prompts, while chat shows
  only the compact design-task card, the proof/package state, and an actionable
  review checklist.
- App automation control-surface choice is now explicit through
  `src/lib/appAutomationControlSurfaces.ts`. Chat and connected agents receive a
  hidden ladder that names the target app, task family, app-native/API/OS/UI
  control order, fail-safe rules, source refs, and the buildout checklist needed
  before retrying an unfamiliar app task.
- Photoshop and InDesign operation execution is now explicit through
  `src/lib/designAppOperationRunbooks.ts`. The hidden runtime prompt turns
  detected operations into observe/approve/act/verify/recover/stop runbooks for
  text edits, placed-asset relinks, proof exports, package handoffs, smart-object
  placement, localized/generative edits, adjustment-layer work, and raster
  proofs. These runbooks are metadata/prompt context, not verbose chat output.
- Still-missing Photoshop/InDesign operations now have typed adapter-gap
  contracts in `src/lib/designAppAdapterGaps.ts`. InDesign resize/layout plus
  Photoshop resize/canvas, adjustment-layer, selection/mask, and
  generative/content-aware tasks carry a
  connected-agent buildout package with official Adobe source refs, missing
  bridge tools, prerequisite observations, approval gates, required evidence,
  smoke cases, fail-closed rules, and the retry prompt for the original task.
  This is the path for "the chat builds what is needed" when the bridge lacks a
  deterministic tool.
- Before/after object evidence is now explicit through
  `src/lib/designAppObjectManifest.ts`. Each Photoshop/InDesign task can carry a
  hidden `design_object_manifest` contract for document, layer, text-frame,
  link, font/preflight, smart-object, selection/mask, adjustment-layer, proof,
  and package-folder entities. The manifest requires source tools, timestamps,
  redacted basename/hash paths, content hashes or summaries, approval evidence,
  changed-entity comparisons, and blocked-manifest reasons.
- The manifest contract now has an executable artifact builder/auditor in the
  same file. When real bridge tool results are available, it normalizes
  before/after captures, action receipts, approvals, proof/package outputs, and
  placed-asset paths into a redacted `design_object_manifest` artifact. Missing
  approvals, missing before/after snapshots, missing proof/package evidence, or
  unredacted local paths become audit blockers before chat claims completion.
- Chat handoff and persisted-message metadata now accept the compact
  `design_object_manifest` artifact summary. This gives Office/run-ledger/proof
  surfaces a safe handoff shape for audited manifest results without exposing
  raw bridge payloads, local paths, or full copy text in the chat transcript.
- `src/lib/designAppManifestLedger.ts` now converts those audited summaries into
  `design.object_manifest` runtime ledger actions. Verified manifests write a
  completed event with proof/package artifact basenames; blocked manifests write
  a blocked event with the missing evidence so Office can show why completion
  was refused.
- `src/lib/designAppRuntimeManifest.ts` now attaches that ledger path to live
  OpenSwan desktop tool execution. It groups hidden Photoshop/InDesign
  before/action/after captures into an audited manifest, strips those captures
  from normal persisted tool metadata, and appends only the compact
  `design.object_manifest` ledger action.
- `src/lib/designAppCreativeAi.ts` now owns the creative-AI capability plan for
  Photoshop, InDesign, and Firefly-backed work. It detects text-to-image,
  generative fill/remove, generative expand, generated background/asset
  placement, creative variants, and InDesign data-merge variants; then gives
  chat/OpenSwan the prompt/data inputs, target layer/frame/selection evidence,
  generated-output receipts, proof checks, source refs, connected-agent
  buildout trigger, and reusable recipes for Photoshop background packs,
  variant contact sheets, localized cleanup, canvas expansion, InDesign frame
  placement, placed-image expansion, and data-merge campaign variants.
- `src/lib/designAppExecutionPipeline.ts` now owns the ordered pipeline for
  Photoshop/InDesign work. It combines the automation plan, operation runbooks,
  creative-AI recipes, and adapter-gap contracts into phases for source/package
  resolution, document inventory, approval, script/API mutation, proof/package
  output, verification, and connected-agent recovery. This compact pipeline is
  persisted in chat metadata so retries and recovery after refresh do not lose
  the intended execution order.

## Adobe Creative Cloud Coverage

The broad Adobe CC path is profile-aware, not a promise that every Adobe app has
native control parity. It classifies Illustrator, Premiere Pro, After Effects,
Acrobat/Reader, Lightroom, Audition, Animate, Media Encoder, Bridge,
Dreamweaver, InCopy, Character Animator, Express, Firefly, Fresco, Capture,
Scan, Fill & Sign, Frame.io, Photoshop Express, Substance 3D, and related CC
tasks into `adobe_cc_control`.

For those apps, the runtime should resolve source/output files, observe the app
and window state, use documented app-native automation when available, and call
`agent.build_app_capability` when a missing adapter blocks safe execution. It
should not use broad Adobe coverage as an excuse to guess coordinates or invent
shortcuts.

## InDesign Banner Path

For "make changes in this InDesign marketing banner with different layers",
the runtime should follow this order:

1. Resolve the exact `.indd`, `.idml`, `.indt`, or staged package folder.
2. Open/focus Adobe InDesign and confirm the active document name/path.
3. Run `desktop.indesign_document_status` for pages, spreads, layers, links,
   fonts, locked/hidden layers, saved/modified state, and package blockers.
4. Run `desktop.indesign_text_inventory` to map named text frames, layer names,
   labels, overset state, visibility, and matching copy.
5. Apply copy edits with `desktop.indesign_batch_update_text_layers`,
   `desktop.indesign_batch_find_change`, or `desktop.indesign_update_text_layer`.
6. For layer visibility/lock changes, use `desktop.indesign_set_layer_state`
   after approval; it refuses missing or ambiguous layer names and returns
   before/after visible and locked state.
7. For asset replacement, verify the replacement file and current link state,
   then use a scripted relink/place adapter when available; otherwise delegate a
   bounded app-capability buildout instead of blind coordinates.
8. Re-run inventory/status after each mutation.
9. Relink selected or named placed assets with `desktop.indesign_relink_asset`
   after approval and a local file read grant; stop if the target link is
   ambiguous instead of using menu/coordinate guesses.
10. Export proof PDFs with `desktop.indesign_export_proof` after approval and a
   local file write grant, then verify output with `file_stat` and
   screenshot/proof evidence.
11. Package production handoff folders with `desktop.indesign_package_document`
    after approval and a local output-folder write grant; the bridge uses
    InDesign `packageForPrint`, returns pre-package link/font counts, writes the
    package report by default, and verifies the folder summary after completion.

## Photoshop Image Path

For "open this Photoshop file and remove/replace/edit/export the image", the
runtime should follow this order:

1. Resolve the exact `.psd`, `.psb`, image file, or staged package folder.
2. Open/focus Adobe Photoshop and confirm the active document name/path.
3. Run `desktop.photoshop_document_status` and
   `desktop.photoshop_layer_inventory` for dimensions, resolution, color
   mode/profile, layer names, visibility, locks, masks, smart objects, text
   layers, and linked/embedded assets.
4. Confirm selection/mask state before localized generative/content-aware edits.
5. Prefer script-backed Photoshop DOM/action tools such as
   `desktop.photoshop_set_layer_state`,
   `desktop.photoshop_update_text_layer`, `desktop.photoshop_place_asset`, and
   `desktop.photoshop_export_proof`; use menu/accessibility commands only for
   known app-native actions.
6. For generative/content-aware or localized edits, require a runbook that
   verifies the target layer plus selection/mask state before mutation, asks for
   approval with the target area and prompt/action, and verifies with refreshed
   document/layer inventory plus a raster proof.
7. Require a local file read grant before placing external assets and a local
   file write grant before proof export.
8. Gate destructive pixel edits, generative fill, flatten/rasterize, save over
   source, and final export behind approval.
9. Verify with refreshed layer/status inventory, screenshot proof, raster proof
   export, and output file stats.

## Creative AI Path

Creative AI is useful, but it must still behave like app automation rather than
an untracked chat idea. For Photoshop, InDesign, and Firefly-backed requests the
runtime should:

1. Classify the capability: generative fill/remove, generative expand,
   text-to-image asset, creative variants, InDesign text-to-image frame,
   InDesign generative expand, InDesign data merge, or Firefly batch assets.
2. Convert the capability into a reusable recipe that names brief inputs,
   setup, execution, approval, proof artifacts, buildout tool, and recovery
   hint before any adapter is called.
3. Insert the recipe into the ordered execution pipeline so generation never
   skips source resolution, document inventory, approval, output receipts, or
   proof verification.
4. Resolve the exact source document/template/CSV, target layer/frame/link,
   selection/mask, output folder, and proof destination before generation.
5. Ask approval for the creative prompt or data source, brand constraints,
   cloud processing/upload, generated asset placement, relink, save, export,
   package, or batch variant spend.
6. Prefer deterministic app/API routes: Photoshop UXP/modal/batchPlay or
   Photoshop API for PSD/image workflows, InDesign UXP/DOM or InDesign APIs for
   layout/data-merge workflows, and Firefly API for generated assets.
7. If the exact bridge tool is missing, call `agent.build_app_capability` with
   the creative-AI gap contract instead of using blind coordinates.
8. Require generation receipts, asset basenames/hashes, refreshed app-native
   inventory, screenshot/proof exports, and `file_stat` evidence before chat can
   claim the creative output is ready.

## Next Build Priorities

- Improve Photoshop and InDesign proof-review UX first: chat should show a
  compact proof card for exported PDFs/images, screenshot comparisons, and
  package summaries while keeping local paths hidden unless requested.
- Deepen InDesign package/handoff receipts using the same script-backed pattern
  as document status, text inventory, asset relink, and PDF proof export:
  missing fonts/links, output folder summary, package report, and retry
  guidance should be machine-readable.
- Expand the shipped Photoshop bridge slice (`desktop.photoshop_document_status`,
  `desktop.photoshop_layer_inventory`, `desktop.photoshop_set_layer_state`,
  `desktop.photoshop_update_text_layer`, `desktop.photoshop_place_asset`, and
  `desktop.photoshop_export_proof`) with dedicated, approval-gated generative
  fill/content-aware actions and before/after layer inventory receipts.
- Convert the creative-AI gap contracts into executable adapters: Firefly image
  generation, Photoshop generative expand, Photoshop creative variants,
  InDesign text-to-image frame placement, InDesign generative expand/relink, and
  InDesign data-merge variants with sample proof receipts.
- Use the new live `design.object_manifest` ledger action in Office/proof
  surfaces so users see proof/package outcomes and blockers without seeing raw
  local bridge payloads.
- Convert the adapter-gap contracts into executable bridge coverage, starting
  with InDesign resize/layout and Photoshop adjustment-layer plus
  selection/generative batchPlay adapters. Each new bridge tool should satisfy
  the contract's source refs, approval gates, required evidence, smoke cases,
  and fail-closed rules before the original task retries.
- Turn successful InDesign traces into reusable workflow templates for dealer
  banners, social ads, web banners, print flyers, and data-merge variants.
- After the Photoshop/InDesign loops are stronger, extend the same
  app-native-first pattern to Illustrator asset/layout edits, Premiere/After
  Effects render flows, and CAD/engineering apps.
