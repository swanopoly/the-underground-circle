# The Underground Circle - App Stack Reference

> Current app map for agents before writing code.
> Last reviewed: 2026-08-05

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
| Agent standards and worktree quality | `src/lib/agentDevelopmentStandards.ts`, `src/lib/openswanWorktreeConfig.ts`, `scripts/openswan-lane-report.ts`, `docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md`, `docs/SWANBOT_OPENSWAN_AGENT_LANES_2026-06-29.md` |
| Chat classification | `src/lib/chatAutomationPlanner.ts` |
| Chat computer request route | `src/lib/chatComputerRequestRouter.ts` |
| Chat computer request UX | `src/lib/chatComputerRequestUx.ts` |
| Computer task evidence contract | `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskEvidenceRecovery.ts` |
| Chat plan execution | `src/lib/runChatAutomationPlan.ts`, `src/lib/chatAgentContextPack.ts` |
| Chat transcript and thread lifecycle | `src/screens/circles/tabs/ChatTab.tsx`, `src/screens/circles/tabs/chat/ChatThreadSidebar.tsx`, `src/screens/circles/tabs/chat/ChatThreadHeader.tsx`, `src/lib/chatService.ts`, `src/lib/chatMessageShape.ts`, `src/lib/circleChatThreads.ts`, `src/lib/chatComposerDraftCore.ts`, `src/lib/subscribeWithReconnect.ts` |
| Chat thread/message database authority | `supabase/migrations/20260805_messages_thread_rls_and_reactions.sql`, `docs/RUN_THIS_SQL.sql` §31, `scripts/messages-thread-rls-smoketest.ts` |
| SwanBot client path | `src/lib/swanbot.ts`, `src/lib/swanbotClientToolDispatcher.ts` |
| SwanBot edge path | `supabase/functions/swanbot-ai/index.ts` |
| SwanBot v2 typed loop | `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/functions/_shared/swanbot-continuation.ts`, `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `src/lib/swanbotV2BatchRuntime.ts`, `src/lib/swanbotV2BatchPolicy.ts`, `src/lib/swanbotV2ClientLoopFlag.ts` |
| SwanBot continuation checkpoint privacy | `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/migrations/20260726_swanbot_continuation_privacy.sql`, `docs/RUN_THIS_SQL.sql` §29 |
| SwanBot/OpenSwan default readiness | `src/lib/swanbotOpenSwanReadiness.ts`, `scripts/swanbot-openswan-readiness-report.ts`, `supabase/migrations/20260805_openswan_production_readiness_contract.sql`, `docs/RUN_THIS_SQL.sql` §32 |
| Typed agent loop | `src/lib/agentExecutionCore.ts` |
| OpenSwan session runtime | `src/lib/openswanSessionRuntime.ts` |
| Agent runtime subject identity | `src/lib/agentRuntimeSubject.ts`, `src/lib/agentIdentityKey.ts`, `src/lib/agentIdentity.ts`, `src/lib/agentInvocation.ts`, `src/lib/agentRuntime.ts`, `src/lib/swanbotV2BatchRuntimeCore.ts` |
| Agent subject display surfaces | `src/components/AutomationsPanel.tsx`, `src/components/OfficeTerminal.tsx`, `src/screens/circles/tabs/office/AgentMemoryPanel.tsx`, `src/screens/circles/tabs/office/AgentRunsPanel.tsx` |
| Tool catalog | `src/lib/openswanToolRuntime.ts` |
| Provider model resolution | `src/lib/serviceProfileSouls.ts` |
| Cross-provider routing | `src/lib/crossProviderRouter.ts`, `src/lib/universalInvoke.ts` |
| Billing preference | `src/lib/billingPriority.ts` |
| BlackSwan routing | `src/lib/blackswanRouting.ts` |
| Computer task runtime, exact programs, and truthful Chat lane outcomes | `src/lib/computerTaskRuntime.ts`, `src/lib/computerSequenceProgramCore.ts`, `src/lib/computerTaskOutcome.ts`, `src/lib/chatLaneOutcome.ts`, `src/screens/circles/tabs/ChatTab.tsx` |
| Browser computer use and typed mutation handoffs | `src/lib/computerUseAgent.ts`, `src/lib/useComputerUseTask.ts`, `src/lib/useComputerUseQueue.ts`, `supabase/functions/computer-use-agent/index.ts`, `src/lib/computerUse.ts`; cloud starts require a bounded v1 policy, while legacy recorder mutations remain value-stripped typed OpenSwan handoffs |
| Agent Monitor | `src/lib/agentMonitorState.ts`, `src/components/agent-monitor/AgentMonitorHost.tsx`, `src/components/ComputerUseLiveCard.tsx` |
| Computer capability expansion | `src/lib/computerCapabilityRegistry.ts`, `src/lib/computerCapabilityExpansion.ts` |
| Local desktop awareness | `src/lib/localComputerAwarenessIntent.ts` |
| WordPress/Dealer Inspire admin automation | `src/lib/wpAdmin.ts`, `src/lib/computerAppTaskStrategy.ts`, `src/lib/chatComputerRequestRouter.ts`, `src/lib/userTaskPipelines.ts`, `src/lib/wordpressAdminSourceIntelligence.ts` |
| Office bridge readiness | `src/lib/bridgeHealthDiag.ts`, `src/lib/officeBridgeReadiness.ts`, `src/screens/circles/tabs/office/Whiteboard.tsx` |
| Desktop bridge authentication boundary | `scripts/desktop-bridge-security.js`, `scripts/claude-bridge.js`, `scripts/codex-bridge.js`, `scripts/cursor-bridge.js`, `scripts/gemini-bridge.js`, `src/lib/bridgeAuth.ts`, `src/lib/desktopBridge.ts` |
| App automation control surfaces | `src/lib/appAutomationControlSurfaces.ts` |
| App observation epochs and mutation receipts | `src/lib/computerAppGrounding.ts` |
| Unfamiliar-app semantic workflow | `src/lib/genericAppNavigator.ts` (`buildGenericAppSemanticWorkflow`) |
| Guarded browser mutation canaries | typed `browser.fill_field`, `browser.set_toggle`, and `browser.select_option` in `src/lib/openswanToolRuntime.ts`, `src/lib/browserBridge.ts`, `scripts/browser-bridge.js` |
| Narrow native semantic-press canary | typed `desktop.click_element` in `src/lib/openswanToolRuntime.ts`, `src/lib/computerAppAdapter.ts`, `src/lib/desktopBridge.ts` |
| Sealed native semantic-value lane | typed `desktop.set_element_value` in `src/lib/openswanToolRuntime.ts`, `src/lib/computerAppAdapter.ts`, `src/lib/desktopBridge.ts`, `scripts/claude-bridge.js` |
| Durable exact action-call ledger | `src/lib/agentActionCalls.ts`, `supabase/migrations/20260726_agent_action_calls.sql`, `docs/RUN_THIS_SQL.sql` §26 |
| Exact single-use approval authority | `src/lib/chatApprovalGate.ts`, `src/lib/openswanToolApprovals.ts`, `src/lib/openswanToolRuntime.ts`, `src/lib/swanbot.ts`, `supabase/migrations/20260726_database_authority_guards.sql` / `docs/RUN_THIS_SQL.sql` §28 |
| Scheduled external-action authority | `src/lib/scheduledActions.ts`, `supabase/functions/scheduled-action-runner/index.ts`, `supabase/migrations/20260726_scheduled_action_mutation_guard.sql` |
| Office durable command authority | `src/lib/officeTerminal.ts`, `src/screens/circles/tabs/OfficeTab.tsx`, `supabase/migrations/20260726_database_authority_guards.sql` / `docs/RUN_THIS_SQL.sql` §28 |
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
    computerSequenceProgramCore.ts
supabase/
  functions/
    _shared/
      swanbot-continuation.ts
      swanbot-continuation-crypto.ts
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
4. Stable plan kinds go through `runChatAutomationPlan`, which attaches both
   the user-facing Plan Card preview and one redacted, immutable
   `chatAgentContextPack`. The same pack is available to approval/transport
   handlers before execution. The real app/file/hybrid computer handler and
   both connected app-capability retry paths pass it through `AgentRunRequest`;
   `agentRuntime` injects the bounded `compactPrompt` into model context and
   saves a bounded projection in run metadata. Other non-computer
   connected-agent entrypoints are still being migrated.
   A compiler-owned exact computer program is a narrow branch inside this same
   dispatcher: its complete calls, arguments, and authorization mode are known
   before dispatch, then `computerTaskRuntime` executes the local program
   without an AI relay and accepts completion only from fresh app-native proof.
   One bounded new unsaved blank document uses the current direct request as
   authority; persistent/external work and oversized allocations stay gated.
   A separate router-owned strict named-app lifecycle branch also bypasses the
   relay for immutable observe -> launch-if-needed -> focus -> fresh foreground
   proof programs. `ChatTab` passes the program and STOP signal through without
   converting it into a model request.
5. Plain agent/model turns route through SwanBot/OpenSwan runtime paths.
6. Provider choice is resolved by selected model, connected providers,
   `serviceProfileSouls`, and cross-provider routing helpers.
7. Bot output is persisted to the active chat thread with compact metadata for
   source, routing, usage, artifacts, memory refs, browser plans, and runtime
   events.

OpenSwan navigation stays visible across circle, private, and shared Chat
threads through `ChatThreadHeader`. The header is mounted before Chat branches
to an empty or populated transcript, clears the prior thread while a selection
resolves, and keeps `OPEN`/`OPENSWAN` plus `RUNS` available through loading,
empty, active, and thread-resolution error states. `OPEN` enters
`OpenSwanServiceMenu`, where mode and crew selection live; Control Panel owns
agent, model, approval, and tool setup; `RUNS` / Runs & recovery use ChatTab's
existing run-history callback for past, blocked, or recoverable work. Keep this
map explicit, responsive, keyboard-focusable, and semantically labeled without
duplicating runtime state or approval authority in the menu components. The
composer selector also keeps availability separate from activation: normal
Chat reads `Chat · OpenSwan available`, while an enabled runtime mode reads
`<Mode> · OpenSwan active`. Advanced controls expose their expanded/selected
state. `Reset Mind` requires explicit destructive confirmation, deletes the
circle's session and current-user memories, and leaves the visible transcript
intact so the user does not mistake a local clear for message deletion. The source contracts are guarded by
`npm run smoke:openswan-chat-navigation` and
`npm run smoke:chat-agent-selector-presentation`; use
`npm run check:openswan-chat-ux` for the complete focused UX gate.

Thread selection is an explicit data transition, not a label change. Chat
clears the prior transcript immediately, validates the target against the
current circle and archive state, restores only that thread's draft and staged
attachments, and keeps the composer disabled until the new transcript is
ready; a failed resolution renders a real Retry state. Active runs and
in-flight uploads block a silent thread move. The compact conversation rail is
an overlay, and archive/delete/leave/member actions are labeled and confirmed.
Message and thread Realtime subscriptions reconnect with an immediate scoped
catch-up and perform a quiet heartbeat repair; the message transcript also
polls every 15 seconds only while its channel is degraded. Authoritative
message tails reconcile missed deletes without
discarding older pages, optimistic sends, or rows inserted after the read
began. Older-message pagination uses the stable `(created_at, id)` cursor, and
reply previews are hydrated in a batched parent read instead of one query per
row. Treat every Realtime payload as an advisory wake-up and re-read through
the canonical scoped query.

Bot output also has an explicit durability contract. `transcript` is the safe
default and can enter Postgres, model history, memory extraction, pending
recovery, and the session archive. `ephemeral` greetings, progress/routing
notices, and command/navigation help remain visible in the mounted client but
do not enter those durable or model inputs. Hydration filters the known legacy
ephemeral source surfaces so a refresh does not fossilize old progress copy;
real outcomes, blockers, and recovery evidence remain transcript messages.

## Agent Subject Metadata

`agentRuntimeSubject` normalizes Office, Chat, SwanBot, and OpenSwan agent ids
into one subject key plus aliases. Automation proposals, `/automation run/test`,
OpenSwan saved automations, specialized Chat/OpenSwan mode runs,
`automation-executor`, the Automations dashboard, Office terminal,
`AgentMemoryPanel`, and `AgentRunsPanel` preserve or display that metadata.

## Provider And Marketplace Flow

- `src/lib/llmProviders.ts` defines provider types, default model lists, key
  CRUD, and `invokeLLMProxy`.
- `src/lib/circleIntegrations.ts` owns circle-level integrations.
- `supabase/functions/custom-api-proxy/index.ts` is the guarded server-side
  execution path for Custom API marketplace connectors; OpenSwan tools call it
  instead of exposing saved API secrets to the model/client.
- `supabase/functions/llm-proxy/index.ts` calls OpenAI-compatible providers and
  Anthropic branches with user-stored keys.
- `supabase/functions/swanbot-ai/index.ts` can relay marketplace-prefixed
  models with tools.
- `src/lib/billingPriority.ts` controls provider preference modes:
  `prefer_direct`, `prefer_openrouter`, and `cheapest`.

Keep provider enums, model prefixes, UI cards, edge support, and the open-ended
integration provider registry aligned.

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
  fail-closed, retry-evidence, and source-reference requirements. Pure desktop
  launch/focus/read contracts carry only exact app/window identity plus the
  smallest requested app-native or accessibility observation; file search/stat,
  mutation, browser fallback, export proof, and approval requirements appear
  only when the typed task actually needs them.
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
- Strongly framed `Use`/`Open`/`In <App>` requests, including long-tail app
  names, stay desktop-owned and strip browser tools/fallbacks. Literal URLs,
  web-only apps, WordPress, transactional web intent, and browser-product
  navigation remain browser-owned. A strict lifecycle-only `Open Chrome`-style
  request targets the installed native app and does not add `browser.open_url`.
  Ambiguous lowercase long-tail lifecycle names enter this branch only on an
  exact normalized match in the refreshed bridge-online installed/running app
  context; unavailable names and offline stale inventories remain rejected.
  Finder/Preview/TextEdit file-shaped work stays local-file.
  The exact Photoshop compiler remains isolated from this generic routing.
  Docker Desktop and Microsoft Remote Desktop are exact app identities, not
  Desktop-folder references. Read-only named-app routes expose only
  launch/focus/wait/observation tools and must be rebuilt before mutation.
- `parseStrictNamedAppLifecycleIntent` in `genericAppNavigator.ts` is shared by
  routing and preflight. It accepts bounded polite forms of `open` / `open up`
  / `launch` / `start` / `focus` / `activate` / `switch (over) to` / `bring ...
  to the front` / `bring ... forward`, but rejects guidance questions, generic
  nouns/files, and appended clauses. The route preserves the user's exact app
  phrase while resolving a separate canonical bridge/bundle dispatch identity;
  an exact observed lowercase-name match never bypasses those rejection guards.
  These reversible lifecycle-only programs require `desktop_control`, no
  approval, no clarifier, and no AI relay; `computerTaskRuntime` reuses
  `executeObservedNativeAppActivation` for launch-if-needed plus fresh
  foreground proof. STOP yields a neutral typed `cancelled` result. Semantic
  reads remain model-assisted, and every document/UI mutation keeps its normal
  approval/evidence contract. This lifecycle/courtesy slice is source-, smoke-,
  and typecheck-verified on 2026-08-05; it has no new live GUI/bridge or
  deployment validation claim.
- Authenticated non-exact app/file/hybrid computer turns require the canonical
  device-local typed tool loop through `AgentRunRequest.forceClientToolLoop`.
  That makes the runtime catalog containing Photoshop status/create tools
  authoritative even while the global client-loop rollout remains off, and it
  prevents an edge or relay failure from replaying the task through v1's
  execution-incapable text-only catalog. The relay retries bounded transient
  5xx/network errors. Ask-classified mutations proceed only as far as the
  named canonical handler's durable exact-call approval boundary; explicit
  user prohibitions still stop before handler entry.
- `computer_apps` is a desktop-only execution profile, not a hint. Its runtime
  guard is carried through the legacy and v2 typed loops, removes browser tools,
  `desktop.open_url`, and generic tool search from the advertised catalog, and
  rejects browser-named launch/focus/raise arguments before dispatch. Browser
  control is available only to an explicit browser or hybrid route.
- Compiler-owned exact programs bypass that relay only after their declared
  authorization policy passes. The Photoshop blank-document family runs
  status -> conditional launch -> status -> exact create -> final status. A
  closed-world unsaved draft at or below 4096 px per axis / 16 MP uses the
  current direct command without a redundant approval; larger allocations keep
  the one-shot Chat approval, and appended/unknown actions cannot inherit the
  direct authority. It does not request local-file evidence, generic UI planning,
  or a connected-agent buildout. Its task card is likewise reduced to
  Status -> Prepare -> Create -> Verify, with exact dimension proof and no
  source-file, layer-review, export, or handoff phases. A missing post-create
  receipt remains outcome-unknown and disables automatic replay. When the
  exact plan requires and files approval, Chat keeps only an in-memory approval-id ->
  task/thread resume entry; the card stays in awaiting-approval state without
  generic failure recovery, then burns that entry and resumes automatically
  after approval. The exact gate still recomputes and atomically consumes the
  durable fingerprint before any desktop action. This convenience is scoped
  to the same mounted ChatTab; approving after a refresh or from Office/another
  client fails closed to an exact retry rather than persisting raw task text.
  The same bounded polite-command envelope recognizes natural
  `Can/Could/Would you ...` and `I need you to ...` wording without widening the
  exact Photoshop action whitelist. This 600x600 document compiler remains
  separate from the router-owned lifecycle-only dispatcher.
  Live Chat validation on 2026-07-31 started from Photoshop
  `appRunning:false`, submitted the exact 600x600 request through the refreshed
  authenticated UI, created no approval row, persisted one completion, and
  finished with app-native proof for `Untitled-1` at 600x600, RGB, 72 ppi, and
  one layer. After refresh, an exact `chat.run_computer_task*` approval has no
  durable in-memory continuation, so Chat offers `Ask again` only inside the
  row's normal live/expired visibility window and then ages it out. A newer
  same-thread completion never suppresses an approval by chronology alone
  because the thread may contain unrelated tasks.
  Timeline reconciliation never compares prompt wording, normalized request
  text, inferred structure, or a shared chat-turn id. An older ready/approval
  design card becomes `Superseded` only when a later structured, verified
  completion shares its exact immutable run id or explicit request id. Without
  exact lineage, it becomes `Historical` only after a newer human turn from the
  same stable author; another member's later turn cannot deactivate it. New bot
  rows persist `requestAuthorId`, so interleaved shared threads do not infer
  ownership from message proximity; ambiguous multi-author legacy rows fail
  open as `Current`. A
  metadata-free legacy row is eligible only under the strict desktop-plan
  fallback: approval/readiness language plus `Approve desktop run`,
  `desktop-app path`, `app-native tool`, or `desktop.*`, with failure and
  blocked states excluded. That fallback may become only `Historical`, and only
  after a newer same-author turn. `Superseded` and `Historical` rows keep phase,
  proof, review, and browser-session evidence visible while disabling approval,
  launch, verification retry, recovery, run-stop, and run-again mutations.
  Deployments that still enforce `messages.content <= 1000` use a separate safe
  persistence fallback. `persistedChatMetadata` builds a bounded, redacted
  source/status/lineage envelope, fits visible text around complete JSON, and
  parses it before submission; if that cannot fit safely, it emits an explicit
  marker-free text-only row. `chatService` releases the recoverable local
  pending row only after the database response strictly round-trips every
  present local-message, run, request, requester, status, and source field, or exactly
  matches the submitted marker-free text. Truncated or parseable-but-mutated
  metadata is not acknowledged.
  Typed-batch and outer failures finalize through the same durable pending-row
  helper; verification retries also update the saved message. Message Realtime
  listens for INSERT and UPDATE through the reconnect/catch-up owner and
  rehydrates the complete envelope into existing rows. Authoritative bounded
  snapshots repair a missed DELETE. A metadata-free bot UPDATE explicitly
  clears stale structured actions, so another mounted client cannot retain
  unproven controls.
  A computer result that may have dispatched mutation but lacks final proof
  carries structured `manual_verify_only` replay policy, `mutationDispatched`,
  and a bounded read-only verification-tool allowlist through persistence and
  refresh. Chat removes approval, retry, recovery, app-choice, preflight,
  quick-reply, run-again, and cross-surface mutation controls in that state;
  only the declared observation may run. Copy is never replay authority.
  Chat passes the raw utterance to classification/compilation and keeps any
  dispatch prefix as non-semantic notes, so this ordered sentence is never
  split into an artificial `Open Photoshop` ask. The web composer has no
  automatic focus claim and is blurred only immediately before native desktop
  dispatch. The exact executor positively proves Photoshop foreground before
  create and after final status; at most one semantic focus plus one follow-up
  observation is allowed at either boundary, with no coordinate fallback.
- Native browser execution uses `supabase/functions/computer-use-agent/index.ts`
  and Browserbase.
- The older `src/lib/computerUse.ts` lane cannot safely execute any of its six
  mutations because it does not carry genuine authenticated user/circle/
  persisted-run identity, provider `toolUseId`/iteration, durable action
  claim, and exact OpenSwan approval. Planned `navigate`, `click`, `fill`,
  `select`, `press_key`, and `scroll` actions therefore fail visibly as
  value-stripped structured non-executable typed OpenSwan handoffs before
  screenshot, Stagehand, MCP, or bridge mutation I/O. They must continue as
  fresh Chat/OpenSwan typed calls and never fall back to a legacy/raw path.
  Saved-plan replay preflights the whole plan and permits only the reviewed
  observation allowlist.
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
- `src/lib/computerAppGrounding.ts` also owns the pure hard-contract foundation
  beneath those prompts: a short-lived observation epoch identifies the exact
  app/process/window/document or browser session/tab and exposes an explicit
  revocation function that callers must invoke after focus, navigation, modal,
  or mutation changes. A proposed mutation carries the matching target, a
  deterministic secret-safe fingerprint derived from canonical normalized
  arguments, runtime-issued exact-call approval policy, idempotency key,
  verification predicate, and safe outcome-unknown policy. Unknown mutators
  default to reviewable medium risk, duplicate/capacity in-process
  authorization fails closed, and a single-use sealed wrapper rechecks
  observation/policy expiry before recording actual handler entry. Completion
  requires a distinct newer runtime-issued after-state with complete target
  identity.
- Typed OpenSwan `browser.fill_field` is one of three integrated browser consumers
  of that contract. `agentExecutionCore` first reserves a bounded provider-issued
  `toolUseId` for the full run and gives the handler the exact tool/id/iteration
  context. The runtime then canonicalizes one exact non-secret draft, takes a
  fresh DOM observation, then asks `POST /browser/fill_target` to resolve and
  inspect exactly one field before the approval lookup. The browser bridge
  issues opaque process/context/live-document identity (`pageId` rotates on
  navigation or reload), binds the current URL, and returns a short-lived,
  single-use `targetId` backed by that exact ElementHandle plus an HMAC
  privacy-safe v2 `targetFingerprint` over inspected semantics and keyed
  document/node/frame structure. The id is dispatch-only and is excluded from
  durable approval, receipts, and model output. Approval stores SHA-256
  bindings for the exact normalized intent and page URL plus bounded safe
  origin/length and opaque process/context/page/fingerprint metadata; raw draft
  text, URL path/query/fragment, locator, and task context are not persisted.
  It still requires a genuine receipt backed by an `agent_run_approvals` row.
- The source-default SwanBot v2 edge schema for `browser.fill_field` is now
  lockstep with that sealed contract: one exact accessible `name` xor CSS
  `selector`, optional `textbox`/`searchbox` role, bounded non-secret `text`,
  optional bounded task context/exactness/timeout, and no submit field or
  unrecognized properties. It cannot model a credential fill, dropdown
  selection, or submit side effect through the generic text-fill shape. The
  edge schema, app normalizer/sealed runtime, browser client request builders,
  and bridge target/perform endpoints independently enforce exactly one locator
  (`name` XOR `selector`); both-present and neither-present inputs fail before
  observation or dispatch.
- Guarded handler entry consumes the target id once. It rechecks the live
  identity, target fingerprint, direct attributes, associated label text,
  `aria-labelledby`/`aria-describedby` text, and containing-form context for
  credential/recovery/seed/private-key/payment/CVV signals before filling.
  App-side and bridge-side classifiers also reject obvious secret-bearing draft
  values without reflecting them. The mutation action SHA-256-binds the exact
  transient dispatch args; the sealed dispatcher recomputes that digest from a
  deep-frozen clone, invalidates the bound observation epoch, and passes only
  those sealed args to the handler. It reads the same handle first and skips
  `fill()` when the value already equals the approved draft, avoiding duplicate
  input/change handlers after an outcome-unknown attempt. Whether skipped or
  filled, proof uses one renderer capture of value, semantics, document, node,
  and frame state bracketed by stable browser identity checks. Proof contains
  only the approved fingerprint, `valueMatches`, bounded
  actual/expected lengths, a `mutationPerformed` boolean, and observation
  identity. The filled or observed value and ephemeral id are never echoed. Navigation, page/context close,
  bridge restart, capability expiry/replay, detachment, or target drift fails
  closed and requires a fresh target observation.
- Typed OpenSwan `browser.set_toggle` is the second sealed consumer, and the
  SwanBot v2 client catalog routes it through the same exact tool/id/iteration
  gateway. It accepts only one checkbox, switch, or radio plus an explicit
  boolean state. Model normalization and bridge inspection both require
  positive presentation/accessibility semantics; account, authentication,
  security, privacy, sharing, subscription, notification, network, payment,
  destructive, publishing, messaging, and unknown settings fail closed. Its
  approval card stores a bounded secret-redacted target summary plus digests
  and opaque identity, never the raw selector, task context, full URL, or
  one-shot target id. The bridge verifies the exact same handle before replay,
  clicks it at most once only when state differs, and proves the final boolean
  without submitting or navigating. Generic `browser.click_role` now inspects
  its resolved handle and refuses native/ARIA state controls, their labels, and
  descendants even when caller role or selector semantics are spoofed.
- Typed OpenSwan `browser.select_option` is the third sealed browser consumer.
  It accepts one native single-value `<select>` and one exact option value or
  label, takes a fresh dedicated target/option observation, binds the same
  exact provider-call and approval identity, selects at most once, and verifies
  the exact option on the same live handle without submitting or navigating.
  Multi-select, ambiguous options, protected/unknown settings, stale handles,
  and target drift fail closed. Generic click refuses select/combobox/listbox/
  option targets, labels, and descendants, so raw click cannot bypass this
  dedicated stateful lane.
- `src/lib/agentActionCalls.ts` and the §26 `agent_action_calls` RPC contract
  provide the durable cross-process boundary for fill, toggle, select, the
  native semantic press, `desktop.open_path`, manual automation file writes,
  and approval-gated external edge mutations. An authenticated claim binds
  user, circle, persisted
  run, tool, provider `toolUseId`, action id, argument fingerprint,
  authorization-contract fingerprint, and idempotency key; no raw args,
  selector, URL, text content, or unrestricted metadata is stored. The exact
  transition is `claimed → dispatched → verified / outcome_unknown`; `failed`
  is valid only while the row is still undispatched `claimed`.
- Handler entry atomically records `dispatched`, and duplicate or terminal
  calls never invoke the bridge handler. Concurrent claimers may receive the
  same token, so a worker that loses before its callback leaves the claim
  unfinalized/reclaimable instead of overwriting another worker's dispatched
  action. Once start is confirmed, any error maps only to `outcome_unknown`.
  Verified fresh proof remains `ok: true` if final database acknowledgement is
  unavailable, but the runtime warns that the exact call remains replay-blocked.
  The TypeScript parser independently rejects a forged `failed` row with a
  non-null `dispatchedAt`.
- Approval rows remain the durable authorization source. The hidden tool-event
  receipt replaces the canonical approval key/args with a privacy-safe digest
  and is stripped from model-visible raw/formatted results. All five guarded
  canaries emit issued mutation-dispatch and computer-app verification
  receipts; `agentRunPersistence` stores only their bounded primitive
  allowlists. SwanBot continuation transport carries only those sanitized
  subsets outside model content, re-sanitizes them at the edge, and persists
  correlated client result events on resume.
- SwanBot v2 and OpenSwan converge in source on this canonical typed runtime.
  The default edge continuation client merges hard constraints parsed from the
  raw turn with richer upstream constraints, then runs the executable
  constraint/always-confirm floor before an optional live exact-call review
  callback. Missing required approval, rejection, and callback exceptions fail
  closed before handler entry. When a review callback is present, calls are
  serialized so concurrent approval prompts cannot reorder user decisions. A
  non-empty always-confirm floor applies to every non-read browser/desktop call,
  including bland or opaque keypresses and unknown/future mutations without
  keyword-bearing arguments.
- The computer-task forced-local lane is narrower than the global SwanBot v2
  rollout. Ordinary chat still follows the v2 preference/circuit flags. If the
  required local loop cannot start or exhausts its relay retries, Chat receives
  a stable `client_tool_loop_unavailable` error and no v1 replay occurs.
- Every browser/desktop mutation currently registered as client-delegated in
  SwanBot v2 is intercepted before the raw browser/desktop dispatchers and
  enters `executeOpenSwanRuntimeTool` with the provider name, tool-use id, and
  iteration. The five guarded canaries retain their sealed action, durable call,
  and sanitized hidden-receipt contracts. Other current mutations gain the
  canonical policy/approval chokepoint, but that does not retroactively give
  them the canaries' proof contract or establish a universal gateway for future
  tools, direct callers, or new mutation families.
- Each paused edge turn minimizes and AES-256-GCM seals its exact model/tool
  snapshot through `_shared/swanbot-continuation-crypto.ts`; the public
  `agent_runs.metadata.continuation` field is a value-free CAS envelope, not a
  plaintext snapshot. It exposes only bounded identity/version/nonce,
  resume/claim state, counters/tool identities/timestamps, an `expiresAt`
  exactly ten minutes after `pausedAt`, and the authenticated ciphertext
  envelope. Public `agent_run_events` tool inputs are value-free structural
  schemas and failures use stable redacted codes/copy; exact arguments/errors
  remain transient for live approval, dispatch, proof, and model-loop work.
- Deployments must explicitly set a dedicated
  `SWANBOT_CONTINUATION_ENCRYPTION_SECRET` and
  `SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION`; never derive or reuse the
  service-role key or another shared credential. The source `v1` fallback is
  not a rotation configuration. Without the encryption key, SwanBot withholds
  all `clientOnly` tools before the model turn and dispatches no local action.
- Before local execution, a client-generated exact claim compare-and-sets
  `pending` / `client_pending` to `dispatch_claimed` /
  `client_dispatching`; only the exact echoed claim may enter a handler. Exact
  results then compare-and-set that state to `results_claimed` /
  `client_resuming` before model resume, and the result claim binds every
  next-pending or terminal write. Only an exact same-claim dispatch retry
  carrying the already-winning claim is idempotently acknowledged. A competing
  claim, mixed protocol/state, acknowledgement ambiguity, expired lease, failed
  claim-bound transition, or post-claim loop error becomes
  `outcome_unknown` with no reopen or automatic replay. Readiness ignores all
  three active stop-reason rows: `client_pending`, `client_dispatching`, and
  `client_resuming`. Pending, checkpoint-failure, continuation-close/seal,
  cancel, failure, and terminal writers normalize a complete run summary:
  array `tool_calls`, `iteration_count >= 1`, and finite nonnegative
  input/output/cache token fields. The hardened summary/checkpoint/close/CAS
  writes log only a bounded operation name and safe machine code; older
  claim/event logging elsewhere in the Edge remains outside that guarantee.
- Terminal success is proof-bound, not prose-bound. A dispatched
  client-delegated mutation with `ok: false`, missing accepted verification, or
  outcome-unknown latches across continuation rounds and cannot be converted
  to completion by model `end_turn`; the edge persists failed/no-replay,
  suppresses a completed Feed card, and returns a structured non-fallback 409.
  Fresh terminal compare-and-set results are inspected and exactly reread:
  late user cancellation wins, while any other ambiguity stops before
  publication. The client treats `cancelled: true` as a neutral reached-edge
  terminal regardless of empty/nonempty model text, so STOP cannot fall
  through to v1 or count against the transport breaker. Other reached-edge
  empty terminals are also non-fallback. Direct WordPress/workspace mutation
  handlers stamp value-free receipts immediately before their provider/DB/UI
  boundary and require concrete returned identity/state for completion;
  unsupported after-state proof remains outcome-unknown. The immutable
  `turnRequestId` survives every fresh pending/terminal/cancel/failure metadata
  update, so lost-response retries collide before another model/Feed run.
- A fresh modern v2 turn sends one client-generated UUID `turnRequestId` on
  every transport attempt and the edge inserts it as `agent_runs.id`; a
  duplicate collides before model/tool work. Legacy/no-identity starts have
  server writers withheld. Those memory/task/mission/message/room/approval
  writers also latch before handler entry. If a later provider/runtime failure
  makes the write ambiguous, v2 persists `server_mutation_outcome_unknown`
  with `replayAllowed: false` and requires verification before new action.
  The client recovers that structured non-2xx error before the v1 fallback
  branch, preventing a completed write from being retried under a new run.
- Section 29 defines a service-role-only atomic sweep for active unsafe or
  expired SwanBot continuations. Its named `pg_cron` job runs every three
  minutes when cron exists and emits a stable NOTICE otherwise. Missing,
  legacy/plaintext, malformed, state-mismatched, or expired active checkpoints
  lose the continuation and receive only a value-free
  `continuationResumeOutcome` with `replayAllowed: false`: `client_pending`
  becomes `failed_before_dispatch`, while
  `client_dispatching`/`client_resuming` become `outcome_unknown`. The
  migration separately performs a one-time terminal/non-active checkpoint
  scrub. AES-GCM additional authenticated data binds the canonical exact
  run/user/circle row without exposing those identifiers in the public
  envelope, so cross-row ciphertext transplantation fails closed. A §29
  protected-row trigger rejects authenticated INSERT/UPDATE/DELETE attempts
  against active SwanBot v2 continuations while preserving existing reads,
  service-role/Postgres maintenance, and only the exact owner STOP transition
  plus one write-once bounded cancellation-provenance merge. Swept terminal
  rows also repair the existing tool/iteration/token summary columns to safe
  shapes without copying those values into outcome metadata.
- Legacy `computerUse.ts` is now observation-only: all six legacy Computer Use
  mutation kinds—`navigate`, `click`, `fill`, `select`, `press_key`, and
  `scroll`—become value-stripped, non-executable typed OpenSwan
  handoffs before screenshot, Stagehand, MCP, or bridge I/O. Recording replay
  preflights the complete plan and runs zero steps if any browser/desktop
  mutation is present; only a reviewed observation allowlist can replay.
- Hosted Browserbase Computer Use is separately source-hardened as of
  2026-07-26. `computerUseAgent` carries a bounded schema-v1 execution-policy
  envelope that the edge validates before provider/session work.
  Authenticated Chat/queue starts require an interactive envelope;
  watch/service calls are forced scheduled observation-only, and authenticated
  legacy callers without the policy receive HTTP 400. All three root Chat
  starts—automatic browser launch, booking-session continuation, and manual
  approved launch—preserve router-derived user constraints and the
  opaque-target/credential/external-side-effect confirmation floors. The
  single-task and queue hooks acquire synchronous start reservations before
  imports or credential lookup, count pending reservations against capacity,
  and invalidate them on cancellation/clear.
  Cloud handles, local browser sessions, and pending permission dialogs are
  owned by the exact mounted thread/user/circle. Scope changes cancel and clear
  those owners before hydration, invalidate late callbacks, and convert an
  orphaned durable `executing` row to blocked/unverified instead of presenting
  a false resumable run. Capability polling uses stable checkpoint identity,
  approval submission has a synchronous double-click reservation, and animated
  Computer Use status/particle loops stop on cleanup without changing hook
  topology.
- The cloud edge treats left/right/double click, type, key, and saved-login
  filling as mutations and treats unknown native actions as blocked mutations.
  Every current opaque coordinate/focus call requires durable exact-call live
  confirmation, including when a pre-run grant exists. Approved work requires
  a fresh pre-action screenshot, one-attempt mutation dispatch, and a fresh
  post-action screenshot. Missing pre-proof blocks before dispatch; ambiguous
  post-dispatch state ends `mutation_outcome_unknown` with no replay.
  Type/key/credential/question inputs are redacted or suppressed across SSE,
  progress/action traces, model history, guided replay, stuck-solver payloads,
  usage metadata, and errors.
- Root Chat's `computerTaskRuntime` no longer calls the deterministic app
  adapter or bridge open/wait helpers for generic/model-planned work before
  authenticated `executeAgentRun`. Read-only live observation may remain
  before the loop. A compiler-owned exact program is the deliberate exception:
  after its closed-world direct-request or SHA-bound Chat-approval policy
  passes, the local handler executes once and requires fresh app-native proof. This
  removes broad pre-agent app-adapter and attachment-open bypasses without
  forcing simple exact tasks through an unavailable AI relay. Uploaded desktop
  files remain staged and return a
  value-free, non-executable `desktop.open_path` handoff without raw path,
  identity, approval, receipt, or proof. Exact staged context remains only in
  the authenticated task prompt and is redacted from result,
  capability-buildout, and action-trace telemetry.
- Approval authority is exact and one-use across the audited chat surfaces.
  Chat SHA-binds the complete normalized plan plus user/circle/thread/room and
  consumes `agent_approvals.applied_at` before one transport dispatch.
  Deployments that specifically lack that additive column use a guarded legacy
  compatibility path: the same exact fingerprint lookup omits only
  `applied_at`, then atomically transitions `approved`/`auto_approved` to
  terminal `consumed`. All unrelated lookup, RLS, network, or schema failures
  still fail closed, and §10b/§28 remains the target database authority.
  `HitlApprovalBanner` sends runtime-owned Chat/scheduled rows back to their
  runners instead of the generic apply worker; the worker's real
  `chat.review_comment` handler is explicitly excluded from that predicate.
  OpenSwan SHA-binds canonical tool arguments plus authenticated run/provider
  call identity and atomically stamps one dispatch binding. SwanBot WordPress
  writes and its generic risk floor use the same schema-v2 digest and claim
  semantics. Durable/model-visible payloads contain only bounded labels and
  safe digests, never raw commands, paths, values, credentials, or canonical
  approval keys.
- Durable OpenSwan/subagent tool-call telemetry is value-free as well:
  `eventBoundCore` persists only bounded field/type/shape summaries, collapses
  unknown result/output/data/content/path fields to a value-free result schema,
  and permits receipt metadata only through exact namespace/field/type/value
  allowlists. `agentRunSystem.addStep` independently reapplies the same fresh
  projection at the final `agent_run_steps` insert boundary for tool input,
  tool output, tool-bound metadata/title/body, and malformed tool names. The
  Run History drawer projects each whole tool step to controlled labels and
  hides legacy raw name/title/body/output fields; non-tool message/plan
  metadata/title/body remains compatible. Exact arguments/results remain
  transient for approval, dispatch, proof, and model work; `event-bound-core`
  guards this in readiness and both release gates.
- Legacy direct local-file, image-conversion, and diagnostic launch paths
  return only value-free, non-executable typed-tool handoffs. The executable
  `desktop.open_path` gateway instead requires a fresh exact stat and path
  digests, authenticated run/provider call, exact approval, §26 claim/start,
  one bridge attempt, and a fresh exact frontmost-app proof. Ambiguity seals
  `outcome_unknown` and cannot replay.
- `automation-executor` keeps service/scheduled invocations read-only. A manual
  room-file mutation needs exact fresh single-use authority plus the §26
  ledger. Every scheduled external action separately needs fresh per-occurrence
  approval, one durable claim, and one dispatch. Timeout or any post-dispatch
  error persists `outcome_unknown`; the Pending Actions UI shows a redacted
  verify-first roadblock with no retry, and recurrence starts without reused
  authority.
- Office Realtime payloads are advisory wakeups only. After client
  authentication/shape checks, §28 `invoke_agent` locks the exact durable
  message/circle/expected command, verifies membership plus owned
  target/scope, and returns canonical command/sender/targets/model. Claims are
  idempotent per message and agent subject, including synthetic `blackswan`;
  stream/completion writes require the same claimant, membership, live state,
  bounded payload, CAS, and multi-target completion coverage.
- Section 28 also validates allowlisted schema-v2 payloads and immutable
  bindings for protected `chat.*` `agent_approvals` and tool-digest
  `agent_run_approvals`. Resolution is member-only while pending and stamps the
  resolver server-side; expiry/one-shot consume is requester-only; protected
  rows cannot be deleted or converted from legacy v1. Legacy unrelated and
  scheduled rows remain outside those trigger predicates.
- Source catalog parity is pinned at **25 server-side + 57 client-delegated =
  82 total**. `browser.locator_actionability` is a read-only advisory
  observation for one fresh exact target, not authorization or target binding
  for a later mutation. The bridge-side `browser.dom_snapshot` walker redacts
  every editable value before transport; skips hidden, inert, and executable
  source descendants; canonicalizes bounded roles; and returns only controlled
  field structure and lengths. Entry/capture/exit identity checks bind the tree
  and title to one exact process/context/page/URL. The model sees an HTTP(S)
  origin-only display URL; exact actionability drift checks use a
  process-scoped HMAC URL identity. HMAC identities rotate on bridge restart,
  and raw/forged legacy URL identities plus non-HTTP snapshots fail closed. The
  device-local typed client remains opt-in/default-off. The SwanBot v1/v2 Edge
  snapshot deployed on 2026-08-05, its canonical JWT modes, required secret names,
  production-origin CORS, §31 Chat catalog, and §32 readiness RPC were
  deployed/re-verified on 2026-08-05; the live report passed all 18 dependency
  checks. Historical production telemetry is incomplete and still blocks a
  default flip. §29 remains unapplied, so encrypted resume/key rotation, claim
  races, three-minute cron expiry, and historical checkpoint scrubbing remain
  unproven. A live exact Photoshop run created and app-natively verified a
  600x600 scratch document while Photoshop stayed frontmost; arbitrary native
  semantic input, Browserbase/confirmation integration, and the updated
  `computer-use-agent` deployment remain unproven. Its HTTP 400 for
  authenticated legacy callers without a v1 policy is intentional.
- Native `desktop.click_element` is a narrow semantic-press canary, not a
  general desktop click gateway. It observes a fresh indexed accessibility
  tree, binds exact app/PID/path/role/label/fingerprint identity, proposes one
  low-consequence target, requires a genuine exact approval, performs one
  target-bound press, and accepts completion only when a refreshed observation
  proves that exact target disappeared or changed semantics. Coordinates,
  ambiguous targets, stale indexes, target drift, consequential actions, and
  arbitrary desktop mutations remain outside this lane.
- Native `desktop.launch_app` and `desktop.focus_app` use one proof-bearing
  helper across the deterministic adapter, typed OpenSwan, and SwanBot v2.
  Every mutation takes a fresh before/after observation, resolves only an exact
  installed name or bounded explicit alias, binds a positive PID for running
  targets, rejects dispatch identity swaps, no-ops when the postcondition
  already holds, and marks attempted-but-unverified work outcome-unknown with
  replay disabled. Bridge acknowledgement alone is not completion. The
  reversible lifecycle step needs no separate approval through either an
  authenticated persisted run with exact provider tool-call identity or the
  strict Chat compiler's immutable direct-request program through the paired
  local bridge. Launch proves the exact app is running and focus proves it is
  running and frontmost. A lifecycle-only command may name an installed native
  browser product, but URL/navigation work remains browser-owned. This is
  bounded activation proof, not a general sealed native mutation gateway.
- `computer_files` uses the parallel `local_file_only` execution ceiling.
  Scoped `desktop.file_*`, `desktop.open_path`, Preview, and other non-browser
  native apps remain available; browser tools, URL opening, generic search,
  and Chrome/Safari launch, focus, or window raising are rejected before
  dispatch. The outer Chat automation planner projects the embedded canonical
  route, risk, and approval decision instead of restoring a browser label or a
  redundant plan approval around a native/local sequence.
- `/desktop diag` is an authenticated read-only health/pairing/running-app
  probe. Supplying an app (`/desktop diag <app>`) still performs no launch,
  focus, open, click, or type mutation; it returns a value-free,
  non-executable `desktop.launch_app` typed-runtime handoff that requires a
  fresh authenticated run, provider call identity, exact approval, dispatch
  receipt, and post-launch focus proof.
- The sealed browser gateway covers
  non-submit/non-credential fill, clearly local presentation/accessibility
  toggle, and one exact option in a native HTML single-value select; the native
  gateway covers one exact low-consequence semantic press plus fail-closed
  dispatch protection for 11 generic typing, paste, keys, menu, bounded
  coordinate/mouse-gesture, and scroll actions. Each guarded call requires an
  exact freshly observed app name, process, and surface before approval; stable
  exact-call approval binding; a private one-shot handler-entry recheck; and
  §26 claim/start before one bridge attempt. Coordinate and mouse actions also
  require live screen bounds and a visible exact-app window. PID, surface,
  bounds/window, args, TTL, clone, or replay drift stops before mutation.
  Acknowledgement-only endpoints return `ok: false`,
  `completionVerified: false`, and `outcomeUnknown: true`, then seal
  replay-blocked `outcome_unknown`; they are never reported as verified
  completion. `desktop.set_element_value` is no longer in that
  acknowledgement-only lane. It requires authenticated persisted run/provider
  call identity and a fresh full accessibility observation, then binds exact
  app/PID/generation/dotted path/role/label plus current/requested value hashes
  and lengths into a short-lived one-shot non-secret target before requesting a
  genuine exact-call approval receipt. The sealed handler re-observes the
  target, performs one AX set-value, and accepts completion only from a newer
  same-field observation with the exact requested hash and length. Raw values
  and paths remain transient; secure, credential, payment, permission,
  destructive, modal, stale, drifting, raw-dispatch, paste, and coordinate
  variants fail closed. Any possibly dispatched call without accepted proof is
  `outcome_unknown` and cannot replay. SwanBot v2 no longer raw-dispatches
  those browser/desktop mutations in its current client catalog.
  The separately vault/origin-gated credential tool retains its own
  compatibility boundary. Submit, upload, browser navigation/close,
  generalized native after-state verification, future catalog additions, and
  non-typed callers still need explicit universal-gateway coverage. The
  separate hosted cloud edge now
  exact-confirms opaque native clicks/typing/keys, but that one-call screenshot
  boundary is not the local semantic target/ledger proof contract.
  Source/contract smokes and app typecheck verify this slice; the current edge
  source additionally normalizes complete v2 summaries across pending and
  terminal paths, but it is not deployed/re-verified. §29 is not applied, and pre-deployment
  plaintext/legacy pending continuations do not gain the fail-closed/scrub
  boundary until those steps. No live generic browser/native-input GUI execution or live
  Postgres contention/race proof was performed. The §26 and §29 migrations are
  authored and mirrored but have not been applied or verified against a live
  database, so durable cross-process behavior and checkpoint cleanup are not
  operational claims.
- Non-browser task results use `src/lib/computerTaskOutcome.ts`. Only
  authoritative `completed` outcomes count as app success or produce a
  completion message; partial, blocked, input/approval, failed, and cancelled
  states remain explicit in persisted Chat metadata. Successful deterministic
  app calls without fresh proof remain partial; read/observation results are
  their own proof. `src/lib/chatLaneOutcome.ts` adapts this typed terminal
  without inspecting user-visible prose: approval wait is deferred, input stays
  input, partial/blocked/cancelled stay blocked, and failed stays failed. Chat
  records native terminals plus cloud/local browser completion, failure,
  cancellation, approval denial, and post-approval launch failure, preventing
  an earlier deferred preview from remaining the apparent terminal. String-only
  agent responses for verified tasks remain
  inconclusive until structured tool/proof outcomes reach `agentRuntime`. The
  same path forwards the
  live Chat thread, plugin ids, cancellation signal, route constraints, and
  always-confirm floor through `agentRuntime` into `SwanBotContext`. Those
  values are consumed by the opt-in typed client canary; the default edge route
  remains non-cancellable. The path does not promote a plan-level approval into
  exact tool-call consent.
- Unfamiliar-app self-healing state records the connected provider. Delayed
  buildout polling accepts dedicated bounded capability receipts from Codex and
  Claude Code, requires exact or unique sufficiently long session identity, and
  converts unsupported Gemini/Cursor result polling into explicit incomplete
  evidence. Claude's transcript JSONL id is reconciled to its managed launch id
  only from one unambiguous anchored UC marker; missing or conflicting claims
  fail closed. `agent.build_app_capability` is therefore hard-limited to
  Codex/Claude until the other bridges provide the same strict result field.
- `src/lib/agentRunPersistence.ts` keeps authoritative typed-loop dispatch truth
  (`true`, `false`, or legacy unknown) and only bounded primitive receipt
  allowlists for computer action, mutation dispatch, app verification, and
  generic verification. The guarded browser fill/toggle/select and native
  semantic-press/value canaries now produce the mutation-dispatch and
  app-verification namespaces, but other computer mutation handlers do not;
  five narrow canaries are not proof that the universal gateway is enforced.
- Claude, Codex, Cursor, and Gemini bridge servers share the local
  `scripts/desktop-bridge-security.js` boundary: explicit loopback binding,
  Host/Origin/source checks, one-time short-lived pairing challenges, and
  bearer-token validation. Claude's expected first challenge uses a quiet HTTP
  200 envelope; the client also accepts rolling/older 428 challenges without
  weakening the one-time exchange. The Claude desktop surface additionally
  enforces exact file grants and a fixed read-only exec-file allowlist that
  rejects shell-family launchers. Every generic native input call carries one
  fresh transient app/PID/CGWindowID/bounds guard into the adjacent bridge
  call. The Swift input helper validates the same target atomically while
  typing/pressing/pasting; pointer coordinates are inside the window and
  mouse-up/scroll require x/y. Raw target authority is never serialized into
  model, approval, receipt, or durable result data. Intentional tunnel access additionally requires the
  exact emitted Host in `UC_BRIDGE_ALLOWED_HOSTS` and the exact browser origin
  in `UC_BRIDGE_ALLOWED_ORIGINS`; setting only an
  `EXPO_PUBLIC_*_BRIDGE_URL` does not relax the server boundary.
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
  preserves the exact request, and emits a schema-v1 semantic workflow with at
  most ten ordered checkpoints. Every checkpoint names its goal,
  observe-before evidence, allowed semantic surfaces, mutation and approval
  classes, expected postcondition, and buildout/stop rule; the final checkpoint
  is reserved for proof of every original clause. Allowed surfaces stop at
  adapters, app lifecycle, app-native APIs/scripts, documented file adapters,
  embedded DOM/CDP, accessibility, semantic menus, and verified shortcuts.
  Coordinates are never part of this workflow. Pure observation and exact
  launch/focus/wait require no mutation approval. Model-issued lifecycle calls
  still need authenticated persisted-call identity; the strict Chat compiler
  instead uses its immutable direct-request program through the paired local
  bridge. Both require fresh exact proof. Named reversible non-secret
  field/menu/toggle steps share one bounded workflow review rather
  than one prompt per control; their runtime calls still need exact receipts.
  Persistent/external/destructive/credential/permission or ambiguous steps
  retain their exact floor. The navigator keeps route/status internals hidden
  on success and asks for only the smallest needed approval or unblock. If the task needs app-specific
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
| `messages` Chat rows | §31 requires a canonical non-null `thread_id`; `circle_id`, `thread_id`, and `reply_to` must resolve to one thread. Toggle reactions through `set_message_reaction` instead of replacing another member's JSON. |
| `circle_integrations.provider` | Provider values are open-ended; validate known providers in app registries and keep lookup indexes/migrations current instead of re-adding a rigid CHECK. |
| `circle_members` RLS | Avoid recursive policy reads; use security-definer helpers where available. |

## SQL

- Local migrations are append-only in `supabase/migrations/`.
- Consolidated idempotent agent SQL is in `docs/RUN_THIS_SQL.sql`.
- Roadmap section 5 owns applied/pending status.
- `20260726_agent_action_calls.sql` (§26) is **applied and catalog-verified**:
  the live table and claim/start/finish RPCs were rechecked on 2026-08-05.
  A real two-worker claim/start contention race remains unproven, so catalog
  presence alone is not cross-process no-replay proof.
- `20260726_scheduled_action_mutation_guard.sql` is mirrored as §27 but is
  **not applied or live-DB verified**. Apply it before relying on the durable
  scheduled claim/dispatch/outcome-unknown state machine.
- `20260726_database_authority_guards.sql` is mirrored as §28 but is **not
  applied or live-DB verified**. The 146-assertion source/byte-identity guard is not proof of
  Office RPC concurrency or approval resolve/consume behavior; local
  Docker/Supabase was unavailable for this review.
- `20260726_swanbot_continuation_privacy.sql` is mirrored as §29 but is **not
  applied or live-DB verified**. Source verification does not prove encrypted
  resume/key rotation, live claim races, cron expiry, or the historical scrub.
- `20260805_messages_thread_rls_and_reactions.sql` (§31) is **applied and
  catalog-verified on the target project as of 2026-08-05**. The service-role
  readiness contract proves the canonical table/column, four message policies,
  mutation trigger, reaction RPC grant, and Realtime publication. Authenticated
  private/shared/circle behavior, revocation, reply/reaction contention, and
  two-client Realtime delivery still need live behavioral proof. Current
  compatibility deliberately permits a creator to author/finalize their own
  `is_bot=true` row until a trusted server/RPC bot-write lane replaces it.
- `20260805_openswan_production_readiness_contract.sql` (§32) is **applied and
  live-verified on 2026-08-05**. Its service-role RPC returns booleans only.
  The report combines those booleans with hosted function/JWT metadata,
  required secret names, the production web origin, browser CORS, source
  smokes/parity, and real telemetry. An authenticated Supabase CLI may supply a
  service key transiently when no explicit key is exported; no key or secret
  value is printed.
- Use `NOTIFY pgrst, 'reload schema';` after schema changes when relevant.

## Validation

```bash
npm run check:openswan-lanes
npm run check:swanbot-chat:daily
npm run smoke:export-traces
npm run typecheck
npm run build
```

The 2026-07-27 guarded-action slice is source-verified by the focused
103-assertion `agent-action-calls` ledger smoke, `agent-action-runtime-wiring`,
read-only `browser-locator-actionability`, browser fill/toggle/select,
computer-app grounding, `swanbot-v2-batch-policy`,
`swanbot-v2-continuation`, `swanbot-v2-edge-fill-schema`,
`computer-use-mutation-handoff`, readiness, and typed-runtime invariant smokes
plus app typecheck. Locator actionability remains advisory and cannot authorize
or bind a later mutation. Those checks do not substitute for deploying the current
edge, applying §26/§29 to Postgres, proving encrypted continuation/key-rotation,
cron-expiry, continuation/action-call races, or running a live browser/native
GUI task.
`openswan-generic-native-ui-runtime`, `browser-dom-snapshot-privacy`, and
`swanbot-v2-terminal-integrity` each run exactly once in both Chat/SwanBot daily
and release chains and in `smoke:all`; these are source/contract gates, not live
database, Browserbase, native-GUI, or deployed-edge proof.
The 2026-07-26 cloud/root-Chat slice is source-verified by
`computer-use-cloud-policy`, `chat-computer-request-router`, and
`computer-task-runtime-context`. The cloud-policy and runtime-context guards
run exactly once in all Chat/SwanBot daily and release gates, `smoke:all`, and
canonical readiness. Exact approval, direct-handoff, open-path, automation,
scheduled-action, Office broadcast, and database-authority guards share that
same exactly-once gate contract. This does not prove a deployed edge, live
Browserbase/confirmation-database integration, or live native-app execution.
It also does not prove §26/§27/§28/§29 application or live two-client Realtime/RLS behavior,
encrypted resume/key rotation or cron expiry, concurrent claims, external
provider dispatch, or automation/scheduler edge deployment.

The 2026-08-05 unfamiliar-app and semantic-value slice is covered by the
focused `generic-app-navigator`, `universal-app-task-eval`,
`native-semantic-value-runtime`, launch/focus, grounding, approval, and runtime
contract smokes, the desktop/local execution-surface guard, and app typecheck.
The universal source corpus covers 160 requests and 7,410 assertions. These
are source/contract checks. They do
not prove a live generic native-app mutation, an edge deployment, a database
contention race, or universal completion for arbitrary human actions in every
app.

Use focused smoke scripts from `package.json` for runtime changes. Use
`npm run check:swanbot-chat:release` before bundling a larger
SwanBot/OpenSwan/Chat delivery. Use the SwanBot/OpenSwan readiness report only
for production/default-flip evidence because it requires either an explicit
Supabase service-role key or authenticated CLI access, plus real `agent_runs`
rows. Its live dependency section must pass separately from telemetry:
`npm run report:swanbot-openswan-readiness -- --smokes-passed --since <iso>`.
`smoke:all` is the integration sweep, not the daily default.
