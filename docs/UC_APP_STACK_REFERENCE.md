# The Underground Circle - App Stack Reference

> Current app map for agents before writing code.
> Last reviewed: 2026-06-02

`AGENTS.md` and `docs/AGENTS_ROADMAP.md` own agent workflow and runtime
ownership. This file maps the app.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Expo 54, React Native 0.81.5, React 19, React Native Web |
| Language | TypeScript |
| Backend | Supabase Auth, Postgres, Realtime, Edge Functions |
| Web deploy | Netlify |
| AI/runtime | BlackSwan/OpenSwan, Claude Code/Codex bridges, Browserbase Computer Use |
| Provider routing | `llm-proxy`, `swanbot-ai`, provider marketplace, BYOK keys |
| Local services | app 8081, OpenSwan proxy 18790, Claude bridge 7778 |

## Do-Not-Break Patterns

1. `src/lib/animationPatch.ts` must be the first import in `App.tsx`.
2. Use the frontend Supabase singleton in `src/lib/supabase.ts`.
3. Prefer `src/lib/authSession.ts` helpers for auth reads. Direct Supabase auth
   calls must be caught.
4. Do not put secret values into prompts, persisted chat messages, logs, or
   activity entries.
5. React Native Web pointer behavior is uneven; use DOM listeners when local
   patterns already do.
6. Before adding a new helper path, check the roadmap owner and the worktree
   checklist in `src/lib/agentDevelopmentStandards.ts`.
7. Office placement stays on the 16px grid.

## Main Surfaces

| Surface | Role |
|---|---|
| Chat | Agent conversation, model picker, automation routing, computer tasks, artifacts, thread persistence |
| Office | Live agent dashboard, local bridge visibility, activity feed, controls, approvals |
| Feed | Goals, plans, missions, tasks, proof of work, team operating loop |
| Rooms | Project rooms, file surfaces, room chat, services, playground, task execution |
| Marketplace | Provider keys, integrations, model catalog, browser/computer providers |
| Computer Use | Browserbase sessions, local bridge tools, guarded desktop/browser actions |

## Core Runtime Files

| Concern | File(s) |
|---|---|
| Agent standards and worktree quality | `src/lib/agentDevelopmentStandards.ts`, `src/lib/openswanWorktreeConfig.ts`, `docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md` |
| Chat classification | `src/lib/chatAutomationPlanner.ts` |
| Chat computer request route | `src/lib/chatComputerRequestRouter.ts` |
| Chat computer request UX | `src/lib/chatComputerRequestUx.ts` |
| Computer task evidence contract | `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskEvidenceRecovery.ts` |
| Chat plan execution | `src/lib/runChatAutomationPlan.ts` |
| SwanBot client path | `src/lib/swanbot.ts` |
| SwanBot edge path | `supabase/functions/swanbot-ai/index.ts` |
| SwanBot v2 typed loop | `supabase/functions/swanbot-v2-ai/index.ts` |
| SwanBot/OpenSwan default readiness | `src/lib/swanbotOpenSwanReadiness.ts` |
| Typed agent loop | `src/lib/agentExecutionCore.ts` |
| OpenSwan session runtime | `src/lib/openswanSessionRuntime.ts` |
| Tool catalog | `src/lib/openswanToolRuntime.ts` |
| Provider model resolution | `src/lib/serviceProfileSouls.ts` |
| Cross-provider routing | `src/lib/crossProviderRouter.ts`, `src/lib/universalInvoke.ts` |
| Billing preference | `src/lib/billingPriority.ts` |
| BlackSwan routing | `src/lib/blackswanRouting.ts` |
| Computer task runtime | `src/lib/computerTaskRuntime.ts` |
| Browser computer use | `src/lib/computerUse.ts`, `supabase/functions/computer-use-agent/index.ts` |
| Computer capability expansion | `src/lib/computerCapabilityRegistry.ts`, `src/lib/computerCapabilityExpansion.ts` |
| Local desktop awareness | `src/lib/localComputerAwarenessIntent.ts` |
| Office bridge readiness | `src/lib/bridgeHealthDiag.ts`, `src/lib/officeBridgeReadiness.ts`, `src/screens/circles/tabs/office/Whiteboard.tsx` |
| App automation control surfaces | `src/lib/appAutomationControlSurfaces.ts` |
| Engineering/CAD operation runbooks | `src/lib/engineeringCadOperationRunbooks.ts` |
| Adobe app profiles | `src/lib/adobeCreativeCloudApps.ts` |
| Design object manifest | `src/lib/designAppObjectManifest.ts` |
| Design manifest ledger | `src/lib/designAppManifestLedger.ts` |
| Design runtime manifest assembly | `src/lib/designAppRuntimeManifest.ts` |
| Design creative AI capabilities | `src/lib/designAppCreativeAi.ts` |
| Design execution pipeline | `src/lib/designAppExecutionPipeline.ts` |
| Design adapter gap contracts | `src/lib/designAppAdapterGaps.ts` |
| Design operation runbooks | `src/lib/designAppOperationRunbooks.ts` |
| Design proof review | `src/lib/designAppProofReview.ts` |
| Marketplace prompt context | `src/lib/marketplaceIntegrationContext.ts` |

