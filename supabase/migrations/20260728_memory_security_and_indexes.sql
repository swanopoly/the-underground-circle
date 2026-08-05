-- Memory system: security convergence, RLS correctness, and hot-path indexes.
--
-- The memory subsystem accreted across ~14 migrations between 20260408 and
-- 20260518. Several of them rewrite the SAME policy names with DIFFERENT
-- predicates, and none of them are in the docs/AGENTS_ROADMAP.md §5 applied
-- checklist. That means nobody can tell which revision production is running,
-- and at least one interim revision is actively unsafe.
--
-- This migration is a CONVERGENCE migration. It does not assume any particular
-- prior state: it drops every historical policy name it knows about and then
-- writes one authoritative set, so re-applying it lands on the same result
-- regardless of which revision is currently live and regardless of the order
-- other memory migrations ran in.
--
-- Covered (numbers match the review findings):
--   1. memory_entries authoritative policy set (4 competing revisions)
--   2. circle_memory / circle_memory_history — USING(true) convergence + DELETE
--   3. memory_evaluations RLS ignores memory visibility
--   4. memory_access_log INSERTs silently rejected (USING with no WITH CHECK)
--   5. dead tsvector FTS index replaced with trigram indexes the callers can use
--   6. hot-path sort indexes + memory_access_log retention
--   7. SET search_path on SECURITY DEFINER maintenance functions
--   8. soft-delete data-retention hazard — DOCUMENTED ONLY, see the bottom
--
-- Everything here is idempotent: IF NOT EXISTS, DROP POLICY IF EXISTS then
-- CREATE, CREATE OR REPLACE, and existence-guarded ALTER. Safe to run
-- repeatedly and safe to run before or after any other pending migration.


-- ═══════════════════════════════════════════════════════════════════════════════
-- 0. RUN THIS FIRST — human verification query (does not run automatically)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Before applying, capture what production actually has. We cannot infer it:
-- four migrations write the same policy names on memory_entries, and the §5
-- checklist has never tracked any of them.
--
-- Paste this into the Supabase SQL Editor, save the output, THEN apply this
-- migration. The saved output is your rollback reference and the only record of
-- which revision was live.
--
--   SELECT
--     tablename,
--     policyname,
--     cmd,
--     roles,
--     qual        AS using_expression,
--     with_check  AS with_check_expression
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'memory_entries',
--       'memory_sources',
--       'memory_evaluations',
--       'memory_access_log',
--       'memory_soul_links',
--       'soul_wisdom',
--       'circle_memory',
--       'circle_memory_history'
--     )
--   ORDER BY tablename, policyname, cmd;
--
-- The single most important thing to look for on `memory_entries`:
--
--   policyname = 'memory_select_private'
--
--   * SAFE (owner-only, from 20260413_agent_memory_private_owner_only.sql):
--       (visibility = 'private') AND (user_id = auth.uid())
--
--   * UNSAFE (interim revision 20260413_agent_memory_private_rls.sql:50-65):
--       ... OR (scope = 'agent' AND circle_id IN (SELECT circle_id FROM
--       circle_members WHERE user_id = auth.uid()))
--     ^ this lets ANY circle member SELECT visibility='private' agent
--       memories. If production shows this, private agent memory has been
--       readable circle-wide for the entire window since it was applied, and
--       that window needs an incident note — applying this migration closes the
--       hole but does not undo any reads that already happened.
--
-- Two other things worth reading off the same output:
--   * circle_memory / circle_memory_history with `qual = true` means the
--     original USING(true) policy from 20260226_hitl.sql is STILL LIVE and every
--     authenticated user in the product can read and write every circle's
--     memory doc. Section 2 below closes that.
--   * memory_entries `visibility` CHECK constraint differs between the two
--     historical base tables (20260408_unified_agent_runs.sql allows
--     room_shared/org_shared; 20260411_memory_entries_standalone.sql allows
--     'public' instead). Confirm with:
--       SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conrelid = 'public.memory_entries'::regclass AND contype = 'c';


