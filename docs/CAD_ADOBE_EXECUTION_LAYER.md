# CAD + Adobe Execution Layer (P15)

> Created 2026-07-06. The review→research→build record for making CAD and
> Adobe chat tasks EXECUTE instead of stopping at "connected-agent adapter
> buildout" or the screenshot loop. Companion to
> `docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md` (pipeline rules) and
> `docs/HUMAN_PARITY_CAPABILITY_MAP.md` (user-facing matrix).

## What the review found (2026-07-06)

- CAD: detection/routing/runbooks/approval gates were mature, but **zero
  app-native executors existed** — every mutation delegated to
  `agent.build_app_capability` or fell to the vision loop.
- Adobe: 6 real bridge tools existed (document status, layer inventory,
  layer state, text update, place asset, export proof — all ExtendScript
  via AppleScript `do javascript` built server-side in
  `scripts/claude-bridge.js`), but every creative/geometry op was a gap
  contract.
- Generic desktop: richer than the CAD/Adobe layers assumed — a11y
  read/click/setValue, keyboard/mouse synth, file ops, AppleScript,
  Shortcuts already executable.

## Research verdicts (mid-2026, sources in session research)

| Surface | Verdict | Why |
|---|---|---|
| Photoshop ExtendScript via AppleScript `do javascript` | **BUILT** | Still supported in 2026; the most reliable external drive; zero install; one TCC Automation grant. UXP `.psjs` is NOT externally invokable; Photoshop has no CLI. |
| Local code-CAD (OpenSCAD CLI, FreeCAD `freecadcmd`) | **BUILT** | Fully headless, deterministic, free; the highest-reliability executor class for agent-generated parts and STEP/FCStd/DXF conversion. OpenSCAD nightly (Manifold backend) ~100x faster; FreeCAD 1.1 stable. |
| A11y before/after tree diff | **BUILT** | ~50ms structured verification vs multi-second screenshot loops (pattern from mcp-server-macos-use). |
| Onshape REST | Deferred | Only full parametric CAD editable via pure HTTP (API keys), but 2025 policy caps free plans at 2,500 calls/YEAR — needs a call-budgeted executor + Marketplace key integration. |
| Adobe Firefly Services / Photoshop API v2 | Deferred | The only headless Photoshop, incl. cloud `/v2/execute-actions`, but enterprise-gated (~$1k/mo minimum, sales cycle). Adapter shape exists in gap contracts; not the individual default. |
| Zoo (KittyCAD) text-to-CAD | Deferred | Cheap first-draft geometry feeding the code-CAD sandbox; draft quality. |
| Autodesk APS / Fusion Automation API | Skip until demand | Token billing + dev-hub enrollment friction; Fusion desktop API has no headless mode. |
| Blender bpy | Later | Render/mesh-repair utility, not engineering CAD. |

## What shipped

### Photoshop ExtendScript adapters (3 gap operations flipped to executable)

- `desktop.photoshop_apply_adjustment_layer` — additive adjustment layers
  (levels/curves/hue_saturation/brightness_contrast/black_white), never
  modifies existing ones.
- `desktop.photoshop_apply_selection_or_mask` — Select Subject
  (`autoCutout`); `select_only` reports bounds, `mask_layer` applies a
  non-destructive reveal-selection mask. Never deletes pixels. This is the
  deterministic core of "remove the background".
- `desktop.photoshop_resize_canvas_or_image` — image_resize /
  canvas_resize (9-grid anchor) / crop_to_selection (fails closed without
  a selection).
- Shared guarantees (smoke-asserted): document-mismatch fail-closed, args
  JSON.stringify-escaped, **no `doc.save()`/`saveAs` ever emitted** —
  saving/exporting stays a separately approved step.
- Owners: pure builders + validators in
  `src/lib/photoshopExtendScriptAdapters.ts` (LOCKSTEP-duplicated in
  `scripts/claude-bridge.js`, drift caught by smoke byte-identity checks);
  client fns in `src/lib/desktopBridge.ts`; endpoints
  `/desktop/photoshop_apply_*`; registered in `openswanToolRuntime.ts`
  (approvalMode `ask` via the desktop mutation policy).