## Repo Layout

```text
src/
  screens/
    auth/
    circles/
      tabs/                 Chat, Rooms, Office, Feed, Marketplace, etc.
    profile/
    agents/
  components/
    chat/
    agent/
    computer-use/
    marketplace/
    openswan/
  lib/
    supabase.ts
    authSession.ts
    swanbot.ts
    agentExecutionCore.ts
    openswanSessionRuntime.ts
    openswanToolRuntime.ts
    chatAutomationPlanner.ts
    runChatAutomationPlan.ts
    serviceProfileSouls.ts
    crossProviderRouter.ts
    universalInvoke.ts
    computerUse.ts
    computerTaskRuntime.ts
supabase/
  functions/
    swanbot-ai/
    swanbot-v2-ai/
    llm-proxy/
    computer-use-agent/
    automation-executor/
    heartbeat-agent/
  migrations/
scripts/
  claude-bridge.js
  browser-bridge.js
  codex-bridge.js
  gemini-bridge.js
  mcp-agent-connect.js
docs/
```

## Chat Flow

1. User sends through `ChatTab`.
2. `chatAutomationPlanner` classifies the message and execution kind.
3. If the message asks to operate another app, browser, local file, CAD tool,
   Adobe design file, or unfamiliar desktop app, `chatComputerRequestRouter`
   builds one hidden best-path route with the selected pipeline, app strategy,
   surface order, approval reason, recommended tools, fallback pipelines, and
   completion proof before dispatch.
4. Stable plan kinds go through `runChatAutomationPlan`.
5. Plain agent/model turns route through SwanBot/OpenSwan runtime paths.
6. Provider choice is resolved by selected model, connected providers,
   `serviceProfileSouls`, and cross-provider routing helpers.
7. Bot output is persisted to the active chat thread with compact metadata for
   source, routing, usage, artifacts, memory refs, browser plans, and runtime
   events.

## Provider And Marketplace Flow

- `src/lib/llmProviders.ts` defines provider types, default model lists, key
  CRUD, and `invokeLLMProxy`.
- `src/lib/circleIntegrations.ts` owns circle-level integrations.
- `supabase/functions/llm-proxy/index.ts` calls OpenAI-compatible providers and
  Anthropic branches with user-stored keys.
- `supabase/functions/swanbot-ai/index.ts` can relay marketplace-prefixed
  models with tools.
- `src/lib/billingPriority.ts` controls provider preference modes:
  `prefer_direct`, `prefer_openrouter`, and `cheapest`.

Keep provider enums, model prefixes, UI cards, edge support, and DB provider
constraints aligned.

## Computer Use Flow

