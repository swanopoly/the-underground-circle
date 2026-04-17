-- Memory Embeddings — Phase 1 of the Agent Memory God Plan.
-- Adds pgvector column + ANN index + RPC for semantic retrieval.
--
-- Design choices:
--   * vector(1536) — matches OpenAI text-embedding-3-small; widely supported
--     and leaves room to swap providers without schema churn.
--   * ivfflat with lists=100 — good default for 10k-100k rows. Can upgrade
--     to hnsw later if recall/latency demand it (hnsw = better recall at
--     higher write cost; ivfflat = faster writes, slightly lower recall).
--   * match_memories() RPC returns only memories the caller can already see
--     via the existing memory_entries RLS policies — we don't bypass RLS.
--   * embedded_at column lets backfill jobs know what's stale or missing.
--   * embedding_model column records the provider+model so we can re-embed
--     safely when we swap models.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Enable pgvector (Supabase has this available; no-op if already on)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Add columns to memory_entries
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'memory_entries' AND column_name = 'embedding') THEN
    ALTER TABLE memory_entries ADD COLUMN embedding vector(1536);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'memory_entries' AND column_name = 'embedding_model') THEN
    ALTER TABLE memory_entries ADD COLUMN embedding_model text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'memory_entries' AND column_name = 'embedded_at') THEN
    ALTER TABLE memory_entries ADD COLUMN embedded_at timestamptz;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. ANN index on the embedding column
-- ═══════════════════════════════════════════════════════════════════════════════
-- We use the cosine operator class because OpenAI embeddings are normalized
-- and cosine similarity is the standard retrieval metric for them.
-- lists=100 is appropriate for ~10k-500k rows.

CREATE INDEX IF NOT EXISTS idx_memory_entries_embedding
  ON memory_entries USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. RPC: semantic memory search with RLS respected
-- ═══════════════════════════════════════════════════════════════════════════════
-- SECURITY INVOKER (default) means RLS policies on memory_entries apply to
-- the SELECT inside, so callers only ever see memories they could already
-- see through the regular API. No bypass.

CREATE OR REPLACE FUNCTION match_memories(
  p_query_embedding vector(1536),
  p_circle_id uuid DEFAULT NULL,
  p_match_threshold float DEFAULT 0.0,   -- 0 = return everything sorted by similarity
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
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
STABLE
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

GRANT EXECUTE ON FUNCTION match_memories TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Coverage view — track backfill progress
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW memory_embedding_coverage AS
SELECT
  circle_id,
  COUNT(*) AS total_active,
  COUNT(embedding) AS with_embedding,
  COUNT(*) - COUNT(embedding) AS missing,
  ROUND(
    100.0 * COUNT(embedding) / NULLIF(COUNT(*), 0),
    1
  ) AS percent_embedded,
  MIN(embedded_at) AS oldest_embedding,
  MAX(embedded_at) AS newest_embedding
FROM memory_entries
WHERE is_active = true
GROUP BY circle_id;

NOTIFY pgrst, 'reload schema';
