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
2. **v2 edge function is done but not default** — `swanbot-v2-ai` currently has
   79 source-derived tools (54 client-delegated) and a readiness gate
   (`swanbotOpenSwanReadiness.ts`), but v1 is still primary.
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
- **C1 Step 2 remaining (pending)** — the conversational families through
  WordPress publish/schedule are now smoke-verified on the unified detected
  intent executor. Terminal cutover prep also shipped:
  `chatTerminalTransportPolicy` owns the stream-vs-batch decision and pure
  smokes cover `run_plain_chat` / `run_openswan` handler selection. The
  remaining live migration is the terminal `run_openswan` / `run_plain_chat`
  model path (`streamChatResponse` / `runOpenSwanSessionTurn`), followed by
  retiring the legacy `conversationalRouter` fallback. This remains the highest
  blast-radius C1 step and must be live-verified.

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
- **R17 SECOND PASS SHIPPED (2026-06-15)** — canonical fencing helper
  `src/lib/untrustedContent.ts` (`wrapUntrusted` / `containsFenceMarker`,
  pure + smoke-tested). Beyond DRY it CLOSES A REAL HOLE the inline fences
  had: it strips nested `</untrusted_quoted>` markers (incl. spaced/cased
  variants) from the body, so a member who types the close marker into a
  note/name/Discord message can no longer end the fence early and smuggle the
  rest out as trusted instructions. Applied to the two unfenced
  `discordContext` injections in `swanbot.ts` (`buildOpenSwanRuntimeContextBundle`
  USER.md block + the legacy Current-Context block) — external Discord chat is
  now fenced + length-bounded. Smoke: `untrusted-content` (incl. the
  marker-injection attack), in smoke:all.
- **R17 THIRD PASS SHIPPED (2026-06-15) — consolidation.** Audited all fence
  sites. The two HIGHEST-value surfaces (tool/observation output
  `fenceUntrustedObservationText`, MCP results `fenceUntrustedMcpText`) and the
  circle snapshot were ALREADY neutralizing embedded markers — good — but with
  a regex that missed spaced/cased variants; broadened all three to
  `/<\s*(\/?)\s*untrusted_quoted\s*>/gi` to match `wrapUntrusted`. Migrated the
  two `memoryService` inline fences (soul wisdom `formatSoulWisdomBlock` +
  turn-time retrieval `retrieveForTurn`) — both member-authored memory, the
  prime injection vector — onto `wrapUntrusted` so they now strip nested
  markers too. Net: every prompt-visible untrusted surface (memory, tool
  results, MCP, snapshots, Discord) now closes the fence-smuggling hole
  consistently. circleSnapshotContextInjection/skillLibrary references are
  comments only; v1 edge fn prompt blocks still pending (Deno, deploy-gated).
  Typecheck + untrusted-content/agent-runtime/memory-bank smokes green.

  v2 prompt caching (R15) check: ALREADY DONE — `swanbot-v2-ai` caches the
  frozen block (`cache_control: ephemeral`, MODE_CONTRACT + buildFrozenBlock)
  with the volatile timestamp split into a separate uncached block and skills
  as a user-role message. The review's "v2 has no caching" note was stale.
  (Open question, needs live token measurement: per-turn `selectToolsForTurn`
  varies the tool set, which can defeat the tools+prefix cache on a new
  message — left untuned rather than guessed blind.)

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
  allowlist). Follow-up shipped later: `credentials.get` now has a dedicated
  approval-gated vault read policy, and login form automation prefers
  `browser.fill_credential_field` so raw secrets do not return to the model.
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

**Un-darking checklist (each its own live-verified pass):** (1) ~~O1~~ DONE
(see below) — the T2/T8 flips inside it remain commented one-liners in
`openswanSessionRuntime.ts` (~533, 660–662), flip after O1 live-verifies;
(2) ~~T6 MCP registration~~ DONE (see below); (3) ~~T7 sticky-allow UX~~
DONE (see below); (4) T3 consolidation with name-migration handling.

### T6 un-darked + D6 notifications (2026-06-11 — typecheck clean, smokes green)

- **T6 LIVE (typed-core path only)** — MCP tools now assemble into OpenSwan
  turns: trust source = `circles.settings.mcpTrustedServerIds` (≤20, new
  `circleMcpTrustSettings.ts`, silent-failure ⇒ all untrusted ⇒ fail
  closed); Office MCP HUB panel gained a per-server UNTRUSTED/✓ TRUSTED
  pill with confirm + warning copy; runtime appends
  `getMcpToolsForCircle(...)` after catalog tools (once per turn, ≤20,
  deterministic order, collisions skipped, all failures ⇒ zero MCP tools);
  approvals ride the SAME `onToolApproval` UX with `mcp_server`/
  `approval_kind` leading the payload. Legacy escape-hatch path gets no MCP
  tools (its dispatcher has no handlers — documented). Live-verify: banner
  rendering of the enriched payload + one real end-to-end MCP turn.
- **D6 notifications SHIPPED** — `ComputerTaskNotification` on the durable
  record (≤5, transition-only derivation: completed/failed/blocked/
  needs_you/partial_result; dedup; persisted-compatible); write-through at
  the single phase-write owner (`persistComputerTaskState`), the D2
  question path, and D8 partial results; ChatTab dismissible banner above
  the needs-you strip (VIEW opens console, DISMISS persists ack,
  completed/failed auto-ack on console open); web OS Notification fired
  only when page hidden AND permission already granted (never requests).
  OfficeTab's 30s-poll card picks the field up automatically.

**O1 live-verification still pending** (requires a logged-in app session —
the playwright profile hit the login wall; checklist unchanged above). The
T2/T8 flips stay gated on it.