- Chat/browser tasks plan through `src/lib/computerUse.ts`.
- Chat requests that mention another app, browser, local file, CAD/engineering
  tool, Adobe design file, or unfamiliar desktop program route first through
  `src/lib/chatComputerRequestRouter.ts`. That route is hidden prompt/metadata
  context, not a verbose chat message. `src/lib/chatComputerRequestUx.ts`
  converts it into the small user notice model for approvals, bridge checks,
  proof, and blockers. `src/lib/chatComputerHandoffContext.ts` carries that
  notice into live chat and `src/lib/persistedChatMetadata.ts` compacts it for
  reload/recovery, while safe read/search work stays hidden by default. The
  same handoff metadata also carries the compact evidence contract and compact
  app route decision for recovery and refresh enforcement.
  `src/lib/computerTaskEvidenceContract.ts` adds the hidden execution proof
  contract for each route: observe-before, actionability, approval, proof-after,
  fail-closed, retry-evidence, and source-reference requirements.
  `src/lib/computerTaskEvidenceRecovery.ts` classifies failed browser, local
  file, desktop, Photoshop, and InDesign runs against that contract so recovery
  options can distinguish fresh-evidence retry, user unblock, connected-agent
  adapter repair, and stop/report without parsing loose prose. It also emits
  required evidence tools and `missing` / `stale` / `ready` / `blocked`
  readiness state before a retry is allowed. Recovery also consumes the compact
  app route decision, so missing route confirmations become fresh-evidence
  requirements, missing approvals become approval boundaries, user-action
  blockers stop retries, and connected-agent buildout decisions become bounded
  adapter-repair options. If an older browser/computer-use failure path does not
  pass an explicit evidence contract, `chatFailureRecovery` infers the hidden
  chat computer route from the task text plus execution/source context and uses
  its contract before falling back to generic recovery.
- Native browser execution uses `supabase/functions/computer-use-agent/index.ts`
  and Browserbase.
- Local app/browser/file awareness uses bridge tools and
  `src/lib/localComputerAwarenessIntent.ts`.
- `src/lib/computerCapabilityExpansion.ts` is the pure planner for deciding
  what to build next when a computer/app/browser task needs more coverage. It
  maps task text and current capability readiness into browser semantic
  actionability, browser protocol inspection, desktop semantic control,
  app-native adapter, local-file grant, and connected-agent buildout lanes, each
  with source refs, proof requirements, and focused smoke commands.
- Native browser popups are handled by a guarded modal-advisor path:
  `src/lib/browserAIModalAdvisor.ts` defines the LLM prompt and validator,
  while the local browser bridge treats JavaScript alerts/confirms/prompts as
  blocking evidence. Safe alerts can be acknowledged, requested-output
  overwrites can be accepted only when the task names that output file, and
  credentials, MFA/CAPTCHA, payments, publishing, deletes, unsaved changes,
  prompt input, or vague confirmations stop with a concise user decision.
- Desktop app popups use the same guarded policy through
  `src/lib/desktopAIModalAdvisor.ts`: read accessibility text and visible
  buttons first, allow safe acknowledgements, allow requested-output
  overwrites, keep requested file extensions such as `.png` on macOS extension
  mismatch prompts, and stop for credentials, payments, publishing, destructive
  actions, unsaved changes, or ambiguous choices.
- Desktop app execution strategy is selected through
  `src/lib/computerAppTaskStrategy.ts`, preflighted by
  `src/lib/computerAppPreflight.ts`, grounded by
  `src/lib/computerAppGrounding.ts`, and given app-specific prompt contracts by
  helpers such as `src/lib/designAppAutomation.ts`.
- `src/lib/appAutomationControlSurfaces.ts` owns the research-backed
  control-surface ladder for app tasks. Photoshop prefers UXP DOM/modal
  execution, then batchPlay/action descriptors or cloud Photoshop API where
  appropriate, then semantic desktop fallback. InDesign prefers UXP
  script/plugin DOM, then cloud InDesign API for rendition/data-merge/custom
  script style work, then Apple Events/accessibility fallback. CAD/engineering
  tasks prefer official app APIs and script/add-in surfaces first: AutoCAD
  API/AutoLISP, Fusion API, SOLIDWORKS API, RhinoCommon, Revit API, Inventor
  API/iLogic-style routes, and APS cloud automation for approved batch/server
  workflows. Other apps prefer official vendor APIs, plugin SDKs, CLIs, or
  file-format operations before accessibility or screenshots. Browser-app tasks
  use DOM/CDP/ARIA plus resilient locator/actionability evidence before
  screenshots or coordinates.
