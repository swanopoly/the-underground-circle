# Agent Memory Retrieval, Privacy, and SQL Dossier

Date: 2026-04-08
Type: Deep research + SQL-first implementation dossier
Status: Claude-ready PR1/PR2 handoff

## Goal

Turn the current memory architecture into a safer and more useful managed-agent system by fixing:

- semantic retrieval
- contradiction handling
- memory privacy and RLS
- exact schema shape for PR1

## Main conclusion

The next memory leap for Underground Circle should be:

1. keep `memory_entries` as the main table
2. add semantic retrieval for archival memory
3. split startup memory from on-demand memory
4. enforce true private `user` memory
5. log what memory was loaded into each run
6. add contradiction/evaluation workflow before durable promotion

## Deep research findings

### A. Semantic retrieval should be hybrid, not vector-only

Supabase’s current docs strongly support using `pgvector` for semantic retrieval, but they also explicitly note the value of hybrid search.

Important implications:

- use the same embedding model for all compared memory embeddings
- keep vector retrieval in Postgres with pgvector
- combine semantic similarity with metadata filters
- do not rely on pure `ilike` or pure recency ordering

Best memory retrieval query shape for this app:

- hard filter by scope and visibility first
- filter by circle/room/user eligibility
- semantic match with embeddings
- add ranking boosts for:
  - importance
  - freshness
  - manual pinning
  - exact tag/kind matches

### B. PostgreSQL RLS must be explicit and restrictive

The PostgreSQL docs matter here because multiple policies are permissive by default and combine with `OR`, unless marked restrictive.

Important implications:

- a broad circle-membership policy can accidentally expose user-scoped rows
- `SELECT`, `INSERT`, `UPDATE`, `DELETE` should not always share the same logic
- `WITH CHECK` matters as much as `USING`
- private memory should use command-specific policies

### C. Memory contradiction handling should not be solved by title matching

Current dedup logic is too weak.

A better contradiction model should:

- detect same subject + changed value
- detect mutually exclusive preference pairs
- detect supersession of decisions
- preserve lineage between old and new memory rows

### D. Retrieval should distinguish startup and archival modes

This is the key production-quality split.

Startup memory:

- small
- deterministic
- instruction-heavy

Archival retrieval:

- semantic
- task-aware
- capped
- optional

## Audit of current implementation

### Current strengths