- Gap engine: the three ops are removed from
  `designAppAdapterGaps.ts` `photoshopGap` and added to
  `EXISTING_TOOLS.adobe_photoshop`; runbooks in
  `designAppOperationRunbooks.ts` now act through the real tools
  (photoshop `resize_layout` got its own runbook branch). InDesign gaps
  unaffected. Still gaps by design: generative_fill_or_remove +
  creative-AI ops (need Firefly or batchPlay-in-UXP), layer effects,
  smart objects, artboards (manage_layers/transform_layer/
  convert_color_mode flipped in P16 — see addendum).

### Local CAD execution (code-CAD sandbox)

- `desktop.cad_compile` — headless compile via `/desktop/cad_compile`:
  OpenSCAD (`.scad` → STL/3MF/DXF/PNG, `-D` parameter overrides,
  `--imgsize=W,H` — comma form, the real CLI syntax) and FreeCAD
  (`freecadcmd` running a generated python script for STEP/FCStd/IGES/DXF
  conversion + inspection). Binaries resolve from fixed install paths
  only; execFile argv (no shell); strict extraArgs allowlist; missing
  engine → honest `engine_not_installed` + brew install hint.
- `desktop.cad_inspect_file` — read-only structural inspection with no
  CAD app: STL (ASCII triangle count + bbox; binary count via size
  formula), DXF (layers, entity counts, `$INSUNITS`), STEP (schema,
  product count). Read-only policy (auto-approve).
- Pure owners: `src/lib/cadCodeExecutor.ts` (compile plans, FreeCAD
  python generation with `UC_CAD_JSON:` sentinel parsing, engine
  resolution incl. honest `mesh_to_brep_not_supported`, receipts),
  `src/lib/cadFileInspector.ts`.
- Runbooks (`engineeringCadOperationRunbooks.ts`): inspect_measure tries
  `desktop.cad_inspect_file` before app-native commands;
  batch_convert_or_translate prefers local FreeCAD conversion before
  cloud routes; model_or_bim_edit gains the "NEW part from description →
  OpenSCAD → STL + PNG proof" lane. Editing EXISTING app documents still
  routes app-native/buildout.

### A11y before/after diff (verification upgrade)

- `src/lib/a11yTreeDiff.ts` — bounded snapshot (≤400 nodes) + `+/-/~`
  diff + `describeA11yDiffForModel` (≤600 chars, every label/value routed
  through the injectable untrusted fence) + `classifyA11yDiffOutcome`
  (`no_change` after a mutation = the actionable failure signal).
- Wired: `desktop.read_a11y_tree` in `openswanToolRuntime.ts` keeps the
  last snapshot per app (bounded ≤8) and appends `Δ since last read: …`
  on consecutive reads — action verification without another screenshot.

## Ops notes

- The running desktop bridge predates these endpoints — **restart it**
  (`npm run bridge`) before the new tools work live.
- OpenSCAD/FreeCAD are optional user installs; tools fail honestly with
  install hints when absent (`brew install --cask openscad` / `freecad`).
- macOS TCC: Photoshop tools need the Automation (Apple Events) grant on
  first use — same grant the existing photoshop tools already use.

## Extension rules

- New Photoshop ops: add the JSX builder to
  `photoshopExtendScriptAdapters.ts` + LOCKSTEP copy in the bridge +
  endpoint + client fn + the 8 registration seams in
  `openswanToolRuntime.ts`; remove the op from `photoshopGap`'s missing
  map and update the runbook step. Never emit save/close/quit from JSX.
- New CAD engines: extend `CAD_ENGINE_BINARIES` fixed paths + the engine
  enum in `cadCodeExecutor.ts` (LOCKSTEP with bridge) — never PATH search
  or user-supplied binaries.
- Smokes: `smoke:photoshop-extendscript-adapters`,
  `smoke:cad-code-executor`, `smoke:cad-file-inspector`,
  `smoke:a11y-tree-diff` (all in `smoke:all`).

## P16 addendum (2026-07-06, same day)