### O3 + C1 prereqs (2026-06-11 — typecheck clean, smokes green)

- **O3 SHIPPED (needs live verification)** — `subagentRegistry` child loops
  run on `agentExecutionCore.runAgent` by default (flag
  `uc_subagent_typed_core`, localStorage-revertable, legacy retained):
  same edge transport/round cap/nudges as O1 (reused adapter exports),
  children keep their narrower tool scoping (NO MCP tools — would widen
  the surface), child events stream to `agent_run_events` via
  `createPersistedRun({parentRunId})`, real token usage (legacy reported
  none). `canDelegate()` is now the single gate (depth/concurrency +
  additive requestedRole/taskPreview context); refusals are structured,
  never throws. **Summary-only contract**: parent receives
  {summary (redactSubagentOutput, 1200-char cap), status, runId, tokens,
  toolCallCount} — child transcripts never enter parent context
  (smoke-asserted). Honest completion: capped/edge-failed children now
  read `completed=false` (legacy lied). Typed-loop composition lives in
  delegationGate.ts (pure) so smokes run the production loop. Live-verify:
  one real delegation (ledger row + digest-only parent reply), gate-block
  notice, revert lever, and that the ledger UI reads the new
  failed-on-cap status sensibly.
- **R7 SHIPPED** — handler state-request contract:
  `ChatTransportStateRequests {typing?, modalToOpen?, workbench?,
  composerLock?}` on transport outcomes; ChatTab applies them after
  dispatch in try/finally — a gate refusal or handler throw can no longer
  leave typing stuck or the composer locked. Both live-verified handlers
  converted (mid-handler streaming mutations stay, documented).
- **R8 SHIPPED** — `executeDetectedConversationalIntent(intent, deps)` in
  conversationalRouter (public API preserved as detect-then-call); the
  memory handler uses the planner's already-detected intent;
  `__conversationalRouterDiagnostics.detectCalls` spy seam asserts zero
  re-detection on the dispatcher path. Router is now smoke-importable
  (static supabase import → dynamic).
- **R9 SHIPPED** — `clarificationResume` store on the dispatcher ctx
  ({pending, setPending, clearPending}; ChatTab refs remain backing
  store); ask_clarification parks through it, so create_task can share
  the seam.
- **wordpress_list cutover (next)** is mechanically trivial now, but
  carries a planner decision: the planner maps it to the `wordpress`
  route → external_side_effect → gated, though `/wp list` is read-only.
  Either teach the planner `wordpress_list` is read-only (risk safe, no
  approval) or accept the silent→gated change deliberately (R6),
  then live-verify.

### O1 + T7-UX status (2026-06-11 — typecheck clean, smokes green)

- **O1 SHIPPED (needs live verification)** — `openswanSessionRuntime`'s tool
  loop now runs on `agentExecutionCore.runAgent` by default. Provider adapter
  wraps the SAME `swanbot-ai` edge transport (no new HTTP path); approval
  gate forwards `{name, input}` untransformed (R19 fingerprint-stable —
  smoke-asserted); R13 stage mapping, R14 design-manifest capture, R12
  checkpoint write + cap-exhaustion finalization + resume contract all
  preserved (mapping table in the session record). Escape hatch:
  `localStorage.uc_openswan_typed_core='0'` reverts to the legacy loop (no
  auto-fallback mid-run). Pure adapter layer:
  `openswanSessionRuntimeAdapters.ts`; smoke:
  `openswan-session-core-adapter` (~60 asserts + e2e runAgent round-trip).
  Bonus: session usage telemetry now real (legacy reported `{}`).
  **Nudge parity follow-up SHIPPED same day**: `onRoundComplete` hook on
  `runAgent` (one user-note per round boundary, skipped on final round,
  errors swallowed); typed path re-wires the three legacy reliability
  nudges via the SAME pure helpers (deterministic re-observe on failed UI
  actions, tool-budget reminder at ≤2 rounds left, surface-aware
  proof-coverage nudge — byte-exact text parity smoke-asserted). Known
  delta: proof nudge fires proactively at round boundary instead of
  intercepting the done-response. Live-verify checklist (7 items) in the
  O1 agent record: plain tool turn, review-mode approve/reject + cached
  approval match, stage spinner, cap+resume, design-manifest capture,
  browser plan card, revert lever.
- **T7 UX SHIPPED** — sticky per-site/per-app allow scopes end-to-end:
  pure model in NEW `computerGrantGate.ts` (normalized eTLD+1-ish site keys,
  30d default expiry, floor categories pay/delete/login/grant REJECTED at
  creation and re-stripped at application — the router's
  `ALWAYS_CONFIRM_FLOOR` now re-exports the same object so they can't
  drift); device persistence via the `storage` wrapper (NO new table/SQL);
  router downgrade only on full non-floor coverage, never for destructive
  risk/ask-before/explicit-approval/buildout, route stamped
  `stickyScopeApplied` + visible "Auto-approved via your standing grant…"
  notice; Computer Use console PERMISSIONS section (list/revoke/history/
  add form — floor categories never offered; one-tap post-task offer);
  ChatTab hydrates the registry on mount + before route build, records
  scope use at definite execution (both immediate and
  preview→approve→launch paths); standing-grant notice rides
  `chatComputerHandoffContext` (bounded, optional, persisted-compatible).
  Smokes: computer-grant-gate (57 sticky asserts incl. malicious-scope
  floor partition), request-router, handoff-context.

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

## App-resolution feature (A — 2026-06-12, typecheck clean, smokes green)

