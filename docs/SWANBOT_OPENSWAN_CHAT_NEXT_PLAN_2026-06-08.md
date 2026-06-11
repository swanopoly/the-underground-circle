# SwanBot / OpenSwan / Chat — Next Plan (2026-06-08)

> Companion to `docs/AGENTS_ROADMAP.md` (canonical). This file is a prioritized
> work plan; the roadmap owns phase status. When an item here ships, update the
> roadmap, not just this doc.

## Core finding

This is a "shipped but unwired" backlog, not a "missing features" one. Many
pure, smoke-tested libraries exist but are not connected to the live path.
Three structural seams gate the cascade:

1. **Two tool loops coexist** — legacy `executeToolUseLoop` (`swanbot.ts` /
   `swanbot-ai`) and `agentExecutionCore.runAgent`. The unification adapter
   (`getOpenSwanToolsForSurface`) exists but `openswanSessionRuntime` still runs
   the old loop.
2. **v2 edge function is done but not default** — `swanbot-v2-ai` has 45 tools
   and a readiness gate (`swanbotOpenSwanReadiness.ts`), but v1 is still primary.
3. **Chat still has six sequential routers** — Phase 1b
   (`ChatTab.sendMessage` -> `buildChatAutomationPlan` + single executor) hasn't
   landed, and >=5 finished features are blocked on it.

Highest leverage = integrations, not net-new libraries. No new parallel modules;
extend canonical owners per roadmap §6.

## SwanBot

- **S1** Deploy `swanbot-v2-ai`, route a traffic %, measure, flip default via
  `buildSwanBotOpenSwanReadinessSnapshot(...)`, then retire v1. (Roadmap 1c)
- **S2** Rate-limit session-memory extraction (1x/day boundary + content-hash
  dedup). `swanbot.ts:~354`.
