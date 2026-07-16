# Loop Convergence Runbook — CONSOLIDATE #1 (ADR-0002)

> Repoint the `batch` chat lane's `callSwanBotV2` at `agentExecutionCore.runAgent`
> using the committed adapter `src/lib/v2ToAgentCoreAdapterCore.ts`, so the
> `swanbot-v2-ai` edge `runLoop` + the M2 client-tool continuation protocol
> become deletable.
>
> - **Owns:** the executable steps for ADR-0002 (`docs/adr/ADR-0002-loop-convergence.md`).
> - **Status:** ready to build. Every step is flag-gated and reversible.
> - **Last reviewed:** 2026-07-16.

This runbook is grounded in the **real code as it exists today** (read, not
guessed). Every claim carries a `file:line` anchor so a future agent can verify
0-usage / parity before acting.

---

## 0. What already ships vs. what this runbook builds

The message/tool/result **shape adapter is already committed and smoke-covered**:

- `src/lib/v2ToAgentCoreAdapterCore.ts` — pure, tsx-loadable, total. Exports
  `toAgentCoreMessages` (`:229`), `toAgentCoreToolDefs` (`:311`),
  `fromAgentCoreResult` (`:431`), and the stop-reason normalizer
  `normalizeV2StopReason` (`:375`). Smoke: `smoke:v2-to-agentcore-adapter`
  (`package.json:409` → `scripts/v2-to-agentcore-adapter-core-smoketest.ts`).
- `normalizeV2StopReason` is a **LOCKSTEP mirror** of the edge's
  `classifySwanBotV2FinalStopReason` (`supabase/functions/swanbot-v2-ai/index.ts:2365`-`2383`)
  **minus `client_pending`** (the client loop never pauses), with `aborted → 'error'`
  and `hitMaxIterations → 'max_tokens'` (adapter `:375`-`387`).

So the adapter is **direction-agnostic translation only**. This runbook builds the
**one thin runtime** that composes it with `runAgent`, the `swanbot-ai` relay, and
the canonical tool catalog — mirroring the proven reference implementation
`runTypedCoreToolLoop` (`src/lib/openswanSessionRuntime.ts:542`) without editing it.

### The convergence target, grep-anchored

- **Loop to converge:** `callSwanBotV2` (`src/lib/swanbot.ts:1019`), reached only via
  `getSwanBotResponseImpl` Tier 2 → `callSwanBotAI` (`swanbot.ts:2299`, calls
  `callSwanBotV2` at `:2326`) → `swanbot-v2-ai` edge.
- **Canonical loop:** `runAgent` (`src/lib/agentExecutionCore.ts:586`).
- **Reference impl already in prod for `openswan_v2`:** `runTypedCoreToolLoop`
  (`openswanSessionRuntime.ts:542`), driving `runAgent` at `:869`-`901` over the
  `swanbot-ai` relay provider (`:797`-`824`, invoke `:742`).
- **What disappears:** the M2 continuation round-trip — client half
  (`swanbot.ts:1057`-`1085`), edge pending path (`index.ts:2652`-`2740`), resume
  branch (`index.ts:2860`-`2904`).

---

## 0.5. De-risk requirements (BLOCKING — from the 2026-07-16 pre-build review)

An adversarial review of the adapter + telemetry-parity plan **before** the runtime
was built surfaced four issues the runtime MUST address or it will ship broken
telemetry. Two are already fixed in the committed adapter (commit `ff3ecda`); two are
runtime obligations:

1. **CRITICAL — `started_at` parity.** The readiness/completion-rate telemetry
   (`swanbotOpenSwanReadiness`) filters its windowed queries on `started_at`, so a
   client-loop run created with `started_at = NULL` is INVISIBLE to the gate — the
   v2-client cohort would silently vanish from the completion-rate check (and could
   never fail it, masking a real regression). The runtime MUST set `started_at` at run
   creation (mirror the edge INSERT), e.g. an immediate `updateRunStatus(run.id,
   'running')` right after `createRun`, since `createPersistedRun`/`createRun` accept
   no `started_at`.

