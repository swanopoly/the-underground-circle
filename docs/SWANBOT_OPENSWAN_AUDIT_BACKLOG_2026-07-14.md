# SwanBot + OpenSwan Optimization/Expansion Audit — Verified Backlog (2026-07-14)

12-subsystem audit (36 agents: auditors + adversarial verifiers), 22 confirmed proposals ranked by value-per-effort. The top 10 are being built as pure cores (workflow swanbot-openswan-build); the rest are the roadmap.

## [0] prompt-assembly · optimization · value 8/10 · small · hot-file-small **[BUILDING]**
**Conversational complexity floor — end the follow-up context cliff**
- Impact: A user deep in a multi-turn task who replies "yes" / "go" gets a turn stripped of memory, turn-retrieval, missions, skills, SOUL wisdom, and connected-resources — the agent effectively forgets what it was doing at the exact moment it should act. The floor keeps continuity across the thread while sti
- Evidence: agenticCodingProfile.ts:406 `if (intent === 'casual' && entityCount === 0) return 'trivial'` — a bare mid-task follow-up ("yes", "do it", "go ahead") classifies trivial. chatPromptAssembly.ts:89-93 `resolveChatPromptContextPolicy('trivial')` then returns loadMemory/loadWisdom/loa
- Core: Prefer the STATELESS variant as primary: make resolveConversationComplexityFloor derive purely from context.conversationMessages (already passed at swanbot.ts:2158) by re-running estimateComplexity on the previous user turn(s) and flooring one tier below it (last turn complex → f
- Wire: swanbot.ts:2499 — add `resolveConversationComplexityFloor(scopeKey, route?.complexity)` as a third input to the existing `composeComplexityFloors(...)` call, and call `recordTurnComplexity(scopeKey, c

## [1] v2-tool-loop · expansion · value 8/10 · small · hot-file-small **[BUILDING]**
**Testable tool-selection core with capability co-occurrence + an imperative-action recall floor (self-heal tool starvation)**
- Impact: Fewer 'I don't have a tool for that' false refusals, and fewer mid-task stalls where the agent does step 1 but lacks the obvious step-2 tool — e.g. a WordPress task that needs a browser fallback, a credentials/login task that needs the browser fill tool, or a coding task that needs verification.type
- Evidence: selectToolsForTurn (supabase/functions/swanbot-v2-ai/index.ts lines 2135-2167) is a blind additive union of ~14 inline single-keyword regexes (lines 2148-2161). Failure mode: if a request misses a group's keyword, that group's tools are ABSENT from activeTools, and prompt rule #8
- Core: Keep the core but tighten three things the smoke should pin: (1) make the imperative-floor detector interrogative-aware — exclude "do you.../does.../can you...?/what.../why..." so the widen fires on true do/make/fix/change imperatives only (the sole real false-positive risk, and 
- Wire: In selectToolsForTurn, replace the inline regex block (lines 2148-2161) with `for (const g of selectToolGroups(text, mode).groups) addToolNames(selected, TOOL_GROUPS[g])`; BASE_TOOL_NAMES + mode-group

## [2] streaming · optimization · value 8/10 · small · hot-file-small
**Stream stall watchdog — two-phase idle-abort so a silently-dead SSE socket can no longer hang the chat forever**
- Impact: Flaky-network turns that today freeze the composer with a permanent spinner instead self-heal: the watchdog converts the hang into the already-built interrupted path — partial answer persisted, 'say continue' offered, batch retry attempted — with no user action.
- Evidence: swanbotStream.ts:318-321 `while (!cancelled) { const {done,value} = await reader.read(); ... }` has NO idle deadline — the only setTimeout in the file (line 189/368) is the 80ms coalesce flush, and `controller.abort()` fires solely from `cancel()` (line 431). The edge fn sends no
- Core: Ship as proposed, with these implementation guards baked in so the ~15-line change is watertight: (1) Add a single clearWatchdog() and call it at the top of finishComplete/finishInterrupted/finishPreStreamError AND inside cancel(), so no timer survives a terminal or leaks after s
- Wire: swanbotStream.ts run(): a resettable watchdog timer reset on every reader.read() value (any byte, keyed on sawAnyOutput to pick the deadline); on expiry set a new `stalled` flag then controller.abort(

## [3] delegation · optimization · value 8/10 · small · hot-file-small **[BUILDING]**
**Complexity-scored delegation sizing — stop fanning out 3-4 specialist LLM runs for a one-line task**
- Impact: Simple builds/debugs stop paying for 3-4 parallel specialist model runs when 1-2 would do — roughly halves delegation latency and token/$ spend on the common small-task case, directly serving the roadmap's cost-control priority ($10 cap / transient agents). Genuinely complex multi-part work still ge
- Evidence: src/lib/subagentRegistry.ts:242 planSubagentDelegation builds specs from a fixed switch on taskPlan.kind; the 'build' case (lines 252-258) ALWAYS adds architect + coder + reviewer (+ tester when tests/preview), every branch ends `return specs.slice(0, 4)` (line 303), and there is
- Core: Ship as proposed, plus two tightenings. (1) Floor guarantee: have sizeDelegationSpecs always retain at least the primary (first-added) spec even in the theoretical medium-only path (default kind + plugin-only medium specs), so a delegated turn never silently runs zero specialists
- Wire: src/lib/subagentRegistry.ts planSubagentDelegation line 303: replace `return specs.slice(0, 4)` with `return sizeDelegationSpecs({ message, taskPlan, specs }).kept.slice(0, 4)`. One-line edit at the s

## [4] coding-agent · optimization · value 8/10 · medium · safe **[BUILDING]**
**Incremental reindex — re-embed only changed files instead of the whole repo every run**
- Impact: codebase.index becomes cheap to re-run, so the index actually stays fresh after edits instead of silently going stale (users avoid re-indexing because it's slow/costly today). A post-edit reindex drops from ~1500 embeddings + 1500 bridge reads to only the handful of touched files — seconds and cents
- Evidence: src/lib/codebaseIndexRuntime.ts:193-227 — indexCodebase() reads EVERY file in plan.toIndex over the bridge (readFile per file) and calls embedTexts(embedInputs) on ALL of them on every invocation; embedded_at/embedding_model are written (lines 189,209-210,222-223) but NEVER read 
- Core: Two cheap refinements that close the only residual gaps and match the codebase exactly: (1) Fold the embedding model into the equality check — fileSignatureChanged should also force reindex when the existing row's embedding_model !== EMBEDDING_MODEL. This fulfills the migration c
- Wire: indexCodebase() in src/lib/codebaseIndexRuntime.ts: have crawlCodebaseEntries carry modifiedAt (already returned by listFiles), fetch existing rows (path,size_bytes,modified_at,embedding IS NOT NULL) 

## [5] coding-agent · expansion · value 8/10 · medium · hot-file-small
**Transactional multi-file edit tool (desktop.edit_files) — one atomic, one-approval coordinated refactor**
- Impact: Cross-file refactors become one atomic operation: the agent proposes edits to all affected files, the user sees ONE combined multi-file diff and approves ONCE, and it's all-or-nothing — either every file changes or none do, so a failed match on file 3 can never leave a half-applied, non-compiling tr
- Evidence: The only edit tool is the SINGULAR desktop.edit_file (src/lib/openswanToolRuntime.ts:3502-3505; args at :598 are one {path,oldString,newString,edits[]}) backed by applyFileEdits over ONE file (src/lib/fileEditCore.ts:99). A refactor spanning N files (rename a function + fix 4 cal
- Core: Keep the pure multiFileEditCore exactly as proposed (it delivers the high-value plan-phase atomicity that eliminates the dominant failure mode — a match failure caught before ANY write). But tighten the WIRING so the DISK phase is also all-or-nothing, since the proposal's headlin
- Wire: Add a desktop.edit_files tool in src/lib/openswanToolRuntime.ts (tool def beside desktop.edit_file ~:3502; executor beside its case ~:5996): read each file via the bridge, call planMultiFileEdit, surf

## [6] verification · optimization · value 8/10 · medium · hot-file-small **[BUILDING]**
**Precise verification failure signal — stop dropping tsc/eslint diagnostics and stop nudging on pre-existing red**
- Impact: The coding agent literally cannot see its own type/lint errors on the most common failure — it edits blind or declares done wrongly — and it gets nagged to fix failures it never introduced. Attributed diagnostics plus regression-only nudges make the run-and-fix loop actually converge and kill the fa
- Evidence: /Users/cswanson/the-underground-circle/src/lib/openswanToolRuntime.ts:6045-6046 — on a FAILED verification the model-facing text is `verificationResult.error || verificationResult.stderr || 'Verification failed.'`; stdout is read only on the SUCCESS branch (line 6048). But `verif
- Core: Ship as two slices. SLICE 1 (near-one-line, safe, do first): at openswanToolRuntime.ts:6046 append stdout (bounded) on the failure branch — e.g. return [error, stderr, stdout].filter(Boolean).join('\n') truncated, or route through summarizeDiagnostics. This alone unblinds the age
- Wire: (1) openswanToolRuntime.ts:6046 — include stdout on the failure branch and route it through summarizeDiagnostics so the model sees the actual errors (partly a one-line bug fix). (2) openswanSessionRun

## [7] provider-routing · optimization · value 7/10 · small · safe **[BUILDING]**
**Auth/rate errors should advance the cross-provider chain to a different provider, not abort it**
- Impact: invokeAnyChat's stated promise ('keep working even when one provider fails') is defeated today: a user with OpenRouter (stale key) + Groq + Google connected sees the whole 'best available' call fail with a 401 the moment OpenRouter is tried first, even though Groq/Google would have served it — and b
- Evidence: /Users/cswanson/the-underground-circle/src/lib/universalInvoke.ts:113,120 — executeRouteChain gates fallthrough on `const transient = isTransientProviderError(err) … if (!transient) break;`. /Users/cswanson/the-underground-circle/src/lib/crossProviderRouter.ts:500-517 — isTransie
- Core: Keep the new pure module and ~5-line indexed-loop wiring, but make shouldAdvanceAfterError class-specific instead of applying differentProviderRemains uniformly: (a) 'auth' → advance IFF a different-provider route remains (same key/provider will just re-fail — this is the actual 
- Wire: /Users/cswanson/the-underground-circle/src/lib/universalInvoke.ts executeRouteChain (lines 105-122): switch the `for (const route of routes)` to an indexed loop and replace the `isTransientProviderErr

## [8] memory · optimization · value 7/10 · small · hot-file-small
**Per-turn retrieval memoization — embed + rank the query once, not twice**
- Impact: Cuts one embedding API call plus 3 duplicate Supabase round-trips (RPC + soul-links + evaluations) and a duplicate access-log insert off the critical path of every non-trivial turn; since both calls sit inside the P72 context fan-out, this trims memory-path tail latency and per-turn embedding spend 
- Evidence: For every non-trivial message, chatPromptAssembly.ts:89,91 sets loadMemory AND loadRetrieval true, so retrieveForTurn (memoryService.ts:819) runs twice on the SAME currentMessage in a single prompt build: once via buildOpenSwanMemoryStores → buildPromptMemoryBundle (memoryService
- Core: Two refinements make the win bigger and more robust. (1) Cache the in-flight PROMISE, not just the resolved result, keyed identically. In the non-pre-built path, loadMemory (2634) and loadRetrieval (2680) run in the SAME Promise.all wave and would race a result-only cache (both m
- Wire: In retrieveForTurn (memoryService.ts:819), before Step 1 look up the cached sorted scored[] (the array at memoryService.ts:1023, pre-slice); on hit skip embed/RPC/links/evals and just re-apply this ca

## [9] memory · expansion · value 7/10 · medium · risky
**Capture-time conflict resolution — supersede contradictory memories instead of stacking them**
- Impact: The agent stops being handed contradictory instructions/preferences from its own memory; recall quality and token efficiency improve at the source. Because the ranking layer is already excellent, keeping conflicting pairs OUT of the store is the single highest-value remaining memory-quality win.
- Evidence: autoExtractAndSave (agentMemory.ts:228) is the main capture path (called from swanbot.ts:713 and ChatTab.tsx:5515/9887). Its dedup is purely lexical — exact/substring title match + 60%-content-prefix overlap (agentMemory.ts:259-271) — so on a miss it always inserts a fresh row (a
- Core: Wire it, but make it policy-safe and cheaper: (1) Do NOT auto-supersede memory_kind 'decision'/'instruction' — the daily cron and its comment ("load-bearing by policy") and CLAUDE.md's HITL-for-destructive-memory rule protect these. For those kinds, decideMemoryConflict returns '
- Wire: In autoExtractAndSave, on a lexical-dedup miss, fetch top-K semantic neighbors via semanticSearchMemories({ queryText: title+content, matchThreshold ~0.8 }) (memoryEmbeddings.ts:286, already returns s

## [10] typed-loop-core · expansion · value 7/10 · medium · hot-file-small **[BUILDING]**
**Oscillation / no-progress stuck detector (catch A-B-A-B thrash the exact-repeat guard misses)**
- Impact: A whole class of runaway loops — ping-pong between two failing approaches, or scattershot failing calls — currently burns the full iteration budget and returns an empty/unhelpful answer while spending real model tokens; catching them early routes into the same P56 solver consultation (root-cause + t
- Evidence: Stuck-detection today is EXACT-repeat only. detectRepeatedToolFailure (src/lib/toolLoopStuckCore.ts:75-104) returns stuck only when the last threshold (3) calls share the SAME name + SAME inputHash AND all failed; the pre-dispatch check in src/lib/agentExecutionCore.ts:743-818 is
- Core: Build it, with three tightening's. (1) Pin the insertion point to AFTER agentExecutionCore.ts:1021 (messages.push toolResultBlocks) — the round's tool_use blocks are closed there, so an injected consultation/terminal user message creates no dangling tool_use; the pre-dispatch pat
- Wire: src/lib/agentExecutionCore.ts at the post-round ring update (~lines 996-1016, after this round's calls are recorded and before the next provider turn): if the exact-repeat guard did not trip, `nextTur

## [11] tool-catalog · expansion · value 7/10 · medium · hot-file-small
**Tool-usage analytics -> per-circle auto-pin: learn each circle's real long-tail and promote it into the pinned core**
- Impact: Over a week of use each circle's palette self-tunes to what they actually do: their genuinely-frequent long-tail tools become turn-1 available with no discovery round-trip and without the model even needing to know to search. This is the persistent/learned complement to the per-message pre-unlock op
- Evidence: The pinned/deferred split is entirely static: TOOL_DISCLOSURE_FAMILY_DEFAULTS (src/lib/openswanToolRuntime.ts:5149-5200) hard-codes wp/desktop/github/gmail/gdocs/etc. as 'deferred' for every circle forever, and getOpenSwanToolDisclosure (5203) only consults per-tool override -> t
- Core: Keep the pure core (computeAutoPinSet) as proposed, but harden the runtime wiring so the default-on, latency-sensitive turn-start path never blocks: (1) Refresh the per-circle auto-pin set OUT-OF-BAND (background/after-run), and have getProgressiveOpenSwanTools read only a small 
- Wire: Same chokepoint as the optimization: getProgressiveOpenSwanTools (openswanBridge.ts:156) unions the auto-pin set into pinnedNames. A thin runtime helper aggregates recent agent_run_events tool_call_re

## [12] delegation · expansion · value 7/10 · medium · safe **[BUILDING]**
**Capability-signal specialist selection — unlock the dormant Security / DevOps / Designer sub-agents into auto-delegation**
- Impact: A request like 'audit this auth flow for injection vulnerabilities' gets the real Security specialist (security spirit + security_review verification + code.review tool) instead of a generic architect; 'set up the deploy pipeline and rollback plan' gets the DevOps specialist instead of planner+coder
- Evidence: subagentCapabilities.ts defines 12 fully-built specialist roles (lines 5-17), each with triggerPatterns + preferredTaskKinds + tool scoping + a spirit — e.g. security (lines 212-225: code.review tool, security_review verification, security spirit), devops (226-239: release/rollba
- Core: The proposal's wiring premise is slightly wrong and needs one correction: there is NO priority-aware "sizing optimization above" — line 303 is a plain `return specs.slice(0, 4)` that keeps the first 4 in INSERTION order, so adding a 'high'-priority signaled spec after the plugin 
- Wire: src/lib/subagentRegistry.ts planSubagentDelegation, immediately after the plugin block (line 301) and before the slice: call selectSignaledSpecialists({ message, taskPlan, capabilities: listSubagentCa

## [13] verification · expansion · value 7/10 · medium · hot-file-small
**Coding-lane Verification Receipt — proof-of-work capture for the run-and-fix gate**
- Impact: Teammates get a compact, auditable artifact for agent coding work — what changed, which checks ran and passed, the net diagnostic delta ('-3 type errors, 0 introduced'), and the commit SHA — surfaced in Feed/Office and echoed back into the originating chat thread, instead of trusting the agent's pro
- Evidence: The run-and-fix gate reaches a verified-clean state (/Users/cswanson/the-underground-circle/src/lib/runAndFixGateCore.ts:250-253 clears `dirty` on a passing verification) but that outcome is never captured — it only mutates in-memory gate state and maybe suppresses a nudge. The a
- Core: Ship the receipt, but DROP the "diffDiagnostics / -3 type errors, 0 introduced" delta — no such helper exists and the runtime captures no diagnostic counts or baseline (the gate is boolean-only; verification/git return untrusted-fenced stdout). Build buildVerificationReceipt({edi
- Wire: openswanSessionRuntime.ts at run completion — right after runAgent() returns, beside the existing agent_run_events telemetry block (~line 890) — assemble the receipt from the final runAndFixState + ca

## [14] prompt-assembly · expansion · value 6/10 · medium · hot-file-small **[BUILDING]**
**Model-aware extras budget (adaptive by context window)**
- Impact: On a small-window model (Ollama 32k, some local/BYOK) the base personality prompt + up to 16k chars of extras + conversation history + tools + output can overrun the window → provider truncation or hard errors, worst at depth 'max' or in long threads. Simultaneously a user on a 1M-token Claude/GPT i
- Evidence: The extras budget is fixed per complexity tier — chatPromptAssembly.ts:96-98 `maxExtrasChars` = 1200/3000/5500/8000 — and the depth dial only raises a flat ceiling (contextDepthPolicy.ts:36 `MAX_DEPTH_EXTRAS_CHARS = 16_000`). It is resolved at swanbot.ts:2582 `applyContextDepthTo
- Core: Keep the pure modelContextBudgetCore.ts (numeric window in → clamped policy out, identity on unknown/large) exactly as proposed — that is the smoke-testable, valuable half. But do NOT add getModelContextWindow to react-tainted llmProviders.ts (it imports useState/supabase, so it 
- Wire: swanbot.ts:2582 — wrap the resolved `contextPolicy` with `resolveModelContextBudget(policy, { modelContextWindow: getModelContextWindow(context.model), approxBasePromptChars: base.length })`. Composes

## [15] provider-routing · expansion · value 6/10 · medium · hot-file-small **[BUILDING]**
**Spend-aware Auto model downshift (automatic cost-guard tied to the circle budget)**
- Impact: Auto automatically steps down one/two tiers (Fable/Opus→Sonnet→Haiku→free/local) as the circle nears its budget cap, with a visible one-line notice ('near your daily cap — used Haiku instead of Sonnet; raise it in Marketplace'), preventing surprise overspend and cap-hit dead-ends while keeping full 
- Evidence: The Auto router chooses a model TIER purely from intent×complexity — /Users/cswanson/the-underground-circle/src/lib/serviceProfileSouls.ts:338-363 (heavy question/build → Sonnet/strong coder) — wired at /Users/cswanson/the-underground-circle/src/lib/swanbot.ts:3399-3407. A full p
- Core: Keep the pure budgetModelDownshift.ts core (tier map + downshiftForBudget, fail-closed identity, smoke-tested), but fix three things and widen the seam: (1) Correct the framing — it's the USER's device budget config (loadBudgetConfig) measured against the CIRCLE's spend (claude_a
- Wire: /Users/cswanson/the-underground-circle/src/lib/swanbot.ts immediately after resolveModelForSoul (line 3407) — ONLY when context.model is empty/'auto' (explicit picks stay authoritative, per house rule

## [16] v2-tool-loop · optimization · value 6/10 · small · hot-file-small
**Parallelize independent server-side reads in the edge runLoop (mirror the client's read-batch fan-out)**
- Impact: Multi-read turns (the dominant shape in this accountability app) drop from sum→max of read latencies — a 5-read status sweep goes from ~5×50ms serial to ~1 parallel batch (~200ms saved per such turn), felt directly as faster chat responses since the model can't produce its next turn until every tool
- Evidence: supabase/functions/swanbot-v2-ai/index.ts runLoop executes server tools strictly sequentially: line ~2744 `for (const use of uses) { await executeEdgeToolUse(...) }` (fully-server batch) and line ~2692 `for (const use of serverUses)` (mixed client+server batch). Each handler is a
- Core: Keep the plan but: (1) drop the incorrect '5-iteration cap' claim — within-turn parallelism doesn't reduce turn count; (2) lead the value case with fetch_url/getGithubActivity batched alongside DB reads, where sum→max makes the DB round-trips effectively free (the pure-DB sweep s
- Wire: Import the core directly in the edge exactly as it already imports ../../../src/lib/toolInputExamples.ts (line 59) — no LOCKSTEP mirror. In runLoop, replace the two sequential for-loops (~2692 and ~27

## [17] session-runtime · optimization · value 6/10 · medium · hot-file-small
**Overlap + coalesce the pre-model run telemetry so record-keeping stops gating time-to-first-token**
- Impact: Every OpenSwan turn (main chat, room chat, missions, kanban) pays ~0.5-2s of serialized DB/storage latency before the model is even invoked. Running the telemetry lanes concurrently WITH the memory retrieval (which must happen anyway) hides almost all of it behind work already on the critical path; 
- Evidence: openswanSessionRuntime.ts:1260-1385 — after createRun (:1191) the turn serially awaits ~8 telemetry round-trips BEFORE any model work: upsertOpenSwanTranscriptHeader (:1260), appendTranscriptEvent x2 (:1271,:1293), updateRunStatus (:1303), mergeRunMetadata (:1304), addStep (:1309
- Core: Ship the lean high-value slice first and skip the pure core unless the logic grows: (1) hoist buildOpenSwanMemoryStores to start before the 1260-1385 telemetry and wrap telemetry + memory in one Promise.all, joining before the prompt build — this alone hides most of the latency s
- Wire: openswanSessionRuntime.ts pre-model seam (:1260-1385) plus the memory-bundle kickoff at :1544. Replace the serial awaits with Promise.all([runRunRowLane(plan.runRowLane), runTranscriptLane(plan.transc

## [18] session-runtime · expansion · value 6/10 · small · hot-file-small
**Stalled-run reaper + tool-loop heartbeat — eliminate zombie 'running' runs and give live introspection a truthful liveness signal**
- Impact: The Office ops board (listCircleLiveRuns) and active-run views stop accumulating zombie 'running' runs forever; a genuinely-dead run flips to 'failed' (visible, actionable, drops out of the active window via completed_at) instead of hanging; and the round-boundary heartbeat gives an honest 'last ali
- Evidence: No stall/heartbeat/reaper exists anywhere (grep of agentRunSystem.ts/openswanSessionRuntime.ts/agentRunPersistence.ts returns nothing). getActiveRuns (agentRunSystem.ts:552-561) and listCircleLiveRuns (:571-591) surface every run with status in (queued,planning,running,waiting_ap
- Core: Keep the pure core runStallPolicy.ts (idiomatic, smoke-testable) but fix the two mechanism choices. HEARTBEAT: do NOT reuse updateRunStatus(runId,'running',{}) — it resets started_at to now() every round (agentRunSystem.ts:194), corrupting officeOpsBoard duration/'started X ago' 
- Wire: Two small edits, NO migration (started_at/updated_at already exist and updateRunStatus already sets completed_at on 'failed'). (1) Heartbeat: in runTypedCoreToolLoop onRoundComplete (openswanSessionRu

## [19] computer-use · expansion · value 6/10 · medium · hot-file-small
**A11y stable-label target resolver — resolve a durable label to the authoritative dotted path at read time (kills the stale-path window)**
- Impact: 'Click the Export button' / fill-the-named-field works reliably even as the tree shifts between reads; wrong-element clicks from stale indices drop sharply, and a full model reasoning step (scan slice → identify node → copy numeric path) collapses into the read itself — cutting a round-trip on essen
- Evidence: desktop.click_element / desktop.set_element_value accept ONLY `{ pid, path }` (openswanToolRuntime.ts:618-619; handlers 10042-10057). `path` is A11yNode.id — a dotted path 'assigned by the bridge per tree read' — and `index` ([#N]) is likewise 'assigned by the bridge per tree rea
- Core: Resolve to and RECOMMEND the `elementIndex` [#N], not the bare dotted path — and in the same PR wire elementIndex through the tool (add `elementIndex?: number` to the click_element/set_element_value schemas at 618-619 and forward it at handlers 10047/10057; the bridge already sup
- Wire: Additive, single-handler edit: in the desktop.read_a11y_tree `target` branch (openswanToolRuntime.ts ~9996-10016), after the slice is built, run resolveA11yTarget over the fresh tree and — on an UNAMB

## [20] streaming · expansion · value 5/10 · medium · hot-file-small
**Live stream health signaling — a byte-truth transport state machine (opening → waiting-first-token → streaming → slow → stalled) surfaced by the pending bubble**
- Impact: During a slow first token or a degrading connection the user sees an honest 'Connecting… / Waiting on model… / Streaming… / Connection slow…' instead of a spinner (or a rotating verb that claims progress that isn't happening), and 'slow' appears before the watchdog would ever trip, so the eventual i
- Evidence: The chat stream emits no phase/health at all: swanbotStream.ts handles only delta/usage/done/error/tool_use (buildStream.ts:98 HAS `phase` events, but the chat lane doesn't). thinkingStatus.ts rotates a cosmetic verb on a fixed ROTATION_MS=2200 timer (line 17) regardless of wheth
- Core: Keep the pure streamHealthCore.ts + additive onHealth wiring, but correct the two errors and reframe the value. (1) Drop the 'streamStallPolicy hard abort' rationale — no watchdog exists. Reframe SLOW/STALLED as honesty during an UNBOUNDED wait: today a hung/slow connection shows
- Wire: Add optional `onHealth?: (h: StreamHealth) => void` to StreamChatOpts in swanbotStream.ts; advance the core on the 200 handshake, first byte, each byte, and a light idle tick, calling onHealth on tran

## [21] tool-catalog · optimization · value 5/10 · small · hot-file-small
**Predictive pre-unlock: fold high-confidence deferred tools into the pinned set for this turn, killing the tools.search round-trip**
- Impact: For predictable intents ('check my email', 'post to WordPress', 'open my calendar') the concrete tool is callable on turn 1 instead of turn 2 — one fewer LLM inference per task (seconds of latency + the re-advertised pinned-core tokens + the tools.search request/result all saved). Net-positive on to
- Evidence: getProgressiveOpenSwanTools (src/lib/openswanBridge.ts:134-164) builds the advertised set purely from the STATIC listPinnedOpenSwanToolsForSurface (openswanToolRuntime.ts:5214) + tools.search; opts is {mode} only — it never sees the user message. Consequence: a deferred tool (gma
- Core: Keep the pure core selectPrewarmToolNames(matches, suggestedFamilies, {cap=5}) exactly as specified (intersection of top-K ranker matches and classifier families, deduped, capped, excluding tools.search and already-pinned). But the proposal is a no-op for its own examples unless 
- Wire: getProgressiveOpenSwanTools (openswanBridge.ts:134) gains opts.message; before line 158 it calls searchOpenSwanToolCatalog(message,{surface}) + suggestCapabilitiesForMessage(message), passes both to s
