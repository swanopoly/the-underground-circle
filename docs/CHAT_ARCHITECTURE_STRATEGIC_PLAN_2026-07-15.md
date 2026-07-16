# Chat Architecture Strategic Plan — SwanBot + OpenSwan (2026-07-15)

> Synthesis of a 45-agent architecture review (11 dimension reviewers + external
> best-practice benchmark + adversarial removal verification) over the full chat
> stack. This is the STRATEGIC layer — structure, coherence, debt, consolidation,
> removal, and the target end-state — above the tactical opt/expansion backlogs
> (`docs/*AUDIT_BACKLOG*.md`). Every REMOVE candidate below was grep-verified
> for live usages; only CONFIRMED-dead items are listed as safe to delete.

## The core finding (one sentence)

The chat stack is **mid-convergence against a stale roadmap**: it runs **three
tool-execution loops over three edge functions** with **two approval engines**
and **two god-component clients (19,262 + 6,456 lines)**, while the machinery for
the *correct* end-state (one client-side typed loop, a real prompt cache
boundary, a keyed tool catalog, a single approval spine) **already exists but
isn't the path the primary lane takes.** The work is less "build new" and more
"finish the convergence already underway and delete the losing side."

## Debt at a glance

| Thing | Reality | Target |
|---|---|---|
| Tool-execution loops | 3 (`executeToolUseLoop`, `agentExecutionCore.runAgent`, `swanbot-v2-ai` server loop) | 1 (`agentExecutionCore.runAgent`, client-side) |
| Edge functions in the loop | 3 (`swanbot-ai`, `swanbot-v2-ai`, `chat-stream`) | 1 streaming + 1 stateless relay |
| Approval engines | 2+ (`agent_run_approvals` + `agent_approvals`/hitlService) + 3 tables | 1 spine (`agent_run_approvals`), 1 banner |
| `ChatTab.tsx` | 19,262 lines, ~54 inline slash intercepts | thin orchestrator; commands table-dispatched |
| `OpenSwanConsole.tsx` | 6,456 lines, imports **zero** cores | < 1,500 lines; logic in tested cores |
| Tool catalog | 203 tools hand-maintained, re-declared in the v2 edge | single dependency-light source both app + edge import |
| Prompt cache boundary | modeled but **inert** — ~90% input-cost saving never realized | real 2-breakpoint cache (frozen prefix + dynamic tail) |
| Eval gate | scorer + 19 golden cases exist; **the runner doesn't** | `scripts/run-evals.ts` as a CI merge-gate |

## Target end-state architecture

```
Thin client (renders a typed AgentEvent stream — never re-implements the loop)
        │
        ▼
ONE client-side typed loop  ── agentExecutionCore.runAgent
        │        (checkpoint-per-step, resumable, one HITL policy fn)
        ▼
ONE tool catalog (keyed, single-source)  ──►  ONE stateless relay transport (+ SSE sibling)
        │                                              │
        ▼                                              ▼
ONE memory pipeline (capture→route→retrieve→inject)   model provider
        │
        ▼
ONE observability layer (OTel GenAI span-tree: invoke_agent → chat → execute_tool, cost/cache/latency per span)
```

Two edges (`swanbot-ai` *relay mode*, `chat-stream` SSE), one loop, one catalog,
one approval spine, one memory pipeline, one telemetry layer, one lane taxonomy.

---

## THE PLAN — sequenced by leverage × safety