- **S3** Route Gemini fallback through `llm-proxy` instead of hardcoded direct
  calls (Rule #11). `swanbot.ts:~2539`.
- **S4** Per-continuation retry in the M2 client-delegation loop.
  `swanbot.ts:~612`.
- **S5** Backfill v1 tool-loop event metrics for run-ledger parity (only if v1
  lingers after S1). `swanbot.ts:~2764`.

## OpenSwan

- **O1** Migrate `openswanSessionRuntime` -> `agentExecutionCore.runAgent` via
  `getOpenSwanToolsForSurface`. (Roadmap 1c, the structural unlock)
- **O2** Fold the 3 add-on tools into `openswanToolRuntime` catalog.
- **O3** Phase 3: `subagentRegistry` -> `AgentExecutionCore` with summary-only
  contract; wire `canDelegate()` + `redactSubagentOutput()` (`delegationGate.ts`).
- **O4** Subagent spend limits via `hitlService` (`agent_controls.spend_limits`).
- **O5** Expand verification status enum to
  `executed | planned | blocked | manual_required | not_applicable` + run-ledger UI.
- **O6** Tool-dependency graph for safe parallel batching (avoid list/update race).
- **O7** Migrate onto `agentPromptBuilder.ts` so both surfaces share one ordered
  component sequence (no prompt-cache drift).

## Chat

- **C1** Phase 1b: migrate `ChatTab.sendMessage` onto `buildChatAutomationPlan` +
  single executor; delete the six sequential routers. (Keystone)
- **C2** Wire `withCheckpoint(...)` into chat-triggered write transports.
- **C3** Wire `compressContextIfOversized(...)` into `runAgent` pre-turn.
- **C4** Wire `describeUserMemoryUsage()` into the prompt memory block.
- **C5** Per-category auto-approve + cost/token footer in the composer.
- **C6** `HitlApprovalBanner` countdown UI consuming `planClarifyTimeout()`.
- **C7** Approval-gate revocation categories
  (`expired | denied | escalated | rate-limited`).

## Sequencing

- **Wave 1 (safe, independent):** S2, S3, C3, C4.
- **Wave 2 (structural unlocks):** C1 + O1 together; then C2/C5/C6.
- **Wave 3 (v2 promotion):** S1; then S4/S5, O2, O7.
- **Wave 4 (subagent maturity, Phase 3):** O3 -> O4 -> O5; then O6.

## Status (updated 2026-06-09)

**Shipped + verified (typecheck clean, smokes green):**

- **C3** — context compression wired into `runAgent` (optional `compaction`,
  injected summariser, `context_compressed` event, fail-safe). Smoke: agent-core case 7.
- **C4** — `describeUserMemoryUsage()` wired into the prompt memory_bank block.
- **S2** — session-memory extraction rate-limited (content-hash dedup + 1h cooldown).
- **O2** — one tool catalog: added `github.activity` to `openswanToolRuntime`;
  the other two add-on capabilities already had catalog equivalents.
- **C7** — approval-gate deferral categories
  (`pending | filed | rejected | blocked_policy | error`) + `retryable`,
  surfaced on the dispatch outcome so the loop can branch retry-vs-wait-vs-stop.
  Backward-compatible (fields optional). Smoke: agent-runtime.
- **S4** — bounded transient retry for the v2 (M2) continuation loop. New pure
  `swanbotV2Retry.ts` (`runWithTransientRetry` + `isRetryableInvokeError`,
  reusing `fallbackChain`'s classifier); `invokeSwanbotV2` split into a
  single-attempt fn + retry wrapper so a 429/5xx/network blip on a
  continuation no longer discards the in-flight turn (server work + already
  executed client tools). Live path (`/v2`). Smoke: swanbot-v2-retry (28 asserts).
- **S3** — Gemini fallback (Tier 3) routed through `llm-proxy` (`google_ai`,
  BYOK) instead of the direct platform-key Gemini REST call — central
  pricing/cache/telemetry (Rule #11) + honors the "no surprise platform-key
  spend" intent. Reuses the tested `findAliasKey` resolver; the direct
  `callGemini` is now `@deprecated`/unwired. Live path. Smoke:
  cross-provider-router (gemini flash/pro assertions added).

**Decisions locked (roadmap §7):** Sonnet 4.6 edge + Opus 4.7 in-app · in-place
v2 rewrite · keep OpenSwan branding.

**Next:** C1 (chat unification) is the keystone but warrants the running app +
manual verification, so it should be its own focused pass. Then O1, then S1
(needs a prod deploy), then Phase 3 (O3/O4/O5).

### C1 progress (2026-06-09, live against the running app)

- **Live harness verified** — drove the running app (`:8081`, circle "THE END"),
  sent a benign message, confirmed the natural-language path responds. Console +
  snapshot inspection working for per-step verification.
- **C1 mapping** — `ChatTab.sendMessage` is a ~2,200-line function (5656–7860).
  `buildChatAutomationPlan` is already called (6446) but consumed by ad-hoc
  `if (plan.execution.kind === …)` branches; a parallel legacy classifier
  (`conversationalRouter`, 6509) still executes structured intents; the terminal
  AI dispatch (`streamChatResponse` 7447 / `runOpenSwanSessionTurn` 7565) sits at
  7386–7600. The unified `dispatchChatAutomationPlan` is only used today for the
  computer-task path (2579).
- **C1 Step 1 SHIPPED** — `src/lib/chatTransportHandlers.ts`
  `createChatTransportHandlers(deps)`: the pure "single executor handler map" the
  cutover needs. Each `ChatAutomationExecutionKind` → a contract-safe handler
  (never throws; `handled:false` → `skipped` so legacy fallback survives; absent
  dep → omitted so the dispatcher skips). Smoke:
  `chat-transport-handlers` (18 asserts incl. real `dispatchChatAutomationPlan`
  integration). Typecheck clean.
- **C1 Step 2 cutover #1 SHIPPED + LIVE-VERIFIED** — the `ask_clarification`
  intent in `ChatTab.sendMessage` now routes through
  `createChatTransportHandlers` → `dispatchChatAutomationPlan` (the dep is the
  former inline body verbatim; `ctx.chatMode` = `planActMode`). `ask_clarification`
  is in `READ_ONLY_EXECUTION_KINDS` and approval-free, so the plan-mode/approval
  gates pass and behavior is identical. Verified against the running app: "create
  a task" → clarification question + TAP-TO-ANSWER chips; a normal message ("…OK…")
  → "OK" (common path unregressed). Only an unexpected `skipped` falls through to
  the legacy path. Typecheck clean; chat smokes green.
- **C1 Step 2 cutover #2 SHIPPED + LIVE-VERIFIED** — the memory family of
  conversational intents (`remember` / `forget` / `show_memories`) now executes
  through the unified executor using the planner's already-detected intent
  (`plan.intent.intent`), removing the double-classification where the legacy
  `conversationalRouter` re-ran its own detector. Scoped to memory intents
  (narrow blast radius); the dep body is a faithful copy of the legacy block
  (same executor, workbench, render, `__SHOW_MEMORIES__` handling). Everything
  non-memory still falls through to the legacy router unchanged. Verified against
  the running app: "what do you remember" → `remember` ("Remembered: …", matching
  the pre-existing planner detection order), "show my memories" → Memory Viewer
  modal opened. Typecheck clean; chat smokes green.
- **C1 Step 2 remaining (pending)** — migrate the rest off `conversationalRouter`
  one family at a time behind the same fallback (wordpress, create_task,
  office_agent_task, generate_image, build_webpage), then retire the legacy
  router, with the terminal `run_openswan`/`run_plain_chat` model path last
  (highest blast radius), each live-verified.

## Deep-review additions (2026-06-10)

Three-subsystem review (Chat transport, SwanBot v1/v2, OpenSwan runtime)
surfaced items not yet tracked above. Same rule applies: extend canonical
owners, no parallel modules.

### R-items (new)

**Now (live gaps / dead weight — independent, small):**

- **R1** Persist `context_compressed` in `agentRunPersistence.ts` — C3 emits the
  event but the onEvent handler (~99–157) has no case for it, so compaction is
  invisible in transcripts today.
- **R2** Wire the `ChatAutomationObserver` hook — `dispatchChatAutomationPlan`
  accepts an observer (`runChatAutomationPlan.ts:156`) but ChatTab never passes
  one; all routing telemetry from the C1 cutovers is dropped. Wiring it also
  gives free cutover-verification evidence for the remaining families.
- **R3** Delete the `@deprecated` `callGemini` path (`swanbot.ts:~1623–1709` +
  `GEMINI_*` consts) — S3 made it dead code.
- **R4** `resetAgentMind` uses a direct `supabase.auth.getUser()`
  (`swanbot.ts:~538`); migrate to `safeGetUser` per the authSession rule.
- **R5** v1 transient retry — v1 `callSwanBotAI` (~1484–1555) still collapses on
  any 429/5xx while it remains the primary tier; wrap its invoke with the shared
  `runWithTransientRetry` (S4's wrapper, network call only).

**Before continuing C1 Step 2 (the side-effectful families):**

- **R6** **Approval-posture decision per family.** The legacy
  `conversationalRouter` path has NO approval gate; the unified dispatcher gates
  every plan (`runChatAutomationPlan.ts:195–214`) and the planner marks
  WordPress `external_side_effect`. Migrating `wordpress_publish` therefore
  CHANGES BEHAVIOR (silent → gated). Decide intended posture per family
  (wordpress, create_task, office_agent_task, generate_image, build_webpage)
  before each cutover, and live-verify the approval path, not just happy path.
- **R7** **Handler state-request contract.** Migrated handlers mutate ChatTab
  state inside closures (`setBotTyping`, `startCodingWorkbench` — ChatTab
  ~6543–6573); a gate refusal or mid-handler throw skips cleanup and locks the
  composer. Before `generate_image`/`build_webpage`: handlers return state
  requests (`{ status, modalToOpen?, typing? }`) and `sendMessage` applies them.
  Also extracts the handler bodies toward a pure smoke-testable lib.
- **R8** **Kill residual double-classification** — the memory handler calls
  `executeConversationalIntent`, which re-runs `detectConversationalIntent`
  (`conversationalRouter.ts:448–469`). Extract an executor that accepts the
  already-detected intent before copying the pattern five more times.
- **R9** **Thread clarification resume through the dispatcher context** —
  resume state lives in ChatTab refs (~5668–5698) that only the
  ask_clarification handler can reach, but `create_task` also produces
  clarifications (`chatAutomationPlanner.ts:215–229`). Needed before the
  create_task cutover.
- **R10** Adopt `withCheckpoint(...)` (C2) DURING each side-effectful family
  cutover rather than as a later pass — wordpress/create_task/office_agent_task
  are exactly the write transports it was built for.

**Before O1 (small agentExecutionCore extensions, each ≤3h, independently
smoke-testable):**

- **R11** Pre-dispatch `toolApprovalGate` option on `AgentRunOptions` — the
  current loop gates BEFORE tool dispatch (`openswanSessionRuntime.ts:1013`);
  `runAgent` has no hook, so naive O1 executes tools then reports rejection.
  Rejection must read as a policy block, not a transient error.
- **R12** Checkpoint/resume surface — expose messages at iteration boundaries
  (or an `iteration_complete` event) so the resumable-checkpoint path
  (`openswanSessionRuntime.ts:1063–1074`) survives O1.
- **R13** Stage events — 8 `emitStage` callsites drive the UI spinner; add an
  `onStageChange`-style hook or synthetic events so O1 doesn't freeze the UI.
- **R14** Tool-result `metadata` passthrough on the result envelope — design-app
  manifest capture reads tool-event metadata (`openswanSessionRuntime.ts:1016–1047`)
  and would silently vanish.

**Pre-S1 (v2 promotion):**

- **R15** **v2 prompt caching** — v1's client builder maintains a
  `cache_control` boundary (`swanbot.ts:~1985`); `swanbot-v2-ai` has none, so
  flipping default as-is takes a cost/latency regression exactly when traffic
  moves. Split frozen/volatile (dovetails with O7/agentPromptBuilder).
- **R16** Verify v2 tool parity with the readiness snapshot
  (`npm run smoke:swanbot-openswan-readiness`), not ad-hoc greps — review
  produced a conflicting count (21 vs 45 server-side); trust the snapshot.

**Hardening (schedule into Wave 2/3):**

- **R17** Untrusted-content fencing sweep in `buildSystemPromptAsync` — memory
  is fenced (~1805–1807) but missions, room messages, agent activity, GitHub
  events (~1819–1965) are not (roadmap untrusted-content rule).
- **R18** Classify `approvalKind` on all `approvalMode: 'ask'` tools in
  `openswanToolRuntime.ts` (~13 lack it) so the approval audit trail is
  categorized.
- **R19** Approval fingerprint normalization — `stableApprovalJson` hashes exact
  payloads (`openswanToolApprovals.ts:49–62`); any input normalization during O1
  silently invalidates every cached approval. Normalize before hashing (or key
  by tool + intent) as part of O1, not after.

### R-item status (2026-06-10 — typecheck clean, smokes green)

- **R1 SHIPPED** — `context_compressed` case added to `agentRunPersistence`'s
  onEvent switch (snake_case payload, matches existing rows). Smoke: agent-runtime.
- **R2 SHIPPED** — `onOutcome: attachPlanDecisionToRun` wired at both C1
  dispatch callsites (clarification + memory). The canonical observer also
  gained a `devLog.trace` branch for run-less dispatches so C1 cutovers are
  verifiable without a DB row. Smoke: chat-transport-handlers.
- **R3 SHIPPED** — `callGemini` + `GEMINI_*` consts deleted from `swanbot.ts`
  (a do-not-re-add comment marks the spot). NOTE: `RESPONSE_DIRECTIVES` was
  NOT part of the dead path — it is still live (used by the response-intent
  directive picker) and stays. Smoke: cross-provider-router.
- **R4 SHIPPED** — `resetAgentMind` migrated to `safeGetUser`.
- **R5 SHIPPED** — v1 `callSwanBotAI` invoke wrapped in `runWithTransientRetry`
  (invoke errors classify via `isRetryableInvokeError`; an error BODY means the
  edge ran → terminal, no retry). Smokes: swanbot-v2-retry, agent-runtime.
- **R11 SHIPPED** — `agentExecutionCore` gained optional pre-dispatch
  `toolApprovalGate` on `AgentRunOptions`: runs before the handler, rejection
  produces a policy-block tool_result ("blocked by policy … do not retry"),
  gate throw fails CLOSED. Smoke: agent-core case 8 (approve / reject /
  gate-throw all asserted).
- **R12 SHIPPED** — `runAgent` emits `iteration_complete` after each closed
  tool round with a shallow messages snapshot (never splits a
  tool_use/tool_result pair; doesn't alias the live history). Persistence
  writes the marker + message_count only (snapshots can be hundreds of KB).
  This is the resumable-checkpoint surface O1 needs. Smoke: agent-core case 9.
- **R13 RESOLVED — no core change needed.** Stage emission for O1 maps from
  existing events in the adapter: `turn_start` → reasoning,
  `tool_call_start` → executing, `final_response`/`turn_end` → finalizing.
  The session runtime's pre/post-loop stages (booting, loading_context,
  delegating, rendering_artifacts) sit outside `runAgent` and keep their
  current `emitStage` calls. Decision recorded so O1 doesn't grow new API.
- **R14 SHIPPED** — `AgentToolResult` gained optional `metadata`; it flows
  through `tool_call_result` events (for design-manifest capture / audit
  ledgers) but is STRIPPED from the model-visible tool_result content so
  hidden captures never leak into the conversation. Smoke: agent-core case 9.
- **R17 SHIPPED (first pass)** — fenced three memory-derived prompt blocks in
  `<untrusted_quoted>`: soul wisdom (at source in
  `memoryService.formatSoulWisdomBlock`), `getLastSessionContext` (whole
  return — session summaries + bridge context + durable memories), and the
  Active Missions data lines (member-authored titles; the guidance line stays
  outside the fence). Deliberately NOT fenced: wiki (curated/trusted), saved
  soul prompt (owner-configured persona — instruction-bearing by design),
  attachment context (current-turn user input, same trust as the message).
  Remaining R17 surface: `buildOpenSwanRuntimeContextBundle` + the v1 edge
  fn's own prompt blocks — audit on the next pass.

### Sequencing tweak

R1–R5 land now. R6–R10 gate the remaining C1 cutovers (suggested order:
wordpress_list → create_task → wordpress_publish/schedule → office_agent_task →
generate_image/build_webpage → terminal path). R11–R14 land BEFORE O1, not
during. R15–R16 gate S1. C1 side-effectful families: batch-migrate with
code+typecheck+smoke and one consolidated live click-through (the approval-gate
behavior change is the risk, not the happy path).

## Delegation items (D — 2026-06-10)

From the chat-delegation research pass (codebase review of the chat→computer
pipeline + execution runtime vs. 2025-26 state of the art: ChatGPT agent,
Claude in Chrome, Mariner, Manus, Skyvern, browser-use). Theme: the internals
(routing, evidence contracts, recovery, buildout) are strong; the gaps are
delegation ergonomics — the user can't see the plan, set boundaries, walk
away, answer later, or run it again. Already-rejected directions stay
rejected (no hosted browsers, no CAPTCHA/anti-bot, no benchmark chasing).

- **D1 SHIPPED (2026-06-10) — plan preview card.** The route's already-computed
  `solutionSteps`/surfaces/approval gates/`completionProof` now render to the
  user BEFORE execution as a numbered plan with an edit hint, riding the same
  autonomy visibility gate as the notice (quiet tasks stay quiet; the preview
  appears exactly when an approval/review notice would). Action/blocker lines
  stay ahead of the plan so compact consumers (handoff messages, 5-line cap)
  never lose the user's next action. Persisted bounded in full-mode chat
  metadata only. Owner: `chatComputerRequestUx.ts` (+`persistedChatMetadata`).
  Smokes: chat-computer-request-ux, chat-computer-handoff-context.
- **D2 SHIPPED (2026-06-10) — pending questions survive reload.** Mid-task
  user questions (MFA/ambiguity/choice) previously lived only in React hook
  state. New `ComputerTaskPendingQuestion` on the durable
  `computerTaskState` record (pure helpers in `computerTaskStateModel`:
  upsert/resolve/open-list, bounded at 5), written through from
  `useComputerUseTask` confirmation callbacks (asked → pending; resolved →
  answered; result/error/cancel → expired). Record carries sessionId/runId so
  a fresh client can resume the paused Browserbase session. Remaining: the
  "needs you" UI surface + answer-from-chat wiring (rides D6). Smoke:
  computer-task-complexity (model cases).
- **D3 SHIPPED (2026-06-10) — user constraints as guardrails.** "don't
  submit", "ask me before deleting", "stop if MFA" now parse into a typed
  `userConstraints` schema on the route (9 verb-anchored categories;
  conservative patterns — a missed phrasing degrades to prompt-only, never a
  wrong block). Ask-before constraints force `approvalRequired`; constraint
  rules inject into the route prompt block; `constraintBlocksToolCall()` is
  the enforcement backstop wired for the R11 pre-dispatch gate (tool-name
  separator-normalized matching). Owner: `chatComputerRequestRouter.ts`.
  Smoke: chat-computer-request-router.
- **D6 SHIPPED (first pass, 2026-06-10) — checklist projection + needs-you
  surface.** Pure `buildComputerTaskChecklistCard` /
  `formatComputerTaskChecklistCard` in `computerTaskStateModel` project the
  durable record (steps, phase, blockers, D2 pending questions, resumable
  session) into the user-facing "what is it doing / what does it need from
  me" card. ComputerUseConsole's status card now renders the NEEDS YOU block
  (questions/approvals/blockers, resumable hint) — this is the read side
  that makes D2's persisted questions visible after reload. Remaining: chat
  message + Office surfaces, completion/blocked notifications. Smoke:
  computer-task-complexity (checklist cases).
- **D8 SHIPPED (2026-06-10) — partial results on bounded stops.** The edge
  loop (`computer-use-agent`) now keeps a bounded action breadcrumb log +
  last-reasoning snippet and, on timeout / token-budget / cost-cap / stall,
  emits `partial_result` (progress, live session link, runId) BEFORE the
  error event and persists the partial summary onto `computer_use_runs`
  (status `error`, summary = progress) so follow-up context can resume from
  what was actually done. Client: `computerUseAgent` parses the event;
  `useComputerUseTask.onPartialResult` populates `result` with the partial
  summary so the card shows what WAS done alongside the error. NOTE:
  requires edge deploy (`npx supabase functions deploy computer-use-agent`).
  Deno check clean.
- **Resume loop CLOSED (2026-06-10).** Two pieces: (a) edge follow-up
  context now includes stopped-early runs (`status error` with a summary —
  exactly what D8 writes) with explicit "pick up AFTER the completed
  actions, do not redo them" framing, so resumes no longer restart blind;
  (b) the console NEEDS YOU block gained an answer box for persisted
  questions — answering resolves the D2 question and submits a resume task
  carrying the original goal + the answer, while the edge supplies the
  prior progress. Full flow now works end-to-end: task pauses on MFA →
  tab closes → user returns → chat strip → console → answer & resume →
  new run continues from prior progress. Needs edge deploy.
- **D4 SHIPPED (first pass, 2026-06-10) — staged multi-surface plan.**
  `planComputerTaskStages` in `computerTaskComplexityPlan.ts` decomposes
  genuinely multi-surface tasks (browser→files→app) into ≤4 ordered stages
  — each with surface, goal, done-when criterion, and an explicit artifact
  handoff ("next stage may only rely on what is stated"). Staged tasks are
  complex by construction (score floor 5); the dispatch block gains a
  "Staged execution contract" section with the resume rule (failure names
  the failed stage; recovery resumes there, completed-stage artifacts
  reported). Stages persist compactly on the task state (`complexity.stages`)
  and drive `visibleNextSteps` so the console/checklist shows per-stage
  progress. Single-surface tasks pay zero staging overhead (stages: []).
  Smokes: computer-task-complexity (stage cases) + all downstream consumers
  green (runtime, execution-grounding, request-router, request-ux, planner).
  **D4b SHIPPED (2026-06-10) — stage-aware recovery.**
  `diagnoseComputerTaskCheckpointFailure` now infers the failed STAGE
  (whole-word goal-keyword scoring first — "download" must not match
  "downloads" — then checkpoint-surface mapping, falling back to stage 1 so
  recovery redoes early work rather than wrongly skipping it). The recovery
  context + prompt carry `failed stage … resume from this stage` and
  `completed stages (do NOT redo; reuse their artifacts)`; both fields
  persist on the durable record (`checkpointRecovery.failedStageId` /
  `completedStageIds`). Smokes: computer-task-complexity (stage-recovery
  cases) + runtime / evidence-recovery / chat-failure-recovery green.
  **Remaining for full D4:** per-stage execution envelopes/budgets (stages
  still share one envelope — the contract is prompt-enforced) and live
  stage status tracking (which stage is active) on the durable record.
- **D5 SHIPPED (first pass, 2026-06-10) — human takeover for 2FA/CAPTCHA.**
  The vault→browser path already existed (`fill_saved_login`); the gap was
  the hard stop on human-only checkpoints ("If a site shows a CAPTCHA or
  2FA, stop"). Now: `ask_user` gained kind `human_takeover` (5-min wait vs
  2-min; defaults to "Done, continue"/"Cancel the task"; context tells the
  user to complete the step in the live session view). Privacy property is
  structural: while the loop is parked on ask_user NO tools run and NO
  screenshots are captured, so user-typed secrets never enter model
  context; the agent re-screenshots only after the user confirms. Time
  spent waiting on ANY confirmation no longer counts against the 5-minute
  work deadline (`confirmationWaitMs` excluded). Prompt rules rewritten:
  login walls/2FA/CAPTCHA route vault-or-takeover instead of stopping.
  Needs edge deploy. Deno check clean.
- **D6 chat strip SHIPPED (2026-06-10).** ChatTab now renders a derived
  needs-you strip between the message list and composer when the persisted
  task record has open questions/approvals/blockers — visible immediately
  on return-after-reload, tap opens the Computer Use console. Derived from
  state (no posted message → no spam on remount). Known limit: the strip
  reads ChatTab's mount-loaded copy of the record, so mid-run questions
  appear in the live card, and in the strip after reload/thread switch —
  the return-after-reload case is exactly what it's for.
  **D6 Office surface SHIPPED (2026-06-10).** OfficeTab renders an active
  computer-task card next to the HITL approval banner (30s poll on the
  persisted main-thread record via lazy import; never breaks Office):
  title + phase, top needs-you items (amber when action needed), compact
  stage glyph row, and a "Open Chat → Use Computer" pointer. Remaining D6:
  push/completion notifications; per-thread records beyond main.
  (Console "resume with answer" shipped earlier — see Resume loop.)
- **D6** Durable task checklist visible in chat + Office (Focus Chain UI) with
  completion/blocked notifications; reads `computerTaskState` (now including
  D2 pending questions). Rides the existing Cline-audit Gap 4 item.
- **D7 SHIPPED (first pass, 2026-06-10) — save completed task as recipe.**
  Pure `buildComputerTaskRecipeDraft` (computerTaskStateModel) turns a
  COMPLETED task record into a SKILL.md draft (agentskills.io frontmatter;
  stages → ordered steps with the handoff rule; baked-in observe/approve/
  proof safety rules; failed/blocked tasks → null). Filed through the
  existing HITL path via new `fileComputerTaskRecipeProposal`
  (skillLibraryWrite — pending `agent_approvals` row, `skill.create`,
  dupe-name guard; a circle member approves before it lands). Console
  "Save as recipe" button on completed tasks. Once in the library the
  recipe rides the existing skill injection/ranking.
  **D7b SHIPPED (2026-06-10) — schedule a completed task.** New pure
  `parseComputerTaskSchedule` (automationChatParser): user supplies just
  the cadence ("friday at 9am", "day at 8am", "weekly"; redundant "every"
  tolerated); reuses the existing cadence grammar via synthetic
  composition, then overrides name/prompt so the ORIGINAL task text
  survives verbatim ("Run this computer task exactly as written: …"),
  output target chat. Unparseable cadence → null (UI shows guidance, never
  files junk). Console: schedule input + button on completed tasks →
  `createAutomationFromProposal` → `circle_automations` row, manageable
  via /automation list. Smoke: automation-builder (8 cadence asserts).
  **D7c SHIPPED (2026-06-10) — action-trace guided replay.** Successful
  runs persist their tool-action sequence (`computer_use_runs.action_trace`
  jsonb — migration `20260610_computer_use_action_trace.sql`, RUN_THIS_SQL
  §20, roadmap checklist row 20). Inputs are REDACTED at write time
  (credential-shaped keys masked, strings bounded, ≤40 actions) — the
  column never stores secrets. On a new run whose normalized task text
  matches a prior successful run (45-day window — weekly schedules still
  match; the schedule prompt prefix is stripped), the edge injects the
  proven sequence as a follow-this-script block with drift rules: confirm
  state before each step, STOP following on mismatch and re-ground
  normally, ask_user steps never skipped. Both sides are
  pre-migration-safe: the trace persists via a separate best-effort update
  (a missing column can't break run completion) and a failed replay lookup
  just means no replay. This closes the recipes→schedules→cheap-repeat
  loop: run N+1 follows run N's proven path instead of re-exploring.
  NEEDS: §20 SQL in prod + edge deploy.
- **Stage status on checklist SHIPPED (2026-06-10).** Checklist card +
  console show per-stage progress (✓/✕/○) derived from D4b recovery:
  completed stages from `completedStageIds`, ✕ on the failed stage (the
  resume point), all-✓ on completed tasks. Step rows yield to stage rows
  when stages exist (no double progress story).
- **D8** Intermediate per-checkpoint proof events + partial-results-on-stop in
  the edge loop (`computer-use-agent/index.ts:432-489` emits proof only at
  end_turn). Feeds D6.
- **Staged pre-flight validation SHIPPED (2026-06-10).**
  `validateComputerTaskStageSurfaces` checks every stage's surface against
  the live capability audit BEFORE launch: a browser→files→app task with
  the desktop bridge offline now fails at launch with "Stage 3 [desktop
  app] cannot run: desktop_control + app_tools unavailable" instead of at
  step 9 after browser/file work already ran. Wired into
  `prepareComputerTaskExecution`: blockers fail `readiness` closed, missing
  capabilities surface, and the envelope carries `stagePreflightBlockers`
  for UI. Rules: only 'missing' blocks ('partial' can degrade);
  desktop_app accepts EITHER desktop control or app tools; no audit defers
  to base readiness. Smokes: computer-task-complexity (preflight cases) +
  execution-grounding + runtime green.
- Honorable mentions (tracked, unscheduled): wire `useComputerUseQueue` for
  parallel fan-out; per-site/app sticky allow scopes on grant memory.

Suggested order: D6+D8 next (visibility pair), then D5, then D4, D7 last as
the compounding payoff.

## Tool-tree items (T — 2026-06-10)

From the tool-tree/desktop deep-research pass (evidence + full rationale in
`docs/TOOLTREE_DESKTOP_RESEARCH_2026-06-10.md`). Ground truth correction:
the catalog is **153 tools** (desktop.* alone is 57), ~15–20k tokens of
schema advertised per turn — past the verified 10-tool/10k-token threshold
where dynamic tool selection measurably improves both cost AND selection
accuracy (Opus 4: 49%→74% on large-catalog evals). Same rule as R/D items:
extend canonical owners (`openswanToolRuntime.ts`), no parallel modules.

**Cheap + verified (do first):**

- **T1** Description/schema audit pass over all 153 tools (when-to-use,
  preconditions, failure modes, evidence returned) + a description-lint
  smoke. Verified as the cheapest reliability lever (SWE-bench description
  refinements).
- **T4** Finish O2: migrate the 7 remaining `agentTools/` locals into the
  catalog, retire the 3 snake_case duplicates, delete the legacy registry.
- **T5** One approval framework: desktop tools off `chatApprovalGate`
  category onto the policy gate; add `approvalKind` to the ~20 mutating-auto
  coordination tools so the audit trail categorizes every mutation.

**Structural (sequence with O7/R15 prompt caching):**

- **T2** Progressive disclosure: pinned per-surface core + `tools.search`
  expansion in the catalog owner (provider-agnostic); native
  `defer_loading`/Tool Search on Anthropic paths. Design together with the
  R15 cache boundary.
- **T3** Family consolidation via action-parameterized group tools
  (desktop file ops / mouse / clipboard / InDesign / Photoshop; missions/
  tasks/rooms writes). Rule: the `action` param must drive approval policy.
- **T6** MCP integration: bridge-style adapter for `mcpClient.ts` tools —
  unannotated/untrusted ⇒ mutating+destructive ⇒ ask (spec: annotations
  MUST be treated as untrusted); surface/mode scoping; run-ledger logging;
  `listChanged` re-fetch. Do NOT wire mcpClient directly (policy bypass).
- **T8** = O6 dependency metadata: `mutationTarget`/`readsFrom` on tool
  policies → parallelize disjoint reads instead of all-or-nothing.

**UX (rides D-item surfaces):**

- **T7** Sticky per-site/per-app allow scopes with reviewable/revocable
  permissions surface + a hard always-confirm category floor
  (pay / permanent-delete / credential-entry / account-grant) that no
  autonomy mode or sticky grant bypasses. Validated against Claude in
  Chrome's shipped model; extends D3 constraint categories + grant memory.
- **T9** Mode-tag completion (mutating tools default `build`/`execute`).
- **T10** Composable result formatters + `response_format: concise|detailed`
  on observation-heavy tools.

**Avoid:** mega-tool collapse, deriving approval from third-party MCP hints,
growing the static catalog pre-T2, desktop-bridge architecture changes based
on the unverified Q2/Q3 research claims (follow-up round needed — see report
§5).

### T-item status (2026-06-10/11 — typecheck clean; see
`docs/TOOLTREE_BUILD_SESSION_2026-06-10.md` for the build session record)

- **T1 SHIPPED** — full description/schema audit: 426 lint violations → 0
  across 158 tools (251 missing schema-prop descriptions, 90 missing
  when-to-use on big families, 39 too-short, 37 mutating-without-side-effect
  statement, 4 untrusted-content, 2 capability-first). Permanent regression
  net: `smoke:tool-description-lint` (7 data-driven rules + self-pruning
  allowlist; 1 documented exception: `credentials.get` policy quirk —
  read-only handler under the mutating catch-all, fix with a real policy).
- **T2 SHIPPED (dark)** — progressive disclosure: per-tool/family
  `disclosure: pinned|deferred`, pure `listPinnedOpenSwanToolsForSurface` +
  ranked `searchOpenSwanToolCatalog`, new `tools.search` catalog tool,
  `resolveAdditionalTools` per-turn hook on `runAgent` (additive-only merge),
  bridge `getProgressiveOpenSwanTools` returning {tools, resolver}. Measured:
  main_chat 147 tools/≈15.7k tokens → 33/≈2.8k (-82%); task_run -89%.
  Default path byte-identical; NO caller flipped (live flip = its own pass,
  per-circle/dev flag suggested). Smoke: progressive-tool-disclosure (60
  asserts incl. real runAgent unlock round-trip).
- **T3 DEFERRED (deliberate)** — consolidation renames model-facing tool
  names → breaks action-trace replay (D7c) + approval fingerprints (R19);
  needs its own live-verified migration pass like C1.
- **T4 SHIPPED** — registry unification done: legacy `agentTools/` was fully
  ORPHANED (zero importers) and is deleted; 10 dupes retired; 4 unique tools
  migrated into the catalog (`skills.view`, `skills.manage`,
  `user_memory.manage`, `messages.search` — now take circleId/userId from
  trusted runtime context, not model args); bridge moved to
  `src/lib/openswanBridge.ts`. No approval grants lost. Roadmap §4/§6
  updated. Follow-up: swanbot-v2-ai edge fn reimplements 4 camelCase tools
  Deno-side — align names during the v2 migration.
- **T5 SHIPPED** — every mutatesState policy carries an approvalKind
  (`COORDINATION_APPROVAL_KINDS` map; union NOT extended — it's mirrored in
  a DB CHECK constraint + total UI Record, needs a migration to grow).
  Desktop tools now single-gate via the catalog policy path (free via T4).
- **T6 SHIPPED (dark)** — `src/lib/mcpToolBridge.ts`: fail-closed MCP→agent
  adapter (untrusted/unannotated ⇒ ask/privileged_action per the MCP-spec
  MUST-treat-annotations-as-untrusted rule), `mcp__<slug>__<tool>`
  namespacing, injected approval gate (no gate ⇒ policy block), results
  `<untrusted_quoted>`-fenced with escape neutralization + 8k cap. NOT
  wired: needs run-set registration, gate backing via `requestRunApproval`,
  and a trust source (`circle_mcp_servers` has no trust column — seam
  documented). Smoke: mcp-tool-bridge (12 checks).
- **T7 SHIPPED (floor half)** — `ALWAYS_CONFIRM_FLOOR` (pay/delete/login/
  grant) in `chatComputerRequestRouter.ts`: forces approval even under
  "don't ask me"; verb-anchored conservative detection;
  `constraintBlocksToolCall` verdict now distinguishes hard-block vs
  floor-confirm; fixed "log into"/"sign into" regex gap. Remaining: sticky
  per-site/app allow scopes + permissions surface UI (rides D-item surfaces).
- **T8 SHIPPED (dark)** — pure layer + typed-core wiring: ToolParallelPolicy
  `mutationTargets`/`readsFrom`, `partitionParallelSafeBatch`;
  `toolParallelPolicyProvider` option on `runAgent` (group-sequential,
  in-group parallel, request-order results; absent ⇒ byte-identical);
  conservative `TOOL_DEPENDENCY_DOMAINS` map in the catalog +
  `createOpenSwanToolParallelPolicyProvider()` in the bridge. O1 flip is a
  one-liner. NOTE: legacy v1 loop (swanbot.ts:~2880) still uses the
  all-or-nothing rule — fine, it retires with S1.
- **T9 SHIPPED** — mode tags on all clearly-mutating tools (semantics
  confirmed first: tools never vanish from default/mode-less chat;
  `tasks.comment` + `approvals.*` deliberately mode-agnostic).
- **T10 SHIPPED** — `src/lib/toolResultFormatters.ts` (pure composable
  helpers) + `response_format: concise|detailed` (default concise) on 10
  observation-heavy tools (`rooms.list_files` was previously UNBOUNDED);
  truncation markers tell the model to ask for detailed. Smoke:
  tool-result-formatters.

**Un-darking checklist (each its own live-verified pass):** (1) flip a
runAgent call site to `getProgressiveOpenSwanTools` + `resolveAdditionalTools`
+ `toolParallelPolicyProvider` (T2+T8 together — this is effectively part of
O1); (2) register `getMcpToolsForCircle` tools behind the run approval gate +
pick the MCP trust source (T6); (3) T7 sticky-allow UX; (4) T3 consolidation
with name-migration handling.

## Office

- **Live Claude Code subagents SHIPPED (2026-06-10).** Claude Code's Task-tool
  subagents now appear in the Office dashboard. Root cause was two-fold: the
  bridge counted `<sessionId>/*.jsonl` but the real path is
  `<sessionId>/subagents/agent-*.jsonl`, so `subagentCount` was always 0 and
  no subagent sessions were emitted. New `extractLiveSubagents` in
  `scripts/claude-bridge.js` reads that dir, surfaces only FRESH subagents
  (file modified within the 2-min active window — historical ones are
  ephemeral and would flood the floor), and returns each as a
  `kind:'subagent'` session with `parentSessionId`, a task label from its
  first user message (Repo: preamble stripped), model, token usage, and
  current tool. The detector path was already built for this:
  `bridgeSessionsToAgents` maps subagents to `role:'Sub-Agent'` live agents
  (distinct `sessionKey` `<parent>::sub::<id>`), and `updateClaudeCodeAgentStatus`
  rolls them into the parent's `(+N sub)` label — so subagents show as their
  own floor agents AND bump the parent. Fixed `publishClaudeCodeAgent`'s
  single-session count (was inflated by subagents in `sessions.length`).
  Subagents are NOT persisted as DB rows (ephemeral, live-only). Verified:
  extractor proven against real on-disk subagent transcripts (this session's
  own Task agents, clean labels); bridge `node --check` clean; typecheck
  clean; office-roster-grouping smoke green. NOTE: restart the local bridge
  (`npm run bridge`) to pick up the change.

## Open decisions (roadmap §7)

Decisions 1–3 were recorded 2026-06-09 (see roadmap §7): Sonnet 4.6 edge +
Opus 4.7 in-app · in-place v2 rewrite · keep "OpenSwan". Still open:

4. Skill marketplace: circle-private, or add `is_public`?
5. (New, R6) Approval posture per chat family when the legacy ungated paths
   migrate onto the gated dispatcher.