-- ═══════════════════════════════════════════════════════════════════════════════
-- 0b. Prerequisite memory_entries columns — no-op when present
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: the policies and indexes below reference three columns that the base
-- table did not ship with — `visibility`
-- (20260408_memory_v2_retrieval_privacy.sql), `agent_id`
-- (20260411_agent_memory_scope.sql) and `importance`
-- (20260408_memory_privacy_fix.sql). None of those migrations is in the §5
-- checklist, so we cannot assume they ran. CREATE POLICY / CREATE INDEX fail
-- hard on a missing column, which would abort this whole file.
--
-- Defaults match the source migrations exactly. This is additive only and a
-- no-op wherever the columns already exist — it does not reconcile a divergent
-- CHECK constraint (see the note at the end of section 0).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memory_entries'
      AND column_name = 'visibility'
  ) THEN
    ALTER TABLE memory_entries ADD COLUMN visibility text NOT NULL DEFAULT 'circle_shared'
      CHECK (visibility IN ('private','room_shared','circle_shared','org_shared'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memory_entries'
      AND column_name = 'agent_id'
  ) THEN
    ALTER TABLE memory_entries ADD COLUMN agent_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memory_entries'
      AND column_name = 'importance'
  ) THEN
    ALTER TABLE memory_entries ADD COLUMN importance numeric(3,2) DEFAULT 0.5;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. memory_entries — one authoritative policy set
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: four migrations rewrite these policy names with different predicates:
--   20260408_memory_privacy_fix.sql            → "memory_entries_access" (FOR ALL, scope-based)
--   20260408_memory_v2_retrieval_privacy.sql   → memory_select_* (visibility-based, owner-only private)
--   20260413_agent_memory_private_rls.sql      → memory_select_private LEAKS private agent memory circle-wide
--   20260413_agent_memory_private_owner_only.sql → owner-only (the intended end state)
-- plus two competing base tables that ship "memory_via_circle" / "memory_read".
--
-- Because Postgres ORs permissive policies together, a single surviving legacy
-- policy re-opens everything the later ones closed. So: drop every name any
-- revision ever created, then write the owner-only set. Predicates below are the
-- 20260413_..._owner_only.sql set, unchanged — this migration does not invent new
-- access rules, it just makes that revision the guaranteed terminal state.

DROP POLICY IF EXISTS "memory_via_circle"     ON memory_entries;  -- 20260408_unified_agent_runs.sql
DROP POLICY IF EXISTS "memory_entries_access" ON memory_entries;  -- 20260408_memory_privacy_fix.sql
DROP POLICY IF EXISTS "memory_read"           ON memory_entries;  -- 20260411_memory_entries_standalone.sql
DROP POLICY IF EXISTS "memory_insert"         ON memory_entries;
DROP POLICY IF EXISTS "memory_update"         ON memory_entries;
DROP POLICY IF EXISTS "memory_delete"         ON memory_entries;
DROP POLICY IF EXISTS memory_select_shared    ON memory_entries;
DROP POLICY IF EXISTS memory_select_private   ON memory_entries;
DROP POLICY IF EXISTS memory_insert           ON memory_entries;
DROP POLICY IF EXISTS memory_update           ON memory_entries;
DROP POLICY IF EXISTS memory_delete           ON memory_entries;

ALTER TABLE memory_entries ENABLE ROW LEVEL SECURITY;

-- Shared memory: any member of the owning circle.
CREATE POLICY memory_select_shared ON memory_entries
FOR SELECT TO authenticated
USING (
  visibility IN ('room_shared','circle_shared','org_shared')
  AND circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  )
);

-- Private memory: the owner and nobody else. This includes scope='agent'
-- private memory — an agent's private working notes belong to the human who
-- ran the agent, not to the circle. Agent-private memory stays cross-session
-- for the same authenticated owner.
CREATE POLICY memory_select_private ON memory_entries
FOR SELECT TO authenticated
USING (
  visibility = 'private'
  AND user_id = auth.uid()
);

