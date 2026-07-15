# Agent Memory — God Plan

> A strategic plan for memory capture, routing, retrieval, and injection
> into OpenSwan and the SOULs. Last updated: 2026-04-15; §1 status
> re-audited 2026-07-13 (nearly all gaps shipped — see §1).

---

## 0. North star

Every OpenSwan turn teaches the system something. Memories are typed,
owned, and indexed. On every subsequent turn in a related context, the
most useful memories get pulled semantically, filtered by who's asking
and which SOUL they're invoking, and injected at a budgeted size so the
model opens the conversation already knowing what it knew last time.

Three guarantees we want the user to feel:

1. **The agent remembers the last time we talked about this.**
2. **Each SOUL gets sharper the more I use it.**
3. **I can see why the agent said something — and fix it.**

---

## 1. Current state (evidence-based snapshot)

From the audit pass (2026-04-15). Grouped so every future claim rests
on real files.

### What works today ✅

| Capability                             | Where                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `memory_entries` schema + RLS          | `supabase/migrations/20260408_memory_v2_retrieval_privacy.sql`           |
| Turn-end extraction (Gemini 2.5 Flash) | `src/lib/agentMemory.ts:60–227`, triggered in `ChatTab.tsx:1471`         |
| Deduplication (title + content)        | `agentMemory.ts:159–174`                                                 |
| Quality gating                         | `isHighQualityMemory()` imported line 150                                |
| Source attribution                     | `source_run_id`, `source_surface`, `metadata`                            |
| Startup bundle (3000 char cap)         | `memoryService.ts:34–152`, `MAX_MEMORY_CHARS=3000`                       |
| System-prompt extras (4000 char cap)   | `swanbot.ts:700`, `MAX_EXTRAS_CHARS=4000`                                |
| Panel UI w/ soul-aware dedupe          | `AgentMemoryPanel.tsx:23–50, 136–150`                                    |
| Soul-routing *inference*               | `decideSoulMemoryRouting()` in `agentSoulMemory.ts:182–271` (built only) |
| FTS index on memory content            | `idx_memory_entries_fts`                                                 |

### Gaps from the 2026-04-15 audit — status as of 2026-07-13 ✅

Every gap below except live-builder capture has since shipped. Kept for
history; do not treat this as an open backlog.

| Gap (2026-04-15)                            | Status now                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Soul routing never called on writes         | ✅ Shipped — `decideSoulMemoryRouting` invoked on the write path (`agentMemory.ts:328`)             |
| No semantic/vector retrieval                | ✅ Shipped — `src/lib/memoryEmbeddings.ts` (`embedAndStoreMemory`) + embedding-backed retrieval     |
| `memoryConsolidation` module missing        | ✅ Shipped — `src/lib/memoryConsolidation.ts` exists; dynamically imported from `agentMemory.ts`    |
| **Live builder has no capture**             | ❌ Still open — `build-stream/index.ts` never writes `memory_entries`                               |
| No automated session-memory decay           | ✅ Shipped — `20260418_soul_wisdom_cron.sql` weekly pg_cron distillation                            |
| SOULs are static                            | ✅ Shipped — `memory_soul_links` + `soul_wisdom` tables (`20260416`/`20260418` migrations)          |
| No "why did the agent say this?" trace      | ✅ Shipped — `memory_access_log` written from `memoryActions.ts`, `memoryService.ts`, run system    |
| Turn-time retrieval isn't wired             | ✅ Shipped — `retrieveForTurn` called in the hot path (`swanbot.ts:2531`)                           |

**Summary (current):** the four-pillar loop is wired end to end. The one
remaining capture gap is the live builder; everything else in this plan's
§1 is shipped and the later sections describe the rationale behind what
now exists.

---

## 2. The four-pillar memory loop

Every other design decision in this plan maps to exactly one of these.

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ CAPTURE  ├───▶│  ROUTE   ├───▶│ RETRIEVE ├───▶│  INJECT  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
  extract         decide          rank &           build
  from turn       scope +         budget           prompt
                  soul(s)
                                      ▲                │
                                      │                ▼
                                      └───── model output ────▶ CAPTURE loop