- `src/lib/genericAppNavigator.ts` owns the unfamiliar-app navigation policy
  used when Chat/SwanBot/OpenSwan is asked to operate an app without a
  prebuilt adapter. It infers the target app, classifies the task family,
  observes app/window/a11y/file state first, takes one bounded semantic action
  at a time, keeps route/status internals hidden on success, and asks for only
  the smallest needed approval or unblock. If the task needs app-specific
  scripting, exporting, rendering, canvas/timeline/model control, or a missing
  bridge tool, it routes to `agent.build_app_capability` before coordinate-heavy
  driving so the runtime can learn a reusable recipe/adapter and retry only the
  failed step with fresh evidence.
- Generic app task-family labels are canonical. Reuse
  `buildGenericAppNavigatorRouteContext` instead of rebuilding target-app or
  task-family detection inside older strategy/buildout files.
  `appAutomationControlSurfaces`, `chatComputerRequestRouter`, `chatComputerRequestUx`,
  `chatComputerHandoffContext`, and `computerTaskEvidenceContract` should reuse
  `genericAppNavigator` labels so recovery/buildout metadata says things like
  "Ableton Live file/save/export work" instead of falling back to "Native
  desktop app" or a vague unfamiliar-app bucket.
- The same module now returns a typed app route decision
  (`ready_to_execute`, `needs_observation`, `needs_approval`,
  `needs_user_action`, or `needs_connected_agent_buildout`). Chat route prompts
  and computer-app preflight both carry that decision; chat handoff metadata and
  persisted chat rows keep a compact summary so the runtime can stop,
  re-observe, request approval, ask the user to unblock, or delegate a bounded
  connected-agent buildout before mutating another app, including after reload.
- `src/lib/engineeringCadOperationRunbooks.ts` turns CAD/engineering app tasks
  into hidden observe/approve/act/verify/recover/stop recipes for
  inspection/measurement, 2D drafting, dimensions/layers/title blocks,
  model/BIM edits, export/plot, and batch conversion. SwanBot, OpenSwan,
  computer-task dispatch, chat handoff metadata, and persisted chat metadata
  receive the compact runbooks so the user only sees approval, proof, or
  actionable blockers.
- InDesign/layout-file and Photoshop/image tasks should use uploaded-file
  staging plus app-native document/layer/text/link or layer/mask/selection
  inventory before accessibility or coordinate control.
- Photoshop and InDesign are the priority desktop-app lanes. Their strategy
  enriches from `designAppAutomation` so chat/OpenSwan carries app-specific
  document inventory, layer/text/link or layer/mask/selection checks,
  approval gates, proof/package verification, and recovery rules.
- `src/lib/designAppOperationRunbooks.ts` turns detected Photoshop/InDesign
  operations into observe/approve/act/verify/recover/stop runbooks. It gives
  SwanBot, OpenSwan, and computer-task dispatch exact tool sequences for
  InDesign text updates, InDesign/Photoshop layer show/hide/lock/unlock,
  relinks, proof exports, package handoffs, Photoshop text/smart-object
  updates, localized/generative edits, and raster proofs, including fail-closed
  blockers and connected-agent buildout triggers.
- `src/lib/designAppAdapterGaps.ts` turns still-missing Photoshop/InDesign
  operations into typed connected-agent buildout contracts. The current gap
  set covers InDesign resize/layout plus Photoshop resize/canvas,
  adjustment-layer, selection/mask, and generative/content-aware adapters. Each
  contract names official Adobe source
  refs, missing bridge tools, prerequisite observation tools, approval gates,
  required evidence, focused smoke cases, fail-closed rules, and the retry
  prompt to use after a connected agent adds the capability.
- `src/lib/designAppObjectManifest.ts` owns the before/after evidence contract
  for design tasks. It defines a `design_object_manifest` JSON artifact for
  document, layer, text-frame, link, font/preflight, smart-object,
  selection/mask, adjustment-layer, proof, and package-folder evidence. Prompt
  and metadata paths require redacted basename/hash paths, content hashes or
  summaries, source tool/timestamp references, changed-entity comparisons,
  approval evidence, and blocked-manifest reasons. The same module can now
  normalize real bridge tool captures into a redacted artifact and audit for
  missing approvals, missing before/after snapshots, missing proof/package
  artifacts, and accidental local-path leakage before completion is accepted.
  `chatComputerHandoffContext` and persisted chat metadata carry only the
  compact audited manifest summary so chat stays quiet and local paths/full copy
  do not leak into saved transcript rows.