- **Per-app automation profiles**: every design/engineering app now has a
  canonical doc in `docs/apps/` (31 apps; see `docs/apps/README.md`).
  `src/lib/appAutomationDocsIndex.ts` resolves tasks/app names → profile and
  `agentAppCapabilityBuildout` injects "read the profile FIRST" into every
  buildout prompt. Status headers are lockstep-pinned by
  `smoke:app-automation-docs-index`.
- **Photoshop wave 2** (gap ops flipped): `desktop.photoshop_manage_layers`
  (rename/duplicate/reorder/group — delete/merge/flatten deliberately do not
  exist), `desktop.photoshop_transform_layer` (move/scale/rotate, middle-center
  anchor, background/locked fail closed), `desktop.photoshop_convert_color_mode`
  (RGB/CMYK/Grayscale, honest no-op, loss note). Photoshop now has 12
  executable tools.
- **Illustrator base pair**: `desktop.illustrator_document_status` (read-only)
  + `desktop.illustrator_export_proof` (PNG/SVG only — PDF deliberately
  excluded because Illustrator PDF export re-associates the source document;
  fail-closed on missing output file). Pure module
  `src/lib/illustratorExtendScriptAdapters.ts`, LOCKSTEP bridge copies.
- **Blender engine**: `desktop.cad_compile` accepts `engine:'blender'`
  (`--background --factory-startup --python`, Blender 4.x operator names,
  Workbench render for headless reliability): mesh↔mesh conversion
  (stl/obj/ply/gltf/glb) + PNG render previews. FreeCAD keeps B-rep;
  stl→step stays honestly unsupported.
- Ops: bridge restart still required (`npm run bridge`); Blender optional
  install (`brew install --cask blender`).

## P17 addendum (2026-07-07): reach → observe → decide

- **Live reachability** (`src/lib/appReachability.ts` pure ladder +
  `src/lib/appReachabilityProbe.ts` live composer + tool
  `desktop.app_reachability`, read-only): bridge online → bridge build has
  the required commands (**stale-bridge detection** — compares
  `/desktop/health` tools against `REQUIRED_BRIDGE_COMMANDS_BY_DOC_SLUG`;
  bridge command names, not OpenSwan tool names) → installed → running →
  frontmost → a11y readable. First blocker + exact fix; launch/focus are
  flagged chat-fixable. Verified live on this Mac: Photoshop resolved as
  installed ("Adobe Photoshop 2026") but not running → needs_launch;
  FreeCAD/Blender correctly reported bridge_outdated against the stale
  running bridge.
- **One-round-trip observation** (`/desktop/observe_app` endpoint,
  `observeApp` client, tool `desktop.observe_app`, read-only): window
  state + a11y tree in a single bridge call (the a11y pipeline was
  factored into a shared `collectA11yTreeForApp` used by both endpoints,
  behavior-identical), then the runtime appends the Δ-since-last-read
  a11y diff AND a deterministic next-step suggestion.
- **Next-step advisor** (`src/lib/appScreenNextStep.ts`, pure): priority
  ladder — not running → launch; not frontmost → focus; dialog/sheet/alert
  open → handle it (save/overwrite/delete dialogs → confirm_with_user via
  approvals.request, NEVER auto-dismissed); mutation + no_change diff →
  reobserve then escalate to screenshot; empty a11y → screenshot + TCC
  hint; else proceed with a task-aware hint. Dialog labels are fenced as
  untrusted.