2. **HIGH — terminal-write-on-throw + orphan finalizer.** The client loop introduces
   failure modes the server edge never had (the process can die mid-run). Wrap
   `runAgent` + the terminal write in try/catch mirroring the edge: on throw →
   `UPDATE final_stop_reason='error', status='failed', metadata.version='swanbot-v2-ai'`
   (keep the cohort tag) so a crashed run never leaves a row with a NULL/clean stop
   reason the gate miscounts.

3. **HIGH — usage from `turn_end` events (adapter fixed).** `AgentRunResult` carries no
   usage; aggregate a `UsageBreakdown` from `runAgent`'s `onEvent` `turn_end` events via
   `v2AgentEventActivityCore.accumulateUsageFromEvents`, and pass it as
   `fromAgentCoreResult(result, { usage })`. Do NOT trust the adapter's usage field (it
   now defaults to `{}` and is opt-supplied).

4. **MEDIUM — toolCalls offset (adapter fixed).** Pass `fromAgentCoreResult(result, {
   initialMessagesLength: initialMessages.length })` so the reconstructed toolCalls trace
   counts only THIS run's tool_use blocks, not historical ones carried in seeded history.

The adapter's INPUT directions (`toAgentCoreMessages` / `toAgentCoreToolDefs`) were
reviewed as **correct** — the runtime can build on them as-is.

---

## 1. Builder scope (this workflow) — NEW FILES ONLY, inert

The builder in this workflow creates **only net-new files**. They are unreferenced
by chat until Phase 2's coordinated one-line `swanbot.ts` delegation lands, so they
carry **zero conflict risk** on the hot `swanbot.ts` file (ADR R6,
`ADR-0002:361`-`364`).

**New file 1 — `src/lib/swanbotV2ClientLoopFlag.ts`** (the rollout flag).
Mirror the shape of `swanbotRouting.isSwanbotV2Enabled` (`src/lib/swanbotRouting.ts:27`)
but **default OFF** (opt-in, not opt-out):

```ts
const FLAG_KEY = 'uc_swanbot_v2_client_loop';
/** Default OFF: only an explicit stored 'true' routes the batch lane through the
 *  client-side runAgent loop. Absent/unparseable/no-localStorage → edge (today). */
export function isSwanbotV2ClientLoopEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(FLAG_KEY) === 'true';
  } catch { return false; }
}
export function enableSwanbotV2ClientLoop(): boolean { /* setItem 'true' */ }
export function disableSwanbotV2ClientLoop(): boolean { /* setItem 'false' */ }
```

Per-device, instant, no deploy — identical rollback ergonomics to `/v2`
(`swanbotRouting.ts:14`-`16`). Add a `/v2loop` command later if desired (out of
scope for the convergence itself).

**New file 2 — `src/lib/swanbotV2BatchRuntime.ts`** (the thin runtime). Composes
existing exports + the committed adapter; **no new engine**. Section 2 is its exact
body. Add a pure smoke for any *pure* helper it extracts (model gate, terminal-field
builder) per the "smoke tests need pure modules" rule; the runtime module itself is
validated by `npm run typecheck` + the Phase 3 telemetry diff (it imports
`supabase`/`runAgent`, so it is not tsx-loadable).

**Optional New file 3 — `src/lib/v2AgentEventActivityCore.ts`** (ADR Core C,
`ADR-0002:198`-`210`). Pure `AgentEvent → { activityLabel? }` mapper reusing
`toolActivityLabel` (`swanbot.ts:72`, `:1260`). **Lowest priority** — the loop swap
is correct without it; it is the progress-UX parity piece. Defer unless UX parity is
required for the flip.

> **Not in builder scope:** the `swanbot.ts` edit (Phase 2) and the deletions
> (Phase 6). Those are separate, coordinated commits.

---

## 2. The thin runtime — exact composition

`src/lib/swanbotV2BatchRuntime.ts` exports one async function with **the same
`V2CallResult` contract `callSwanBotV2` already returns** (`swanbot.ts:1017`:
`{ text: string | null; bodyError?: V2BodyError }`). Ordered body:

### 2.1 Fail-closed model gate (R4 — preserve byte-identical batch semantics)

