# ADR-0001 — Chat Transport And Tool Loops

- **Status:** Proposed
- **Date:** 2026-07-15
- **Deciders:** Chat/agent runtime owners
- **Supersedes:** the scattered "loops are client-side, edges are stateless
  transports" comments that never lived in one place.
- **Related:** [`docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md`](../CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md)
  (this is that plan's ADD #3, "transport-vs-loop boundary ADR");
  [`docs/SWANBOT_V2_MIGRATION_PLAN.md`](../SWANBOT_V2_MIGRATION_PLAN.md) (M5).

---

## 1. Context

The chat stack is **mid-convergence**. A single chat turn can be served by one of
**three tool-execution loops**, and each of those loops reaches a model through a
**provider transport** that — for two of the three — is the **same `swanbot-ai`
edge function running in its relay role, not its tool-loop role.** These are
different things that share a directory, and conflating them is exactly the
mistake the original migration plan made (it said "delete `swanbot-ai/`", which
would take out a live relay — corrected in
[`SWANBOT_V2_MIGRATION_PLAN.md`](../SWANBOT_V2_MIGRATION_PLAN.md) M5,
`:173`-`:204`).

### The three loops, and why there are three (historical)

A "loop" here is the machine that runs `model → tool_use → dispatch →
tool_result → model` until the model stops. They accreted in three waves:

1. **Wave 1 — the v1 legacy loop.** `executeToolUseLoop`
   (`src/lib/swanbot.ts:4054`) drives the cycle **client-side**, dispatching
   through the `openswanTools` registry and calling a model once per round. Its
   hardcoded tool catalog, `BLACKSWAN_TOOLS`, lives in the edge
   (`supabase/functions/swanbot-ai/index.ts:1431`, attached to the request at
   `:3108`). This is the "hardcoded tools, ~2,800 lines" loop the migration plan
   was written to escape (`SWANBOT_V2_MIGRATION_PLAN.md:5`).

2. **Wave 2 — the v2 typed edge loop.** `runLoop` inside the v2 edge
   (`supabase/functions/swanbot-v2-ai/index.ts:2555`) runs the cycle
   **server-side** with a typed `ToolDef` catalog (`TOOLS`,
   `swanbot-v2-ai/index.ts:258`), real `agent_runs`/`agent_run_events`
   telemetry (`:2936`, `:2629`), and a client-delegation continuation protocol
   for `clientOnly` tools it cannot run on Supabase (`:2652`-`:2660`, snapshot
   in `agent_runs.metadata.continuation` at `:2871`). It exists because adding
   desktop tools to v1 meant hand-porting a dispatcher, whereas v2 registers a
   tool as one object literal (`SWANBOT_V2_MIGRATION_PLAN.md:5`).

3. **Wave 3 — the in-app typed loop.** `agentExecutionCore.runAgent`
   (`src/lib/agentExecutionCore.ts:586`) is the provider-injected, testable
   typed loop (Hermes-inspired; `agentExecutionCore.ts:24`-`31`). It emits a
   typed `AgentEvent` stream (`agentExecutionCore.ts:203`-`237`) and its
   `AgentToolDefinition` shape (`agentExecutionCore.ts:67`-`82`) is the one the
   v2 edge's `ToolDef` was built to match. OpenSwan sessions run **this** loop —
   `runTypedCoreToolLoop` (`src/lib/openswanSessionRuntime.ts:542`) calls
   `runAgent` at `openswanSessionRuntime.ts:869`, and it is the default (the O1
   cutover left the legacy `executeToolUseLoop` reachable only behind a manual
   revert flag: `openswanSessionRuntime.ts:487`-`490`, `:1746`-`:1771`).

`runAgent` carries the reliability layers the older loops lack (grep-anchored):
compaction (`agentExecutionCore.ts:679`-`697`), deterministic per-result
summarization (`:610`-`613`, `:946`-`962`), live-image pruning + base64
hygiene (`:704`, `:915`-`935`), progress-based stuck-loop exit (`:744`-`819`),
cross-round oscillation stop (`:1033`-`1045`), one-shot solver consultation
(`:759`-`796`), hard pre-dispatch constraint/floor guard (`:836`-`869`),
pre-dispatch approval gate (`:871`-`889`), and dependency-aware parallel
dispatch (`:972`-`989`) — plus resumable per-round checkpoints (`:1050`) and
mid-run steering (`:1058`-`1066`).

### The one relay, reached by multiple lanes

Separately from all three loops, `swanbot-ai` has a **relay branch** — the
`hasRelayTools || relayToolsDisabled` path
(`supabase/functions/swanbot-ai/index.ts:3681`-`3684`). It runs **no tool loop**.
It takes one model turn: forward to Anthropic unchanged, translate to a
marketplace/BYOK provider (`swanbot-ai/index.ts:3685`-`3711`, dispatcher at
`:2928`), or run tool-less for a single guarded call
(`tools_disabled` / `tools: []`, `:3667`-`3682`). This relay is **still live**
and is the raw model transport for both client-side loops:

- `runAgent`'s injected provider (`AgentProvider`,
  `agentExecutionCore.ts:189`-`201`) is wired to the relay in the OpenSwan
  session runtime (`openswanSessionRuntime.ts:742`), and the cap-exhaustion
  wrap-up rides the tool-less relay leg (`openswanSessionRuntime.ts:1017`).
