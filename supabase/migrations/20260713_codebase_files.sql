-- ═══════════════════════════════════════════════════════════════════════════
-- codebase_files — P4 of docs/CODING_AGENT_UPGRADE_PLAN.md (Cursor-style
-- codebase awareness). Stores the per-user index of a local repo crawled via
-- the desktop bridge: one row per indexed file with extracted symbols, a short
-- summary, and an embedding for semantic search.
--
-- Design choices (mirrors 20260417_memory_embeddings.sql):
--   * vector(1536) — matches OpenAI text-embedding-3-small, the same model
--     memoryEmbeddings already routes through llm-proxy ('openai-embed').
--   * ivfflat lists=100 — right-sized for ≤ ~50k rows per user; revisit if a
--     team indexes many large monorepos.
--   * match_codebase_files is SECURITY INVOKER (the default) — the table's RLS
--     applies INSIDE the function, so a user can only ever match their own
--     rows. No bypass.
--   * No file CONTENT is stored — only path, symbols, summary, sizes. The
--     summary/symbols are derived from the file head client-side
--     (codebaseSymbolCore.ts); raw code stays on the user's machine.
--   * embedding_model + embedded_at are provenance so a provider migration can
--     re-embed only stale rows.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. pgvector ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── 2. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS codebase_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid,
  repo_root text NOT NULL,
  path text NOT NULL,
  language text,
  symbols text[] NOT NULL DEFAULT '{}',
  summary text,
  size_bytes bigint,
  embedding vector(1536),
  embedding_model text,
  embedded_at timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, repo_root, path)
);

CREATE INDEX IF NOT EXISTS idx_codebase_files_user_root
  ON codebase_files (user_id, repo_root);

CREATE INDEX IF NOT EXISTS idx_codebase_files_embedding
  ON codebase_files USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── 3. RLS — strictly owner-scoped (the index describes a user's LOCAL disk;
--        it is never shared circle-wide, even when circle_id is stamped) ──────
ALTER TABLE codebase_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS codebase_files_owner ON codebase_files;
CREATE POLICY codebase_files_owner ON codebase_files
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── 4. Semantic match RPC ───────────────────────────────────────────────────
-- SECURITY INVOKER (default): RLS above applies inside — callers only match
-- their own rows. Returns cosine similarity like match_memories.
CREATE OR REPLACE FUNCTION match_codebase_files(
  p_query_embedding vector(1536),
  p_repo_root text DEFAULT NULL,
  p_match_threshold float DEFAULT 0.0,
  p_match_count int DEFAULT 20
)
RETURNS TABLE (
  path text,
  language text,
  symbols text[],
  summary text,
  repo_root text,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.path,
    f.language,
    f.symbols,
    f.summary,
    f.repo_root,
    (1 - (f.embedding <=> p_query_embedding))::float AS similarity
  FROM codebase_files f
  WHERE f.embedding IS NOT NULL
    AND (p_repo_root IS NULL OR f.repo_root = p_repo_root)
    AND (1 - (f.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY f.embedding <=> p_query_embedding
  LIMIT LEAST(GREATEST(p_match_count, 1), 100);
END;
$$;

GRANT EXECUTE ON FUNCTION match_codebase_files TO authenticated;

NOTIFY pgrst, 'reload schema';