- [memory_entries](/Users/cswanson/the-underground-circle/supabase/migrations/20260408_unified_agent_runs.sql#L189) already exists
- [agentRunSystem.ts](/Users/cswanson/the-underground-circle/src/lib/agentRunSystem.ts) already centralizes save/load/promotion
- [agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts) already attempts extraction and memory management

### Current weaknesses

1. no embedding storage or semantic retrieval path
2. `loadMemories` still does not filter by `userId`
3. user-scope privacy is still not enforced safely
4. no access-log of which memory influenced which run
5. no contradiction lineage fields
6. no clear startup-vs-archival retrieval split

## Recommended schema changes

### 1. Extend `memory_entries`

Add columns:

```sql
alter table memory_entries
  add column if not exists visibility text not null default 'circle_shared'
    check (visibility in ('private','room_shared','circle_shared','org_shared')),
  add column if not exists status text not null default 'active'
    check (status in ('candidate','active','stale','retracted')),
  add column if not exists importance numeric(3,2) not null default 0.50,
  add column if not exists confidence numeric(3,2) not null default 0.75,
  add column if not exists retrieval_mode text not null default 'on_demand'
    check (retrieval_mode in ('startup','on_demand','manual_only')),
  add column if not exists access_count integer not null default 0,
  add column if not exists last_accessed_at timestamptz,
  add column if not exists supersedes_memory_id uuid references memory_entries(id) on delete set null,
  add column if not exists embedding extensions.vector(384);
```

Notes:

- `384` assumes `gte-small` for local Supabase-compatible embeddings
- if a different embedding model is chosen, dimension count must match everywhere

### 2. Add source linkage table

```sql
create table if not exists memory_sources (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references memory_entries(id) on delete cascade,
  source_type text not null
    check (source_type in ('message','run','step','artifact','approval','manual')),
  source_id uuid,
  excerpt text,
  created_at timestamptz default now()
);
```

### 3. Add evaluation table

```sql
create table if not exists memory_evaluations (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references memory_entries(id) on delete cascade,
  evaluation_kind text not null
    check (evaluation_kind in ('quality','contradiction','sensitivity','durability','manual_review')),
  evaluator text not null default 'auto',
  passed boolean,
  score numeric(3,2),
  feedback text,
  created_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);
```

### 4. Add context snapshot table

```sql
create table if not exists run_context_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  circle_id uuid not null,
  checkpoint_index integer not null,
  summary text,
  active_plan text,
  open_questions text[],
  artifacts_snapshot jsonb default '[]'::jsonb,
  source_message_count integer default 0,
  compacted_message_count integer default 0,
  created_at timestamptz default now()
);
```

### 5. Add retrieval access log

```sql
create table if not exists memory_access_log (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references memory_entries(id) on delete cascade,
  run_id uuid references agent_runs(id) on delete cascade,
  surface text,
  reason text not null
    check (reason in ('startup','retrieval','session_resume','manual_pin')),
  created_at timestamptz default now()
);
```

## Exact RLS design

### Problem to solve

The current policy shape is too broad for private `user` memory.

### Safer policy strategy

Use command-specific policies.

#### Step 1: remove the over-broad policy

```sql
drop policy if exists "memory_via_circle" on memory_entries;
```

#### Step 2: select policies

```sql
create policy memory_select_shared
on memory_entries
for select
to authenticated
using (
  visibility in ('room_shared','circle_shared','org_shared')
  and circle_id in (
    select circle_id from circle_members where user_id = auth.uid()
  )
);

create policy memory_select_private_owner
on memory_entries
for select
to authenticated
using (
  visibility = 'private'
  and user_id = auth.uid()
);
```

#### Step 3: insert/update/delete policies

```sql
create policy memory_insert_owner
on memory_entries
for insert
to authenticated
with check (
  (
    visibility = 'private'
    and user_id = auth.uid()
  )
  or
  (
    visibility in ('room_shared','circle_shared','org_shared')
    and circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);

create policy memory_update_owner_or_circle
on memory_entries
for update
to authenticated
using (
  (
    visibility = 'private'
    and user_id = auth.uid()
  )
  or
  (
    visibility in ('room_shared','circle_shared','org_shared')
    and circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
)
with check (
  (
    visibility = 'private'
    and user_id = auth.uid()
  )
  or
  (
    visibility in ('room_shared','circle_shared','org_shared')
    and circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);

create policy memory_delete_owner
on memory_entries
for delete
to authenticated
using (
  (
    visibility = 'private'
    and user_id = auth.uid()
  )
  or
  (
    visibility in ('room_shared','circle_shared','org_shared')
    and circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);
```

### Important application rule

Even with good RLS, app queries should still explicitly filter by:

- active user
- requested scopes
- requested room
- visibility

RLS is the safety backstop, not the only filter.

## Retrieval ranking design

### Retrieval formula

Suggested ranking:

```text
final_score =
  (semantic_similarity * 0.45) +
  (importance * 0.18) +
  (confidence * 0.12) +
  (freshness * 0.10) +
  (scope_priority * 0.10) +
  (manual_pin_bonus * 0.05)
```

### Scope priority defaults

- room instruction: `1.00`
- user preference: `0.92`
- room decision: `0.88`
- circle policy: `0.84`
- circle fact: `0.75`
- old session context: `0.55`

### Startup retrieval rule

Do not run full semantic retrieval at startup for every turn.

Startup bundle should be:

- top instructions
- top room decisions
- top user preferences
- current session summary

Archival retrieval should happen only when:

- task is open-ended
- run enters planning
- user asks recall-like query
- room/task context changes enough to justify retrieval

## Contradiction handling design

### Add lineage and replacement

When a memory is replaced:

- new row gets `supersedes_memory_id = old.id`
- old row becomes `status = 'stale'` or `retracted`

### Contradiction categories

1. direct contradiction
   - same subject, opposite fact

2. preference change
   - new preference replaces older one

3. decision supersession
   - architecture or workflow changed

4. scope contradiction
   - session-only note conflicts with shared durable note

### Evaluation rule

Any detected contradiction should create a `memory_evaluations` row.

## Exact code changes for PR1

### File 1

[agentRunSystem.ts](/Users/cswanson/the-underground-circle/src/lib/agentRunSystem.ts)

Change:

- fix `loadMemories` to honor `userId`
- add `visibility`, `status`, `retrievalMode`, `importance`, `confidence`
- add `loadStartupMemories(...)`
- add `logMemoryAccess(...)`

### File 2

`src/lib/memoryRetrieval.ts`

New responsibilities:

- semantic retrieval query
- startup retrieval query
- ranking merge
- source refs for UI

### File 3

`src/lib/memoryPrivacy.ts`

New responsibilities:

- scope-to-visibility rules
- allowed promotion rules
- query guards before DB access

### File 4

`src/lib/memoryEvaluation.ts`

New responsibilities:

- contradiction check
- durability scoring
- sensitivity scoring

### File 5

[agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts)

Change:

- stop using naive title-only dedup as the primary strategy
- emit candidate memories first
- call evaluation before activation/promotion

### File 6

[swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)

Change:

- stop calling the generic broad memory builder
- use:
  - startup bundle
  - optional archival retrieval
  - memory source refs

## Suggested PR split

### PR1

- schema additions
- RLS correction
- `loadMemories` correction
- startup retrieval split

### PR2

- embeddings generation pipeline
- semantic retrieval RPC
- access logging

### PR3

- contradiction/evaluation flow
- supersession handling
- UI source refs

## Verification checklist

- private user memory is unreadable to other circle members
- startup memory no longer loads unrelated user memory
- semantic retrieval returns relevant room/user decisions
- memory access log shows what influenced a run
- contradiction creates evaluation rows and stale/retracted lineage

## Sources

- Supabase semantic search docs: https://supabase.com/docs/guides/ai/semantic-search
- Supabase semantic search edge-function example: https://supabase.com/docs/guides/functions/examples/semantic-search
- Supabase pgvector docs: https://supabase.com/docs/guides/database/extensions/pgvector
- PostgreSQL row security docs: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