```

- **Capture** — distill what was learned this turn into atomic memories.
- **Route** — decide who owns this memory (user, circle, SOUL, shared).
- **Retrieve** — next turn, find the 10–30 most useful for this moment.
- **Inject** — fit them into the prompt budget in the right order.

---

## 3. Future-state architecture

### 3.1 Schema deltas

**New column on `memory_entries`:**

```sql
alter table memory_entries
  add column embedding vector(1536);       -- pgvector, OpenAI small or Voyage-3
create index memory_entries_embedding_ivfflat
  on memory_entries using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

**New join table `memory_soul_links` (replaces hard-coded single soul):**

```sql
create table memory_soul_links (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references memory_entries(id) on delete cascade,
  soul_key text not null,               -- 'soul:architect' etc.
  role text not null check (role in ('primary', 'shared', 'reference')),
  ownership_mode text not null check (ownership_mode in ('exclusive', 'shared_multi', 'agent_core')),
  confidence numeric(3,2) default 0.5,
  rationale text,
  created_at timestamptz default now(),
  unique (memory_id, soul_key)
);
create index on memory_soul_links(soul_key, ownership_mode);
create index on memory_soul_links(memory_id);
```

This matches the routing shape already emitted by
`decideSoulMemoryRouting()` — the function was designed for this table,
the table just doesn't exist yet.

**New table `soul_wisdom` — the distilled per-SOUL synthesis:**

```sql
create table soul_wisdom (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references circles(id) on delete cascade,
  soul_key text not null,
  body text not null,                   -- LLM-synthesized guidance
  source_memory_ids uuid[],             -- the memories that produced this
  generated_at timestamptz default now(),
  unique (circle_id, soul_key)
);
```

Regenerated weekly by a cron-triggered edge fn that takes the top-N
memories per SOUL per circle and asks a model to distil "what has this
SOUL learned in this circle?"

**New view `memory_health` — observability:**

```sql
create view memory_health as
  select
    scope, memory_kind,
    count(*) as total,
    count(*) filter (where embedding is not null) as embedded,
    count(*) filter (where is_active) as active,
    percentile_cont(0.5) within group (order by importance) as median_importance,
    max(last_accessed_at) as last_access
  from memory_entries
  group by scope, memory_kind;
```

### 3.2 Capture — what we change

- **Call `decideSoulMemoryRouting()` inside `autoExtractAndSave`**
  (`agentMemory.ts:199`). For each new memory, insert a row + write 1–3
  corresponding `memory_soul_links` rows using the returned ownership
  mode. Scope stays (user/circle/agent/session), but *in addition* the
  memory is now routed to one or more SOULs.
- **Embed on write.** After insert, call an embedding endpoint (see
  §3.6 decision matrix) and update the row's `embedding` column.
  Batched / deferred via a lightweight queue so it never blocks the UI.
- **Trigger on every completed turn**, not just chat. Wire the same
  extractor into `build-stream` (`supabase/functions/build-stream/index.ts`)
  and the agent-bridge completion path. One path in, one path out.
- **Rebuild `memoryConsolidation`.** Stub exists via `isHighQualityMemory`
  import but no module. Create `src/lib/memoryConsolidation.ts` with
  (a) contradiction detection via embedding + content comparison, (b)
  near-duplicate collapse, (c) low-confidence quarantine.

### 3.3 Route — the SOUL-aware layer

The `decideSoulMemoryRouting` function already returns exactly what
`memory_soul_links` needs — we just persist it:

| Function output          | DB column                        |
| ------------------------ | -------------------------------- |
| `primarySoulKey`         | `memory_soul_links.role='primary'` |
| `relevantSoulKeys[]`     | `role='shared'` rows              |
| `ownershipMode`          | `memory_soul_links.ownership_mode`|
| `confidence`             | `memory_soul_links.confidence`    |
| `rationale`              | `memory_soul_links.rationale`     |

A memory with `ownership_mode='exclusive'` has 1 link (primary).
`shared_multi` has 2–3 (one primary, others shared). `agent_core` has
0 (no SOUL owns it; it belongs to the agent identity itself).

