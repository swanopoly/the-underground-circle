-- Soul Wisdom — Phase 3 of the Agent Memory God Plan.
-- Stores a weekly LLM-synthesized guidance block per (circle, SOUL).
-- Injected as Block B of the system prompt before the per-turn retrieval
-- block, so each SOUL invocation starts with "here's what you've learned
-- in this circle" rather than a blank persona.
--
-- Why not compute at request time?
--   * Haiku round-trip adds ~1s; we'd pay it on every turn.
--   * Wisdom is stable over days, not seconds — weekly batch is plenty.
--   * Generating per-turn would also cost 15x more in LLM calls.
-- Why one row per (circle, SOUL)?
--   * Same SOUL can give different advice in different circles because it
--     has accumulated different context. "architect" in a fintech circle
--     won't talk the same as "architect" in a game-studio circle.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS soul_wisdom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  soul_key text NOT NULL,                      -- 'soul:architect' etc.
  body text NOT NULL,                          -- markdown bullets, 5-8 lines
  source_memory_ids uuid[] NOT NULL DEFAULT '{}',
  source_count int NOT NULL DEFAULT 0,         -- how many memories fed this synth
  model text NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (circle_id, soul_key)
);

CREATE INDEX IF NOT EXISTS idx_soul_wisdom_circle
  ON soul_wisdom (circle_id);
CREATE INDEX IF NOT EXISTS idx_soul_wisdom_freshness
  ON soul_wisdom (generated_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. RLS — readable to any member of the circle; writes go through the
--    distil-soul-wisdom edge fn which uses the service role.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE soul_wisdom ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS soul_wisdom_select ON soul_wisdom;
CREATE POLICY soul_wisdom_select ON soul_wisdom FOR SELECT TO authenticated
USING (
  circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  )
);

-- No INSERT/UPDATE/DELETE policies for authenticated role — only the
-- service role key (edge fn) can write. This keeps users from spoofing
-- wisdom into each other's SOUL configurations.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Staleness view — the cron uses this to pick which (circle, SOUL)
--    pairs to refresh next.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW soul_wisdom_staleness AS
SELECT
  sl.circle_id,
  sl.soul_key,
  COUNT(*) FILTER (WHERE sl.role = 'primary') AS primary_memories,
  COUNT(*) AS total_links,
  MAX(sl.created_at) AS newest_memory_at,
  w.generated_at AS wisdom_generated_at,
  w.source_count,
  CASE
    WHEN w.generated_at IS NULL THEN 'never'
    WHEN MAX(sl.created_at) > w.generated_at THEN 'stale'
    WHEN w.generated_at < now() - interval '7 days' THEN 'aged'
    ELSE 'fresh'
  END AS freshness
FROM memory_soul_links sl
LEFT JOIN soul_wisdom w
  ON w.circle_id = sl.circle_id AND w.soul_key = sl.soul_key
WHERE sl.circle_id IS NOT NULL
GROUP BY sl.circle_id, sl.soul_key, w.generated_at, w.source_count;

GRANT SELECT ON soul_wisdom_staleness TO authenticated;

NOTIFY pgrst, 'reload schema';