- `executeToolUseLoop`'s per-round model call is the relay
  (`swanbot.ts:4277`; finalizer at `:4707`).
- Standalone relay callers: `agentInvocation.ts:151`,
  `computerTaskRuntime.ts:675` (tool-less clarifier),
  `subagentRegistry.ts:468`, `swanbot.ts:2381` (the v1 fall-through),
  `swanbot.ts:2444` (structured), `BlockBriefEditor.tsx:197`.
- **v2 itself falls back to it:** an unsupported model returns
  `model_unsupported_on_v2` and is told to "route via swanbot-ai/llm-proxy"
  (`swanbot-v2-ai/index.ts:2919`).

That is **11 `functions.invoke('swanbot-ai', …)` call sites** across `src/`
(grep-verified). So the headline is not "3 loops" — it is **3 tool loops AND 1
provider relay that coexist**, and the relay is load-bearing under two of the
loops plus the v2 fallback.

### How a turn picks a lane

Main chat enters through `getSwanBotResponse` (`swanbot.ts:3371`, impl `:3386`),
a tiered picker: Tier 1 BlackSwan (`:3547`), Tier 1.5 marketplace tool tier
(`:3583`), Tier 2 `callSwanBotAI` (`:3706`), Tier 3 Gemini via `llm-proxy`
(`:3814`). `callSwanBotAI` (`swanbot.ts:2299`) is itself a router: it checks the
per-device v2 flag (`isSwanbotV2Enabled`, default-on/opt-out,
`src/lib/swanbotRouting.ts:27`) and, unless the session circuit breaker has
tripped (2 consecutive transport failures, `swanbotRouting.ts:72`, `:78`,
`:109`), calls `callSwanBotV2` (`swanbot.ts:1019` → v2 edge at `:1143`),
otherwise falls through to the `swanbot-ai` v1 invoke (`swanbot.ts:2381`). A
`body_error` such as `model_unsupported_on_v2` is deliberately **not** counted
toward the breaker — v2 answered, it is a config error, not a transport blip
(`v2OutcomeCountsTowardBreaker`, `swanbotRouting.ts:103`). Whether v2 is even
declared ready is derived from real `agent_runs` telemetry keyed by
`metadata->>version` + `surface='main_chat'`
(`src/lib/swanbotOpenSwanReadiness.ts:363`-`365`, `:463`), never a manual
checklist.

The four surface lanes (`stream` / `batch` / `openswan_v2` /
`conversational_build`) are orthogonal to which loop runs — a fact the new
`laneTaxonomyCore` (`src/lib/laneTaxonomyCore.ts`) now models explicitly (§4).

---

## 2. The current reality — one row per loop, plus the relay