### 3.4 Retrieve — semantic + SOUL-weighted

Replace the keyword retrieval at `memoryService.ts:190–209` with:

```ts
async function retrieveForTurn(opts: {
  circleId: string; userId: string; activeSoulKey?: string;
  queryText: string; budgetChars: number;   // default 1500
}): Promise<MemoryRow[]>
```

Algorithm:

1. Embed the turn's user message (same model used on writes).
2. Vector cosine search over `memory_entries` where the user can see
   them (RLS handles this) — top 40 candidates.
3. Join `memory_soul_links` and **boost**:
   - +0.25 if linked to `activeSoulKey` with role='primary'
   - +0.10 if linked to `activeSoulKey` with role='shared'
   - +0.05 if `ownership_mode='agent_core'`
4. Decay by age: `× exp(-age_days / 30)` so an old unaccessed memory
   competes weaker than a recent one.
5. Hard filter: memory is_active + not contradicted.
6. Cut to `budgetChars`, preserving the ordering.
7. Write a `memory_access_log` row per memory returned with reason
   `retrieval` so the UI can explain "I used these 6 memories."

### 3.5 Inject — two-tier + SOUL-first

Every system prompt is composed from three stacked blocks:

```
┌────────────────────────────────────────────────────┐
│ Block A  Static SOUL template (soulTemplates.ts)   │  ~1500 chars
├────────────────────────────────────────────────────┤
│ Block B  SOUL wisdom (soul_wisdom table, weekly)   │   ~800 chars
├────────────────────────────────────────────────────┤
│ Block C  Turn-retrieval (retrieveForTurn)          │  ~1500 chars
└────────────────────────────────────────────────────┘
```

Plus the existing startup bundle (3000 chars) for continuity across
sessions when no specific turn-query exists yet (first message).

Total memory-related content per prompt: ≤ 6800 chars. Fits inside the
existing Haiku / Sonnet / Opus context budgets with room to spare.

### 3.6 Embedding provider decision

| Option                       | Pros                                           | Cons                          | Verdict   |
| ---------------------------- | ---------------------------------------------- | ----------------------------- | --------- |
| OpenAI `text-embedding-3-small` | 1536d, $0.02/M tokens, battle-tested       | yet another API key           | **pick**  |
| Voyage-3                     | Best benchmark for retrieval, 1024d            | newer, less tested            | watch     |
| Cohere embed-english-v3      | Good, 1024d                                    | we use no other Cohere        | skip      |
| Local (ollama `nomic-embed`) | Free, runs on the training Mac                 | deploy ops, not web-reachable | skip      |

Route embeddings through the existing `llm-proxy` so keys stay in
Supabase secrets. Add `provider: 'openai-embed'` to `llm-proxy`.

---

## 4. SOUL integration — the vision in detail

Today a SOUL is a static personality in `soulTemplates.ts`. After this
plan ships, invoking a SOUL composes **five live sources**:

1. The static system prompt (unchanged).
2. This SOUL's distilled wisdom for *this circle* (from `soul_wisdom`).
3. This SOUL's most relevant memories for the current message (turn
   retrieval, soul-weighted).
4. The recent decisions this SOUL has made in this circle (last 3 runs).
5. Any user-pinned memories that target this SOUL.

Concretely, the system prompt for an "architect" invocation in circle
X becomes:

```
<static architect system prompt>

## Architect wisdom in this circle (updated 2026-04-09)
- Prefer service-oriented boundaries; the team tried modular monolith in Q1 and reverted
- DDD aggregates > plain CRUD for the project tracker
- We do NOT adopt microservices until team > 5

## Architectural decisions we've made here
- 2026-03-11: picked Postgres over DynamoDB for state (cost + RLS)
- 2026-02-28: rejected gRPC, stayed on REST (tooling gap)
- 2026-02-14: chose Supabase Edge Fns over own server (ops load)

## Relevant to this message
- User prefers diagrams in plain text, not Mermaid (they've said 3x)
- Don't propose Kubernetes — this is a solo-founder context
```