-- Writes: private rows must be stamped with the writer's own user_id (agent
-- rows additionally need agent_id + circle membership); shared rows require
-- membership in the target circle.
CREATE POLICY memory_insert ON memory_entries
FOR INSERT TO authenticated
WITH CHECK (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND user_id = auth.uid()
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY memory_update ON memory_entries
FOR UPDATE TO authenticated
USING (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND user_id = auth.uid()
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
)
WITH CHECK (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND user_id = auth.uid()
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY memory_delete ON memory_entries
FOR DELETE TO authenticated
USING (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND user_id = auth.uid()
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. circle_memory / circle_memory_history — close USING(true), add DELETE
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: both tables shipped with
--     CREATE POLICY circle_memory_auth ... FOR ALL TO authenticated
--       USING (true) WITH CHECK (true)
-- in 20260226_hitl.sql:59 and again in 20260313_missing_tables.sql:278. That is
-- unrestricted cross-tenant read AND write of every circle's memory doc by any
-- signed-in user in the product. Two later migrations fix it
-- (20260325_security_warnings_fix.sql:124-157 and 20260411_memory_cleanup.sql:8-27)
-- but NEITHER is in the §5 checklist, so we cannot assume either ran.
--
-- The two fixes also disagree on names — 20260411 drops
-- circle_memory_select/insert/update (20260325's names) and replaces them with
-- cm_doc_*, but only drops circle_memory_history_auth on the history table
-- without replacing its INSERT policy. So if 20260411 ran and 20260325 did not,
-- circle_memory_history has a SELECT policy and NO INSERT policy, and every
-- client history write silently fails — that write path is live in
-- src/lib/chatCheckpoints.ts:331 and src/services/sharedMemory.ts:175, and
-- circle_memory_history is the ONLY undo for a memory-doc edit
-- (see src/lib/circleMemoryWriteCore.ts:13).
--
-- Convergence: drop every historical name on both tables, then write one
-- per-command set gated on circle membership.

DROP POLICY IF EXISTS "circle_memory_auth"    ON circle_memory;  -- 20260226_hitl.sql — USING(true)
DROP POLICY IF EXISTS "circle_memory_select"  ON circle_memory;  -- 20260325_security_warnings_fix.sql
DROP POLICY IF EXISTS "circle_memory_insert"  ON circle_memory;
DROP POLICY IF EXISTS "circle_memory_update"  ON circle_memory;
DROP POLICY IF EXISTS "circle_memory_delete"  ON circle_memory;
DROP POLICY IF EXISTS "cm_doc_select"         ON circle_memory;  -- 20260411_memory_cleanup.sql
DROP POLICY IF EXISTS "cm_doc_insert"         ON circle_memory;
DROP POLICY IF EXISTS "cm_doc_update"         ON circle_memory;
DROP POLICY IF EXISTS "cm_doc_delete"         ON circle_memory;

ALTER TABLE circle_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_doc_select ON circle_memory
FOR SELECT TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY cm_doc_insert ON circle_memory
FOR INSERT TO authenticated
WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- WITH CHECK is stated explicitly rather than inherited from USING so a member
-- cannot re-point a row at a circle they do not belong to.
CREATE POLICY cm_doc_update ON circle_memory
FOR UPDATE TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- DELETE was missing entirely, so "delete this memory doc" was impossible
-- through the API and a circle could never actually drop a doc_kind row it no
-- longer wants. Granting it to circle members adds no real authority: a member
-- who can UPDATE can already blank `content` to ''. Circle deletion itself is
-- unaffected either way — the circles(id) FK cascade runs as the system and
-- bypasses RLS.
CREATE POLICY cm_doc_delete ON circle_memory
FOR DELETE TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "circle_memory_history_auth"   ON circle_memory_history;  -- USING(true)
DROP POLICY IF EXISTS "circle_memory_history_select" ON circle_memory_history;
DROP POLICY IF EXISTS "circle_memory_history_insert" ON circle_memory_history;
DROP POLICY IF EXISTS "cm_history_select"            ON circle_memory_history;
DROP POLICY IF EXISTS "cm_history_insert"            ON circle_memory_history;

ALTER TABLE circle_memory_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_history_select ON circle_memory_history
FOR SELECT TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Restores the INSERT capability the client undo path depends on, regardless of
-- which of the two prior fixes ran.
CREATE POLICY cm_history_insert ON circle_memory_history
FOR INSERT TO authenticated
WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- DELIBERATELY NO UPDATE/DELETE POLICY ON circle_memory_history.
-- The review flagged the missing DELETE policy on both tables, but these two
-- tables are not symmetric. circle_memory_history is the edit audit trail and
-- the only undo record; letting a member erase it is strictly MORE authority
-- than they have today and is exactly the capability an accountability product
-- must withhold. Append-only is the correct posture. Bulk history trimming, if
-- it is ever wanted, belongs in a service-role retention job like the one in
-- section 6 — not in a client-reachable policy.


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2b. Prerequisite tables — no-op when present
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: sections 3-6 rewrite policies on memory_sources, memory_evaluations and
-- memory_access_log. `DROP POLICY IF EXISTS ... ON t` and `ALTER TABLE t` both
-- still require `t` to exist, so this file would abort on a database that never
-- ran 20260408_memory_v2_retrieval_privacy.sql — which is exactly the state we
-- cannot rule out, since that migration is not in the §5 checklist either.
--
-- These three definitions are copied verbatim from that migration (:80-:158).
-- IF NOT EXISTS makes them a no-op wherever the tables already exist — this
-- does NOT reconcile column drift, it only guarantees the rest of the file can
-- run in any order. memory_entries, circle_memory and circle_memory_history are
-- assumed present; every live app path already depends on them.

CREATE TABLE IF NOT EXISTS memory_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('message','run','step','artifact','approval','manual')),
  source_id uuid,
  excerpt text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_sources_memory ON memory_sources(memory_id);

CREATE TABLE IF NOT EXISTS memory_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  evaluation_kind text NOT NULL CHECK (evaluation_kind IN ('quality','contradiction','sensitivity','durability','manual_review')),
  evaluator text NOT NULL DEFAULT 'auto',
  passed boolean,
  score numeric(3,2),
  feedback text,
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_memory_evaluations_memory ON memory_evaluations(memory_id);

CREATE TABLE IF NOT EXISTS memory_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  surface text,
  reason text NOT NULL CHECK (reason IN ('startup','retrieval','session_resume','manual_pin','search')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory ON memory_access_log(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_run ON memory_access_log(run_id) WHERE run_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. memory_evaluations — respect the parent memory's visibility
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: 20260408_memory_v2_retrieval_privacy.sql:117-120 gates memory_evaluations
-- on circle membership ALONE:
--     USING (memory_id IN (SELECT id FROM memory_entries
--            WHERE circle_id IN (SELECT circle_id FROM circle_members ...)))
-- It never checks `visibility`. Evaluation rows carry `feedback` text plus
-- quality/contradiction/sensitivity verdicts that an automated evaluator wrote
-- ABOUT the memory, so any circle member can enumerate and read auto-generated
-- commentary on every PRIVATE memory in the circle — including which private
-- memories exist and how many there are.
--
-- The sibling policy memory_sources_access (:91-96) already has the right
-- predicate. This copies it verbatim so the two stay in lockstep. It also
-- restores the private-owner branch that the circle-only predicate dropped, so
-- an owner keeps access to evaluations of their own private memories.

DROP POLICY IF EXISTS memory_evaluations_access ON memory_evaluations;

ALTER TABLE memory_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_evaluations_access ON memory_evaluations
FOR ALL TO authenticated
USING (
  memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
)
WITH CHECK (
  memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
);

-- Same omission exists on memory_sources: the policy is FOR ALL with USING and
-- no WITH CHECK, so INSERT reuses USING. There the predicate happens to be
-- correct for writes too, but stating it explicitly removes the dependency on
-- that coincidence and on the FOR ALL fallback rule.
DROP POLICY IF EXISTS memory_sources_access ON memory_sources;

ALTER TABLE memory_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_sources_access ON memory_sources
FOR ALL TO authenticated
USING (
  memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
)
WITH CHECK (
  memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. memory_access_log — stop silently rejecting provenance INSERTs
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: 20260408_memory_v2_retrieval_privacy.sql:164-169 declares
--     CREATE POLICY memory_access_log_access ON memory_access_log FOR ALL
--       USING (user_id = auth.uid() OR run_id IN (...))
-- with NO WITH CHECK. For FOR ALL policies Postgres reuses USING as the INSERT
-- check, so every inserted row must satisfy the READ predicate.
--
-- Three of the four writers cannot satisfy it:
--   * src/lib/memoryService.ts:3297  logMemoryAccess() sends `user_id: userId || null`
--     and no run_id at all
--   * src/lib/memoryService.ts:1080  sends `user_id: opts.userId || null`
--   * src/lib/agentRunSystem.ts:1650  sends `user_id: userId` (undefined → absent)
-- When userId is undefined both sides evaluate NULL/false and the row is
-- rejected. Every writer swallows the error (`.then(() => {})`, `catch {}`), so
-- the failure is silent and provenance simply vanishes. The user-visible
-- symptom is src/lib/memoryActions.ts:265 loadCitationsForMessage() returning
-- nothing — "which memories were used for this message" goes blank with no
-- error anywhere.
--
-- Fix: split read from write and give INSERT its own WITH CHECK. The writer may
-- stamp its own user_id or leave it NULL (a background/system retrieval with no
-- authenticated subject is a legitimate provenance row), but the referenced
-- memory must be one the caller can actually see — that is what stops the log
-- from becoming a private-memory-existence oracle.

DROP POLICY IF EXISTS memory_access_log_access ON memory_access_log;
DROP POLICY IF EXISTS memory_access_log_select ON memory_access_log;
DROP POLICY IF EXISTS memory_access_log_insert ON memory_access_log;

ALTER TABLE memory_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_access_log_select ON memory_access_log
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR run_id IN (
    SELECT id FROM agent_runs
    WHERE circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  )
);

CREATE POLICY memory_access_log_insert ON memory_access_log
FOR INSERT TO authenticated
WITH CHECK (
  (user_id IS NULL OR user_id = auth.uid())
  AND memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
);

-- DELIBERATELY NO UPDATE/DELETE POLICY. This is an audit trail; nothing in the
-- app updates or deletes rows (only the three inserts above and the read at
-- src/lib/memoryActions.ts:273), and append-only is the point. Retention is
-- handled service-side in section 6.


-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Keyword search — replace the dead FTS index with trigram indexes
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: 20260408_memory_v2_retrieval_privacy.sql:172-173 builds
--     CREATE INDEX idx_memory_entries_fts ON memory_entries
--       USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')))
-- but NOTHING calls .textSearch() anywhere in src/ or supabase/functions/ — the
-- whole codebase reaches memory keywords through PostgREST `.or()` filters:
--     title.ilike.%term%,content.ilike.%term%
-- (src/lib/memoryService.ts:900, :2684, src/lib/agentMemory.ts:649,
--  src/lib/memoryActions.ts:199).
-- A tsvector GIN index cannot serve an ILIKE '%...%' predicate, so that index
-- has only ever cost write amplification on every memory insert/update and
-- returned zero reads. Meanwhile the ILIKE path is a sequential scan over the
-- circle's memories, and it runs on EVERY turn where the embedding proxy is
-- unavailable (semanticSearchMemories returns [] and memoryService falls back).
--
-- pg_trgm is already enabled repo-wide (20260430_global_search.sql:7) and the
-- same gin_trgm_ops pattern is already used for missions/tasks/goals/messages.
-- This applies it to memory_entries.
--
-- Index shape: separate GIN indexes on title and content so the planner can
-- BitmapOr them for the two-sided `.or()` filter. Partial on is_active = true —
-- all four ILIKE callers pass .eq('is_active', true), and restricting to live
-- rows keeps the index off the soft-deleted backlog. A future caller that omits
-- `is_active = true` will NOT be able to use these.
--
-- Caveat worth knowing: trigram indexes only help for search terms of 3+
-- characters. memoryService.extractSearchTerms already drops shorter tokens.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_memory_entries_title_trgm
  ON memory_entries USING gin (title gin_trgm_ops)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_memory_entries_content_trgm
  ON memory_entries USING gin (content gin_trgm_ops)
  WHERE is_active = true;

-- Drop the dead tsvector index. Provably unused (no .textSearch(), no other
-- to_tsvector reference against memory_entries anywhere in the repo) and purely
-- a write tax. Fully reversible — to restore it:
--   CREATE INDEX IF NOT EXISTS idx_memory_entries_fts ON memory_entries
--     USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));
-- If you later want real ranked FTS, prefer a stored generated tsvector column
-- plus .textSearch() over resurrecting this expression index.
DROP INDEX IF EXISTS idx_memory_entries_fts;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Hot-path sort indexes + memory_access_log growth control
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY (memory_entries): the prompt-build reads filter on (circle_id, is_active)
-- and then need an ordered prefix. The only index covering that filter is
--     idx_memory_circle (circle_id, scope, is_active) WHERE is_active = true
-- which puts `scope` BETWEEN the two filter columns and carries neither sort
-- key, so every read still sorts the whole matching set. Two shapes are needed:
--
--   a) importance DESC, updated_at DESC — the ranked read
--      (src/lib/memoryEmbeddings.ts:174 backfill; the same ordering is applied
--       client-side after fetch in src/lib/agentRunSystem.ts:1579, which is
--       exactly the sort that should be pushed into the index)
--   b) scope-filtered created_at DESC — the shared-scope prompt loader
--      (src/lib/agentRunSystem.ts:1401, LIMIT 30 per prompt build)
--
-- NOTE: plain CREATE INDEX takes a SHARE lock that blocks writes to
-- memory_entries for the duration. On a large table run these two statements
-- separately with CONCURRENTLY instead (CONCURRENTLY cannot run inside a
-- transaction block, so it will fail if pasted with the rest of this file).

CREATE INDEX IF NOT EXISTS idx_memory_entries_circle_rank
  ON memory_entries (circle_id, importance DESC, updated_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_memory_entries_circle_scope_recent
  ON memory_entries (circle_id, scope, created_at DESC)
  WHERE is_active = true;

-- WHY (memory_access_log): this table takes 12-15 INSERTs per turn
-- (memoryService.logMemoryAccess slices to 12, agentRunSystem slices to 15) and
-- has no retention policy at all, so it is the fastest-growing table in the
-- memory system and the only one that grows purely with usage.
--
-- Existing indexes cover memory_id and run_id, but the actual read path is
-- src/lib/memoryActions.ts:265 loadCitationsForMessage():
--     .eq('user_id', …).eq('reason','retrieval')
--     .gte('created_at', …).lte('created_at', …).order('created_at' DESC)
-- which nothing supports. And the retention sweep below needs created_at.

CREATE INDEX IF NOT EXISTS idx_memory_access_log_user_created
  ON memory_access_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_access_log_created
  ON memory_access_log (created_at);

-- Bounded retention sweep. Deletes only audit-log rows past the retention
-- window — never memory content, never a memory_entries row. Batched so one
-- tick can never take a long lock on a hot table. The 30-day floor and the
-- p_max_rows range check exist so a mistyped call cannot turn this into a
-- table wipe. Service-only: REVOKEd from every client role below, so the sole
-- callers are the cron job and an operator holding the service role.
CREATE OR REPLACE FUNCTION public.prune_memory_access_log(
  p_retain_days int DEFAULT 180,
  p_max_rows int DEFAULT 50000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF p_retain_days IS NULL OR p_retain_days < 30 THEN
    RAISE EXCEPTION 'prune_memory_access_log_retain_days_below_floor';
  END IF;
  IF p_max_rows IS NULL OR p_max_rows < 1 OR p_max_rows > 500000 THEN
    RAISE EXCEPTION 'prune_memory_access_log_max_rows_out_of_range';
  END IF;

  WITH doomed AS (
    SELECT id
    FROM public.memory_access_log
    WHERE created_at < now() - make_interval(days => p_retain_days)
    ORDER BY created_at
    LIMIT p_max_rows
  )
  DELETE FROM public.memory_access_log l
  USING doomed d
  WHERE l.id = d.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_memory_access_log(int, int)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.prune_memory_access_log(int, int) IS
  'Service-only bounded retention sweep for memory_access_log. Deletes audit rows older than p_retain_days (floor 30) in batches of p_max_rows. Never touches memory content.';

-- pg_cron is optional in local/self-hosted environments. Unschedule first so
-- rerunning this migration never stacks duplicate jobs. Daily at 04:07 UTC —
-- ahead of the 04:42 tick_memory_maintenance job so the two do not overlap.
-- To opt out entirely:
--   SELECT cron.unschedule('prune-memory-access-log');
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable; run prune_memory_access_log() manually';
  ELSE
    BEGIN
      EXECUTE
        'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1'
        USING 'prune-memory-access-log';
      EXECUTE
        'SELECT cron.schedule($1, $2, $3)'
        USING
          'prune-memory-access-log',
          '7 4 * * *',
          'SELECT public.prune_memory_access_log()';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron unavailable; run prune_memory_access_log() manually';
    END;
  END IF;
END;
$cron$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. SET search_path on the SECURITY DEFINER memory maintenance functions
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: these four run as the definer (superuser-equivalent in Supabase) with an
-- attacker-influenceable search_path:
--     cleanup_stale_session_memories()      20260411_memory_cleanup.sql:34
--     decay_session_memories()              20260419_memory_maintenance.sql:28
--     collapse_near_dup_by_embedding(...)   20260419_memory_maintenance.sql:84
--     tick_memory_maintenance()             20260419_memory_maintenance.sql
-- Every table and operator reference inside them resolves through whatever
-- search_path the caller had, which is the classic SECURITY DEFINER hijack.
-- 20260518_fix_pgcrypto_search_path.sql already established the fix pattern for
-- this repo; this applies it to the memory maintenance surface.
--
-- Two of these ARE client-callable: src/lib/memoryConsolidation.ts:178 and :198
-- call decay_session_memories and collapse_near_dup_by_embedding via
-- supabase.rpc(), and 20260419 GRANTs EXECUTE on all three to `authenticated`.
-- So the hijack path is reachable by any signed-in user today.
--
-- We use ALTER FUNCTION rather than CREATE OR REPLACE on purpose: it changes
-- only the search_path setting and cannot drift the function bodies away from
-- whatever revision production actually has. Guarded by to_regprocedure so a
-- database missing any of them is a no-op rather than an error.
--
-- `extensions` is included because collapse_near_dup_by_embedding uses the
-- pgvector `<=>` operator and the `vector` type, which Supabase installs into
-- the extensions schema. Pinning search_path to `public` alone would BREAK that
-- function.
--
-- NOT CHANGED HERE, but flagged: 20260419 GRANTs EXECUTE on all three to
-- `authenticated`, so any signed-in user can invoke global, cross-circle memory
-- deactivation. tick_memory_maintenance() in particular has no caller in src/
-- or supabase/functions/ and should probably be service-role only. Left alone
-- because revoking is a behavior change beyond this migration's scope and two
-- of the three have live client callers.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.cleanup_stale_session_memories()',
    'public.decay_session_memories()',
    'public.collapse_near_dup_by_embedding(uuid, double precision, integer)',
    'public.tick_memory_maintenance()'
  ]
  LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path = public, extensions, pg_catalog',
        fn
      );
    ELSE
      RAISE NOTICE 'search_path fix skipped — % not present', fn;
    END IF;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Soft-delete data retention — PROPOSAL ONLY, NOTHING EXECUTED
-- ═══════════════════════════════════════════════════════════════════════════════
-- Deliberately not implemented. Deleting user data is a product decision, not a
-- migration's call. Written down here so the decision is made once, explicitly,
-- by a human — instead of being rediscovered by the next reviewer.
--
-- THE HAZARD
-- Every user-facing "delete"/"forget" path is a soft delete —
-- `is_active: false` (src/lib/memoryActions.ts:150 forgetMemory,
-- :211 rageForget, src/lib/memoryService.ts:2695). The ON DELETE CASCADE FKs on
-- memory_sources, memory_evaluations, memory_access_log and memory_soul_links
-- therefore NEVER fire. After a user says "forget that", the full `content`,
-- `title`, the 1536-dim `embedding` derived from them, `memory_sources.excerpt`
-- and the entire access history all remain in the table indefinitely. The row is
-- invisible in the UI and still present in the database. That is a truthfulness
-- gap and, for anyone with a deletion obligation, a compliance gap.
--
-- WHY NOT EVEN THE "SAFE HALF" (clearing `embedding` on deactivate)
-- Considered and rejected:
--   * It does not close the gap. The embedding is a lossy derivative; `content`,
--     `title` and `memory_sources.excerpt` — the actual sensitive text — all
--     survive. It buys the appearance of deletion without the substance, which
--     is worse than doing nothing openly.
--   * It silently breaks a working feature. src/lib/memoryActions.ts:237
--     undoRageForget() flips is_active back to true; with the embedding gone the
--     restored memory is invisible to semantic search until an unrelated manual
--     job (memoryEmbeddings.backfillMemoryEmbeddings) happens to run. Undo would
--     appear to succeed and quietly return degraded memory.
--   * collapse_near_dup_by_embedding() deactivates rows automatically. A
--     deactivate-time trigger would make routine maintenance destructive.
--   * It makes a SOFT delete partially HARD, which is the worst of both: not
--     recoverable, not actually deleted.
--
-- PROPOSED REAL FIX (needs a human decision, then its own migration)
--   1. Add `deactivated_at timestamptz` set on the is_active true→false edge, so
--      "how long has this been soft-deleted" is answerable at all. Today it is
--      not — `updated_at` is bumped by unrelated writes.
--   2. Add a service-only, REVOKEd `purge_deactivated_memories(p_older_than
--      interval)` that hard-DELETEs rows deactivated longer than the grace
--      window, letting the existing CASCADEs finally do their job. Grace window
--      must be >= the undo window the UI advertises.
--   3. Give the user-facing "forget" a true hard-delete option distinct from
--      soft delete, and say which one it is in the UI.
--
-- THE INVERSE HAZARD (also unresolved, and it points the other way)
--   memory_entries.user_id is `REFERENCES auth.users(id) ON DELETE CASCADE`
--   (20260408_unified_agent_runs.sql:198 and 20260411_memory_entries_standalone.sql:14).
--   Deleting one user therefore destroys every `circle_shared` memory THEY
--   authored — team knowledge the circle still owns and depends on vanishes when
--   a member leaves. The obvious patch (ON DELETE SET NULL) is not safe as a
--   drop-in either: `visibility='private'` rows are gated on `user_id =
--   auth.uid()`, so a NULLed owner turns them into permanently unreadable
--   orphans that no policy can reach and no purge job targets. A correct fix has
--   to split the two cases — hard-delete the departing user's private rows,
--   re-attribute shared rows to the circle — and that is a product decision
--   about what a departing member's contributions become.


NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('memory_entries','memory_sources','memory_evaluations',
--                        'memory_access_log','circle_memory','circle_memory_history')
--    ORDER BY tablename, policyname;
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename IN ('memory_entries','memory_access_log')
--    ORDER BY indexname;
--   SELECT p.proname, p.proconfig FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('cleanup_stale_session_memories','decay_session_memories',
--                        'collapse_near_dup_by_embedding','tick_memory_maintenance',
--                        'prune_memory_access_log');
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'prune-memory-access-log';