The edge is Anthropic-only and **rejects** non-Anthropic models
(`model_unsupported_on_v2`, `index.ts:2917`-`2920`; allowlist `MODEL_MAP`
`index.ts:2773`-`2784`). The `swanbot-ai` relay, by contrast, translates
marketplace/BYOK — so repointing could **silently widen** batch-lane model support.
Keep it closed initially:

```ts
// Mirror index.ts:2917 — MODEL_MAP alias OR an already-qualified claude-* id; else fail closed.
const resolved = resolveV2BatchModel(model);           // { model } | { bodyError }
if ('bodyError' in resolved) return { text: null, bodyError: resolved.bodyError };
```

Return the **same body-error shape** (`{ code: 'model_unsupported_on_v2', message }`)
so `callSwanBotAI`'s breaker classification (`swanbot.ts:2345`-`2352`) and the
readiness cohort stay byte-identical. `resolveV2BatchModel` is a pure helper (smoke
it). Relaxing this to the relay's marketplace path is a **separate later decision**
(ADR R4, `ADR-0002:348`-`354`).

### 2.2 System prompt (client-side; the edge built it server-side)

The edge builds its own system prompt inside `runLoop`
(`buildFrozenBlock` + `MODE_CONTRACT`, `index.ts:2587`). Client-side, the runtime
must supply `systemPrompt` to the relay body (`buildSwanbotToolTurnBody.system_override`,
`openswanSessionRuntimeAdapters.ts:526`). Reuse the chat path's assembly — the same
`buildSystemPromptAsync` the v1/relay tier already calls in `swanbot.ts` — and append
the mode-contract line (mirror `MODE_CONTRACT`, `index.ts:111`-`128`). Keep it a
**frozen/cache-hot** block; put volatile context in the message slot (2.3), matching
the reference impl's cache discipline (`openswanSessionRuntime.ts:870`-`878`, R15/O7).

### 2.3 `initialMessages` — uses `toAgentCoreMessages`

Convert the v2 wire history (`conversationMessages?: Array<{role;content}>`,
`swanbot.ts:1026`) with the committed **`toAgentCoreMessages`** (total/bounded,
`v2ToAgentCoreAdapterCore.ts:229`), then seed the fresh turn the way the edge did
(skills-context message + user message, `index.ts:2618`-`2621`) via
`buildSnapshotAwareInitialMessages` (`circleSnapshotContextInjection.ts:109`) for the
volatile snapshot/grounding slot:

```ts
const history = toAgentCoreMessages(conversationMessages);          // v2 wire → AgentMessage[]
const seed = buildSnapshotAwareInitialMessages({                    // [snapshot?, user]
  userMessage: message,
  snapshotContextMessage,                                           // circle snapshot + BlackSwan grounding
});
const initialMessages = [...history, ...seed];
```

### 2.4 `tools` — uses `toAgentCoreToolDefs`, dispatch IN-PROCESS

All tools (Supabase-backed **and** bridge-backed) dispatch in one process — the
`clientOnly` split (`index.ts:92`, `:1516`, `:1971`, `:2089`) evaporates because the
loop is already client-side (ADR §2.1, `:118`-`122`). Advertise the **same catalog the
edge advertised** and bind handlers from the canonical wrapped catalog, so tool
ADVERTISING is edge-identical **and** the R3 observers ride along for free:

```ts
// Wrapped catalog = shapeLegacyToolHandlerResult handlers (R14 metadata, image side
// channel, a11y-cache/recording/verification observers) — reference-impl parity.
const catalog = getProgressiveOpenSwanTools('main_chat', toolCtx, { mode }).tools
             /* or */ getOpenSwanToolsForSurface('main_chat', toolCtx, { mode });  // openswanBridge.ts:51/:134
const handlerByName = new Map(catalog.map(t => [t.name, t.handler]));

const tools = toAgentCoreToolDefs(                                   // v2ToAgentCoreAdapterCore.ts:311
  catalog.map(({ name, description, input_schema, input_examples, interactive }) =>
    ({ name, description, input_schema, input_examples, interactive })),   // advertise-shape specs
  { resolveHandler: (name) => handlerByName.get(name) },            // bind in-process dispatch by name
);
```