That's a SOUL that **accumulates** intelligence instead of starting
from zero each invocation.

---

## 5. OpenSwan integration — the service view

OpenSwan is the *service*; SOULs are *modes* the service can operate
in. The existing service menu (Build / Review / Debug / Arch × Auto /
Parallel / Solo) already expresses this. What changes:

- **`sessionProfile` → SOUL map.** `Build`→`sr-engineer`,
  `Review`→`code-reviewer`, `Debug`→`debugger` (spirit), `Arch`→`architect`.
  One line in `chatSessionProfile.ts` + a lookup in the system-prompt
  builder.
- **`delegationMode`.** `Auto` means "retrieve SOUL wisdom + allow
  spawning sub-SOULs if query spans concerns." `Parallel` means
  "retrieve for the active SOUL AND spawn peer SOUL contexts in
  parallel, merge." `Solo` means "retrieve only for the active SOUL,
  no spawn."
- **Run completion hook.** When an OpenSwan run finishes, we already
  get a `run_id` in `agent_runs`. Extend `updateRunStatus` to call
  `autoExtractAndSave` with the full transcript. Memories get routed
  to the SOUL matching the profile that was active.

Net effect: the service menu already picks the SOUL, so we don't need
new UI to take advantage of SOUL-keyed memories. Everything plugs in
behind the existing dropdown.

---

## 6. Phased rollout

Each phase is independently shippable, with entry/exit criteria.

### Phase 0 — Wire Soul routing on writes  (1 day)
**Entry:** audit complete (done).
**Do:**
1. Create `supabase/migrations/20260416_memory_soul_links.sql` for the
   join table.
2. Inside `autoExtractAndSave` (`agentMemory.ts`), call
   `decideSoulMemoryRouting` for each extracted memory, insert the
   primary memory row, then the 1–3 soul-link rows.
3. Update `AgentMemoryPanel` read path to join `memory_soul_links`
   instead of reading `metadata.soul_key`.

**Exit:** new memories from fresh turns show up in the panel bucketed
under the correct SOULs. Old memories stay in their current buckets.

### Phase 1 — Embedding infrastructure  (2 days)
**Entry:** Phase 0 merged.
**Do:**
1. Migration adds `embedding vector(1536)` + ivfflat index.
2. Extend `llm-proxy` to accept `provider: 'openai-embed'` and return
   the raw vector.
3. Backfill script: nightly embed the top 5000 most-accessed memories
   first, then everything else.
4. `agentMemory.ts:saveMemory` embeds on write, fire-and-forget.

**Exit:** ≥ 80 % of active memories have embeddings. `memory_health`
view shows the backfill percentage.

### Phase 2 — Semantic retrieval wired into OpenSwan  (2 days)
**Entry:** Phase 1 embedding coverage ≥ 80 %.
**Do:**
1. Implement `retrieveForTurn()` in `memoryService.ts`.
2. Call it from the system-prompt builder in `swanbot.ts` as Block C.
3. Write `memory_access_log` rows on each retrieval.
4. Add "Used N memories" hint in the chat UI under assistant
   messages; tapping reveals the list.

**Exit:** a user can see which memories informed an answer. Retrieval
latency p95 ≤ 400 ms.

### Phase 3 — SOUL wisdom distillation  (2 days)
**Entry:** Phase 2 in production one week.
**Do:**
1. `soul_wisdom` migration + cron.
2. Edge fn `distil-soul-wisdom` that takes top-50 memories per
   (circle, SOUL), asks Haiku to write 5–8 bullets of guidance, and
   upserts to `soul_wisdom`.
3. System prompt builder injects Block B (SOUL wisdom) before Block C.

**Exit:** the distinct "wisdom" section is visible in the system
prompt, and empirically the SOUL gives consistent advice across
sessions.

### Phase 4 — Consolidation + decay  (1 day)
**Entry:** Phase 3.
**Do:**
1. Create `src/lib/memoryConsolidation.ts` with contradiction /
   near-dup collapsing.
2. Cron: once a day, scan new memories from last 24 h for
   contradictions against existing ones, mark winners.
