# OpenSwan Runtime Hot-Path Optimization Plan

> Audit + sequencing plan for the OpenSwan session tool loop. No code changed —
> this is the discovery + ranking record so any agent can pick up one item
> without re-deriving the hot path.
> Author pass: 2026-07-16. Scope: `runOpenSwanSessionTurn` → `runTypedCoreToolLoop`
> → `agentExecutionCore.runAgent` → `openswanToolRuntime` catalog assembly.

Owners (from `CLAUDE.md` Runtime Map):
- OpenSwan sessions — `src/lib/openswanSessionRuntime.ts`
- Typed model/tool loop — `src/lib/agentExecutionCore.ts`
- Tool catalog — `src/lib/openswanToolRuntime.ts` (+ adapter `src/lib/openswanBridge.ts`)

---

## 1. Hot-path cost model

A single OpenSwan turn does work at three cadences. Optimizations only matter in
proportion to their cadence:

| Cadence | What runs | Dominant cost |
|---|---|---|
| **Once per turn** (before the loop) | prompt-block assembly, memory recall, system-prompt build, run/transcript persistence, tool-catalog assembly, MCP fetch | ~11 serial Supabase writes + 1 memory recall + 1 system-prompt build gate time-to-first-token |
| **Once per round** (`provider.turn`, up to `maxToolRounds` = 2–5) | one `swanbot-ai` edge invoke (fresh JWT) that **re-sends the entire `messages[]` history** | network RTT + input tokens that GROW every round (stale tool_result bytes) |
| **Once per tool call** | `executeOpenSwanRuntimeTool` dispatch (itself often a network/edge call) | currently **serial** — `parallelToolConcurrency: 1` |

The two levers with the most headroom are therefore: (a) **serial tool dispatch**
within a round, and (b) **unbounded context growth** across rounds. Both have a
pure core already built this session but **neither is wired**.

Key confirmations from the read:
- `runTypedCoreToolLoop` pins `parallelToolConcurrency: 1`
  (`openswanSessionRuntime.ts:896`) and leaves `toolParallelPolicyProvider`
  commented out (`openswanSessionRuntime.ts:998-999`).
- The `runAgent` call passes **no `compaction` option**
  (`openswanSessionRuntime.ts:869`) — history is never summarised/pruned across
  rounds. `grep` confirms `compaction:` is passed to `runAgent` **nowhere** in the
  codebase.
- Both new cores are referenced **only by their own smoke tests** —
  `partitionOpenSwanToolCalls` / `planContextCompaction` have zero runtime call
  sites.

---

## 2. Findings, ranked by value ÷ effort

| # | Optimization | Value | Effort | Core status |
|---|---|---|---|---|
| 1 | Parallelize independent read-only tool calls in a round | High (wall-clock on multi-read rounds) | Low | **Existing T8 path built + integrated**; `openswanParallelToolCore` built this session (redundant alt) |
| 2 | Move pre-loop telemetry/transcript writes off the critical path | High (time-to-first-token) | Low–Med | No core needed |
| 3 | Wire context compaction into the round loop | Med–High (avoids context-limit 400s, cuts per-round input tokens/cost) | Med (new core + applier) or Low (existing `runAgent.compaction` seam) | **`openswanContextCompactionCore` built this session** (needs applier) |
| 4 | Memoize tool-catalog assembly + cache `resolveAdditionalTools` re-shape | Low–Med (per-turn + per-round CPU/alloc) | Low | No core needed |
| 5 | Index `TOOL_DEFINITIONS` by name (kill O(n²) `.find` in disclosure/pinned) | Low | Low | No core needed |
| 6 | Consolidate the ~15 per-turn prompt-block scans of the message | Low | Med | No core needed |

---

## 3. Recommendations

### R1 — Parallelize independent read-only tool calls (High value / Low effort)

> **STATUS: SHIPPED (Primary route, 2026-07-20).** The T8 policy provider was
> already wired (`openswanSessionRuntime.ts:~1088`) and
> `parallelToolConcurrency` is now raised `1 → 4`
> (`openswanSessionRuntime.ts:~980`). Groups still run sequentially in emitted
> order; concurrency applies only within a parallel-safe group.
> `delegationGate.ts` and `swanbotV2BatchRuntime.ts` intentionally remain
> pinned at 1. Rollback: one-line revert of the concurrency value.

**Problem.** When a model round emits a burst of pure reads with no ordering
dependency (`context.search` + `codebase.search` + `tasks.list` +
`desktop.read_a11y_tree`), each waits on the previous one's network round-trip.
`runTypedCoreToolLoop` pins concurrency to 1.

**Evidence.**
- Pin (now flipped): `openswanSessionRuntime.ts:~980` (`parallelToolConcurrency`,
  formerly `1`, now `4`).