| Lane | Where it runs | Tool protocol | Telemetry | Superseded? | Notes |
|---|---|---|---|---|---|
| **Loop #1 — `agentExecutionCore.runAgent`** (typed, in-app) | Client / in-app (`agentExecutionCore.ts:586`); hosted by OpenSwan sessions (`openswanSessionRuntime.ts:869`) | Typed `AgentToolDefinition` + injected `AgentProvider` (`agentExecutionCore.ts:67`, `:189`); default 25 iters (`:591`) | Typed `AgentEvent` stream (`agentExecutionCore.ts:203`); DB rows via the session runtime | **No — this is the target.** | Provider is injected → its transport is usually the `swanbot-ai` relay (`openswanSessionRuntime.ts:742`). Carries all 9 reliability layers (§1). |
| **Loop #2 — `swanbot-v2-ai` `runLoop`** (typed, edge) | Edge / server (`swanbot-v2-ai/index.ts:2555`); `MAX_ITERATIONS = 5` (`:2307`) | Typed `ToolDef` catalog (`:258`); `clientOnly` tools pause via M2 continuation (`:2652`, `:2871`) | Real `agent_runs` + `agent_run_events`, `metadata.version='swanbot-v2-ai'`, normalized `final_stop_reason` + `rawStopReason` (`:2629`, `:2936`, `:3006`) | **Converging** — to be repointed at Loop #1 (plan CONSOLIDATE #1). | On an unsupported model returns `model_unsupported_on_v2` → routes back through the relay/`llm-proxy` (`:2919`). |
| **Loop #3 — `executeToolUseLoop` + `BLACKSWAN_TOOLS`** (legacy v1) | Loop driver client-side (`swanbot.ts:4054`); hardcoded catalog edge-side (`swanbot-ai/index.ts:1431`, attached `:3108`) | Hand-maintained `BLACKSWAN_TOOLS` array; dispatch via `openswanTools` | v1 `agent_runs` rows, `metadata.version='swanbot-ai'` on normal-path turns (`swanbot-ai/index.ts:1069`) | **Yes — retire the loop** (migration M5). | Reachable via `callSwanBotAI`'s v1 fall-through (`swanbot.ts:2381`) and the manual OpenSwan revert flag (`openswanSessionRuntime.ts:1771`). Per-round transport is the relay (`swanbot.ts:4277`). |
| **The relay — `swanbot-ai` relay branch** (NOT a loop) | Edge / server (`swanbot-ai/index.ts:3681`-`3684`) | **None** — one model turn: Anthropic passthrough, marketplace/BYOK translation (`:3685`, `:2928`), or tool-less (`:3667`) | Relay-mode turns are excluded from terminal v1 telemetry (`SWANBOT_V2_MIGRATION_PLAN.md:168`) | **No — keep.** Load-bearing. | 11 live `invoke('swanbot-ai')` sites incl. `openswanSessionRuntime.ts:742`/`:1017`, `agentInvocation.ts:151`, `computerTaskRuntime.ts:675`, `subagentRegistry.ts:468`, `swanbot.ts:2381`/`:2444`/`:4277`/`:4707`, `BlockBriefEditor.tsx:197`, plus v2's fallback (`swanbot-v2-ai/index.ts:2919`). |

**The distinction, stated once so it is unmistakable:** `swanbot-ai` is **two
things in one directory.** Its *tool-loop role* (`BLACKSWAN_TOOLS` +
`executeToolUseLoop`) is Loop #3 and is superseded. Its *relay role* (the
`hasRelayTools || relayToolsDisabled` branch) is a stateless single-turn model
transport that is **not superseded** and underpins Loops #1 and #3 and v2's
fallback. Retiring the loop does **not** retire the function.

---

## 3. Decision

We adopt a **transport-vs-loop boundary** as the target architecture:

1. **One typed loop shape is the source of truth.** `agentExecutionCore`'s
   `AgentToolDefinition` / `AgentProvider` / `AgentEvent` contract
   (`agentExecutionCore.ts:67`, `:189`, `:203`) is the canonical loop. Loops
   run **client-side / in-app**; they own iteration, approvals, checkpoints,
   reliability layers, and telemetry.

