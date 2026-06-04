# UC Task Fulfillment Research — Handling Underspecified Chat Requests

> Research + improvement roadmap. Goal: a user enters a chat with an
> **incomplete / underspecified** task ("doesn't have all the information built
> out beforehand") and the system still fulfills it — by clarifying, gathering
> context, observing the environment, recalling memory, discovering
> capabilities, or building what's missing — instead of failing or silently
> degrading.
>
> Produced: 2026-06-01. Based on a deep read of the chat, OpenSwan, SwanBot,
> computer-use/desktop/browser, capability-buildout, and memory/skill
> subsystems, plus external best-practice research (2024–2026).
>
> Status: analysis + proposal. File:line anchors reflect the current working
> tree and should be reconfirmed at implementation time.

---

## 1. Executive summary

The codebase **already contains** almost every component needed to fulfill
underspecified tasks. The problem is not missing capability — it is **missing
wiring**. Across every subsystem the same three failure shapes recur:

1. **Defined-but-unwired** — a real mechanism exists but nothing in the live
   send path calls it (`conversationalBuild.ts` clarify state machine,
   `analyzeBuildBrief`, `agentPlanMode` questions outside `/plan`).
2. **Computed-but-unconsumed** — a signal is produced and then dropped
   (`userTaskPipelines.needsClarification`, the `needs_observation` route
   decision status, capability-profile strings).
3. **Prose-not-enforcement** — observe/approve/verify contracts are injected as
   *instructions the model may ignore*, not as control-flow gates
   (computer-task evidence contract, control-surface stop-for statuses).

The **single biggest enemy** of the goal is **silent degradation**: at every
uncertainty point the system quietly falls back to a weaker behavior — text-only
reply, 0.4-confidence plain chat, a static "AI is offline" string, empty memory
recall, or an inert route decision — instead of surfacing *"I need X"* or taking
a *discovery action*. A vague request should produce a **question or a gather
step**, never a confident-but-empty guess.

**Implication:** most of the roadmap below is *connecting existing parts into a
loop* and *replacing silent fallbacks with explicit gather/ask outcomes* — far
cheaper and lower-risk than building new systems.

---

## 2. The missing loop

Today the pipeline is a **single forward pass**:

```
message → plan once (regex + entities) → run with a frozen tool allowlist
        → on any uncertainty, silently degrade → reply
```

What best-practice agentic systems (and the user's goal) require is a **loop**:

```
message → assess specification completeness
        → GATHER (discover context / recall memory / observe surface)
        → CLARIFY (ask only what's still uncertain, calibrated)
        → PLAN / RE-PLAN with what was learned
        → ACT (tools), observing before each mutation
        → VERIFY → on failure: reflect + recover, or BUILD the missing capability
        → (resume after human input where gated)
```

Every stage of that loop maps to code that **already exists in part**. The
roadmap is about closing the arrows between the boxes.

---

## 3. Current-state map (per subsystem)

### 3.1 Chat entry & planning — `chatAutomationPlanner.ts`, `ChatTab.tsx`, `runChatAutomationPlan.ts`

- Real entry is `ChatTab.tsx` `sendMessage`; `buildChatAutomationPlan` is
  consulted at `ChatTab.tsx:6385` but **only `run_computer_task` (`:6394`) and
  `run_openswan` (`:6400`) plan kinds are acted on** — every other plan kind
  falls through to legacy handlers / plain chat.
- Planner fallback is `run_plain_chat` at **confidence 0.4**
  (`chatAutomationPlanner.ts:817`). There is **no `ask_clarification`
  execution kind** (`ChatAutomationExecutionKind`, `:49`).
- `clarifyTimeout.ts` does **not** ask questions — it only times out an existing
  `computer_use_confirmations` row (`autoResolveOnTimeout:92`).
- `conversationalBuild.ts` is a genuine one-question-per-turn clarify state
  machine (idle→exploring→converging→confirmed) — but **orphaned**: nothing in
  the send path calls `loadBuildConversation`/`advanceOnUserMessage`, and
  `swanbot.ts:2374` reads a `buildState` that `ChatTab` never passes.
  `buildChatStream.ts` has **zero importers**.
- `buildBriefQuality.ts` `analyzeBuildBrief` (returns `needsClarification`+`hint`)
  is **dead code** (no callers).
- `userTaskPipelines.ts` `needsClarification`/`clarificationReason` (`:1762`)
  are computed, threaded into the plan, **and never read at dispatch**.
- Vague conversational intents **fabricate** params instead of asking:
  `create_task` uses `message.slice(0,120)` as title (`:146`), `wordpress_publish`
  `slice(0,80)` (`:134`), `office_agent_task` hardcodes `agentName:'Agent'`
  (`:148-153`).

### 3.2 OpenSwan runtime — `openswanSessionRuntime.ts`, `openswanContextDiscovery.ts`

- `runOpenSwanSessionTurn` (`:432`) builds a **static, single-shot** plan
  (`buildOpenSwanTaskPlan`, `:477`) and **never re-plans**. The tool allowlist is
  frozen at plan time (`selectRuntimeToolNames:190`); if the planner regexes miss
  a tool, **the model cannot call it**.
- `openswanContextDiscovery.ts` is narrow: it fetches only **project markdown**
  (`AGENTS.md`/`CLAUDE.md`/…, `CONTEXT_FILE_PRIORITY:22`), **web-only** (`:115`),
  and **only if a path was already typed** in the message (`extractDirectories:57`).
  It does **not** discover repo state, providers, tools, or memory, and its
  output never feeds back into re-planning.
- Silent-degrade points: empty plan → `runTextOnlyResponse()` (`:966`);
  tool-loop exception → silent text-only fallback (`:1097-1102`); max-round
  exhaustion → dead-end string `'Tool-use limit reached.'`
  (`swanbot.ts:2799`); unversioned model fallback `'claude-haiku-4-5'` (`:992`).
- Clarifying questions exist (`agentPlanMode.ts` `buildPlanQuestions:183`,
  `isBroadOrAmbiguous:151`) but **only fire for `/plan` / `mode==='plan'`**
  (`shouldCreateAgentPlanForMessage:118`).

### 3.3 SwanBot — `swanbot.ts`, `supabase/functions/swanbot-v2-ai/index.ts`

- `getSwanBotResponse` (`:2295`) runs a hand-rolled tier ladder
  (BlackSwan→custom→edge→Gemini→static). The robust `crossProviderRouter` /
  `universalInvoke` fallback chain is **not on this path**.
- The **richer v2 loop is off by default** (`isSwanbotV2Enabled`,
  `swanbotRouting.ts:21`); v1 is live and has **no discovery tool**
  (`integrations.list` exists only in v2).
- **No `clarify`/`ask_user` tool anywhere.** `agentExecutionCore` defines an
  `interactive` flag (`:51-55, :248`) but no registered tool uses it.
- Regex tool-gating (`selectToolsForTurn:1798`): a vague request matches no
  group, so only `BASE_TOOL_NAMES` are advertised — the model can't *see*
  `tasks.create`, browser, or desktop tools to fill the gap.
- Complexity gating skips memory/retrieval for `trivial`/`simple` turns
  (`swanbot.ts:2346, 1654-1660`) — terse-but-deep asks lose context.
- `MAX_ITERATIONS = 5` (v1 `swanbot-ai:2702`, v2 `swanbot-v2-ai:1964`) is too low
  for gather→clarify→act→verify.
- Final fallback is a **static "AI is offline" string** (`:2532`) even when the
  real cause is a missing key or a 400 — the real blocker is masked.

### 3.4 Computer / desktop / browser — `chatComputerRequestRouter.ts`, `computerTaskRuntime.ts`, `computerTaskEvidence*.ts`, `appAutomationControlSurfaces.ts`

- The observe/approve/verify contract is **richly modeled but enforced as
  prose**, not control flow. Mandatory `observeBefore` exists per surface
  (`computerTaskEvidenceContract.ts:104/162/166`) but is injected into the prompt,
  not gated in code.
- **The route decision is permanently `needs_observation`** because
  `buildAppAutomationRouteDecision` (`appAutomationControlSurfaces.ts:1161`) is
  always called with **no observations** (`chatComputerRequestRouter.ts:404`,
  `computerAppPreflight.ts:415`; only `agentAppCapabilityBuildout.ts:653` passes
  real options). So the five stop-for statuses (`ready_to_execute`,
  `needs_observation`, `needs_approval`, `needs_user_action`,
  `needs_connected_agent_buildout`, `:77`) are **inert data**, not gates.
- There is **no observe→re-decide loop** in `executeComputerTaskWithAgent`
  (`computerTaskRuntime.ts:325`); it goes straight to `executeAgentRun` (`:503`).
- **No clarifying-question path exists** in the entire computer-task path (grep
  for clarify/ambiguous/missing → zero hits).
- Recovery (`computerTaskEvidenceRecovery.ts:461`) **is** wired into chat
  (`chatFailureRecovery.ts:781`) but **starved of inputs**: it re-infers the
  route from the task string and passes no `observations[]`, so the
  fresh-evidence readiness gate can never confirm.
- `unknown` preview silently forces browser routing
  (`computerTaskPlanner.ts:400`, default `browser_runtime`
  `computerTaskExecution.ts:131`).

### 3.5 Capability & adapter buildout — `agentAppCapabilityBuildout.ts`, `designAppAdapterGaps.ts`, `computerCapabilityRegistry.ts`, `computerAppAdapter.ts`

- **Two capability models never reconcile**: a live audit
  (`auditComputerCapabilities`, `computerCapabilityRegistry.ts:126`, statuses
  `ready|partial|missing`) and declarative profile strings
  (`taskCapabilityProfiles.ts:34`). Nothing checks a task's required
  capabilities against the live audit before running.
- Buildout **is real and dispatches** to a connected Codex CLI session
  (`computerTaskRuntime.ts:135` → `agent.build_app_capability` →
  `openswanToolRuntime.ts:4314` → `sendTerminalAgentSessionMessage('codex',…)`),
  parses the result back, and retries (`:209`). But it is **narrowly wired**:
  - gated to **one strategy** (`universal_app_control`,
    `agentAppCapabilityBuildout.ts:178`),
  - **one provider** (Codex hard-wired; hard-fails at `openswanToolRuntime.ts:4388`
    even when Claude Code/Gemini/Cursor bridges are live),
  - **one rich-contract domain** (`designAppAdapterGaps.ts` is Photoshop/InDesign
    only; the gold-standard `DesignAppAdapterGapContract:17` isn't generalized).
- The most common "I don't have the tool" paths **dead-end without buildout**:
  generic-app fall-through (`computerAppAdapter.ts:3667-3691` returns a passive
  surface list), missing filesystem MCP tools (`computerFileAdapter.ts:809,831`).

### 3.6 Memory, skills & pipelines — `memoryService.ts`, `openswanSkills*.ts`, `userTaskPipelines.ts`

- Semantic memory has **no keyword fallback**: when the embedding proxy/key is
  absent, `embedText` returns null → `semanticSearchMemories` returns `[]` →
  `retrieveForTurn` returns empty (`memoryService.ts:836`) with no `ilike`
  backup (`agentMemory.searchMemories:432` exists but isn't used here).
- Complexity gate **starves vague requests**: skills load only on `complex`
  turns (`swanbot.ts:1656`), so short underspecified asks miss recall when they
  need it most.
- Library `SKILL.md` skills are **passive** — auto-resolution never pulls a
  body; the model must elect to call `viewLibrarySkill` (`openswanSkills.ts:64`).
  Only a fixed 7-skill vocabulary is auto-inferable
  (`openswanSkillResolution.ts:28-47`).
- Pipeline matching is **regex-only** (`scorePipeline:1478`) — brittle for vague
  requests, which fall to a 0.35 `direct_answer` fallback (`:1624`) with no
  runbook.
- The four recall systems **never inform each other** (no cross-fill): a matched
  pipeline's `recommendedTools`/`executionRequirements` are not used to query
  memory/skills/integrations for the gaps it declares.
- **Security gap:** recalled content is **not** wrapped as untrusted
  (`userMemory.ts:74`, `skillLibrary.ts:36-39` "Phase 2b"), violating the
  CLAUDE.md untrusted-content rule for model-visible quoted content.

---

## 4. The five capability gaps (cross-cutting)

| # | Capability | Exists today (unwired/partial) | What's missing |
|---|---|---|---|
| G1 | **Clarify when uncertain** | `conversationalBuild` (orphaned), `agentPlanMode` Qs (`/plan` only), `userTaskPipelines.needsClarification` (dropped), `analyzeBuildBrief` (dead) | First-class `ask_clarification` plan kind + `needs_input` dispatch outcome + a `clarify` interactive tool |
| G2 | **Gather / observe before acting** | `openswanContextDiscovery` (markdown-only), evidence contracts + route decisions (inert) | Feed real observations into route decisions; enforce observe→re-decide loop; broaden discovery to providers/tools/repo/memory |
| G3 | **Re-plan under uncertainty** | none (frozen plan) | Re-plan after first tool round / after a discovery tool returns; widen the tool allowlist post-observation — **see validated-non-gap note below: tool-stranding is not a real problem** |
| G4 | **Build the missing capability** | real Codex buildout, rich design-gap contract | Broaden triggers (all strategies), providers (any connected agent), and generalize the gap contract to any app; reconcile capability models |
| G5 | **Recall stored knowledge to fill gaps** | 4 independent recall systems | Keyword fallback; auto-select library skills; cross-fill between pipeline/memory/skill/integration; relax complexity gate; untrusted-wrap |

> **Validated non-gap — G3 tool-stranding (2026-06-03):** the worry that an
> actionable request gets stranded text-only (empty tool plan) was tested
> empirically against `buildOpenSwanTaskPlan`. It does NOT happen: the planner's
> browser/desktop strategy + local-intent + browserbase detection gives EVERY
> external/actionable phrasing a rich concrete tool set (verified across
> connect/sync/fetch/email/schedule/reminder/notify requests — all returned
> desktop.*/browser.*/schedule_action tools, never "only inspect"). Only
> genuinely conversational requests (questions, chit-chat, "help me think")
> return an empty tool plan — and for those, text-only is the CORRECT behavior,
> not a bug. A speculative discovery-tool fallback was prototyped, found to be
> dead code (`onlyInspect && external` is mutually exclusive in practice), and
> reverted. **Do not re-attempt G3 tool-widening.** Phase-0 P0.3 already makes
> the rare text-only/max-round degradations explicit, which is the right fix.

> **G5 recall — investigated 2026-06-03; one real build shipped.** Skeptical
> validation of the three Phase-4 sub-items: **P4.2 cross-fill = SPECULATIVE**
> (the pipeline's `recommendedTools` are tool-ID strings, not semantic content;
> semantic + task-affinity retrieval already surfaces domain-relevant memory —
> the same dead-fallback class as G3, so NOT built). **P4.1 auto-select library
> SKILL.md = REAL** but behavior-changing (threshold tuning + extra fetch + cap
> interactions) — deferred. **Shipped — untrusted-wrap the remaining recalled
> content (security, CLAUDE.md rule 5):** P0.5 only fenced `retrieveForTurn`;
> user notes, runtime memory, and the working-memory bundle (which also carries
> **cross-agent bridge context** — the sharpest injection risk) still reached the
> v1 model raw at `swanbot.ts:1692-1694`. All three are now fenced in
> `<untrusted_quoted>` at the model-facing push sites (model-only — the
> underlying `stores.*` are untouched, so no UI shows tags), and the v1 prompt
> already explains the tag (added in P0.5). Verified: typecheck; no double-wrap
> with the already-fenced `retrieveForTurn` block.

---

## 5. External best-practice alignment (2024–2026)

The roadmap is consistent with current research and frameworks:

- **Clarification = calibrated uncertainty**, not "always ask." Score each
  missing parameter; ask only when expected information gain is high
  (INTENT-SIM, ICLR 2025; POMDP parameter-filling). Over-asking is a measured UX
  cost. → informs **G1**.
- **ReAct as default, escalate deliberately** to Plan-and-Solve / bounded
  tree-search / LATS where early decisions are load-bearing. → informs **G3**.
- **Dynamic tool discovery via MCP** (`tools/list` + `list_changed`) and
  **tool creation when none fits** (CREATOR, ToolMaker: code → typecheck →
  unit-test → index for reuse). → informs **G2/G4**.
- **Observe immediately before every mutation** for GUI/desktop (screenshot +
  a11y/DOM snapshot; Set-of-Mark, Agent S); treat stale observations as
  fail-closed. → directly validates the **existing** evidence contract; informs
  **G2**.
- **Grow a versioned, embedding-indexed skill/memory library** (Voyager;
  Anthropic Agent Skills) so repeat-but-vague requests resolve from memory. →
  informs **G5**.
- **Recover with verifier-backed reflection** (Reflexion + *external* feedback,
  not self-critique alone): capture a structured reason, write to episodic
  memory, retry within a budget, then stop/report. → informs **G3/G4**.
- **Durable HITL checkpoints, gate only high-risk actions** (LangGraph
  interrupt/resume; approve/edit/reject/respond) with thread IDs + TTL expiry. →
  validates the existing approval gate; informs the resume story for **G1**.

---

## 6. Improvement roadmap (phased)

Each item names the file and the specific change. Ordered by leverage ÷ risk.

### Phase 0 — Stop the silent bleeding (quick wins, low risk)

These convert silent degradation into visible, actionable signals and delete/
wire dead code. Small diffs, immediate user-visible improvement.

- **P0.1 — Surface the real blocker instead of "AI is offline."**
  `swanbot.ts:2526-2540`: thread the last tier's error (key_missing / 400 /
  provider down) into a specific message (reuse `byokMissingMessage`).
- **P0.2 — Keyword fallback for memory recall.** `memoryService.ts:836`: when
  `semanticSearchMemories` returns `[]`, fall back to
  `agentMemory.searchMemories(circleId, queryText)` ranked by recency/importance.
  Removes the hard dependency on the embedding proxy.
- **P0.3 — Make text-only / max-round fallbacks explicit.**
  `openswanSessionRuntime.ts:966,1097` and `swanbot.ts:2799`: attach a
  `degraded`/`incomplete` flag + a one-line "ran text-only; tool X unavailable"
  notice to the result and transcript instead of silent prose.
- **P0.4 — Relax the complexity gate for recall.** `swanbot.ts:1656-1658`: run
  semantic memory + skill recall on `simple` turns too (keep `trivial` lean),
  bounded by the existing `withTimeout` budget.
- **P0.5 — Untrusted-wrap recalled content.** `userMemory.ts:74`, memory/skill
  formatters: wrap model-visible recalled text in `<untrusted_quoted>…</…>`
  (the `skillLibrary.ts:36-39` "Phase 2b" promise). **Security fix.**

### Phase 1 — Close the clarify + gather loop (the core of the goal)

> **Status (shipped 2026-06-02):** P1.1, P1.2, P1.3, and P1.4a landed and are
> verified (typecheck + `smoke:chat-planner` with new clarification + regression
> cases + `smoke:agent-runtime`). The planner now emits an `ask_clarification`
> plan for underspecified conversational actions (and ambiguous-but-actionable
> fallbacks); ChatTab recalls context then posts the question; thin `/build-page`
> briefs are gated.
>
> **Loop closed + UX polish (shipped 2026-06-02):** the clarification is no
> longer a dead end. ChatTab stores a per-thread pending clarification when it
> asks; the user's next reply is reconstructed into a well-specified request via
> `reconstructClarificationAnswer` (`chatGapFill.ts`) and routed to completion
> (create_task → the deterministic `/task new` slash command so action-word
> replies aren't hijacked by the computer-task router). Each question now shows
> tap-worthy example answers; cancel words, stale (>15 min) prompts, and replies
> ending in "?" fall through safely instead of being folded into the task. A
> resolving-guard prevents re-asking loops. `chatGapFill`'s heavy `userMemory`
> import is lazy so the pure reconstruct helper is Node-testable. New
> `smoke:chat-planner` cases assert reconstruction shape AND that reconstructed
> messages route to a handler (never back to a question).
>
> **Answer chips shipped (2026-06-03):** the clarification examples are now
> rendered as tappable chips (new `chat/QuickReplyChips.tsx` + a generic
> `quickReplies` chat-message field) instead of inline text — one tap sends the
> example, which flows through the pending-clarification resume path and
> completes the task. This is the "tappable answer chips" deferred at Phase 1,
> unblocked once the `PreflightBlockersCard` established the chip-card + message-
> field pattern. Verified: typecheck + `smoke:chat-planner` (plan still carries
> the examples the chips consume).
>
> **Deferred:** P1.4b (the multi-turn `conversationalBuild.ts` state machine +
> `buildChatStream` streaming) — its `buildSystemAddendum → systemDirective`
> injection isn't on the current `runOpenSwanSessionTurn` reply path, so wiring
> it safely needs `buildState` threaded through that path first; it also overlaps
> with the existing `run_build_discovery` route. P1.5 (v2 `clarify` tool) not
> started (the v2 loop is off by default).

- **P1.1 — Add an `ask_clarification` execution kind.**
  `chatAutomationPlanner.ts`: extend `ChatAutomationExecutionKind` (`:49`) and the
  fallback (`:817`). Emit it (carrying `missingParams: string[]` +
  `clarificationReason`) when `pipelineDecision.needsClarification` is true,
  confidence < ~0.5, or a conversational action has empty required params
  (replace the `slice(0,120)` placeholder fabrication at `:146/134/148`).
- **P1.2 — Consume clarification at dispatch.** `runChatAutomationPlan.ts:128`:
  add a `status:'needs_input'` outcome mirroring the existing `deferred` approval
  path (`:152-165`); handle it in `ChatTab.tsx:6385` by posting the question as a
  bot message (alongside the existing two plan-kind branches).
- **P1.3 — Recall-before-ask.** New helper (e.g. `chatGapFill.ts`) called by the
  clarification branch: attempt to auto-fill missing params from
  `userMemory`/`sharedMemory` + recent thread context first ("the task we just
  made" → latest task id), then ask only for what truly remains.
- **P1.4 — Wire the existing build clarify machine.** `ChatTab.tsx` `sendMessage`:
  call `loadBuildConversation`/`advanceOnUserMessage`, pass `buildState` into the
  chat call so `swanbot.ts:2374` injects `buildSystemAddendum`; run
  `analyzeBuildBrief` (`buildBriefQuality.ts`) before scaffolding. Activates
  `conversationalBuild.ts` + `buildChatStream.ts`.
- **P1.5 — A `clarify` interactive tool for SwanBot v2.**
  `swanbot-v2-ai/index.ts`: register a `clientOnly` `clarify` tool (use the
  existing `interactive` support, `agentExecutionCore.ts:248`) and add it +
  `integrations.list`/`tasks.list` to `BASE_TOOL_NAMES` (`:1762`) so a keyword
  miss can't strand the model. Add a frozen-prompt rule: "If target/scope/success
  criteria are missing, FIRST discover or `clarify` — do not answer from
  assumptions" (`buildFrozenBlock:1851`).

### Phase 2 — Enforce observe-before-act + re-planning

> **Status (shipped 2026-06-02):** the observe→re-decide→inject core landed and
> is verified (typecheck + `smoke:computer-task-runtime` new cases +
> `smoke:chat-computer-request-router` + `smoke:chat-planner`). Two pure,
> Node-testable helpers were added to `appAutomationControlSurfaces.ts`:
> `deriveAuditObservedEvidence(audit)` (infra evidence from the capability audit)
> and `buildObserveBeforeActPromptBlock(task, observations, opts)` (re-decides
> against live observations + emits a concise ground-truth block).
> `computerAppPreflight` now feeds audit-derived `observedEvidence` into the
> planning-time decision (P2.1, partial — the status stops reporting
> `needs_observation` for infra that's demonstrably present). `computerTaskRuntime`
> now does a runtime **read-only** capture of live window state for
> app/hybrid tasks (`captureLiveSurfaceObservations`, gated on a healthy bridge,
> fail-open) and injects the re-decided ground truth into the agent prompt before
> `USER COMPUTER TASK` (P2.2, as a grounding inject rather than a hard block —
> hard-blocking on heuristic coverage would false-block working flows).
>
> **Deferred:** P2.3 (evidence-contract block in the dispatch prefix — needs a
> contract built in `prepareComputerTaskExecution` + a new arg threaded through
> `computerTaskDispatch`), P2.4 (thread live route + observations into
> `chatFailureRecovery`), P2.5 (OpenSwan mid-run re-plan). The runtime
> observation could also be extended with a bounded a11y-tree snapshot and a
> hard gate on `needs_user_action`/`needs_connected_agent_buildout`.

- **P2.1 — Feed real observations into route decisions.**
  `chatComputerRequestRouter.ts:404` & `computerAppPreflight.ts:415`: pass
  `availableSurfaceIds` (from desktop-bridge health + installed-tool registry)
  and `observedEvidence` (cached grounding) into `buildAppAutomationRouteDecision`.
  This alone makes the stop-for statuses meaningful instead of permanently
  `needs_observation`.
- **P2.2 — Enforce an observe→re-decide loop.** `computerTaskRuntime.ts:325`
  before `executeAgentRun` (`:503`): for `app_task`/`hybrid_task`, call read-only
  bridge observers (`getWindowState`, `readA11yTree`, document status, `listFiles`),
  feed results into `recommendComputerAppGroundingNextStep` + a re-computed route
  decision, and only proceed to mutation when status is
  `ready_to_execute`/`needs_approval`. Converts the contract from prose to a gate.
- **P2.3 — Inject the evidence contract into the dispatch prefix.**
  `computerTaskDispatch.ts:109`: include
  `formatComputerTaskEvidenceContractPromptBlock` +
  `formatAppAutomationRouteDecisionPromptBlock` (currently only the SwanBot/
  OpenSwan prompt paths carry them).
- **P2.4 — Give recovery the live route + observations.**
  `chatFailureRecovery.ts:781`: thread the live `route.evidenceContract` /
  `appRouteDecision` and an `observations[]` array instead of re-inferring from
  the task string, so `evaluateComputerTaskEvidenceRecoveryReadiness` can gate
  retries on fresh evidence.
- **P2.5 — Re-plan once mid-run (OpenSwan).** `openswanSessionRuntime.ts`: after
  the first tool round (or after a discovery tool returns), recompute
  `runtimeToolNames` and append newly relevant tools to the allowlist (frozen
  today at `:478`). Broaden `openswanContextDiscovery.ts` into a structured
  `discoverRuntimeContext` (providers + tool surface + memory-hit summary, not
  just markdown) that feeds the re-plan.

### Phase 3 — Generalize capability buildout (build what's missing)

> **Status (shipped 2026-06-02):** the buildout trigger no longer dead-ends
> unconfigured browser/app requests. `shouldRequestAgentAppCapabilityBuildoutFromOutcome`
> (`agentAppCapabilityBuildout.ts`) was broadened from `universal_app_control`-only
> to **every actionable app/desktop/browser strategy** — gated on a concrete
> failure or capability-gap signal (error / "no adapter" / "can't continue"),
> excluding `desktop_readonly` and `agent_asset_acquisition`. `universal_app_control`
> stays most permissive (empty response also escalates). The trigger now also
> inspects the **app-adapter message**, and the generic-app dead-ends in
> `computerAppAdapter.ts` were sharpened to emit explicit gap language and
> threaded into the runtime gate (`computerTaskRuntime.shouldRequestConnectedAppCapabilityBuildout`)
> — so the "no surfaces / no adapter" dead-end now routes to capability buildout
> instead of a passive "I can't". Verified: `smoke:agent-app-capability-buildout`
> (+5 cases), `smoke:computer-task-runtime`, `smoke:chat-computer-request-router`,
> typecheck. **Also shipped (worktree):** managed `/launch` worktree isolation
> (all CLI bridges) + a safe cleanup lifecycle (`pruneOpenSwanWorktrees`, bridge
> `/worktree/prune`, app `pruneTerminalAgentWorktrees`).
>
> **P3.3 shipped (2026-06-02):** capability buildout is no longer Codex-hardwired.
> New `connectedAgentDispatch.ts` (`dispatchConnectedAgentTask`) reuses a
> manageable session across providers in preference order (codex → claude-code →
> gemini → cursor) via `sendTerminalAgentSessionMessage`, or launches the first
> provider whose bridge is online (`checkAllBridges` + the per-provider
> launchers), failing closed with an actionable "start a bridge" message.
> `agent.build_app_capability` now routes through it. So the full chain —
> broadened trigger (P3.2) → adapter dead-end emits a gap signal (P3.1) →
> provider-agnostic dispatch (P3.3) — lets the chat build and fulfil a
> browser/app request through whichever connected agent exists. Verified:
> typecheck + `smoke:agent-app-capability-buildout` + `smoke:openswan-runtime-approval`
> + `smoke:multi-agent-dispatch`.
>
> **File-adapter dead-ends fixed (2026-06-02):** `computerFileAdapter`'s two
> terse dead-ends ("No filesystem MCP tools active" / "none matched") are now
> **actionable and bridge-aware**. Since the desktop-bridge path returns null
> only when the bridge is offline, the no-tools case now re-checks bridge health
> and tailors guidance — local files → "start `npm run bridge` + grant the
> folder", remote/cloud → "connect a filesystem integration" — and emits a
> `file_capability_gap` data signal. (Deliberately NOT routed to connected-agent
> buildout: for local files the correct fix is starting the bridge, not building
> a tool.)
>
> **P3.4 assessed as low-ROI (2026-06-02):** `buildAgentAppCapabilityBuildoutPolicy`
> is already generic and rich for ANY app (control-surface plan, research
> checklist, capability ladder, guardrails, output contract are app-agnostic;
> the smoke proves it for "Ableton Live"). The Adobe `designAppAdapterGaps`
> contract's value is its *hard-coded specificity* (Firefly tools, Adobe docs),
> which can't be meaningfully generalized — so generalizing it adds little.
> Pivoted to the higher-value item instead:
>
> **Failure recovery is now provider-agnostic (2026-06-02):**
> `startConnectedAgentFailureRecovery` (`agentFailureRecovery.ts`) was
> Codex-hardwired just like buildout was; it now routes through
> `dispatchConnectedAgentTask`, so when a browser/app task fails, recovery runs
> on whichever connected agent exists (Codex/Claude Code/Gemini/Cursor). Result
> `provider` widened from `'codex'` to `ConnectedAgentProvider | null`. Verified:
> typecheck + `smoke:agent-failure-recovery` + `smoke:chat-failure-recovery` +
> `smoke:openswan-runtime-approval`.
>
> **Deferred:** P3.5 (reconcile capability audit vs profiles); `agent.codex_acquire_asset`
> stays Codex-named by design (de-Codex-ing it means renaming the registered tool).
>
> **Hardening pass (2026-06-03) — adversarial self-review + research:** ran an
> adversarial correctness review of the cumulative Phase 0-3 + worktree + recovery
> changes (no high-severity bugs; many tricky spots verified clean) and a research
> pass on the capability-reconciliation state. Findings acted on: (1) **tightened
> the broadened buildout trigger** — a *specific* strategy now requires an explicit
> gap signal (`CAPABILITY_GAP_RE`), not the loose "can't continue" hedge, so a
> successful-but-hedging run no longer spuriously triggers buildout; the loose
> hedge is trusted only for `universal_app_control` (2 new smoke guards). (2)
> **Closed the single-verb dead-end gap** — the generic-app surface-inventory
> dead-end is tagged `app_capability_gap` and the runtime's pure-launch
> short-circuit now skips gaps, so single-verb "no adapter" app tasks route to
> buildout like multi-verb ones do. (3) **Made `pruneOpenSwanWorktrees` repo-scoped**
> (exact `/.openswan-worktrees/` prefix, not a bare substring). Verified: typecheck
> + node --check + `smoke:agent-app-capability-buildout` + `smoke:computer-task-runtime`.
>
> **Research finding — P3.5 already covered (re-confirmed 2026-06-04):**
> `computerAppPreflight` already reconciles required capabilities (via
> `STRATEGY_CAPABILITIES`, keyed off the live strategy — a more accurate signal
> than the coarse `taskCapabilityProfiles` strings) vs the live
> `auditComputerCapabilities`, and emits blocker-severity items with verbatim
> "connect X / start the bridge / grant Accessibility" fixes (`CAPABILITY_FIX`)
> pre-execution, plus the route-decision's "connected-agent buildout required" and
> `buildComputerCapabilityExpansionPlan` guidance. A fresh profile-string
> reconciler would duplicate it → **validated non-gap, not built** (the G3/P4.2
> pattern). **Genuine remaining piece SHIPPED 2026-06-04:** the preflight's
> connected-agent-buildout signal was generic; `buildComputerAppPreflight` now
> attaches `appCapabilityBuildout` — the research-first app-adapter-gap contract
> (proposed `desktop.<app>_<op>` tool, universal find-ladder, research plan,
> connected-agent buildout task, retry prompt) — whenever a buildout is indicated
> for a non-Adobe app (route `needs_connected_agent_buildout`, or
> `app_tools`/`desktop_control` missing/partial). This makes the **proactive**
> pre-execution buildout ask actionable, symmetric to the **reactive** research-first
> failure recovery. Self-gates to null for non-app and Adobe tasks (Adobe keeps
> its design path). Verified: typecheck 0; `smoke:computer-app-preflight` (4 new
> cases incl. Adobe-stays-design + ready-no-buildout) + preflight-consumer suites
> green.
>
> **Preflight-blocker chips UI shipped (2026-06-03):** the genuine remaining gap
> (the reconciled blockers were prompt/metadata-only) is closed. New
> `src/screens/circles/tabs/chat/PreflightBlockersCard.tsx` renders the blocked
> preflight's `blockers` as a user-facing card with tappable chips — bridge
> capabilities → **Connect the bridge** (`addDesktopBridgeAutoConnectMessage`),
> browser capabilities → **Open Computer Use** (`setShowComputerUseConsole`), plus
> **Try again** (`sendMessage(originalTask)`). Wired via a new
> `computerPreflightBlockers` field on the chat message (carrying task + blocker
> items), attached at the blocked-preflight `addBotMessage` and rendered in
> `renderMessage`. Verified: typecheck (UI isn't smoke-testable; the
> capability→action mapping is a pure helper in the card).

> **Photoshop/InDesign operation coverage expanded (2026-06-03):** widened the
> design-app automation taxonomy from 15 → 29 typed operations so "anything a
> user asks on those apps" routes to a precise runbook + adapter-gap buildout
> contract. Batch 1: PS `apply_layer_effects`, PS `manage_layers`, ID
> `apply_text_style`, ID `manage_pages`. Batch 2: PS `transform_layer`, PS
> `convert_color_mode`, ID `manage_tables`, ID `resolve_fonts`. Batch 3: PS
> `manage_artboards`, ID `manage_hyperlinks`, ID `build_toc`. Batch 4: ID
> `manage_text_flow` (threading/overset), PS `manage_smart_objects`
> (verb-specific so it never collides with `replace_linked_asset`'s "place X
> smart object"), ID `manage_swatches` (spot colors/inks). Each adds a
> detector in `designAppAutomation.ts`, an `operationLabel` entry in both
> `designAppOperationRunbooks.ts` and `designAppAdapterGaps.ts` (the two
> exhaustive `Record<DesignAppAutomationOperation,…>` maps act as a TS
> completeness net), a `GAP_OPERATIONS` membership, and a missing-tool mapping.
> Destructive/irreversible ops (`manage_layers`, `manage_pages`, `manage_tables`,
> `transform_layer`, `convert_color_mode`, `manage_artboards`,
> `manage_smart_objects`) are `high` risk; recoverable ops (font activation,
> hyperlinks/cross-refs, TOC/index, text flow/overset, swatches/inks) → `review`.
> The `inDesignGap` deterministic branch was refactored from an `isPages` ternary
> into an operation-spec map (cleaner altitude as ops grow); detectors use
> plural-tolerant patterns (`artboards?`, `hyperlinks?`) after a `\bartboard\b`
> word-boundary miss on the plural. `convert`/`rotate`/`flip`/`transform`/`warp`/
> `create`/`artboard` were added to `PHOTOSHOP_TASK_RE` so those tasks gate into
> automation without needing "open". Verified: typecheck 0 errors; the full
> `smoke:design-app-*` suite + `smoke:chat-{computer-handoff-context,design-task-card}`
> + `smoke:chat-recording` + `smoke:computer-task-{evidence-contract,runtime}` +
> `smoke:computer-app-execution-receipts` + `check-persisted-chat-metadata.mjs`
> all green (focused per-operation assertion cases — including a negative guard
> that "place X smart object" stays `replace_linked_asset` — added to the
> adapter-gaps smoke).

> **Pre-existing persistence-budget failure RESOLVED — `smoke:design-app-object-manifest` (2026-06-03):**
> surfaced (NOT introduced — confirmed by reverting all design edits to HEAD and
> re-running; it failed there too) while verifying the op build-out. Root cause:
> a rich PS task's full handoff metadata is ~20–28 KB; the persisted-row budget
> (`MAX_PERSISTED_BOT_MESSAGE_CHARS=9000`) forced compaction down to the `tiny`
> tier, which kept the **narrative** (execution pipeline / creative-AI) but
> nulled the **evidence** (object manifest, operation runbooks, proof review).
> `smoke:design-app-object-manifest` asserts the evidence survives;
> `smoke:design-app-execution-pipeline` asserts the narrative survives — opposing
> lowest-tier priorities under a fixed byte cap. **Fix (non-regressing):** the
> `tiny` tier in `compactComputerHandoff` now packs the proof-critical fields
> alongside the narrative — compact object manifest (`entityKinds` kept at 10 so
> no kind is dropped), risk-sorted top-3 operation runbooks (via the new shared
> `sortDesignRunbooksByRisk` helper, de-duplicated from the minimal path), and a
> compact proof review. A new candidate tier in `formatPersistedChatBotMessage`
> sits between this evidence-bearing tiny and the existing narrative-only variant:
> the loop picks the evidence-bearing tier when it fits (≤9000), else falls back
> to a guaranteed-smaller narrative-only tier (today's behavior), else to no
> metadata — so the worst case is never made worse. Measured: the object-manifest
> task fits the evidence-bearing tier at 8447; the heavier Firefly task overflows
> it and lands on the narrative-only fallback at 7402. Both smokes now pass, plus
> the full persistence suite. The 9000-char cap (documented "keep payloads
> bounded") is unchanged.

- **P3.1 — Replace the generic-app dead-end with a buildout request.**
  `computerAppAdapter.ts:3667-3691`: emit `agent.build_app_capability` (or a
  typed `{kind:'needs_capability_buildout', connectedAgentTask}` signal) instead
  of returning a passive surface list.
- **P3.2 — Broaden the buildout trigger.**
  `agentAppCapabilityBuildout.ts:177`: eligible for any app/desktop/hybrid
  strategy that errors with capability-gap language, not just
  `universal_app_control`.
- **P3.3 — Make buildout provider-agnostic.** `openswanToolRuntime.ts:4334-4391`:
  fall back to Claude Code / Gemini / Cursor sessions (already detected by
  `agentAutoConnect.ts`) when no Codex session exists; add a `provider` arg and a
  shared `sendTerminalAgentSessionMessage(provider,…)` dispatch.
- **P3.4 — Generalize the gap contract. ✅ SHIPPED 2026-06-03.** New
  `src/lib/appAdapterGapContract.ts` exposes `buildAppAdapterGapContract(appName,
  operation, ctx)` + `buildAppAdapterGapPlan(task)` + `formatAppAdapterGapPromptBlock`
  — the app-agnostic sibling of `designAppAdapterGaps.ts`. It synthesizes the
  already-generic tiers (`genericAppNavigator` navigate→find→act→verify loop,
  `appAutomationControlSurfaces` research refs, `knownAppShortcuts`
  matchKnownApp/detectPlatform) into one structured contract covering the user's
  full ask: (1) a **universalFindLadder** — find any control/command/file via the
  basics every app shares (a11y/semantic tree, command palette/search, menu-bar
  walk, standard shortcuts, panel/inspector scan, file search; visual+OCR only as
  last resort); (2) the navigate+act phases/ladder; (3) a platform- and app-aware
  **researchPlan** + researchTriggers + officialSourceRefs ("research how this app
  exposes the action before guessing"); (4) the buildout contract (proposed
  `desktop.<app>_<op>` tool, required evidence, approval-before, fail-closed,
  smoke cases, connectedAgentTask, retryPrompt). Wired into THREE places:
  (a) `buildAgentAppCapabilityBuildoutPolicy` as the **fallback for any non-Adobe
  app** (Adobe keeps its richer design contract) — adds the generic prompt block
  + research-before-guessing checklist; (b) the **live
  `buildComputerAppTaskStrategyPromptBlock`** (OpenSwan + SwanBot grounding via
  `openswanSessionRuntime.ts:447` / `swanbot.ts:1625`) so the agent gets the
  universal find-ladder + research-plan inline for any-app tasks — prompt-only,
  no persistence-budget cost; (c) the **failure-recovery loop**
  (`computerTaskEvidenceRecovery.ts` ← `chatFailureRecovery.ts`): on a failure
  for an unfamiliar app, recovery now prescribes **research-before-guess** (a
  `research.search` evidence requirement precedes the buildout for a
  `capability_gap`) + the precise connected-agent buildout (`appCapabilityResearch`
  carries the find-ladder, research plan, proposed `desktop.<app>_<op>` tool, and
  research-anchored resume), and a `fresh_evidence` failure pulls the find-ladder
  into the next observation — so "research at some point, then take the steps"
  holds on failure, not just up front. Browser/file/Adobe recovery is unchanged
  (the field self-gates to null for non-app tasks). The runtime
  "call agent.build_app_capability" line is filtered out of the buildout-agent
  prompt (it's circular there).
  Verified: typecheck 0; `smoke:app-adapter-gap-contract` (new) +
  `smoke:generic-app-navigator` + `smoke:computer-app-task-strategy` +
  `smoke:agent-app-capability-buildout` + `smoke:app-automation-control-surfaces`
  + design/computer/chat/swanbot/openswan suites green. Now "fulfil the task even
  if it's not built out beforehand" holds for the whole long tail of apps — the
  live agent navigates/finds/researches/acts on any app, not just Adobe.
- **P3.5 — Reconcile capability models. ✅ RESOLVED 2026-06-04 (mostly a non-gap).**
  The literal idea — map `taskCapabilityProfiles` strings → audit
  `ComputerCapabilityId` — would duplicate `computerAppPreflight`, which already
  reconciles the live strategy's required capabilities vs `auditComputerCapabilities`
  and emits up-front "connect X / start bridge / grant Accessibility" fixes +
  the route-decision buildout signal pre-execution. So the reconciler was **not
  built** (validated non-gap). The one genuinely-missing piece — making the
  pre-execution "build adapter" ask carry the research-first app-adapter-gap
  contract — shipped: `buildComputerAppPreflight` now attaches
  `appCapabilityBuildout` (find-ladder + research plan + proposed tool +
  buildout task) for non-Adobe apps when a buildout is indicated. Proactive
  (preflight) + reactive (recovery) buildout paths are now both research-first.

### Phase 4 — Recall that collaborates (fill gaps from knowledge)

- **P4.1 — Auto-select library skills.** `openswanSkills.ts`/`openswanSkillResolution.ts`:
  when a `SKILL.md` keyword/tag score exceeds a threshold, auto-fetch its body
  and inject as an active capability instead of a passive table entry.
- **P4.2 — Cross-fill step.** After `buildUserTaskPipelineDecision`
  (`swanbot.ts:1621` / `openswanSessionRuntime.ts:445`): use the chosen
  pipeline's `recommendedTools`/`persistenceTargets`/`category` as an *additional*
  retrieval query against memory, `SKILL.md` tags, and marketplace
  `capabilityFlags`. Highest-leverage recall change — makes the four systems
  collaborate.
- **P4.3 — Turn "no pipeline match" into a gap-fill prompt. ✅ SHIPPED 2026-06-04.**
  `buildUserTaskPipelineDecision` now sets a `gapFill` field when the best match
  is the `direct_answer` fallback (true no-match) or a low-confidence (`<0.5`)
  non-question match: it carries the top-3 candidate pipelines + their
  `executionRequirements`, a `suggestedClarification`, and a `recallHint`
  (recall memory/skills/integrations before guessing). Surfaced in
  `buildUserTaskPipelinePromptBlock` (live SwanBot/OpenSwan grounding) so the
  agent recalls/clarifies the approach on uncertain **actions** before
  committing. Deliberately **additive, not a hard gate** — `needsClarification`
  is unchanged, and a clean-question guard (`isCleanQuestion`) keeps plain
  questions ("what is X") answering directly (forcing clarification on every
  unmatched question would be wrong). This complements the existing
  ambiguity-only `needsClarification` (which fires on two close, risky matches).
  Verified: typecheck 0; `smoke:user-task-pipelines` (gap-fill present on
  fallback/weak, absent on clean-question/confident-match, prompt surfaces
  candidates + recall trigger) + `openswan-task-planner`/`chat-planner`/
  `swanbot-v2-delegation` suites green.

---

## 7. Dead / orphaned code to wire or delete

Discovered during the review — each is either a free win (wire it) or cleanup:

- `conversationalBuild.ts` + `buildChatStream.ts` — orphaned clarify machine → **wire (P1.4)**.
- `buildBriefQuality.ts` `analyzeBuildBrief` — dead → **wire (P1.4)** or delete.
- `userTaskPipelines.needsClarification` — computed, never consumed → **wire (P1.1)**.
- `agentExecutionCore` `interactive` flag — supported, no tool uses it → **wire (P1.5)**.
- `appAutomationControlSurfaces` stop-for statuses — inert → **wire (P2.1)**.

---

## 8. Risks & guardrails

- **Over-asking (clarification fatigue).** Gate G1 on a calibrated uncertainty
  score + a recall-before-ask step (P1.3); never ask for what memory/context can
  fill. Cap at 1–3 questions per turn (the `conversationalBuild` pattern).
- **Latency / cost.** Re-planning (P2.5) and cross-fill (P4.2) add work; bound
  them (re-plan **once**; reuse existing `withTimeout`/char budgets).
- **Untrusted content (security).** Recalled memory/skill/integration text is
  untrusted — **P0.5 must land before** auto-injecting more recalled content in
  Phase 4.
- **Buildout blast radius.** Generalizing buildout (Phase 3) dispatches repo
  edits to connected CLI agents — keep the existing approval gate in front of
  every `agent.build_app_capability` call; don't broaden the trigger without it.
- **Iteration caps.** Raising `MAX_ITERATIONS` (SwanBot) widens the loop budget;
  pair with a near-cap "summarize and ask/stop" instruction so longer loops fail
  gracefully rather than truncating.

---

## 9. Suggested first slice

The smallest end-to-end slice that demonstrates the whole loop on one path:

**Chat clarify loop (P0.1 + P0.2 + P1.1 + P1.2 + P1.3).** It is self-contained
(planner + dispatcher + ChatTab), low-risk, immediately user-visible, and
establishes the `ask_clarification`/`needs_input` contract that Phases 2–4 reuse.
Phase 2 (observe-before-act enforcement) is the highest-value follow-up for
computer/app tasks specifically.