User ask: "type what you want → SwanBot knows the best application and opens
it (browser/app/desktop)." Shipped end-to-end:

- **A1 — task→app model** (`knownAppShortcuts.ts`, canonical owner): 20-member
  TaskAppCategory taxonomy; catalog expanded ~30→~50 apps (every category has
  desktop + web options, `webAppQuality: full|limited`);
  `detectTaskAppCategory` (verb-anchored, conservative; named app always
  wins; URL tasks skip); `resolveBestAppForTask` ranking: named >
  user-preferred > installed+learned > installed > web-full >
  maybe-installed (HONESTY rule: unknown installedApps ranks below known
  web-full) > web-limited; running-app bonus; named-but-unavailable falls to
  its own web variant. `buildAppOpenPlan` (launch/focus + wait_for_app /
  open_url, real catalog tool names). Per-category preference memory (device
  storage, ≤20). Smoke: app-task-resolver (227 asserts).
- **A2 — installed-apps probe**: bridge `/desktop/installed-apps` (Spotlight
  + fs fallback, ≤400 deduped, 5-min cache) + `/desktop/app-installed`
  (`open -Ra`, execFile argv — shell-injection-proof, hostile-name
  smoke-pinned); client `listInstalledAppNamesLower()`; catalog tool
  `desktop.list_installed_apps` (read-only auto, deferred disclosure,
  E6-fenced concise output). Version fuzziness handled
  ("Adobe Photoshop 2026" matches "Photoshop").
- **A3 — route wiring**: in-memory app-resolution context (T7 hydration
  pattern; ChatTab hydrates on mount + before route build; fail-honest when
  unhydrated); route stamps optional `appResolution` (persisted-compat);
  open-app-first solution steps + recommendedTools; route-creation policy:
  resolutions CREATE routes only for high-confidence app-workbench
  categories (photo/video/spreadsheet/pdf/cad/…), conversational categories
  only stamp; prompt "App choice:" line + visible notice ("Using Photoshop
  (installed) — say 'use Photopea' to switch") riding the autonomy gate;
  "use <app> instead" override parsing records the per-category preference
  (anchored, cross-category rejected).
- **A4 — dispatch contract**: complexity plan carries the resolution; the
  dispatch block's "App choice contract" (~6 lines): open first → verify
  frontmost before acting → fall back ONCE to the named alternative → then
  ask the user. Threaded route→ChatTab→`executeComputerTaskWithAgent`→
  `prepareComputerTaskExecution`→plan (optional args, additive).

Also this round: escalation-breadcrumb producer wired in ChatTab (L0
leftover); `wordpress_list` now read-only/no-approval in the planner (the
pre-cutover fix); unmet buildout proposals surfaced in the console; L1
example injection gated by measured per-app benefit (suppress when
example-assisted success <60% AND ≥20pts below unassisted baseline, ≥4
samples — UFO2 o1-regression answer); post-buildout-retry outcomes fold
into learned facts. Deferred from this round: the E2E pipeline integration
smoke (agent was interrupted — still worth building).

## WordPress admin/browser buildout (2026-06-23, typecheck clean, smokes green)

User ask: SwanBot/OpenSwan/Chat should be able to log into and operate a
WordPress site, navigate wp-admin, upload assets, and complete requested site
tasks with professional safeguards.

- **Route rescue shipped.** Short and mixed phrases such as "edit a page in
  wp-admin", "install a WordPress plugin after approval", and "log into
  wp-admin and edit a page" now form computer/browser routes instead of build
  discovery or plain chat routes.
- **Execution strategy shipped.** WordPress admin tasks use a dedicated
  browser strategy: prefer REST/API tools for supported content and media,
  fall back to wp-admin browser automation for dashboard-only workflows, resolve
  vault credentials before login, stop for MFA/CAPTCHA, require approval before
  public/settings/plugin/theme/user/ecommerce changes, and verify with
  proof-after evidence.
- **REST schedule fix shipped.** `/wp schedule` now creates `future` posts with
  an ISO publish date and shares payload shaping with `siteAutomation`, including
  optional excerpt, slug, meta, featured media, categories, and tags.
- **OpenSwan tool policy hardened.** `wp.discover_types` and `wp.list_posts`
  stay read-only/auto; `wp.upload_media` and `wp.create_slide` are explicit
  publish-class writes requiring approval.
- **Local wp-admin macros expanded.** Requests like "open wp-admin plugins for
  example.com" and "open wp-admin settings for example.com" map to the proper
  dashboard URLs before generic desktop/browser fallback.
- **Dealer Inspire source intelligence shipped.** The route now recognizes
  Dealer Inspire / DI Slides / `di_slide` / `flavor_di_slides` tasks as
  WordPress admin/browser work, not generic desktop slides or creative-banner
  work. `browser.wp_admin_source_intelligence` is the canonical pre-DOM
  read-only tool; it calls `wordpressAdminSourceIntelligence` to parse
  bounded/redacted wp-admin source facts from managed Dealer Inspire sites:
  admin root, current screen,
  custom post types, DI menus/plugins, list-table rows/actions, slider/image
  columns, status counts, Quick Edit expiration/order fields, auth/session
  markers, and nonce field names without returning nonce values, raw scripts,
  secrets, or email payloads. Chat routes for "upload banner.jpg and create a
  Dealer Inspire DI Slide" now prefer `wp.discover_types` -> `wp.list_posts` ->
  `wp.create_slide`, inspect wp-admin source intelligence before dashboard UI
  decisions, use DOM/editor reads only for clickable or editor state, request
  approval before media/status/slider/expiration/cache changes, and verify post
  id/title/status, slider, image URL, expiration, and public/cache state.
- **WordPress existing-item updates shipped.** `wp.update_post` is now a
  client-delegated, approval-gated WordPress write for known post/page/CPT IDs.
  SwanBot/OpenSwan can patch existing posts, pages, and Dealer Inspire records
  through REST before falling back to browser Quick Edit. Supported fields are
  bounded to title/content/status/slug/excerpt/date/featured-media/menu-order/
  meta, and returned receipts stay slim (`id`, `title`, `status`, `link`) so
  chat does not expose full WordPress payloads.
- **WordPress trash + mutation normalization shipped.** `wp.trash_post` is
  soft-delete only and exact-approval gated; permanent delete/force inputs are
  rejected before dispatch. `src/lib/wordpressRestPayload.ts` now owns shared
  mutation normalization for SwanBot and OpenSwan so status, post type, slug,
  date, and bounded meta validation stay aligned.

Next WordPress buildout: add live bridge/browser E2E coverage against a seeded
WordPress test site, then expand deterministic wp-admin recipes for pages,
menus, media library, plugin/theme install/activation, WooCommerce products,
users/roles, settings export/rollback, and Dealer Inspire DI Slides edit/clone/
quick-edit/cache recipes against a sanitized fixture plus a real staging site.

## Circle Context Snapshot (CX — 2026-06-12, typecheck clean, smokes green)

External insight adopted (Airbyte "Context Store" pitch — the discovery-gap
framing): agents waste tool calls + tokens on runtime discovery (sequential
list calls to learn what exists and how entities connect). We already
pre-materialized TOOLS (T2 tools.search), CAPABILITIES (app-resolution
registry, sticky scopes), and SKILLS (metadata injection); this round did it
for CIRCLE DATA. Their other half — write-with-audit-trail — we already had
(approvals + run ledger). Their product itself: not needed (Supabase-native
index from our own tables).

- **CX1 — snapshot model + builder** (`circleContextSnapshot.ts`): bounded,
  ENTITY-LINKED index (tasks carry assignee/mission/room inline; missions
  carry task counts + assigned agent) across members/tasks/goals/missions/
  rooms/integrations/recentRuns/skills; parallel per-section queries reusing
  the catalog tools' exact shapes, per-section degradation (one failing
  table never kills the snapshot); 60s-TTL cache + in-flight dedupe +
  mutation-seam invalidation (tasks/goals/missions/rooms/workspace writes);
  render = structural headers OUTSIDE one `<untrusted_quoted>` fence
  (R17), budget-trimmed; in-memory ranked search. No new SQL.
