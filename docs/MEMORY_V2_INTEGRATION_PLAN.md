# Memory → SwanBot v2 Integration Plan

> How the memory system reaches the **default chat lane**. Every claim below was
> read out of the current code, not inferred. Companion to
> `docs/MEMORY_SYSTEM_AUDIT_2026-07-24.md` (which ranks the defects this fixes).
> Date: 2026-07-28. Status: **P1–P5 all built and verified. Not yet run against a live model.**

## The situation, precisely

The memory pipeline is **already built and already correct**. It just runs on a
branch that is off by default.

| Path | Memory today |
|---|---|
| Client-loop branch (`isSwanbotV2ClientLoopEnabled()`, **default OFF**) — `swanbot.ts:1313` | ✅ Full. Calls `buildSystemPromptAsync(...)` → the four memory sections → `appendV2ModeContract` → passes `systemPrompt` into the typed loop |
| **Default edge path** (`swanbot-v2-ai`) | ❌ **None.** `buildFrozenBlock` (`:2447`) reads only the `circles` row |

So this is not "build a memory feature for v2". It is: **route an existing,
working bundle onto the path most turns actually take.**

Two supporting facts that shape everything below:

- **`systemDirective` is a dead channel.** The client sends it (`swanbot.ts:1415`);
  the edge never reads it. Zero references in `swanbot-v2-ai/index.ts`.
- **Agent identity already arrives.** `agentSubject`, `targetAgentSubjectKey`,
  `targetAgentDbId`, `targetAgentLegacyIds` are all in the request body
  (`swanbot.ts:1416-1420`) — so agent-scope lookup keys are available
  server-side today, which is exactly what `memoryLookupKeyCore.resolveMemoryLookupIds`
  consumes.

## The injection seam — the decision that matters

```ts
// swanbot-v2-ai/index.ts:4324
const systemBlocks = resumeFrom
  ? resumeFrom.systemBlocks                                       // resume: verbatim
  : [
      { text: frozenBlock + MODE_CONTRACT, cache_control: ephemeral },  // Block 1 — CACHED
      { text: `Now: …\nUser id: ${userId}${connectivityNote}` },        // Block 2 — NOT cached
    ];
```

**Memory goes in Block 2. Never Block 1.** The file already states this rule for
the connectivity note (`:4295-4298`): *"appended to the NON-cached system block
below (never the cache_control frozen block, or every connectivity change would
bust the prompt cache)."*

For memory the argument is **stronger than cache economics**.
`buildFrozenBlock(supabase, circleId, targetAgentName, tools)` takes **no
`userId`** — it is circle-scoped *precisely so the cached prefix can be shared
across every member of the circle*. Putting per-user memory in Block 1 would
therefore not merely bust the cache; it would place one member's memory into a
prefix shared with other members. That is the same class of defect as the v1
leak fixed on 2026-07-24.

**Resume behaviour is a feature, not a problem.** `resumeFrom.systemBlocks` is
reused verbatim, so memory is snapshotted at turn start and stays stable for the
whole tool loop. Retrieval cost is paid once per turn, not once per
continuation, and the model's context does not shift underneath a running loop.
Consequence to accept knowingly: a memory written mid-turn is not visible until
the next turn.

## Constraints that are non-negotiable

1. **Privacy.** The edge runs on a **service-role client** (`:4682-4684`) — RLS is
   bypassed. Any `memory_entries` read added here must carry its own visibility
   filter. This is exactly the v1 bug (`swanbot-ai/index.ts:595`, fixed 07-24).
   `userId` is trustworthy: the edge 403s unless `authUser.id === userId` (`:4677`).
2. **Untrusted content.** Retrieved memory is untrusted (CLAUDE.md Critical
   Guarantees). `wrapUntrusted` already exists in-file (`:411`, `:687`). It must
   **not** land in a rule/guardrail slot unfenced — v1 had precisely that bug
   (`swanbot-ai/index.ts:746`, fixed 07-24).
3. **Bounded.** Block 2 is uncached, and `systemBlocks` is persisted into the
   `RunContinuation` snapshot (`:4556`) — so injected text costs input tokens on
   every turn *and* row bytes on every continuation.

## Options considered

**A — Server-side retrieval in the edge.** New `buildMemoryBlock(supabase,
circleId, userId, subjectIds, nowMs)` sibling to `buildFrozenBlock`.
*For:* works for every v2 caller, no payload growth, one place to enforce privacy.
*Against:* no query embedding server-side, so no semantic ranking without the
edge calling the embed proxy — and that proxy resolves the key from the *user's*
BYOK settings and needs their JWT. Ranking would be importance/recency only.