`toAgentCoreToolDefs` **intentionally drops `clientOnly`** (adapter `:306`-`309`) and
its `resolveHandler` seam exists precisely for this bind-by-name (adapter `:266`-`271`).
Binding to the **wrapped** catalog handler (not the raw bridge) is what discharges R3
(§7) — the observers `executeClientToolCalls` carries (`swanbot.ts:1203`-`1233`) are
already present on the catalog path (`openswanSessionRuntime.ts:671`-`692`).

### 2.5 `provider` — the `swanbot-ai` relay (non-streaming), reference-impl shape

One model turn per round via the relay (Anthropic passthrough / marketplace
translation), identical to `runTypedCoreToolLoop`'s provider
(`openswanSessionRuntime.ts:797`-`824`):

```ts
const provider: AgentProvider = { turn: async ({ messages, tools }) => {
  const { data, error } = await supabase.functions.invoke('swanbot-ai', {
    headers: { Authorization: `Bearer ${await getFreshAccessToken()}` },
    body: buildSwanbotToolTurnBody({                                 // adapters:508
      userMessage: message, circleId, userId, model: loopModel, systemPrompt,
      tools: toAnthropicToolShapes(tools),                          // adapters:490 (name/desc/schema/examples)
      messages,
    }),
  });
  if (error || !data) { /* edge-fail parity: end the turn with partial text, do NOT throw
                           — openswanSessionRuntime.ts:808-818 */ }
  return parseSwanbotToolTurnData(data).turn;                       // adapters:538
}};
```

### 2.6 `runAgent` — nine reliability layers + cancellation for free

```ts
const runResult = await runAgent({                                  // agentExecutionCore.ts:586
  initialMessages, tools, provider,
  maxIterations,                                                    // batch budget (edge cap was MAX_ITERATIONS=5, index.ts:2307)
  signal,                                                           // STOP-button cancellation the edge never had
  onEvent: handle.onEvent,                                          // telemetry sink (§3)
  toolApprovalGate: chatApprovalGate                                // createLegacyApprovalGateAdapter, adapters:127
    ? createLegacyApprovalGateAdapter(chatApprovalGate) : undefined,
  toolConstraintGuard,                                              // QW1 constraint/floor guard (optional, parity w/ session path)
  steering, onRoundComplete,                                        // O1 nudge parity (optional)
});
```

### 2.7 Result — uses `fromAgentCoreResult`, map to `V2CallResult`

```ts
const v2 = fromAgentCoreResult(runResult);                         // { text, toolCalls, usage, stopReason } — adapter:431
// stopReason ∈ 'end_turn'|'max_tokens'|'error' (normalized; aborted→error, hitMax→max_tokens)
return { text: v2.text || null };                                  // V2CallResult (swanbot.ts:1017)
```

Stop **copy** for the user is unchanged: the caller already resolves friendly copy
via `resolveChatStopMessage` (`swanbot.ts:1097`-`1099`) — the runtime returns text
only, exactly like the edge's terminal body did (`index.ts:3048`-`3060` → `swanbot.ts:1086`).

### 2.8 Streaming & continuation — how they map

- **Streaming:** `runAgent` emits a live `AgentEvent` stream
  (`agentExecutionCore.ts:203`-`237`). The relay provider is **per-turn
  non-streaming** (`supabase.functions.invoke` does not stream), so `model_delta`
  will **not** fire — but `tool_call_start` / `tool_call_result` / turn-boundary
  events do. Map those to the existing `emitSwanBotActivity` + `toolActivityLabel`
  progress the current path already uses (`swanbot.ts:1258`-`1260`) via optional New
  file 3. Net UX: "Reading the screen…" / "Running tests…" instead of a static
  spinner — a **strict improvement** over today's blocking batch invoke.
- **Continuation:** maps to **nothing** — deleted, not ported (ADR §2.3,
  `:123`-`127`). With the loop in-process there is no pause/resume boundary: no
  `RunContinuation`, no `pending`/`clientToolCalls` HTTP shape, no `continuationRunId`,
  no 6-round cap, no stale-resume handling. `runAgent` dispatches every tool inline
  and re-enters `provider.turn` with the results appended (`agentExecutionCore.ts:1022`,
  loop re-entry `:1097`).

---

## 3. Telemetry parity — THE gate (not the loop swap)