3. Cron: demote session memories > 14 d from startup → on_demand;
   deactivate > 30 d.

**Exit:** `memory_health` shows flat or declining total-active count
while quality metric stays flat.

### Phase 5 — Observability + trust  (1–2 days)
**Entry:** Phase 4.
**Do:**
1. "Why did you say this?" affordance in the UI — lists the memories
   cited for a specific assistant message.
2. Memory pin / unpin / flag from the panel.
3. Rage-button: one-click "forget everything about X" that deletes
   memories matching a query with audit trail.

**Exit:** a user can audit, edit, and delete any memory path end-to-end
without touching the DB.

---

## 7. Observability

- `memory_health` view — watch total, embedded %, median importance
  weekly.
- `memory_access_log` — log every retrieval with reason + scores so we
  can debug "why did this memory lose."
- UI "Used N memories" pill on every assistant turn.
- Alert if retrieval returns 0 memories for > 30 % of turns in a day
  (suggests cold start or broken filter).

---

## 8. Risks and mitigations

| Risk                                | Mitigation                                                                |
| ----------------------------------- | ------------------------------------------------------------------------- |
| PII captured into shared scope      | Keep default scope=user; only promote with explicit user action or rule   |
| Memory rot (stale facts linger)     | Confidence decay + contradiction detection + pinned-by-user bypass        |
| Over-injection → hallucination      | Hard char budgets (Block C ≤ 1500), ranked by score, lowest get dropped   |
| Cross-circle leakage                | RLS uses `user_can_see_memory` helper (SECURITY DEFINER), no `to authenticated` on INSERT (burnt by this before — see CLAUDE.md) |
| Embedding provider outage           | Graceful degrade to keyword + recency ranking; no blocking on embed       |
| SOUL wisdom gets generic / unhelpful | Gate the cron on ≥ 15 memories per (circle, SOUL) so we don't synth noise |
| Panel perf on large memory counts   | Paginate AgentMemoryPanel + add virtualized list                          |

---

## 9. Appendix A — File-level delta map

| File                                          | Change                                                           | Phase |
| --------------------------------------------- | ---------------------------------------------------------------- | ----- |
| `supabase/migrations/20260416_memory_soul_links.sql` | NEW — join table + indexes                                 | 0     |
| `src/lib/agentMemory.ts`                      | call `decideSoulMemoryRouting`, insert links                    | 0     |
| `src/screens/circles/tabs/office/AgentMemoryPanel.tsx` | join read path                                         | 0     |
| `supabase/migrations/20260417_memory_embeddings.sql` | NEW — add embedding column + ivfflat index               | 1     |
| `supabase/functions/llm-proxy/index.ts`       | add `openai-embed` provider                                     | 1     |
| `src/lib/agentMemory.ts`                      | embed on write                                                  | 1     |
| `src/lib/memoryService.ts`                    | `retrieveForTurn` vector + soul-weighted                        | 2     |
| `src/lib/swanbot.ts`                          | inject Block C                                                  | 2     |
| `supabase/migrations/20260418_soul_wisdom.sql`| NEW — `soul_wisdom` table + cron                                | 3     |
| `supabase/functions/distil-soul-wisdom/index.ts` | NEW edge fn                                                  | 3     |
| `src/lib/memoryConsolidation.ts`              | NEW — contradiction / dedupe                                    | 4     |

Rough effort: 7–9 focused build days end-to-end.

---

## 10. Appendix B — Why this plan, not the simpler one

Tempting alternative: "just shove all memories into every prompt and
let the context window sort it out." Reasons we don't:

- Haiku's 200k context is cheap but *attention degrades with size*.
  Relevance wins vs recall.
- Users have expressed the app "tends toward feature sprawl" — same
  applies to prompts. Tight, scored, SOUL-aware > firehose.
- SOUL differentiation is the killer feature. The whole point of
  having 21 spirits is that invoking "architect" feels architectural.
  Semantic, SOUL-keyed retrieval is what makes that real.
- Observability. Scored retrieval produces a log ("used 6 of 40
  candidates"). Firehose can't be audited.

---

*End of plan.*