**B — Client sends the bundle.** Client calls `buildPromptMemoryBundle(...)`
(`memoryService.ts:1306`) and puts the result in the request body; edge fences it
into Block 2.
*For:* reuses the pipeline **we just fixed** — pinned boost, relevance floor,
budget-fit, union fallback — with zero duplication. The embedding call already
works client-side. **Privacy is structurally safer**: the client reads
`memory_entries` *through RLS as that user*, so cross-user private leakage is
impossible by construction, rather than depending on a service-role filter being
written correctly.
*Against:* payload growth; a non-chat caller of v2 gets nothing; the edge must
treat the text as untrusted client input.

**C — Flip the client-loop flag.** Memory comes along for free.
*Rejected.* That flag moves tool dispatch client-side — a far larger semantic
change with its own readiness gate and runbook. It must be justified on its own
merits, not smuggled in as a memory fix.

## Recommendation: **B primary, A as a floor**

Ship B for quality and A for coverage. They compose: the edge uses the
client-supplied bundle when present and falls back to its own bounded,
privacy-filtered, importance-ordered read when absent. Nothing is ever worse
than today.

The privacy argument is the deciding one. In A, correctness rests on a filter I
write against a service-role client. In B, the read happens under the user's own
RLS — the failure mode is structurally unavailable. A exists only as the
degraded floor, and its filter must still be written correctly.

### Design detail worth getting right

`swanbot.ts` does not inject memory as one blob — it assembles **four separately
keyed, separately prioritized sections** (`memory_user_profile`, `memory_startup`,
`turn_retrieval`, soul wisdom) that `chatPromptAssembly` can independently clip
by priority. Sending a single flattened string throws that machinery away and
recreates Bug 3 from the audit (truncation eating the query-relevant section
first). **Send structured sections, not a blob** — and have the edge do the final
clip with the same priority order.

## Build status (2026-07-28)

**P1 and P4 are built.** P2/P3/P5 remain.

| Phase | Status |
|---|---|
| **P1 — edge accepts + fences + injects, plus the server floor** | ✅ **Built.** `body.memory` is read, threaded into `runLoop`, and — on the **fresh path only** — assembled by `buildV2MemoryBlock` and appended to **Block 2**. When no payload is sent, the edge reads the floor itself via `buildMemoryFloorQueryPlan` with the v1-shaped privacy filter. Whole thing is wrapped so memory can never fail a turn. |
| **P4 — `save_memory`** | ✅ **Built.** Fetch-then-update dedupe (was an unconditional INSERT), `source_run_id` from `ctx.runId` (uuid-validated, `null` rather than junk), an honest writer-named `source_surface`, and agent-lane writes when a subject key is present. The credential-shape refusal gate still runs before any read or write. |
| **P2 — client sends the bundle** | ✅ **Built.** New `src/lib/v2MemoryPayloadBuilder.ts`; `callSwanBotV2` sends `{sections:[{key,text}]}` on the **fresh leg only**. Kicked off *before* the connectivity await and joined after, so its 2000 ms deadline overlaps connectivity's existing 1500 ms cap — marginal worst case ≈ **+500 ms**, not +2000. Any failure ⇒ field omitted ⇒ the P1 floor covers the turn. |
| **P3 — on-demand memory search** | ✅ **Built.** `searchCircleMemory` now searches `memory_entries` **and** the legacy circle doc, tagged by `source`, name unchanged. |
| **P5 — `systemDirective`** | ✅ **Resolved.** Dead *v2 wire field* removed; the parameter stays (it is live on two other lanes). |

### Two defects found in P1 while building P3

Both were mine, both in the floor read, and the floor had **never returned a row**:

1. `buildMemoryFloorQueryPlan().eq` is an **array of `{column,value}`**, not an
   object. `Object.entries(plan.eq)` therefore filtered on a column literally
   named `0` — so the `circle_id` narrowing never applied. It **failed safe**:
   PostgREST rejected the query outright, so the result was no memory rather
   than cross-circle memory.
2. `.select(plan.select)` was handed a string **array** where PostgREST needs a
   comma-joined string.

Both reads now go through one shared `applyMemoryQueryPlan`, so the narrowing
cannot be right in one call site and wrong in the other. This is a good argument
for the plan's own rule that `postFilterRequired: true` — the pure predicate, not
the SQL, is the authority — since the SQL was broken and the design still held.

### Three notes worth keeping

- **Omitting ≠ sending empty.** The edge gate is
  `memoryPayload !== undefined && memoryPayload !== null`, so `{sections: []}`
  passes it, *skips the floor read*, then fails `payloadReport.ok` — leaving the
  turn with no memory at all. The client omits the field entirely instead.