- **CX2 — `context.search` tool**: pinned (the discovery entry point — one
  free in-memory call instead of N list calls), read-only auto, all
  surfaces; description steers FIRST-use for what/which/who + live tools
  for fresh-after-write (documented ~60s staleness). Pinned core stays in
  band (34 tools, 80% payload reduction preserved).
- **CX3 — prompt injection**: compact render (~2.5k chars) as a USER-ROLE
  context message (skillPromptInjection precedent — frozen system prompt
  stays cache-hot per R15): typed-core path via
  `buildSnapshotAwareInitialMessages`; v1 path in the non-frozen dynamic
  tail (moderate/complex turns only), with `omitCircleContextSnapshot`
  preventing double-injection on the typed path while the legacy revert
  lever still gets it. Fail-safe: build error/1.5s timeout ⇒ no block,
  turn byte-identical to pre-feature. Smokes: circle-context-snapshot (38),
  session-core-adapter section 10.
- **Follow-ups**: subagents currently inherit the v1-tail injection on
  moderate+ turns (bounded; suppress flag exists if it proves wasteful);
  measure actual list-call reduction via observed evals (tools.total per
  run) once live.

## SwanBot build session (2026-06-12 — typecheck clean, smokes green)

Pre-S1 gates + Phase 3 maturity items, per "build SwanBot as best as possible":

- **R16 SHIPPED** — v2 tool parity is now SOURCE-DERIVED, not constant-trusted.
  Finding: the readiness snapshot's previous 45/22 expected constants were
  STALE and nothing live fed it real counts — the exact drift R16 warned
  about. New pure
  `deriveSwanbotV2ToolParityFromSource()` in `swanbotOpenSwanReadiness.ts`
  parses the `swanbot-v2-ai` TOOLS array (Deno edge fn can't be imported
  from tsx) and the readiness smoke asserts EXACT match both directions.
  Real counts re-pinned: **79 total / 54 client-delegated / 25 server** (2026-07-14: +6 coding-agent client tools).
  Catalog growth or shrink now fails `smoke:swanbot-openswan-readiness`
  until the constants are re-pinned deliberately.
- **R15 VERIFIED ALREADY SHIPPED** (was unrecorded) — `swanbot-v2-ai`
  already splits frozen/volatile: frozen block (identity, tool discipline,
  focused tool list, mode contract) carries `cache_control: ephemeral`;
  volatile `Now:`/user-id block sits after the boundary; `systemBlocks`
  build once per run and are reused across loop iterations AND
  client-delegation continuations (`resumeFrom.systemBlocks`); skills
  metadata rides a user-role message. The shared `_claude/anthropic.ts`
  adapter parses cache_creation/cache_read tokens with cache-aware cost
  math. Deno check clean. **S1's cost-regression blocker is gone** — both
  pre-S1 gates (R15+R16) are now closed; S1 needs only the prod deploy +
  traffic measurement.