Convergence is **not "done" when the loop swaps**; it is done when a client-run batch
turn is **indistinguishable in `agent_runs`** from the edge-run turn it replaced
(ADR §6, `:310`-`326`). The readiness gate `swanbotOpenSwanReadiness` loads both
cohorts by `metadata->>version` + `surface='main_chat'`
(`src/lib/swanbotOpenSwanReadiness.ts:363`-`365`) and compares normalized
`final_stop_reason` completion rates (`:606`, `:610`).

### Why the default persistence path would silently drift the cohort

If the client loop leaned on `agentRunPersistence.finalize`, the row would be **wrong
in three ways** the loop would still *appear* to work through:

1. **No `version` tag.** `finalize` writes columns only (`agentRunPersistence.ts:249`-`261`)
   and never sets `metadata.version`. The row would **miss the cohort entirely**
   (`getAgentRunVersion` reads `metadata->>version`, readiness `:806`, `:286`-`291`).
2. **Raw stop reason.** `finalize` writes `result.stopReason || lastStopReason`
   (`agentRunPersistence.ts:254`) — the **raw** vocabulary (`tool_use` / `end_turn` /
   `max_tokens` / `stop_sequence`). The readiness `normalizeStopReason`
   **only lowercases** (`:710`-`713`) — it does **not** collapse `stop_sequence`→`end_turn`
   or `tool_use`/hitMax→`max_tokens`. So a clean `stop_sequence` completion and a
   cap-exhausted `tool_use` run would both be counted as **non-`end_turn`**,
   **understating** the completion rate vs. the edge cohort (edge pre-normalizes,
   `index.ts:2373`-`2382`).
3. **Aborted mislabeled.** `finalize` ignores `runResult.aborted`
   (`agentExecutionCore.ts:358`); an aborted run keeps `stopReason:'end_turn'` and would
   be written `status:'completed'` — **inflating** completions. The edge has no abort;
   `normalizeV2StopReason` maps `aborted→'error'` (adapter `:381`).

### The parity mechanism the runtime MUST implement

1. **Create the run with the cohort tags** (createRun passes both through —
   `surface` at `agentRunSystem.ts:165`, `metadata` at `:177`):

   ```ts
   const handle = await createPersistedRun({                        // agentRunPersistence.ts:83
     circleId, userId, surface: 'main_chat', provider: 'anthropic', model, mode,
     title: `v2 ${mode}: ${message.slice(0, 80)}`,                  // edge parity index.ts:2930
     metadata: { version: 'swanbot-v2-ai', targetAgent: targetAgentName },  // readiness filter :364-365
   });
   ```

2. **Stream events** via `handle.onEvent` into `runAgent` (agent_run_events durability).

3. **Write the terminal row EXPLICITLY — do NOT use `finalize`'s raw path.** Mirror the
   edge terminal write byte-for-byte (`index.ts:2990`-`3007`), using the committed
   adapter for the normalized reason:

   ```ts
   const finalStopReason = fromAgentCoreResult(runResult).stopReason;        // 'end_turn'|'max_tokens'|'error'
   const status = finalStopReason === 'end_turn' ? 'completed' : 'failed';   // edge parity index.ts:2995
   await supabase.from('agent_runs').update({
     tool_calls: v2.toolCalls,
     iteration_count: runResult.iterations,
     final_stop_reason: finalStopReason,
     input_tokens, output_tokens, cached_tokens,                             // accumulate via onEvent, edge parity index.ts:2402-2412
     status, completed_at: new Date().toISOString(),
     metadata: { version: 'swanbot-v2-ai', targetAgent: targetAgentName, rawStopReason: runResult.stopReason },
   }).eq('id', handle.run.id);
   ```

   Choose **one** terminal writer (this explicit write) — do not also call
   `finalize`, or the two writes race and the raw one can win.

### The proof (before flipping the default — ADR §4 step 4/6, §6)

Dogfa behind the flag, then diff the cohorts:

- **Same cohort membership:** client-loop rows appear under
  `metadata->>version='swanbot-v2-ai'` + `surface='main_chat'` — no new `ignoredRows`
  (readiness `:282`-`295`).