2. **The two other loops converge onto it, they are not extended.**
   - Loop #2 (`swanbot-v2-ai` `runLoop`) is repointed so the `batch` lane
     delegates to `runAgent` instead of the edge server loop
     (plan CONSOLIDATE #1). The M2 client-delegation round-trip protocol then
     becomes redundant and is deleted.
   - Loop #3 (`executeToolUseLoop` + `BLACKSWAN_TOOLS`) is retired per
     migration **M5** once the v2 flip is durable.

3. **Transports are stateless and dumb.** An edge function in the target may
   *relay one model turn* or *stream one model turn* (SSE) — it never runs a
   tool loop. The `swanbot-ai` **relay branch** is a valid transport and stays.

4. **`swanbot-ai` can be orphaned only after its relay is re-homed — never
   before.** The provider relay (BlackSwan/marketplace/BYOK/tool-less) moves
   onto `llm-proxy` or a dedicated relay function; **all** relay call sites
   above migrate; and v2's `model_unsupported_on_v2 → swanbot-ai` fallback
   (`swanbot-v2-ai/index.ts:2919`) is removed. Only then is the directory
   genuinely dead. This is a **separate, later milestone** — not folded into
   M5 (`SWANBOT_V2_MIGRATION_PLAN.md:198`-`204`).

5. **The taxonomy that models this already exists in code.**
   `src/lib/laneTaxonomyCore.ts` folds the two historical lane vocabularies onto
   one **surface × transport × loop** descriptor (`LaneDescriptor`,
   `laneTaxonomyCore.ts:82`). Its `LaneLoop` axis is exactly the three loops
   named here plus `none` (`laneTaxonomyCore.ts:79`), and `resolveLoop`
   (`:183`-`195`) encodes the one genuine ambiguity — transport `v2` fronts the
   edge loop (`edge_v2`) for the `batch` surface but `runAgent` (`agent_core`)
   for the `openswan_v2` surface. A `batch` turn that fell back to the v1 relay
   is correctly `{surface:'batch', transport:'v1', loop:'legacy'}`, not a phantom
   edge run (`laneTaxonomyCore.ts:41`-`48`). New telemetry and health tracking
   record the whole descriptor, not one axis.

**Target end-state:** two edges (`swanbot-ai` *relay mode*, `chat-stream` SSE),
**one loop** (`runAgent`), one tool catalog, one approval spine, one lane
taxonomy (`CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md:51`).

---

## 4. Consequences

### What stays true during convergence
- **The relay is never removed as part of loop work.** Any change that touches
  the three loops must keep all 11 `invoke('swanbot-ai')` relay callers green.
- **`swanbot-ai` deletion is gated on relay re-home**, which is gated on
  migrating every call site AND deleting v2's fallback
  (`swanbot-v2-ai/index.ts:2919`). Ordering is a hard constraint:
  **relay re-home → then, and only then, directory deletion.**
- **v2 remains a safe default** because `callSwanBotAI` still falls through to
  the v1 relay on any v2 transport failure (`swanbot.ts:2381`) and the session
  breaker stops paying doomed round-trips (`swanbotRouting.ts:109`).
- **Nothing is deleted without a grep-verified 0-usage + a commit checkpoint**
  (plan guardrails). The migration plan's DoD for M5 is explicit that the
  edge-function deletion is **out of M5** (`SWANBOT_V2_MIGRATION_PLAN.md:224`).

### What each lane owner must do
- **Loop #1 (`agentExecutionCore` / `openswanSessionRuntime`)** — owns the
  canonical contract. New loop behavior lands here; the injected provider keeps
  the loop transport-agnostic (`agentExecutionCore.ts:189`), so re-homing the
  relay is a call-site swap, not a loop change.
- **Loop #2 (`swanbot-v2-ai`)** — no new capability; the job is to become a
  thin delegate to Loop #1 (or a pure relay) and then have its server loop
  retired. Preserve the normalized `final_stop_reason` telemetry
  (`swanbot-v2-ai/index.ts:3006`) that the readiness gate reads.
- **Loop #3 (`executeToolUseLoop` / `BLACKSWAN_TOOLS`)** — frozen; retire per
  M5. No new tools added to `BLACKSWAN_TOOLS` (`swanbot-ai/index.ts:1431`).
- **Router (`swanbot.ts` tiers + `swanbotRouting`)** — one lane decision per
  turn; emit the full `laneTaxonomyCore` descriptor
  (`laneTaxonomyCore.ts:226`) so "lane health" means one thing.
- **Relay owner (`swanbot-ai` relay branch)** — treat as a stable transport
  contract; the re-home target (`llm-proxy` / dedicated fn) must preserve the
  Anthropic-passthrough, marketplace/BYOK-translation
  (`swanbot-ai/index.ts:2928`), and tool-less (`:3667`) shapes verbatim.

### Costs accepted
- Until convergence lands, three loops and one relay coexist; a turn's behavior
  depends on the flag, the breaker, the model, and the surface. This ADR makes
  that state legible; `laneTaxonomyCore` makes it measurable.
- The relay re-home is real migration work (11 call sites + a v2 fallback) that
  must complete before the ~2,800-line `swanbot-ai` directory can be reclaimed.

---

## 5. Cross-links

- **Strategic plan — CONSOLIDATE #1 (loop convergence):**
  [`docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md`](../CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md)
  (debt table `:22`-`:32`; IMPROVE #1 relay-vs-loop fix `:75`; CONSOLIDATE #1
  `:103`). This ADR is that plan's **ADD #3** (`:82`).
- **Migration plan — M5 (retire the v1 tool loop, NOT the edge function):**
  [`docs/SWANBOT_V2_MIGRATION_PLAN.md`](../SWANBOT_V2_MIGRATION_PLAN.md)
  (`:173`-`:204`; DoD `:224`).
- **The taxonomy code this ADR blesses:** `src/lib/laneTaxonomyCore.ts`
  (IMPROVE #2 of the strategic plan).
- **Ownership / runtime map:** `CLAUDE.md` Runtime Map, `docs/AGENTS_ROADMAP.md`.