- **O4 SHIPPED** — subagent spend limits. Pure `spend_limit_exceeded`
  check in `canDelegate` (enforced only when both spend AND limit are
  present — budget guard fails open, depth/concurrency still apply;
  explicit $0 limit blocks all spawns); `hitlService.getCircleMinSpendingLimit`
  takes the tightest `agent_controls.spending_limit_daily` across the
  circle's control rows; `delegateToSubagent` feeds last-24h spend from
  `get_claude_usage_summary` (parallel with the depth/in-flight reads).
  Blocked spawns log to the Activity feed with spend/limit in metadata and
  return the standard no-op DelegationResult so the parent continues
  in-line. Smokes: delegation-gate (+10 asserts), delegation-wiring.
- **O5 SHIPPED** — `not_applicable` verification status. Decision: kept
  `passed`/`failed` (more signal than the plan's `executed`), added
  `not_applicable` for optional non-automatic checks (the general plan's
  `manual_review required:false` previously read `planned` forever).
  Run-ledger surfacing: N/A label + muted color in the
  `openswanExecution` helpers; not_applicable contracts are filtered OUT
  of `buildOpenSwanExecutionStream` so RunExecutionCard's step counts and
  Green state stay honest (the checks list still renders them);
  `appendRunToolEvent` persists them as `skipped` steps and keeps them out
  of the typed ledger event stream (its status union doesn't carry the new
  value). Smoke: openswan-verification-runtime (+not_applicable cases).

**Environment note:** ~324 repo files are root-owned (e.g.
`src/components/chat/RunExecutionCard.tsx`, `ChatArtifacts.tsx`,
`agentRunLedgerPersistence.ts`) and cannot be edited without
`sudo chown -R $(whoami) src scripts supabase docs`. O5 was designed
around this (lib-level stream filter instead of a card edit), but future
passes touching those components will need the chown first.

**SwanBot next:** S1 is now unblocked code-side — deploy `swanbot-v2-ai`,
route a traffic %, watch `buildSwanBotOpenSwanReadinessSnapshot` telemetry
(50-run minimum), flip default, retire v1 (which also retires S5 + the v1
all-or-nothing parallel rule). Then O7 (agentPromptBuilder unification)
and the remaining C1 family cutovers (live-verified, R6 approval-posture
decision per family).

## App-task UX: honest, recoverable app selection (AR — 2026-06-12, typecheck clean, smokes green)

Deep-research pass on SwanBot's cross-app task UX (codebase review of the
chat→app pipeline + SOTA scan: ChatGPT Agent, Claude in Chrome, Mariner,
Manus, Skyvern, Cline). Finding: the app-task surfaces already match
best-in-class on most axes (plan preview D1, takeover D5, sticky scopes +
always-confirm floor T7, recipes/replay/scheduling D7, partial results D8,
needs-you surfaces D6). The one gap BOTH the internal review and the SOTA scan
converged on: **app selection was optimistic and recovery was generic** — the
agent picked an app from a possibly-stale install probe, the chosen app's
availability wasn't carried downstream, the fallback was a string footnote
recovery never consulted (and blindly `alternatives[0]`), and "you asked for
Pixelmator but it's not installed" surfaced as a generic "missing app
capability" dead-end. Four pure-lib items in canonical owners (all writable;
the area's 3 root-owned files — evidenceContract, computerAppGrounding,
chatComputerTaskAutonomy — were deliberately avoided):

- **AR1 SHIPPED** — availability is a first-class signal. `ResolvedAppOption`
  gained `availability` ('installed' | 'maybe' | 'web'), populated in
  `buildScoredOptionsForApp`/`browserOption`. New pure helpers in
  `knownAppShortcuts.ts`: `isAppOptionConfidentlyLaunchable`,
  `buildAppFallbackLadder` (best + distinct alternatives), and
  `pickRecoveryAppFallback` (next-best CONFIDENTLY-launchable option, prefers a
  full web app > confirmed-installed desktop > any alternative — never chains
  into another 'maybe' guess). Smoke: app-task-resolver.