- **Both obvious client sources are already fenced.** `retrieveForTurn().formatted`
  and `formatSoulWisdomBlock()` both return `wrapUntrusted(...)`, and the edge
  fences again — so the builder rebuilds the retrieval body from raw rows and
  strips any surviving marker, reporting when it does.
- **`systemDirective` was not globally dead**, only dead on the v2 wire: v1
  (`swanbot-ai:4211`) and the client loop (`swanbotV2BatchRuntime:203`) both read
  it. Removing the whole parameter would have been wrong.

### The Deno constraint, and how it was resolved

The edge cannot import `src/lib/promptSectionPriorityCore` — Deno resolves the
whole graph and its **type-only** import of `chatPromptAssembly` fails to
resolve. Verified twice with `deno check`, once for a value import and once for
the type import. Every core the edge already imports has **zero** imports; that
is the house rule, not an accident.

Rather than fork the injection core, two narrow copies were made and both are
**drift-guarded by test**:

- `v2MemoryInjectionCore` is now import-free. It inlines the six section
  priorities, and the smoke asserts they are identical to
  `DEFAULT_SECTION_PRIORITY`.
- `planSectionFit` is **injected**, not imported — the client passes the real
  one, the edge passes `supabase/functions/_shared/prompt-section-fit.ts`. The
  smoke runs **both** over a 12-case battery (keep / truncate / drop / ties /
  degenerate) and asserts byte-identical plans.
- Missing planner ⇒ **fail closed** (no sections), because an unclipped block
  truncates the query-relevant section first — the exact bug the core exists to
  prevent.

Moving the `ChatPromptSectionKey` union out of `chatPromptAssembly` would have
removed the duplication outright, but it is a large union owned by a hot file
with five dependants including `swanbot.ts`, which a concurrent session is
editing. Not worth the blast radius for a plumbing concern.

### Verification

`deno check supabase/functions/swanbot-v2-ai/index.ts` → clean.
`npm run typecheck` → 9 errors, all pre-existing in a concurrent session's
files (`computerAppAdapter.ts`, `openswanToolRuntime.ts`, `swanbot.ts`); none in
anything this touched. Smokes: `v2-memory-injection` **320**,
`v2-save-memory-core` **213**, plus 12 adjacent memory/v2 suites — 14/14 green.

**Not yet exercised against a live model.** Nothing here has run against real
Anthropic traffic; `swanbot-v2-ai` needs a redeploy, and the agent lane in P4
additionally needs `20260411_agent_memory_scope.sql` applied in production.

## Phases

| # | Work | Gate |
|---|---|---|
| **P1** | Edge accepts an optional bounded `memory` payload, fences it with `wrapUntrusted`, appends to **Block 2**. Plus the server-side floor (A) with the v1-shaped visibility filter. Purely additive — no client change needed to deploy. | Privacy regression test: another user's private row is never selected. Fencing shape asserted. |
| **P2** | Client populates it from `buildPromptMemoryBundle` on the default (non-client-loop) path, as structured sections. | A/B the token delta; confirm the relevant section survives clipping. |
| **P3** | Repoint `searchCircleMemory` at `memory_entries` (or add `searchMemories`) so the model can pull on demand past the injected budget. Today it searches the legacy `circle_memory` doc table only (`:379-397`). | Tool returns fenced, privacy-filtered rows. |
| **P4** | Fix `save_memory` (`:937-995`): it hardcodes `scope:"circle"`, `visibility:"circle_shared"`, `source_surface:"main_chat"`, does an **unconditional INSERT** (v1 fetch-then-updates), and never sets `source_run_id` despite `runId` being in `ToolContext`. | Dedupe proven; provenance honest; agent scope when a subject key is present. |
| **P5** | Decide `systemDirective`: wire it or delete it. A field the client fills and the server ignores will mislead the next person. | — |

P1 and P4 are independent of everything else and can land first.

## Risks to measure, not assume

- **Token cost.** ~4k chars ≈ ~1k uncached input tokens per turn, every turn.
  The budget cap is the control; measure before widening it.
- **Continuation row growth.** `systemBlocks` is persisted per continuation
  (`:4556`). A 4k-char block multiplies across every continuation of every run.
  Check the existing row-size bound before choosing the cap.
- **Cache hit rate.** Block 1 must stay byte-identical across users for the
  circle-shared cache to pay off. Verify no memory text leaks into it.
- **Client-supplied trust.** A crafted `memory` payload can only influence that
  user's own turn (they already control `message`), so fencing + bounding is
  sufficient — but the edge must never treat a client-declared *scope* or
  *visibility* as authoritative.