- Seam (now wired): `openswanSessionRuntime.ts:~1088`
  (`toolParallelPolicyProvider: createOpenSwanToolParallelPolicyProvider(...)`).
- The executor honors concurrency only when > 1: `runWithConcurrency`
  short-circuits to a serial loop at `agentExecutionCore.ts:563` (`if (concurrency <= 1)`).
- The safe partition dispatch path is **already implemented** in
  `agentExecutionCore.ts:972-989` (`partitionParallelSafeBatch` → ordered
  reassembly, `hasApprovalGate` respected, unknown tools fail closed to
  singletons).

**Two ways to wire it — pick ONE:**

- **Primary (recommended, lowest effort, most capable): flip the existing T8 path.**
  Everything is built. In the `runAgent` call:
  1. set `toolParallelPolicyProvider: createOpenSwanToolParallelPolicyProvider({ activePluginIds: args.activePluginIds })`
     (already exported at `openswanBridge.ts:210`, wraps
     `getOpenSwanToolParallelPolicy` at `openswanToolRuntime.ts:4666`, which
     carries the coarse write/read domain map `TOOL_DEPENDENCY_DOMAINS`
     `openswanToolRuntime.ts:4495`), and
  2. raise `parallelToolConcurrency` from `1` to `4` (the `runAgent` default;
     `agentExecutionCore.ts:592`).
  **Both changes are required together** — raising concurrency without a
  partitioner would parallelize the *whole* round indiscriminately (unsafe for
  mutations/approvals); wiring the provider while concurrency stays 1 still runs
  serially (`runWithConcurrency` at `:563`). This path also parallelizes
  *disjoint-domain writes*, not just reads.

- **Alternative (simpler, conservative, but needs a new seam): `openswanParallelToolCore`.**
  `partitionOpenSwanToolCalls` (`openswanParallelToolCore.ts:306`) coalesces only
  consecutive **read-only + auto** calls (keyed off tool policy via an injected
  `policyOf`), failing closed on anything mutating/approval-gated/unknown. It is
  correct and smoke-pinned, **but it is partially redundant** with the T8 path
  above: `getOpenSwanToolParallelPolicy` already classifies read-only+auto tools
  as parallel-safe, so the existing provider achieves the same read coalescing
  **plus** safe write parallelism. `partitionOpenSwanToolCalls` also does not fit
  `runAgent`'s current seam (which is a *per-tool policy* function, not a
  *whole-round partition* function), so wiring it means adding a new `runAgent`
  input or a bespoke dispatch loop. Its genuine niche is any dispatcher that does
  **not** go through `runAgent`'s policy-provider seam (e.g. a future non-core
  loop). For the OpenSwan session path, prefer the Primary route and keep this
  core on the shelf.

**Risk / mitigation.** Ordering + approval safety is handled by
`partitionParallelSafeBatch` (`hasApprovalGate`, unknown → sequential barrier,
original-order reassembly). The image side-channel, stuck-loop ring, and
`onRoundComplete` all operate on the reassembled in-order result blocks, so they
are unaffected. Ship behind the same manual-revert discipline as the other O1
flips.

**Validation.** `npm run smoke:openswan-parallel-tool`,
`npm run smoke:agent-core`, `npm run smoke:agent-runtime`.

---

### R2 — Move pre-loop telemetry writes off the critical path (High value / Low–Med effort)

**Problem.** Before the first model token, `runOpenSwanSessionTurn` performs
roughly **eleven awaited Supabase round-trips** that are pure audit/transcript
telemetry, executed serially. They gate time-to-first-token even though nothing
in the model call depends on them.

**Evidence (all `await`ed inline, `openswanSessionRuntime.ts`):**
- `upsertOpenSwanTranscriptHeader` `:1295`
- `appendTranscriptEvent` ×2 (`session_started`, `user_turn`) `:1306`, `:1328`
- `updateRunStatus` `:1338` + `mergeRunMetadata` `:1339` + `addStep` `:1344`
- `appendTranscriptEvent` (`context_loaded`) `:1373`
- `addStep` ×2 `:1390`, `:1398` + `updateRunStatus` `:1419`
- `appendTranscriptEvent` (`memory_loaded`) `:1593` + `mergeRunMetadata`
  (posture) `:1613`

Only `createRun` (`:1226`, returns `run.id`), `buildOpenSwanMemoryStores`
(`:1579`, feeds the prompt) and `buildStreamableSystemPrompt` (`:1693`) are truly
on the critical path. The rest is observability.