- **Same vocabulary:** client-loop `v2StopReasons` keys ⊆ `{end_turn, max_tokens, error}`
  (readiness `:322`-`323`) — **no raw `tool_use`/`stop_sequence` leakage**.
- **No completion-rate discontinuity:** client-loop `end_turn` rate **≥** the edge
  cohort's over a soak window (ADR §4 step 6). This is the M4-style bar — real
  telemetry, not a checklist.
- **No completeness regressions:** token fields non-null and non-zero, `tool_calls`
  present, `iteration_count` a positive int (readiness completeness accumulators
  `:304`-`320`).

Only when this holds do you flip the default (Phase 4).

---

## 4. Rollout phases (telemetry-parity-first, reversible at every step)

| Phase | Action | Reversible by |
|---|---|---|
| **1** | Build New files 1–2 (+ optional 3) + pure smokes. Unreferenced by chat. `npm run typecheck` green. | Delete the files (zero call sites). |
| **2** | **Coordinated `swanbot.ts` commit** (its own small commit, hot-file discipline, ADR R6): `callSwanBotV2` becomes a thin wrapper — `if (isSwanbotV2ClientLoopEnabled()) return runSwanbotV2Batch(...); ` else the exact edge path today. Flag **default OFF** ⇒ **no behavior change on merge**. | Flag OFF (per-device, no deploy) or revert the one commit. |
| **3** | Dogfa: flip the flag ON per-device, run §3 telemetry diff until the cohort is proven indistinguishable. | Flag OFF. |
| **4** | Flip the flag **default ON** (edit New file 1's default, or ship an ops default). Edge is now dead code on the hot path but **still deployed**. | Flip default OFF — **instant revert, no deploy**. |
| **5** | Soak: prove durability (client-loop `end_turn` rate ≥ edge cohort, no regressions). | Flag default OFF. |
| **6** | **Delete** (§5) — each deletion its own grep-verified 0-usage commit. | `git revert` the deletion commit(s). |

The existing v1 safety nets stay untouched throughout: `callSwanBotAI` still falls
through to the v1 relay on any failure (`swanbot.ts:2358`, `:2368`), and the session
circuit breaker still short-circuits doomed v2 attempts (`swanbotRouting.ts:107`-`111`).

---

## 5. What becomes deletable AFTER (each = its own grep-verified 0-usage commit)

Ordered; delete **last**, after Phase 5 durability. Anchors are the ADR's (`ADR-0002:266`-`306`).

**Client — `src/lib/swanbot.ts` (the whole v2 round-trip client):**
- `callSwanBotV2` continuation loop + cap handling (`:1057`-`:1085`) — collapsed to the
  thin wrapper.
- `executeClientToolCalls` (`:1184`-`:1274`) + `dispatchOneClientTool` (`:1276`-`:1355`).
  **R3 caveat (verify first):** its observers — a11y-tree cache (`:1203`-`:1209`),
  `chatRecording` step append (`:1213`-`:1224`), `appendAppActionVerificationGate`
  framing (`:1229`-`:1233`) — must be confirmed present on the catalog handler path
  (they are, via `shapeLegacyToolHandlerResult`, `openswanSessionRuntime.ts:671`-`692`)
  **or ported** before deletion.
- `invokeSwanbotV2` / `invokeSwanbotV2Once` (`:1138`-`:1179`),
  `swanBotV2ClientToolStopMessage` (`:1097`-`:1099`), types `V2Response` (`:1101`-`:1113`)
  and `V2BodyError` (`:1122`), `extractV2BodyError` (`:1124`).

**Edge — `supabase/functions/swanbot-v2-ai/index.ts` (eventually the whole file — it
has NO relay role to strand, unlike `swanbot-ai`):**
- `runLoop` (`:2555`-`:2769`) incl. the M2 pending path (`:2652`-`:2740`) and
  `executeEdgeToolUse` (`:2502`).
- Continuation machinery: `RunContinuation` (`:2347`-`:2361`),
  `sanitizeContinuationForStorage` (`:2427`), `isContinuationStale` (`:2463`),
  `mergeContinuationToolResults` (`:2481`), `getLastAssistantToolUseIds` (`:2469`),
  resume branch of the HTTP handler (`:2798`, `:2860`-`:2904`).
- Once §3 parity is durable: the terminal-write + Feed + usage tail (`:2942`-`:3128`)
  and finally the whole `Deno.serve` handler.

**Shared continuation cores (both surfaces):**
- `supabase/functions/_shared/swanbot-continuation.ts` (entire file).
- `src/lib/swanbotContinuationBudgetCore.ts` (imported at `index.ts:61`, used at `:2681`)
  once neither side pauses.
- Their smokes: `smoke:swanbot-v2-continuation`, `smoke:swanbot-v2-delegation`,
  `smoke:swanbot-continuation-budget-core`.

**Taxonomy update (not deletion) — `src/lib/laneTaxonomyCore.ts`, pure-core edit under
`smoke:lane-taxonomy`:**
- `resolveLoop` drops the `v2 → (surface≠openswan_v2) → edge_v2` branch (`:190`); `batch`
  now resolves to `agent_core`.
- Remove `edge_v2` from `LaneLoop` (`:79`) and `LANE_LOOPS` (`:115`) once the edge is gone.

---

## 6. Risks & mitigations

- **R1 — service-role → RLS trust shift.** Edge handlers ran under service-role with
  explicit `circle_id` scoping; client handlers run under the user JWT with RLS. Net
  *safer*, but any tool that relied on service-role bypass must be re-validated.
  *Mitigation:* `openswan_v2` already runs the full catalog client-side via
  `runTypedCoreToolLoop` in production — **proven posture, not new**.
- **R2 — readiness cohort discontinuity (most-likely-missed).** The loop will *work*
  while telemetry silently drifts. *Mitigation:* §3's explicit normalized terminal
  write + the Phase 3 cohort diff **before** the default flip. This is the true gate.
- **R3 — client-tool observer parity.** *Mitigation:* bind `toAgentCoreToolDefs`'s
  `resolveHandler` to the **wrapped** catalog handler (§2.4), which already carries the
  a11y-cache / chat-recording / verification-gate observers; verify present before
  deleting §5's client block.
- **R4 — model-support widening.** The edge rejects non-Anthropic models; the relay
  translates them. *Mitigation:* §2.1's fail-closed `resolveV2BatchModel` keeps
  byte-identical batch semantics; relaxing it is a **separate later decision**.
- **R5 — latency shape.** Edge ran ≤5 server iterations in one HTTP call; the client
  loop makes one relay round-trip per turn (same as `openswan_v2` today). *Mitigation:*
  accepted — it buys the nine reliability layers + cancellation; parallel dispatch
  (`agentExecutionCore.ts:972`-`989`) offsets multi-tool rounds.
- **R6 — hot-file coordination.** `swanbot.ts` is live-edited. *Mitigation:* all new
  logic lands in net-new files (Phase 1, inert); the only `swanbot.ts` edit is the
  Phase-2 thin delegation, its own coordinated commit behind the flag.

---

## 7. Rollback

- **Before default flip:** `uc_swanbot_v2_client_loop = OFF` (per-device) → `callSwanBotV2`
  hits the edge exactly as today. **No deploy.**
- **After default flip, before deletion:** flip the default back — the edge function is
  still deployed (Phases 4–5 keep it live as the revert target).
- **After deletion:** standard `git revert` of the deletion commits; the edge function
  and continuation cores are recoverable from history. This is why §5 deletions are
  **last** and each is its own commit.

---

## 8. Cross-links

- **ADR-0002** (this runbook executes it): `docs/adr/ADR-0002-loop-convergence.md`.
- **Committed adapter:** `src/lib/v2ToAgentCoreAdapterCore.ts` (smoke
  `smoke:v2-to-agentcore-adapter`).
- **Reference impl:** `runTypedCoreToolLoop` (`src/lib/openswanSessionRuntime.ts:542`).
- **Canonical loop:** `runAgent` (`src/lib/agentExecutionCore.ts:586`).
- **Readiness gate:** `src/lib/swanbotOpenSwanReadiness.ts` (cohort filter `:363`-`365`,
  completion rate `:606`, normalizer `:710`).
- **Migration plan / lane taxonomy:** `docs/SWANBOT_V2_MIGRATION_PLAN.md`,
  `src/lib/laneTaxonomyCore.ts`.
