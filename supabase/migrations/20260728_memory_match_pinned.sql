-- Memory retrieval: carry `pinned` out of match_memories().
--
-- THE BUG: memory_entries.pinned has existed since
-- 20260408_memory_v2_retrieval_privacy.sql and pinMemory()/unpinMemory() write
-- it, but the match_memories() RPC added in 20260417_memory_embeddings.sql never
-- projected the column. memoryService.retrieveForTurn reads `(c as any).pinned`
-- and applies a 0.12 boost — against a field that was always undefined. Pinning
-- a memory therefore changed NOTHING about what the model saw. (The keyword
-- fallback branch dropped it too; that half is fixed in mapMemoryEntry.)
--
-- THE FIX: recreate match_memories() with `pinned` in the RETURNS TABLE.
--
-- SECURITY MODEL — UNCHANGED AND DELIBERATE. This function stays SECURITY
-- INVOKER (the default). That is precisely what makes semantic search honor RLS:
-- the SELECT inside runs as the CALLING user, so memory_select_shared /
-- memory_select_private filter the rows exactly as they would through the REST
-- API. Making it SECURITY DEFINER would turn a similarity search into a
-- cross-circle, cross-user memory leak. Do not "fix" it that way.
--
-- Idempotent: safe to run repeatedly. Postgres refuses CREATE OR REPLACE when
-- the return type changes ("cannot change return type of existing function"),
-- so every existing overload is dropped by oid first — which also survives any
-- signature drift between environments.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Guarantee the column exists (no-op where 20260408 already ran)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'memory_entries'
      AND column_name = 'pinned'
  ) THEN
    ALTER TABLE public.memory_entries ADD COLUMN pinned boolean DEFAULT false;
  END IF;
END $$;

-- Retrieval reads `pinned` on every turn; keep the pinned set cheap to find.
CREATE INDEX IF NOT EXISTS idx_memory_entries_pinned
  ON public.memory_entries (circle_id)
  WHERE pinned = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Drop every existing overload of match_memories
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'match_memories'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s;', fn.sig);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Recreate with `pinned` projected
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.match_memories(
  p_query_embedding vector(1536),
  p_circle_id uuid DEFAULT NULL,
  p_match_threshold float DEFAULT 0.0,   -- client now passes its own floor
  p_match_count int DEFAULT 20,
  p_soul_key text DEFAULT NULL           -- optional filter: only memories linked to this SOUL
)
RETURNS TABLE (
  id uuid,
  scope text,
  circle_id uuid,
  user_id uuid,
  agent_id text,
  memory_kind text,
  title text,
  content text,
  importance numeric,
  retrieval_mode text,
  visibility text,
  pinned boolean,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER   -- explicit: RLS on memory_entries must apply to the caller
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.scope,
    m.circle_id,
    m.user_id,
    m.agent_id,
    m.memory_kind,
    m.title,
    m.content,
    m.importance,
    m.retrieval_mode,
    m.visibility,
    COALESCE(m.pinned, false) AS pinned,
    m.metadata,
    m.created_at,
    m.updated_at,
    (1 - (m.embedding <=> p_query_embedding))::float AS similarity
  FROM memory_entries m
  WHERE m.is_active = true
    AND m.embedding IS NOT NULL
    AND (p_circle_id IS NULL OR m.circle_id = p_circle_id)
    AND (1 - (m.embedding <=> p_query_embedding)) >= p_match_threshold
    AND (
      p_soul_key IS NULL
      OR EXISTS (
        SELECT 1 FROM memory_soul_links sl
        WHERE sl.memory_id = m.id AND sl.soul_key = p_soul_key
      )
    )
  ORDER BY m.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_memories(vector, uuid, float, int, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