**Fix.** Convert the pre-loop transcript/ledger writes to fire-and-forget
(`void ...().catch(() => {})`, the pattern already used for
`persistAgentRunLedgerPreview` at `:1278` and `persistRuntimeToolActions` at
`:1985`), or batch the independent ones with `Promise.all`. Keep write **ordering**
where a later write reads an earlier row's id; transcript appends already return a
fresh header, so sequence only what truly depends. `mergeRunMetadata` is a JSON
merge (safe to coalesce), whereas `updateRunStatus` `metadata` is a whole-column
replace (already noted at `:2130`) — do not reorder those two.

**Risk / mitigation.** Telemetry-only; the transcript may land microseconds later
but content is unchanged. Preserve the documented merge-vs-replace ordering.

**Validation.** `npm run smoke:agent-runtime`; manual: confirm run ledger +
transcript still populate for a session turn.

---

### R3 — Wire context compaction into the round loop (Med–High value)

**Problem.** `runAgent` re-sends the whole `messages[]` on every round
(`agentExecutionCore.ts:706`). A long build/execute/debug session appends an
assistant `tool_use` turn + a bulky user `tool_result` turn each round; after a
handful of rounds most of the request is stale `tool_result` bytes — rising input
tokens, rising cost, and eventual context-limit 400s. The OpenSwan path passes
**no** `compaction` option (`openswanSessionRuntime.ts:869`). Today only two
partial mitigations run: `pruneStaleToolResultImages` (images only,
`agentExecutionCore.ts:704`) and P6 per-result clamping
(`toolResultSummarization`, `agentExecutionCore.ts:609-613`) — the latter clamps a
*single oversized* result but never the *cumulative history*.

**Evidence.** `runAgent` call omits `compaction` (`openswanSessionRuntime.ts:869`);
the seam exists and is unused (`agentExecutionCore.ts:317-325` option shape,
`:679-697` apply site). `grep` confirms zero `compaction:` call sites.

**Two ways to wire it — pick ONE:**

- **Option A (lowest effort): use `runAgent`'s existing `compaction` seam.**
  Pass `compaction: { summariser, maxContextTokens, preserveLast }` to the
  `runAgent` call. `compressContextIfOversized`
  (`agentContextCompression.ts`) already preserves the tail and never splits a
  tool_use/tool_result pair (`expandCutForToolPairs`). Cost: the `summariser`
  is an **extra cheap-model round-trip** (wrap Haiku via the same `swanbot-ai`
  transport) when the threshold trips. Simple, pairing-safe, model-summarised.