- **AR2 SHIPPED** — the route carries the structured signal.
  `ChatComputerAppResolution` (chatComputerRequestRouter.ts) gained
  `best.availability`, `namedAppIntent` (the user's exact named app), and a
  structured `recoveryFallback` (full option, not a string). `alternativesSummary`
  kept for display. Smoke: chat-computer-request-router.
- **AR3 SHIPPED** — fail-fast availability + smart fallback in the dispatch
  contract. The App-choice contract (computerTaskComplexityPlan.ts) now adds a
  "confirm the chosen app actually launched and is frontmost BEFORE task work —
  a not-installed failure is the fallback trigger, not a blind retry" line when
  the chosen app is 'maybe'/named-unconfirmed (confirmed-installed apps keep the
  plain verify line), and the "fall back ONCE to …" line uses the structured
  `recoveryFallback` (a known-launchable web app) instead of `alternatives[0]`
  (which could itself be an unconfirmed desktop guess). Smoke:
  computer-task-complexity.
- **AR4 SHIPPED** — context-aware recovery. `computerTaskEvidenceRecovery.ts`
  gained `namedAppIntent` + `appFallback` inputs/context fields. When the chosen
  app can't open AND a confidently-launchable fallback exists AND it isn't a
  website auth/verification wall (which switching apps wouldn't fix), recovery
  turns the dead-end ("go build an adapter" / "go install it") into a one-tap
  switch-and-retry: `recommendedOptionId: retry_with_fresh_evidence`, the reason
  names the intent ("You asked to use Pixelmator…"), the resume instruction
  says "Switch to Photopea — open it in the browser", and it re-grounds on the
  fallback surface (no capability-gap buildout smokes). Auth walls and
  unconfirmed ('maybe') desktop fallbacks are suppressed. Threaded into
  `chatFailureRecovery.ts` from the inferred route's `appResolution` (and as
  optional explicit input for the live path). Smoke:
  computer-task-evidence-recovery.

Deferred (tracked, unscheduled — most touch root-owned UI files): proof
export ("copy as JSON / save CSV" on result cards), Office real-time
subscription (currently 30s poll), auto-approve checkbox placement +
write-confirmation, always-show approval countdown, mid-run steering
("interrupt-and-redirect without restart" — the strongest remaining SOTA gap),
progressive delegation (auto-approve suggestion after N clean runs), run
timeline scrubber (D7c action_trace already persisted). See the AR research
notes for the full ranked SOTA pattern list.

## Bug: app-open spawned a Codex terminal (RX — 2026-06-12, typecheck clean, smokes green)

User report: "told chat to open the Notes app → it opened Notes but then opened
a Codex terminal window." Root-cause chain from the transcript:

1. Notes launched fine ("Launched Notes via the local bridge").
2. The task ran the full **Desktop Semantic Control Loop** (a11y preflight +
   fresh-evidence + proof), whose bridge health probe hit
   `cors_preflight_blocked on desktop_bridge`, so the task was marked FAILED
   even though the app opened.
3. **Automatic** chat failure-recovery classified it `restart_or_update_bridge`
   / next-actor `connected_agent` and **auto-launched a Codex terminal** —
   `dispatchConnectedAgentTask({ launchIfMissing: true })` with no approval.

- **RX1 SHIPPED — gate the connected-agent launch behind explicit approval.**
  `startConnectedAgentFailureRecovery` (agentFailureRecovery.ts) now returns a
  "ready — approve the repair option" result instead of launching/commandeering
  an agent unless `approveConnectedAgentLaunch === true`. Default OFF, so
  AUTOMATIC recovery prepares + presents the recovery-options card but never
  opens a terminal window on its own (CLAUDE.md: desktop actions stay explicit
  about risk + approval). Threaded through `ChatFailureRecoveryInput` →
  `buildChatFailureRecoveryInput`; the automatic ChatTab handoff leaves it
  unset. The explicit `agent.recover_failed_task` tool sets it true (calling
  the approval-gated tool IS the decision). The recovery-option copy already
  branched on `recovery.ok`, so with the gate it correctly reads "Launch a
  connected recovery agent…" (an action to choose) instead of "Continue the
  launched recovery session." Smoke: agent-failure-recovery (would-handoff
  failure asserts launched:false + "approve the repair option" without
  approval), chat-failure-recovery green.

- **RX2 (deferred — blocked on root-owned files) — launch-only app tasks
  shouldn't run the semantic-control-loop proof path.** "open the notes app"
  is task family `launch_or_read`; once the app is open the task is DONE. It
  should not require a11y inspection / accessibility permission / proof-after
  inventory, and a successful launch should not be marked failed. The
  classification lives in `computerAppGrounding.ts` (root-owned — needs
  `sudo chown`) + the evidence contract (`computerTaskEvidenceContract.ts`,
  also root-owned). Fixing RX1 already stops the user-visible symptom (no
  surprise terminal); RX2 is the deeper correctness fix so a pure app-open
  reports success and never enters recovery. See [[root-owned-repo-files]].

## Bug: "create a Notes note" blocked by phantom "Agent bridges missing" (RX3 — 2026-06-12, typecheck clean, smokes green)

User report: "open the notes app and create a note that says … → Use Computer
blocked by preflight: Notes Generic App Navigator preflight: blocked. 1 blocker:
Agent bridges missing." But the browser console showed the bridges were ONLINE
("Claude Code bridge detected", "Codex bridge detected", "came online"), and
only ONE capability blocked (not three) — so `app_tools` + `desktop_control`
(which read the live `bridgeAlive` probe) passed, while `agent_bridges` alone
failed.

- **RX3 SHIPPED — `agent_bridges` audit honors the live bridge.** Root cause:
  `auditComputerCapabilities` judged `agent_bridges` from `loadConnections()`
  (the persisted connection store) ONLY — `status: enabledConnections.length > 0`
  — ignoring the live `bridgeAlive` health probe the rest of the audit uses.
  Auto-connected bridges aren't always written to that store, so the capability
  read 'missing' while the bridge on :7778 (claude-bridge.js — itself the Claude
  Code / Codex agent transport) was demonstrably alive. Fix: extracted the pure
  rule `isAgentBridgeCapabilityReady({ enabledConnectionCount, bridgeAlive })`
  into dependency-light `computerCapabilityReadiness.ts` (per
  [[smoke-tests-need-pure-modules]] — importing the value from the registry
  pulls react-native into tsx), wired it into the audit (ready when a
  persisted connection is enabled OR the bridge is live), and added a
  source/detail line for the live-bridge case. Smoke: computer-app-preflight
  (3 readiness cases incl. the live-bridge-no-persisted-connection case + the
  genuinely-missing case).

  Two real-but-separate degradations seen in the same console, NOT fixed here
  (environment / out of scope): (a) `GET /desktop/installed-apps → 404` means
  the running local bridge is an OLDER build without the A2 endpoint — restart
  with `npm run bridge` to pick up the installed-apps probe; (b) a recurring
  Supabase `messages?select=id → 400` on bot-message persistence (schema/query
  mismatch worth a separate look). The recovery still classified
  `cors_preflight_blocked on desktop_bridge` — the bridge's CORS allow-headers
  don't include the desktop token header (the bridge-update path the recovery
  runbook already names).