### Phase 0 — Land + de-risk (do first)
1. **Commit** the session's ~80 built cores + wirings (currently 1 commit behind, uncommitted). Removal steps below are unsafe on an uncommitted tree.
2. **Wire (don't delete) the 5 "0-usage" cores this session built but held back** — the removal-verifier correctly flagged them dead *because they're unwired*, not because they're legacy. These are pending work, not garbage:
   - `multiFileEditCore` → the `desktop.edit_files` tool (11-site add)
   - `runCostRollupCore` rollup half → the ops board (`officeOpsBoard`)
   - `openswanQualityAggregateCore` → the two dashboard memos (`RunHistoryDrawer:201`, `AgentRunsPanel:135`)
   - `retrievalMemoCore` → `memoryService.retrieveForTurn` (or consciously drop if the memory-collapse below subsumes it)
   - `swanbotLaneTelemetryCore` → reconcile with `chatLaneOutcome` first (see Improve #2), then wire
   - `openswanLaunchReadinessCore` → the console gate (needs a `controlRecommendation` passthrough slot added first)

### OPTIMIZE — highest ROI, low risk (do these next)
1. **Make the prompt cache boundary real** ⭐ *(single highest-leverage move — a pure win on every streamed turn).* `chatPromptAssembly` already models frozen-vs-turn and inserts `CHAT_PROMPT_CACHE_BOUNDARY`, but `composeChatSystemPrompt` returns one blob and `chat-stream` puts one `cache_control` at the very end — so the ~90% input-cost saving is never captured, and it's actively defeated by `chatHistory` + "## Current Context" + the response directive sitting *above* the marker (`swanbot.ts:3065-3092`). Split into two system blocks (`cache_control` on the frozen prefix); move the volatile fields into the dynamic tail. *(medium)*
2. **Build the system prompt once per turn.** `getSwanBotResponseImpl` calls `buildSystemPromptAsync` in Tier 1 (`swanbot.ts:3559`), Tier 1.5 (`:3590`), and Tier 3 (`:3830`); on any fallthrough it rebuilds the whole heavy prompt + DB context. Compute once, thread down. *(medium)*
3. **Stop paying two doomed v2 round-trips per fresh session.** `swanbotRouting CIRCUIT_THRESHOLD=2` → every new session on a secondary surface pays two failed `swanbot-v2-ai` invokes before the breaker opens. Gate the v2 attempt behind a deploy-freshness probe or set threshold to 1. *(small)*
4. **One cost-attribution seam.** Fold `runCostRollupCore.estimateRunCostUsd` onto the canonical `modelPricing` table (delete the duplicate `MODEL_PRICES`), and call it from `agentRunPersistence.finalize()` so **every** run row gets cost (not just the OpenSwan path just wired). *(small)*

### IMPROVE — correctness / coherence
1. **Fix the migration plan: "delete swanbot-ai" would delete a live dependency.** `SWANBOT_V2_MIGRATION_PLAN.md:176` says delete `swanbot-ai/`, but `openswanSessionRuntime.ts:742` + `swanbot.ts:4277` use its **relay branch** as the raw model transport for the primary batch lane. Rewrite M5 to retire the two *server loops* (BLACKSWAN_TOOLS + the v2 server loop), keeping the relay. *(small)*
2. **Reconcile the two incoherent lane taxonomies.** `swanbotLaneTelemetryCore` uses `'v1'|'v2'|'none'` (transport); `chatLaneOutcome` uses `'stream'|'batch'|'openswan_v2'` (surface). "Lane health" can't mean one thing until these unify. *(medium)*
3. **Collapse the redundant per-turn memory path + light up capture.** `buildOpenSwanMemoryStores → buildPromptMemoryBundle` already runs `retrieveForTurn` + soul-wisdom + startup, then the *separate* `loadWisdom`/`loadRetrieval` tasks run them **again** — a double embed+rank per turn. One assembler; wire capture where it's missing. *(medium)*

### ADD — missing capability / structure (the state-of-the-art gaps)
1. **An eval CI merge-gate** ⭐ — the scorer (`agentEvals.ts`) + 19 golden cases (`docs/evals/golden.jsonl`) exist but the runner **doesn't**. Build `scripts/run-evals.ts` driving each case through the real `agentExecutionCore.runAgent` (real model, mocked side-effecting tools, pinned model/judge). Grow the set from prod failures. *This is the safety net that makes every consolidation below safe.* *(medium)*
2. **A single dependency-light tool-catalog source** both the RN app and Deno edges import (proven by `toolInputExamples.ts`), killing the 71 re-declared v2-edge schemas + the LOCKSTEP burden. *(large)*
3. **A transport-vs-loop boundary ADR** — the "loops are client-side, edges are stateless transports" contract exists only in scattered comments and the migration plan contradicts it. State it once; it's the prerequisite for safely retiring either server loop. *(medium)*
4. **Durable checkpoint-per-step resume** — model the loop as checkpoint-per-step keyed by run id (the `agent_runs` substrate exists), so any run resumes deterministically after crash / edge cold-start / long HITL wait, with idempotent side effects. *(large)*
5. **OTel GenAI span-tree observability** — emit `invoke_agent → chat → execute_tool` spans with cost/cache/latency per span from the single loop (after the loop converges). Replaces flat DB rows. *(large)*
6. **A code-execution tool surface** — you already run a local bridge with `exec_file` + CAD/Photoshop script exec; extend to a sandboxed code-tool so the agent calls 203 tools *programmatically* instead of one-at-a-time (the modern large-catalog pattern). *(large)*

### REMOVE — verified dead code (19 CONFIRMED-dead; grep-verified 0 live usages)
Safe to delete now (after Phase 0 commit):
- **`ChatTranscript.tsx`, `RunInspector.tsx` cluster, `ChatComposer.tsx`** — orphaned presentational components (0 imports; corroborates the existing `chat-message-render-lives-in-chattab` memo).
- **`chatThreadLineage.ts`** — dead thread-lineage helper (0 usages).
- **`task_run_approvals`** table + system — zero writers (3 approval tables → 2).
- **Dead exports:** `memoryService.evaluateMemoryCandidate`, `openswanToolRuntime.buildOpenSwanCapabilityManifestB…`, `openswanRuntimeToolLoop.runOpenSwan…` legacy fns, `openswanSessionRuntime` legacy `executeToolUseLoop` branch + typed-core revert flag.
- **`chatPromptAssembly.ts:203-243`** — the speculative cache-stability map + type (never read).
- **`computerTaskEvidenceContract.ts`** — the FLAG-DARK outcome-verify tier + dead approval-risk mini-tier.
- **`appAutomationControlSurfaces` builder** never injected into a prompt (self-refs only).
- **`swanbot.ts` standalone `loadWisdom`/`loadRetrieval` duplicate sections** — ⚠️ VERIFY against the P72 refactor first (confirm these are the *old* standalone copies, not the new tasks) before deleting.

Do **NOT** remove (verifier caught as LIVE — reviewers were wrong or migration-first):
- `swanbot-ai` edge (4 uses — relay branch is load-bearing), `executeToolUseLoop` (5), `HitlApprovalBanner`/`agent_approvals` (12 — retire only *after* consolidation), the `code.*` planner stubs (66), the `planned:true` pseudo-tools (77), the v2-edge TOOLS array (6). These need migration before removal.
- The 5 "0-usage" cores from this session (see Phase 0.2) — **wire, don't delete.**

### CONSOLIDATE — the structural debt (largest, highest-value, do last with the eval gate as net)
1. **Loop convergence** ⭐ — repoint `getSwanBotResponse` Tier 2 (`callSwanBotV2`) at `agentExecutionCore`, which makes both server-side loops redundant and lets the M2 client-delegation round-trip protocol be deleted. Extract a shared `callModelRelayTurn` transport helper first (both loops hand-roll `invoke('swanbot-ai')` + JWT-refresh + retry). *End-state: 1 loop.*
2. **Approval consolidation** — anoint `agent_run_approvals` as the single spine; one `resolveApproval` policy fn every lane calls (fold `chatApprovalGate` + `openswanToolApprovals` + per-tool `approvalMode`); one banner; retire `hitlService`/`HitlApprovalBanner` + `agent_approvals` after migration.
3. **`OpenSwanConsole` decomposition** (6,456 → <1,500) — mechanical first (move the ~1,900-line StyleSheet + wire the built `openswanLaunchReadinessCore`), then structural (extract the section view-models into tested cores). Establishes the "thin surface + tested cores" pattern the console entirely lacks.
4. **`ChatTab` command-dispatch** — extend `ChatCommandDefinition` with an optional `handler(ctx)` and add `dispatchChatCommand(input, ctx)` that table-dispatches; migrate the ~54 inline slash intercepts out of the 19k-line send path.
5. **State persistence keystone** — add a `messages.metadata` jsonb column (the pattern `room_messages` already uses); move bot metadata off the content text blob → delete the ~1,000-line lossy full/minimal/tiny compaction machinery in `persistedChatMetadata`.

---

## Recommended sequencing

1. **Now:** Phase 0 (commit + wire the 5 held cores) → OPTIMIZE #1 (cache boundary — biggest pure win) → ADD #1 (eval gate — the safety net).
2. **Then, behind the eval gate:** IMPROVE #1-3 (migration-plan fix, lane taxonomy, memory collapse) + the REMOVE sweep (19 dead items) + OPTIMIZE #2-4.
3. **Then, the big consolidations:** loop convergence → approval consolidation → god-component decomposition, each gated by evals + a commit checkpoint.

## Guardrails carried through
- Nothing removed without a grep-verified 0-usage + a commit checkpoint.
- The `default::blackswan` agent id is not renamed without a migration (CLAUDE.md).
- Every consolidation ships behind the eval gate (ADD #1) — build that first.
- The house pattern holds: pure cores + smoke tests + thin wiring; no new logic in the god-components.