- **Option B (more token-efficient, uses this session's core):
  `openswanContextCompactionCore`.**
  `planContextCompaction` (`openswanContextCompactionCore.ts:215`) +
  `projectMessagesForCompaction` (`:400`) decide **keep / summarize / drop**
  index sets from a cheap running token estimate — **no model call for the drop
  path** (stale `tool_result` → dropped like `clear_tool_uses`; narrative →
  summarised). Natural apply seam: inside the `provider.turn` wrapper
  (`openswanSessionRuntime.ts:797-824`), transform `messages` before
  `invokeSwanbotToolTurn`. **Effort is Medium** because the *applier* — which the
  core deliberately does not own (see its header) — must preserve
  tool_use↔tool_result pairing when it drops a result whose `tool_use` stays
  (an orphaned `tool_use` 400s the request). The core provides one structural
  guard (never lets the kept suffix start with a `tool_result`) and expects the
  caller, which holds the real ids, to own the rest — mirror
  `agentContextCompression.expandCutForToolPairs`. Feed `referencedToolUseIds`
  for any result the caller intends to keep.

**Recommendation.** Ship **Option A first** (fast, safe, immediately caps runaway
cost), then migrate to **Option B** to remove the summariser round-trip on the
drop-heavy majority of long runs. Set `contextWindowTokens` from the resolved
loop model, not the default 200k, so the trigger matches the real window.

**Risk / mitigation.** Pairing bugs orphan tool blocks → hard 400. Both options
must be smoke-covered for pair integrity before default-on; keep a manual revert
flag consistent with the O1/P25 cutover levers.

**Validation.** `npm run smoke:openswan-context-compaction`,
`npm run smoke:agent-core`; add a loop-integration assertion that a compacted
round still forwards well-formed tool_use/tool_result pairs.

---

### R4 — Memoize tool-catalog assembly + cache the disclosure re-shape (Low–Med value / Low effort)

**Problem.** `listOpenSwanAnthropicToolsForSurface`
(`openswanToolRuntime.ts:5381`) walks all ~157 `TOOL_DEFINITIONS` through four
`.filter`s + `attachToolInputExamples` on **every** call. It runs once per turn
for the pinned core, and again **every round** via `resolveAdditionalTools`
(`openswanBridge.ts:188-197`) which re-shapes the model's unlocked tools through
`getOpenSwanToolsForSurface` on each turn start (`agentExecutionCore.ts:665-673`).

**Evidence.** Per-turn walk: `openswanToolRuntime.ts:5388-5391`. Per-round
re-shape: `openswanBridge.ts:192`. Note the heavy part — example validation — is
**already memoized** (`toolInputExamples.ts` `validatedExamplesMemo` WeakMap at
the `attachToolInputExamples` body), so the residual cost is the array
filter/`map`/object-spread allocation, not validation.

**Fix.**
- Cache `listOpenSwanAnthropicToolsForSurface` output keyed on
  `(surface, mode, sorted allowlist)` — the inputs are pure and
  `TOOL_DEFINITIONS` is a module const, so a module-level `Map` keyed on that
  tuple is safe. (Handlers close over `ctx`, so cache the *catalog shape* in
  `listOpenSwanAnthropicToolsForSurface`, not the bound `AgentToolDefinition`s in
  the bridge.)
- In `getProgressiveOpenSwanTools`, memoize `resolveAdditionalTools` on
  `unlocked.size` — the set only grows, so re-shape only when it changes instead
  of every turn.

**Risk / mitigation.** Low; pure derivation. Ensure the cache key includes
`mode` (mode filtering at `:5396-5400`) so a mode switch never serves stale
tools.

**Validation.** `npm run smoke:agent-runtime` (tool-catalog + progressive
disclosure coverage).

---

### R5 — Index `TOOL_DEFINITIONS` by name (Low value / Low effort)

**Problem.** `getOpenSwanToolDisclosure` (`openswanToolRuntime.ts:5206`) does a
linear `TOOL_DEFINITIONS.find` per call. `listPinnedOpenSwanToolsForSurface`
(`:5216-5220`) calls it inside a `.filter` over all definitions → O(n²) for
pinned-core assembly.

**Fix.** Build a module-level `Map<name, OpenSwanToolDefinition>` once and use it
in `getOpenSwanToolDisclosure` (`:5206`) and `buildOpenSwanToolBrief`
(`:5465` already builds a local map each call — fold into the shared one).

**Risk / mitigation.** None; pure lookup swap. Low value (runs once per turn) but
near-zero effort, so bundle it with R4.

---

### R6 — Consolidate per-turn prompt-block scans (Low value / Med effort)

**Problem.** `runOpenSwanSessionTurn` builds ~15 prompt blocks
(`openswanSessionRuntime.ts:1118-1150`), each an independent keyword/regex scan of
the same `cleanMessage`. Also several modules are dynamically imported more than
once per turn (`serviceProfileSouls` at `:1155` and `:1196`;
`codingModelSplitPolicy` at `:1173` and again inside the loop at `:786`) — cached
by the module system after first import, so minor.

**Fix.** Only if profiling shows it matters: pass a single tokenized view of the
message to the block builders, or lazily skip builders whose family clearly
doesn't apply. Lowest priority — this is once-per-turn CPU dwarfed by the network
cadence, and the builders are owner modules that must stay independently correct.

**Risk / mitigation.** Medium effort, cross-cuts many owner modules; defer unless
a profile flags it.

---

## 4. Suggested sequencing

1. **R1 (T8 flip) — SHIPPED 2026-07-20** + R2 (telemetry off critical path) —
   biggest latency wins, both Low effort, both use already-built machinery. Ship
   behind revert discipline.
2. **R3 Option A** — cap runaway context cost fast with the existing seam.
3. **R4 + R5** — cheap CPU/alloc cleanup, bundle in one PR.
4. **R3 Option B** — migrate compaction onto `openswanContextCompactionCore` to
   drop the summariser round-trip; requires the pairing-safe applier + integration
   smoke.
5. **R6** — only if a profile justifies it.

## 5. Core status summary (this session's builds)

- **`openswanParallelToolCore`** (`partitionOpenSwanToolCalls`) — built +
  smoke-pinned, **unwired**. For the `runAgent`-based session path it is
  **redundant** with the already-integrated `toolParallelPolicyProvider` +
  `createOpenSwanToolParallelPolicyProvider` route (R1 Primary), which is both
  lower-effort and more capable. Keep for non-`runAgent` dispatchers.
- **`openswanContextCompactionCore`** (`planContextCompaction` /
  `projectMessagesForCompaction`) — built + smoke-pinned, **unwired**. It is the
  right long-term target for R3 (token-efficient, no summariser round-trip) but
  needs a pairing-safe applier in `provider.turn`; ship R3 Option A first.

## 6. Non-goals

- Do **not** raise `parallelToolConcurrency` without a partitioner (unsafe round
  reordering).
- Do **not** compact history without pairing-integrity coverage (orphaned
  tool_use → hard 400).
- Do **not** add a second parallelism stack when the T8 path is already
  integrated — extend the owner, per `CLAUDE.md`.
</content>
</invoke>