- `src/lib/designAppManifestLedger.ts` converts audited manifest summaries into
  compact `design.object_manifest` run-ledger tool actions. Successful manifests
  become completed ledger events with proof/package artifact basenames; blocked
  manifests become blocked events with the missing evidence, still without raw
  local paths.
- `src/lib/designAppRuntimeManifest.ts` assembles live OpenSwan Photoshop/InDesign
  desktop tool events into the hidden manifest contract. The runtime keeps
  structured before/action/after captures out of normal persisted tool metadata,
  then appends only the redacted `design.object_manifest` ledger action.
- `src/lib/designAppProofReview.ts` owns the Photoshop/InDesign proof-review
  contract. It is injected into SwanBot/OpenSwan/computer-task prompts and
  summarized in the chat design-task card as a short review checklist rather
  than raw paths or verbose run logs.
- `src/lib/designAppCreativeAi.ts` owns the creative-AI capability plan for
  Photoshop, InDesign, and Firefly-backed work. It detects text-to-image,
  generative fill/remove, generative expand, AI asset generation, creative
  variations, and InDesign data-merge variants; names the required prompts,
  target frames/layers/selections, generated-output receipts, proof evidence,
  source refs, connected-agent buildout trigger, and reusable user-task recipes
  such as Photoshop generated background packs and InDesign text-to-image frame
  placement; and is injected into SwanBot/OpenSwan plus compact chat handoff
  metadata and the design-task card.
- `src/lib/designAppExecutionPipeline.ts` owns the ordered Photoshop/InDesign
  task pipeline. It turns automation plans, operation runbooks, creative-AI
  recipes, and adapter gaps into phases for resolve, observe, approve, mutate,
  export/package, verify, and connected-agent recovery. The compact pipeline is
  injected into SwanBot/OpenSwan, chat handoff metadata, persisted chat rows,
  and connected-agent buildout prompts.
- The local desktop bridge exposes script-backed InDesign status, text
  inventory, text-layer/Find-Change updates, placed-asset relink, and
  `packageForPrint` production package handoff, and proof-PDF export, plus
  Photoshop status, layer inventory, text-layer update, asset placement, and
  proof-export tools through the same OpenSwan runtime used by chat. Proof
  exports and InDesign package output folders require local write grants;
  InDesign asset relink and Photoshop asset placement require local read grants.
- Other Adobe Creative Cloud products route through
  `src/lib/adobeCreativeCloudApps.ts` and the `adobe_cc_control` strategy. That
  path resolves files, observes app/window state, gates mutations/exports, and
  uses connected-agent app-capability buildout when the runtime lacks a native
  adapter; it does not replace the dedicated Photoshop/InDesign bridge tools.
- Native Anthropic computer use in the edge function must use a Sonnet-capable
  model; unsupported selections fall back to the default Sonnet computer-use
  model.

## Schema Gotchas

| Item | Gotcha |
|---|---|
| `profiles` | No `email` column. Use auth user data for email. |
| `circle_office_agents` | No `model` column. Owner FK is `owner_id`. |
| `user_xp` | Primary key is `user_id`. |
| `room_messages.message_type` | Must match the DB check constraint. |
| `circle_integrations.provider` | CHECK constraint must include any new provider. |
| `circle_members` RLS | Avoid recursive policy reads; use security-definer helpers where available. |

## SQL

- Local migrations are append-only in `supabase/migrations/`.
- Consolidated idempotent agent SQL is in `docs/RUN_THIS_SQL.sql`.
- Roadmap section 5 owns applied/pending status.
- Use `NOTIFY pgrst, 'reload schema';` after schema changes when relevant.

## Validation

```bash
npm run typecheck
npm run build
```

Use focused smoke scripts from `package.json` for runtime changes.