- **RX2 still open (deeper):** Notes is treated as an unknown app →
  `universal_app_control` / Generic App Navigator (`unknown_mutation`) requiring
  the full a11y/proof loop + `agent_bridges`. A common app with native
  AppleScript ("create a note") shouldn't need the unknown-app buildout path.
  Classification lives in root-owned files (`computerAppGrounding.ts`,
  `computerTaskEvidenceContract.ts`) — needs `sudo chown` first. See
  [[root-owned-repo-files]].

## Notes app + messages-cap fixes (RX4 — 2026-06-13, typecheck clean, smokes green)

After the user chowned the previously root-owned files, fixed the deeper
"create a note" failure (RX2) end-to-end plus the recurring messages-400.

- **RX4a SHIPPED — "create a note" is no longer mis-parsed as a file write.**
  Root cause: `FILE_WRITE_TEXT_RE` in `localComputerAwarenessIntent.ts` literally
  included `note|notes`, so "create a note that says X" matched the text-FILE
  write intent → `local-file-write-text` → unexecutable step → escalation →
  generic unknown-app navigator → connected-agent buildout (Claude Code launch,
  billing-disabled). Fix: removed `note|notes` from the file-write pattern.
- **RX4b SHIPPED — deterministic Notes recipe (`notes_create`).** New intent
  kind + `NOTES_CREATE_RE` (tolerant of the "thats says" typo and an optional
  "in the Notes app" clause; captures the body) → routed to a deterministic
  AppleScript recipe (`make new note with properties {body:…}`) instead of the
  generic navigator. Bridge endpoint `/desktop/notes_create` in
  `claude-bridge.js` runs osascript via `execFile` with the body as an `on run
  argv` item — arbitrary content (quotes, newlines, profanity, shell metachars)
  needs zero escaping and can't inject. Client: `desktopBridge.createNote`;
  executor handler in `computerAppAdapter.executeLocalDesktopSequenceStep` (+
  single-intent delegation); planner routes `notes_create` to
  `run_computer_task` (`shouldUseComputerTaskForLocalIntent`). Risk = review.
  Generalizes to other scriptable Apple apps later. Smoke:
  local-desktop-bridge-intent (single + "thats says" typo + the exact reported
  sequence "open the notes app and create a note thats says…" + a genuine
  file-write still routing to file_write_text). **NEEDS: `npm run bridge`
  restart to pick up the new endpoint** (the user's bridge was an older build —
  404 on /desktop/installed-apps, "Unknown /desktop endpoint" on InDesign).
- **RX4c SHIPPED — messages 400 (content cap).** `messages.content` had
  `CHECK (char_length(content) <= 1000)`; long agent/recovery messages violated
  `messages_content_check` → HTTP 400 → "Unexpected error persisting bot msg"
  and the row never saved (full content survived only in local recoverable
  storage). Fix: migration `20260612_messages_content_cap.sql` raises the cap to
  100000 (mirrored RUN_THIS_SQL §21) + a graceful client fallback in
  `persistChatMessage` that classifies the check violation (code 23514) and
  retries with truncated content so persistence degrades instead of hard-failing
  pre-migration. **NEEDS: run RUN_THIS_SQL §21 (or the migration) in prod** to
  restore full-length persistence.

## Desktop: scriptable-app autonomy (2026-06-15)

User intent: simple desktop tasks ("create a note") should work by the agent
using the app's native script surface, not stall on "unknown app -> needs
buildout." Shipped:

- **AppleScript capability (general script surface).** New pure
  `src/lib/scriptableMacApps.ts` (knowledge: `isScriptableMacApp`,
  `canonicalScriptableApp`, recipes `buildCreateNoteProgram` /
  `buildCreateReminderProgram` / `buildScriptableProgram`, raw escape-hatch
  `buildRawAppleScriptProgram` — all using the safe `on run argv` pattern so
  user text travels as argv, never inlined → injection-safe). Bridge
  `/desktop/applescript` executor (mirrors `notes_create`'s execFile safety;
  bounded size/timeout). Client `runDesktopAppleScript` in `desktopBridge.ts`.
  Smoke: `scriptable-mac-apps` (in smoke:all).
- **Routing fix (no buildout-block for scriptable apps).**
  `shouldUseGenericAppNavigator` now returns false for scriptable apps
  (Notes/Reminders/Calendar/…) alongside known-configured apps — they have a
  deterministic native surface, so they skip the unfamiliar-app/buildout path
  that made "create a note" stall. Smoke: generic-app-navigator (Notes/
  Reminders skip; Ableton still routes). Downstream strategy/grounding/router
  smokes green.
- **Launch idempotency (loop-symptom guard).** Bridge `/desktop/launch`
  skips the `open` when the target app is already frontmost (fail-open on
  probe error) so a retrying/blocked task can't keep yanking an app to the
  front (the "keeps opening" churn).
- **Notes recipe → reliable one-shot.** `buildAppleNotesCreateNoteSequence`
  now emits a single deterministic `notes_create` step (AppleScript `make new
  note` via the bridge) instead of the fragile launch→wait→focus→a11y→click
  "New Note"→paste→verify UI dance that depended on finding the button + the
  editor keeping focus (and stalled on the modal false-positive). This is the
  path that actually runs for "create a note," so it's the highest-leverage
  reliability fix. Smokes: app-automation-control-surfaces + strategy green.