- **`/apps` chat command** (`src/lib/appsChatCommand.ts` + ChatTab
  intercept + registry/palette entry): `/apps` = capability overview from
  the docs/apps registry; `/apps <name>` = detail card + LIVE reachability
  (both surfaces share `runAppReachabilityProbe` so they can't drift).
- Smokes: `smoke:app-reachability` (108), `smoke:app-screen-next-step`
  (73), `smoke:apps-chat-command` (78) — all in `smoke:all`.

## P18 addendum (2026-07-07): loop integration + design exports + fix chips

- **Observe-loop integration**: CAD/MATLAB runbook observation collapsed
  from three calls (window_state → read_a11y_tree → screenshot) to
  `desktop.observe_app` + screenshot-when-visual-proof; desktop strategies'
  observeFirst/recommendedTools now lead with `desktop.app_reachability`
  (start / after failures) and `desktop.observe_app`. Photoshop/InDesign
  runbooks keep their app-native document_status observation (better than
  generic observe for those apps).
- **Headless design exports** (`desktop.design_export`, approval-gated):
  Inkscape (SVG → PNG/PDF/EPS, validated pixel dims, fixed binary paths)
  and Sketch `sketchtool` (.sketch → PNG document preview via
  export-to-dir + freshness-gated rename; artboard batch is a follow-up).
  Pure owner `src/lib/designCliExecutor.ts`; engine resolution hands
  raster↔raster to `desktop.convert_image`. Inkscape/Sketch app docs +
  index flipped to `partial` in lockstep.
- **Chat fix chips**: `/apps <name>` now renders a one-tap fix chip when
  reachability is chat-fixable ("Open Photoshop for me" / "Bring X to the
  front"), and a plain restart-the-bridge line for bridge_offline/outdated.
  Bridge/engine failures anywhere in chat now translate to a plain-language
  outcome pointing at `npm run bridge` / the install hint and a `/apps`
  recheck (chatUserFacingOutcomes; null contract preserved).
- Smokes: `smoke:design-cli-executor` (104) new; apps-chat-command now 101;
  chat-user-facing-outcomes extended (+17); engineering runbook smoke pins
  the observe_app replacement.

## P19 addendum (2026-07-07): /screen, folder watches, browser status

- **`/screen [app]`** (screenChatCommand.ts pure + appScreenObserver.ts
  composer + ChatTab intercept + registry): one-tap observation of the
  frontmost or named app — running/frontmost state, fenced window titles,
  plain-words Δ since the last look, suggested next step, and fix chips
  (launch/focus/dialog). Bridge offline → honest `npm run bridge` notice.
  The observer keeps its OWN bounded snapshot cache (deliberately separate
  from the tool loop's); the untrusted fence is a LOCKSTEP copy in
  screenChatCommand (computerUseSteering precedent).
- **Local folder watches** (folderWatchModel.ts; NO schema migration):
  `/watch my Downloads folder for new pdfs` → task stored as
  `local-folder: ~/Downloads | *.pdf` on the existing schedules row;
  CLIENT runner branch probes via bridge listFiles, snapshots into
  last_findings (≤100 files), diffs (added/removed/changed, ≤400-char
  summary), posts per notify_on. Bridge offline → skipped WITHOUT claiming
  (page watches can't be starved). Server watch-scheduler skips
  `local-folder:%` rows (LOCKSTEP; **needs
  `npx supabase functions deploy watch-scheduler`**). Honest caveat in
  every confirmation: runs while the app is open (local bridge).
- **Browser surface status in /apps** (buildAppsOverviewWithLive): the
  overview now appends a live line — local browser bridge online/offline ·
  Browserbase connected/not — so the third execution surface is visible
  next to the desktop apps.
- Smokes: folder-watch (111), screen-chat-command (95), watch-chat-commands
  (+33), apps-chat-command (114) — registered in smoke:all.

## P20 addendum (2026-07-07): images → chat → WordPress

- **Paste-an-image** (web): Cmd+V a screenshot/copied image anywhere in chat
  → it rides the existing drag-drop staged-upload path (Supabase storage,
  chip strip, 10-file cap). Text pastes untouched.
- **Image→WordPress lane** (`src/lib/wpImagePostFlow.ts` pure +
  ChatTab send-time wiring): attached images + WordPress wording (or a
  pasted wp-admin URL) → a bounded directive with EXACT `wp.upload_media`
  recipes carrying the real storage paths, joined into the agent prompt;
  a friendly routing notice shows the plan. Site URLs normalize
  Dealer-Inspire-style subdir installs verbatim
  (`…/wp/wp-admin` → site base `…/wp`); credential-bearing URLs are
  refused, never echoed. Rules baked in: every upload is an approval-gated
  WordPress write; drafts by default; onePasswordItem is NEVER invented —
  the model must ask; connect guidance says app-password → 1Password, and
  passwords never go in chat. Picker (non-staged) images are staged to
  storage at send time on web so the tool can reach the bytes.
- Smoke: `smoke:wp-image-post-flow` (115) in smoke:all.
