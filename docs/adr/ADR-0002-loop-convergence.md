# ADR-0002 — Loop Convergence (repoint the v2 batch lane at `runAgent`)

- **Status:** Proposed
- **Date:** 2026-07-15
- **Deciders:** Chat/agent runtime owners
- **Supersedes:** nothing (extends ADR-0001's decision #2 into an executable design)
- **Related:** [`ADR-0001-chat-transport-and-tool-loops.md`](./ADR-0001-chat-transport-and-tool-loops.md)
  (the transport-vs-loop boundary this ADR executes);
  [`docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md`](../CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md)
  **CONSOLIDATE #1**; [`docs/SWANBOT_V2_MIGRATION_PLAN.md`](../SWANBOT_V2_MIGRATION_PLAN.md) (M5).

---

## 1. Context

ADR-0001 established the target: **one typed loop shape** (`agentExecutionCore`'s
`AgentToolDefinition` / `AgentProvider` / `AgentEvent` contract) is canonical, the
other two loops converge onto it, and transports stay dumb. This ADR is the
concrete design for the first convergence — **CONSOLIDATE #1: repoint the `batch`
lane's `callSwanBotV2` at `agentExecutionCore.runAgent`** so the `swanbot-v2-ai`
server loop and the M2 client-tool continuation protocol become deletable.

### The three loops today (recap, grep-anchored)

1. **`agentExecutionCore.runAgent`** — the typed, provider-injected, in-app loop
   (`src/lib/agentExecutionCore.ts:586`). `AgentToolDefinition`
   (`agentExecutionCore.ts:67`-`82`), `AgentProvider` (`:189`-`201`), the
   typed `AgentEvent` union (`:203`-`237`), `signal`-based abort with an honest
   `aborted` result flag (`:655`, `:1110`-`1122`, result shape `:358`). It carries
   the nine reliability layers the older loops lack (ADR-0001 §1).
2. **`swanbot-v2-ai` `runLoop`** — the same cycle re-implemented **server-side**
   (`supabase/functions/swanbot-v2-ai/index.ts:2555`; `MAX_ITERATIONS = 5` at
   `:2307`) with a typed `ToolDef` catalog (`:75`-`93`), inline handlers, and the
   **M2 continuation protocol** for `clientOnly` tools it cannot run on Supabase.
3. **`executeToolUseLoop` + `BLACKSWAN_TOOLS`** — the v1 legacy loop
   (`src/lib/swanbot.ts:4054`). Frozen; retire per migration M5. Out of scope here.

### Why the v2 server loop exists — and why that reason is now gone

The v2 edge loop was built so tools could be registered as one typed object
literal instead of hand-porting a v1 dispatcher (`SWANBOT_V2_MIGRATION_PLAN.md:5`).
But an edge function **cannot reach `localhost:7778`** (the desktop/browser
bridge), so every `desktop.*` / `browser.*` / coding / workspace tool is marked
`clientOnly: true` (`swanbot-v2-ai/index.ts:92`, `:1516`, `:1971`, `:2089`) and
the loop has to **pause and round-trip through the client**: when `runLoop` hits a
`clientOnly` use it persists a `RunContinuation` snapshot into
`agent_runs.metadata.continuation` (`:2715`-`:2731`), returns
`{ pending: true, clientToolCalls, continuationRunId }` (`:2732`-`:2739`,
`:2977`-`:2987`), and the client executes the tools and POSTs results back
(`swanbot.ts` `callSwanBotV2` continuation loop `:1057`-`:1085`; the resume branch
of the HTTP handler `:2860`-`:2904`).

**The enabling fact for convergence:** the client already has working handlers
for *both* halves of the v2 catalog. The Supabase-backed "server-side" v2 tools
(`tasks.create`, `save_memory`, `rooms.create`, `missions.create_task`,
`tasks.list`, `approvals.request`, …) all exist as first-class client handlers in
the canonical runtime `openswanToolRuntime.ts`
(`executeOpenSwanRuntimeTool`, `:6143`; e.g. `tasks.create` at `:1372`,
`save_memory`/`rooms.create`/`approvals.request` in the same catalog). The v2
edge's inline versions are a **parallel re-implementation** forced by the RN
import boundary ("Handlers reimplemented inline against the edge-side Supabase
client — can't import from `src/`", `SWANBOT_V2_MIGRATION_PLAN.md:141`). So when
the whole loop runs client-side, **every** tool — Supabase-backed or bridge-backed
— runs in one process. There is nothing left for a continuation protocol to
bridge: the entire M2 round-trip exists **only** to work around the edge's
inability to reach the bridge, and that constraint disappears the moment the loop
is client-side.

### The reference implementation already ships

We do not have to invent the client-side batch loop — an equivalent already runs
in production for the `openswan_v2` / `stream` surfaces.
`runTypedCoreToolLoop` (`src/lib/openswanSessionRuntime.ts:542`) is exactly the
shape `callSwanBotV2` should take:

- **tools** from the shared catalog — `getOpenSwanToolsForSurface` /
  `getProgressiveOpenSwanTools` (`src/lib/openswanBridge.ts:51`, `:134`), wrapped
  with the legacy metadata side channel (`openswanSessionRuntime.ts:671`-`692`);
- **provider** = an `AgentProvider` whose `.turn()` calls the **`swanbot-ai`
  relay** — `buildSwanbotToolTurnBody` → `supabase.functions.invoke('swanbot-ai')`
  → `parseSwanbotToolTurnData` (`openswanSessionRuntime.ts:797`-`824`, invoke at
  `:742`; adapters at `openswanSessionRuntimeAdapters.ts:508`, `:538`, `:490`);
- **approval gate** via `createLegacyApprovalGateAdapter`
  (`openswanSessionRuntimeAdapters.ts:127`);
- **telemetry** via the `onEvent` sink into `agent_runs` / `agent_run_events`
  (`openswanSessionRuntime.ts:901`+);
- **`runAgent`** with `signal`, `steering`, `onRoundComplete`
  (`openswanSessionRuntime.ts:869`-`901`).

The `batch` lane (`callSwanBotV2`, `swanbot.ts:1019`, reached via
`getSwanBotResponse` → Tier 2 `callSwanBotAI` → v2 attempt, `swanbot.ts:3706`,
`:3734`, `:2320`-`:2353`) is the **only** loop-bearing chat path still calling a
server loop. `laneTaxonomyCore` already predicts this collapse: it resolves
transport `v2` to `agent_core` for the `openswan_v2` surface but `edge_v2` for
`batch` (`src/lib/laneTaxonomyCore.ts:183`-`195`, ambiguity note `:41`-`48`) — the
convergence erases that split.

### One thing that is genuinely different from `swanbot-ai`

`swanbot-ai` survives ADR-0001's M5 because it has a **relay role** underpinning
11 call sites. **`swanbot-v2-ai` has no relay role** — it is *only* a tool loop
plus a telemetry writer. So unlike `swanbot-ai`, once (a) the loop is client-side
and (b) the readiness telemetry it writes is reproduced client-side, the **entire
`swanbot-v2-ai` edge function is deletable**, not just a branch of it. That makes
the telemetry-parity requirement (below) the true gate, not the loop swap.

---

## 2. Decision

**Repoint `callSwanBotV2` at a thin client-side runtime that drives
`agentExecutionCore.runAgent`, using the `swanbot-ai` relay as its provider
transport and the `openswanToolRuntime` catalog as its tools** — i.e. give the
`batch` lane the same engine `runTypedCoreToolLoop` already gives `openswan_v2`.

1. **The loop is `runAgent`, client-side.** All tools (Supabase-backed and
   bridge-backed) dispatch in-process through the canonical catalog. The batch
   lane inherits all nine reliability layers plus `signal` cancellation for free.
2. **The transport is the `swanbot-ai` relay** (one model turn: Anthropic
   passthrough / marketplace translation / tool-less — ADR-0001 §"The one relay").
   No new edge is required. `chat-stream` (SSE) remains the streaming transport.
3. **The M2 continuation protocol is deleted, not ported.** With the loop
   in-process there is no pause/resume boundary: no `RunContinuation`, no
   `pending`/`clientToolCalls` HTTP shape, no `continuationRunId`, no 6-round cap,
   no stale-resume handling.
4. **Telemetry moves client-side and preserves the M4 readiness cohort.** The
   client run writes `agent_runs` with `metadata.version = 'swanbot-v2-ai'` and
   `surface = 'main_chat'`, and a **normalized** `final_stop_reason`, so
   `swanbotOpenSwanReadiness` keeps counting these turns unchanged
   (`src/lib/swanbotOpenSwanReadiness.ts:358`-`365`, `:282`, `:297`). This is the
   real gate (§6).
5. **`swanbot-v2-ai/index.ts` is retired in full** once #4 is proven durable —
   it has no relay leg to strand.

**End state for the `batch` lane:** `{surface:'batch', transport:'v1'|'stream',
loop:'agent_core'}` — one loop, the shared catalog, the shared relay, and the
`edge_v2` `LaneLoop` value retired (`laneTaxonomyCore.ts:79`).

---

## 3. The adapter/shim needed

The repoint is mostly **composition of code that already exists** (the exported
adapters `runTypedCoreToolLoop` uses). Three small **pure cores** close the gaps
that are specific to the batch lane, and one **thin runtime** wires them to
`runAgent`. All three cores are tsx-loadable / smoke-testable (`import type`
only), per the repo's "smoke tests need pure modules" rule.

### Core A — message-shape + model adapter (`src/lib/v2BatchLoopAdapterCore.ts`)

The *message-shape adapter* named in CONSOLIDATE #1. Pure; no Supabase, no
`runAgent`. Mirrors the fresh-start setup currently inside the edge `runLoop`:

- `resolveV2BatchModel(modelKey)` → `{ model }` or `{ bodyError }` — LOCKSTEP
  mirror of `MODEL_MAP` + the fail-closed `model_unsupported_on_v2` decision
  (`swanbot-v2-ai/index.ts:2773`-`2784`, `:2917`-`2920`). See §7 Risk R4 for the
  recommended relaxation once the relay's marketplace path is trusted for tools.
- `buildV2BatchModeContract(mode)` → the mode contract string (mirror
  `MODE_CONTRACT`, `swanbot-v2-ai:111`-`128`).
- `buildV2BatchInitialMessages({ userMessage, conversationMessages, skillsContext?, snapshotContext? })`
  → `AgentMessage[]` — mirror the fresh-start assembly
  (`swanbot-v2-ai:2613`-`2624`), reusing the exported
  `buildSnapshotAwareInitialMessages` shape (`circleSnapshotContextInjection.ts:109`)
  for the volatile-context slot so the frozen system prompt stays cache-hot.
- `mapAgentResultToV2CallResult(runResult)` → `{ text: string | null;
  stopReasonToken?: 'continuation_cap' | 'continuation_failed' }` — collapses an
  `AgentRunResult` to the existing `V2CallResult` contract (`swanbot.ts:1017`).
  The runtime resolves `stopReasonToken` through the already-pure
  `resolveChatStopMessage` (`swanbot.ts:1097`-`1099`) so stop copy is unchanged.
- Smoke: `smoke:v2-batch-loop-adapter`.

### Core B — terminal-telemetry parity (`src/lib/v2TerminalTelemetryCore.ts`)

The core that keeps the **M4 readiness gate honest** after the edge stops writing
rows. This is the load-bearing shim (see §6), not a nicety.

- `classifyV2FinalStopReason({ hitMaxIterations, aborted, stopReason, hadError })`
  → `'end_turn' | 'max_tokens' | 'error'` — LOCKSTEP mirror of
  `classifySwanBotV2FinalStopReason` (`swanbot-v2-ai:2365`-`2383`) **minus
  `client_pending`** (no pause exists client-side). `aborted` → `error` (an
  aborted turn is not a clean completion).
- `v2BatchTerminalRunFields(result, usage)` → `{ final_stop_reason, status,
  input_tokens, output_tokens, cached_tokens }` with `status === 'completed'`
  **only** for `end_turn` (parity `swanbot-v2-ai:2995`) and token fields mirroring
  `agentRunTokenUsageFields` (`swanbot-v2-ai:2402`-`2412`).
- `V2_BATCH_RUN_METADATA = { version: 'swanbot-v2-ai' }` and
  `V2_BATCH_RUN_SURFACE = 'main_chat'` constants — the exact keys
  `swanbotOpenSwanReadiness.ts:364`-`365` filters on.
- Rationale: `agentRunPersistence.finalize` today writes the **raw** stop reason
  (`agentRunPersistence.ts:254`: `result.stopReason || lastStopReason`) and does
  **not** set `metadata.version`. That raw vocabulary (`tool_use` / `end_turn` /
  `max_tokens` / `stop_sequence`) is **not** what the readiness gate expects
  (`swanbot-v2-ai` normalizes to `end_turn`/`max_tokens`/`error`, and only
  `end_turn` counts as `completed`). Without this core, a client-run batch turn
  would either miss the cohort (no `version` tag) or pollute the completion-rate
  math (raw reasons). Smoke: `smoke:v2-terminal-telemetry`.

### Core C — event→activity streaming translation (`src/lib/v2AgentEventActivityCore.ts`)

The *streaming translation* named in CONSOLIDATE #1. Today `callSwanBotV2` is a
blocking batch invoke with no progress surface; `runAgent` emits a live
`AgentEvent` stream. Pure mapper `AgentEvent → { activityLabel?: string }` reusing
the existing `toolActivityLabel` copy (`swanbot.ts`, used by the current
`executeClientToolCalls` progress emitter `:1258`-`:1260`) so the batch lane shows
"Reading the screen…" / "Running tests…" instead of a static spinner. Note: the
relay provider is **per-turn non-streaming** (`supabase.functions.invoke` does not
stream, `SWANBOT_V2_MIGRATION_PLAN.md:56`), so `model_delta` will not fire from
the relay — this core maps the tool/round boundary events, which do. Smoke:
`smoke:v2-agent-event-activity`. *(Optional / lowest priority — the loop swap is
correct without it; it is the UX parity piece.)*

### The thin runtime (`src/lib/swanbotV2BatchRuntime.ts`)

**Not a new engine** — it composes existing exports, mirroring
`runTypedCoreToolLoop` without duplicating its body:

```
tools     = getProgressiveOpenSwanTools / getOpenSwanToolsForSurface('main_chat', ctx, {mode})
provider  = { turn: () => parseSwanbotToolTurnData(invoke('swanbot-ai', buildSwanbotToolTurnBody(...))) }
gate      = createLegacyApprovalGateAdapter(chatApprovalGate)   // + constraint guard (QW1)
telemetry = createPersistedRun({ surface: V2_BATCH_RUN_SURFACE, metadata: V2_BATCH_RUN_METADATA, ... })
result    = runAgent({ tools, provider, onEvent, signal, steering, toolApprovalGate, toolConstraintGuard, onRoundComplete })
return      mapAgentResultToV2CallResult(result)  // → V2CallResult
```

`callSwanBotV2` in `swanbot.ts` becomes a **thin wrapper** delegating here, behind
a flag (§4). *(Coordination note: `swanbot.ts` is a hot, live-edited file — the
wrapper edit must land as its own small, coordinated commit; the runtime module +
all three cores are net-new files and carry no conflict risk.)*

**Recommended follow-up (not required for CONSOLIDATE #1):** extract the shared
provider-construction + `runAgent` + result-mapping body of `runTypedCoreToolLoop`
into a single `runClientRelayToolLoop(...)` that **both**
`openswanSessionRuntime` and `swanbotV2BatchRuntime` call, so there is literally
one loop-driver. Deferred because it edits a hot file
(`openswanSessionRuntime.ts`); the reuse-via-exports approach above ships the
convergence without that churn.

---

## 4. Migration steps

Telemetry-parity-first, flag-gated, reversible at every step.

1. **Build the three pure cores (A/B/C) + smokes.** No wiring yet; net-new files,
   zero runtime change. Pin each mirror against its edge source line.
2. **Build `swanbotV2BatchRuntime.ts`.** Compose the exports; wire `onEvent` →
   `createPersistedRun` handle with Core B's normalized `finalize` mapping and the
   `version`/`surface` tags. Still unreferenced by chat.
3. **Add a routing flag** (`uc_swanbot_v2_client_loop`, default OFF) alongside the
   existing `isSwanbotV2Enabled` opt-out (`src/lib/swanbotRouting.ts`). When ON,
   `callSwanBotV2` delegates to the runtime; when OFF, it hits the edge as today.
4. **Dogfood behind the flag** and diff telemetry: the client-loop cohort must
   produce the **same** `metadata.version='swanbot-v2-ai'` + `surface='main_chat'`
   + normalized `final_stop_reason` rows the edge produced, so
   `swanbotOpenSwanReadiness` sees no discontinuity (`:358`-`365`).
5. **Flip the flag default ON.** The edge loop is now dead code on the hot path
   but still deployed (instant revert = flip the flag).
6. **Prove durability** (mirror M4's telemetry bar): client-loop `end_turn` rate
   ≥ the edge cohort's over a soak window, no regressions.
7. **Delete** (§5), each deletion its own grep-verified 0-usage commit
   (plan guardrail).

---

## 5. What becomes deletable

Ordered; each line is grep-anchored so a future agent can verify 0-usage first.

**Client (`src/lib/swanbot.ts`) — the whole v2 round-trip client:**
- `callSwanBotV2` continuation loop + cap handling (`:1057`-`:1085`), reduced to
  the thin wrapper.
- `executeClientToolCalls` (`:1184`-`:1274`) and `dispatchOneClientTool`
  (`:1276`-`:1355`) — the parallel client-tool dispatcher. **Caveat (R3):** its
  desktop/browser/coding sub-dispatchers and its *observers* — the a11y-tree cache
  (`:1203`-`:1209`), `chatRecording` step append (`:1213`-`:1224`), and
  `appendAppActionVerificationGate` framing (`:1229`-`:1233`) — must be verified
  present on the catalog handler path before deletion, or ported.
- `invokeSwanbotV2` / `invokeSwanbotV2Once` (`:1138`-`:1179`),
  `swanBotV2ClientToolStopMessage` (`:1097`-`:1099`), types `V2Response`
  (`:1101`-`:1113`) and `V2BodyError` (`:1122`), `extractV2BodyError` (`:1124`).

**Edge (`supabase/functions/swanbot-v2-ai/index.ts`) — eventually the whole file:**
- `runLoop` (`:2555`-`:2769`) incl. the M2 pending path (`:2652`-`:2740`) and
  `executeEdgeToolUse` (`:2502`).
- The continuation machinery: `RunContinuation` (`:2347`-`:2361`),
  `sanitizeContinuationForStorage` (`:2427`), `isContinuationStale` (`:2463`),
  `mergeContinuationToolResults` (`:2481`), `getLastAssistantToolUseIds` (`:2469`),
  and the resume branch of the HTTP handler (`:2798`, `:2860`-`:2904`).
- Once telemetry parity (§6) is durable, the terminal-write + Feed + usage tail
  (`:2942`-`:3128`) and finally the whole `Deno.serve` handler — `swanbot-v2-ai`
  has **no relay role** to preserve (contrast ADR-0001 §2 for `swanbot-ai`).

**Shared continuation cores (both surfaces):**
- `supabase/functions/_shared/swanbot-continuation.ts` (entire file —
  `validateSwanBotResumeToolResults` `:33`, `SwanBotResumeToolResult` `:12`).
- `src/lib/swanbotContinuationBudgetCore.ts` (the shared client/edge cap;
  imported at `swanbot-v2-ai:61` and used at `:2681`) once neither side pauses.
- Their smokes: `smoke:swanbot-v2-continuation`, `smoke:swanbot-v2-delegation`,
  `smoke:swanbot-continuation-budget-core`.

**Taxonomy update (not deletion):** `laneTaxonomyCore.resolveLoop` (`:183`-`195`)
drops the `v2 → batch → edge_v2` branch (`:190`); `batch` now resolves to
`agent_core`, and `edge_v2` is removed from `LaneLoop` (`:79`) / `LANE_LOOPS`
(`:115`) once the edge is gone. Executable as a pure-core edit under
`smoke:lane-taxonomy`.

---

## 6. The real gate: telemetry parity (not the loop swap)

The M4 default-flip decision is derived from **real `agent_runs` telemetry**, not
a checklist: `swanbotOpenSwanReadiness` loads both cohorts by
`metadata->>version` + `surface='main_chat'` and compares normalized
`final_stop_reason` completion rates (`src/lib/swanbotOpenSwanReadiness.ts:358`-
`365`, `:282`, `:297`; `SWANBOT_V2_MIGRATION_PLAN.md:165`-`168`). Today the edge
writes those rows with normalized reasons and the `version` tag
(`swanbot-v2-ai:2936`, `:3000`-`:3006`).

When the loop moves client-side, `agentRunPersistence` becomes the writer — and it
currently writes the **raw** stop reason and **no** `version`
(`agentRunPersistence.ts:254`, `:96`). **Core B exists precisely to close that
gap.** Convergence is not "done" when the loop swaps; it is done when a client-run
batch turn is **indistinguishable in `agent_runs`** from the edge-run turn it
replaced. Step 4/6 of §4 are that proof.

---

## 7. Risks and mitigations

- **R1 — Trust/capability model shift (service-role → RLS).** Edge handlers run
  under the service-role client with explicit `circle_id` scoping
  (`SWANBOT_V2_MIGRATION_PLAN.md:142`); client handlers run under the user JWT with
  RLS. Net *safer*, but any tool that relied on service-role bypass must be
  re-validated under RLS. *Mitigation:* the `openswan_v2` surface already runs the
  full catalog client-side via `runTypedCoreToolLoop` in production — this is a
  proven posture, not a new one.
- **R2 — Readiness cohort discontinuity.** Covered by Core B + §6; called out
  separately because it is the failure mode most likely to be missed (the loop
  will *work* while telemetry silently drifts). *Mitigation:* Step 4 diffs the
  cohorts before the default flip.
- **R3 — Client-tool observer parity.** `executeClientToolCalls` carries the
  a11y-cache, chat-recording, and verification-gate observers
  (`swanbot.ts:1203`-`:1233`). *Mitigation:* verify each is present on the catalog
  handler path (they are wired in `runTypedCoreToolLoop`'s wrapper,
  `openswanSessionRuntime.ts:671`-`692`) or port before deleting §5's client block.
- **R4 — Model-support surface change.** The edge is Anthropic-only and *rejects*
  non-Anthropic models (`model_unsupported_on_v2`, `swanbot-v2-ai:2917`-`2920`);
  the relay provider translates marketplace/BYOK. Repointing could silently *widen*
  batch-lane model support. *Mitigation:* Core A's `resolveV2BatchModel` keeps the
  fail-closed behavior initially (byte-identical batch semantics); relaxing it to
  use the relay's marketplace path is a **separate, later** decision once non-
  Anthropic tool-use fidelity through the relay (a pre-existing Tier-1.5 concern)
  is trusted.
- **R5 — Latency shape.** The edge ran ≤5 server iterations in one HTTP call; the
  client loop makes one relay round-trip per turn (same as `openswan_v2` today).
  For pure-server-tool turns this adds client↔relay hops. *Mitigation:* accepted —
  it is the existing `openswan_v2` cost, and it buys the nine reliability layers +
  cancellation; parallel dispatch (`agentExecutionCore.ts:972`-`989`) offsets
  multi-tool rounds.
- **R6 — Hot-file coordination.** `swanbot.ts` is live-edited. *Mitigation:* all
  new logic lands in net-new files; the only `swanbot.ts` edit is the thin
  `callSwanBotV2` delegation, shipped as its own coordinated commit behind the
  flag.

---

## 8. Rollback

- **Before default flip:** `uc_swanbot_v2_client_loop = OFF` (per-device) →
  `callSwanBotV2` hits the edge exactly as today. No deploy.
- **After default flip, before deletion:** flip the flag default back — the edge
  function is still deployed (Steps 5-7 keep it live as the revert target).
- **After deletion:** standard git revert of the deletion commits; the edge
  function and continuation cores are recoverable from history. This is why §5
  deletions are **last** and each is its own commit.
- The existing v1 safety nets remain untouched throughout: `callSwanBotAI` still
  falls through to the v1 relay on any failure (`swanbot.ts:2381`) and the session
  circuit breaker still short-circuits doomed v2 attempts
  (`swanbotRouting.ts`, ADR-0001 §"How a turn picks a lane").

---

## 9. Cross-links

- **ADR-0001** — the transport-vs-loop boundary this executes:
  [`ADR-0001-chat-transport-and-tool-loops.md`](./ADR-0001-chat-transport-and-tool-loops.md)
  (decision #2, `:153`-`159`).
- **Strategic plan — CONSOLIDATE #1:**
  [`docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md`](../CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md).
- **Migration plan — M5** (retire the v1 tool loop; the v2 retirement here is the
  parallel, *cleaner* case because there is no relay to strand):
  [`docs/SWANBOT_V2_MIGRATION_PLAN.md`](../SWANBOT_V2_MIGRATION_PLAN.md).
- **Reference implementation:** `runTypedCoreToolLoop`
  (`src/lib/openswanSessionRuntime.ts:542`).
- **Canonical loop contract:** `agentExecutionCore.runAgent`
  (`src/lib/agentExecutionCore.ts:586`).
- **Lane taxonomy:** `src/lib/laneTaxonomyCore.ts`.