- **`desktop.run_applescript` model tool SHIPPED (2026-06-15).** Resolved the
  earlier delegation question: traced the in-app path
  (`executeToolUseLoop` → `dispatchToolDetailed` → `executeOpenSwanRuntimeTool`),
  which runs CLIENT-SIDE and dispatches desktop tools to the bridge directly
  in `executeOpenSwanTool` (openswanToolRuntime ~5973). So the tool is wired
  there completely: model-visible definition (recipe `intent`+`params` OR raw
  `scriptLines`+`args` for the research path), executor calling
  `runDesktopAppleScript`, type maps, mode/writes maps, formatter, tool-name
  registry, and auto-classified mutating approval via the `desktop.` policy
  block. Also added the v2 client-dispatch case (`dispatchOneClientTool`). The
  program-building glue is one shared, smoke-tested helper
  `buildProgramFromToolInput` (scriptableMacApps) used by both call sites — no
  duplication, so a model that calls the tool can't hit a half-wired path.
  Net: the model can now drive ANY scriptable Mac app — built-in recipes for
  note/reminder, or its own researched AppleScript for anything else — the
  "without being fully built out" capability. Typecheck + scriptable-mac-apps
  + openswan-runtime-approval + agent-runtime smokes green; bridge syntax OK.
  Browser side was already comprehensive (browser.plan_task / open_url /
  dom_snapshot / click_role / fill_field / select_option / upload_file /
  press_key / screenshot / verification_state / close). Remaining: add the
  tool to the v2 EDGE catalog (Deno, deploy-gated) for v2 parity (R16) — the
  user's path is OpenSwan, so not blocking; live-confirm the model picks the
  tool on a real scriptable-app task.

ROOT CAUSE of the live failure: the running bridge was from **Jun 2** and
predated `notes_create` + `installed_apps` (both uncommitted working-tree
work) — so note creation 404'd and Notes got mis-classified "unknown app."
The fix is a bridge restart (the capability already existed); the sandbox
blocks restarting it from the agent shell, so the user restarts
`npm run bridge`. NOT yet wired (next, needs a live run to verify): registering
`desktop.run_applescript` as an agent tool + adapter recipes that auto-route
non-Notes scriptable intents (e.g. Reminders) through `runDesktopAppleScript`.

## Chat verbosity + misdiagnosis fixes (2026-06-15)

From a real failure ("open pearsoncdjr-img in Photoshop, save as PNG" → wall of
text + wrong recovery advice). Three verified fixes:

- **CORS misdiagnosis fixed.** `agentFailureTaxonomy` classified
  `cors_preflight_blocked` on the bare word `/\bpreflight\b/i`, which collides
  with the computer-app readiness *preflight* ("Photoshop … preflight: partial.
  4 warnings"). Every failed design-app task got mislabeled "CORS blocked →
  restart the bridge" — wrong advice (the live bridge CORS is correct:
  `Access-Control-Allow-Headers: …X-UC-Desktop-Token, X-UC-File-Session-Token`
  + private-network true, verified by curl). Patterns are now CORS-specific.
  Smoke: agent-failure-recovery (regression case).
- **Failure-recovery chat message is now TERSE** (user: "just do the task —
  don't dump so much info about why it couldn't"). `formatChatFailureRecoveryUserMessage`
  → `Couldn't finish: <one-line reason>\n<single next action>`. The full
  breakdown moved to `formatChatFailureRecoveryDetail` + a new `result.detail`
  field + the archive metadata; the actionable choices already render as
  interactive option cards. Smokes: chat-failure-recovery + evidence-recovery
  (split: terse on userMessage, full on detail).
- **Warnings no longer trigger the verbose "Needs attention" block.**
  `formatChatComputerHandoffForMessage` gated `problem` visibility on
  `warningCount > 0`; warnings are internal agent guidance (research surface
  order, "inventory required" reminders) that belong in metadata, not chat.
  Now only real BLOCKERS surface as "Needs attention"; warning-only tasks fall
  through to the terse "Ready for review" or stay hidden.

- **`desktop.convert_image` SHIPPED + PROVEN (2026-06-15) — the robust fix for
  "save/export this image as <format>".** Root finding (verified live with
  osascript): Photoshop's scripted PNG export TIMES OUT on a color-profile /
  format modal dialog — that brittleness is why the task kept failing, not a
  bridge/CORS problem. The reliable path is macOS `sips` (no GUI, no dialogs).
  New bridge `/desktop/convert_image` endpoint: resolves a bare name
  ("pearsoncdjr-img") across Desktop/Downloads/Documents/Pictures (so
  `resolve-files` can't fail for a file that exists), converts via sips, writes
  next to the source without clobbering, home-dir-scoped. Client `convertImage`
  wrapper + full agent-tool registration (`desktop.convert_image`, all surfaces,
  directive "PREFER THIS over scripting Photoshop" description, mutating/HITL
  via the `desktop.` policy) + v2 client dispatch. PROVEN end-to-end against the
  user's real file: "pearsoncdjr-img" → resolved to the Desktop PNG → sips
  converted (1.2MB) → output path avoided clobbering. Typecheck + bridge syntax
  + openswan-runtime-approval/scriptable/agent-runtime/strategy smokes green.
  NEEDS A BRIDGE RESTART (new endpoint). KNOWN FOLLOW-UP (not done — smoke
  contract + multi-layer routing, needs live verify): make simple image
  open/save tasks skip the heavy Adobe "Layered Creative Control Loop" so the
  model isn't steered to plan-instead-of-act; the convert_image tool already
  makes the task completable regardless of that routing.

## Open decisions (roadmap §7)

Decisions 1–3 were recorded 2026-06-09 (see roadmap §7): Sonnet 4.6 edge +
Opus 4.7 in-app · in-place v2 rewrite · keep "OpenSwan". Still open:

4. Skill marketplace: circle-private, or add `is_public`?
5. (New, R6) Approval posture per chat family when the legacy ungated paths
   migrate onto the gated dispatcher.
