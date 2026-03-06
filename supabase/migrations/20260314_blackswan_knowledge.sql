-- ─────────────────────────────────────────────────────────────────────────────
-- BlackSwan Knowledge Base — Growing memory from every conversation
--
-- Every exchange with BlackSwan is stored as a knowledge entry.
-- On each new message, the most relevant past entries are injected
-- into the system prompt so BlackSwan learns from experience.
--
-- Categories help with efficient retrieval:
--   coaching, technical, social, accountability, tasks, creative,
--   circle_management, general, games, crypto
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blackswan_knowledge (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id       uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,

  -- The exchange
  user_message    text        NOT NULL,
  bot_response    text        NOT NULL,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name       text,

  -- Auto-categorization
  category        text        NOT NULL DEFAULT 'general'
                    CHECK (category IN (
                      'coaching', 'technical', 'social', 'accountability',
                      'tasks', 'creative', 'circle_management', 'general',
                      'games', 'crypto', 'onboarding', 'feedback'
                    )),

  -- Searchable summary (shorter than full exchange, for prompt injection)
  summary         text,

  -- Quality signals
  quality_score   real        NOT NULL DEFAULT 0.5,  -- 0.0–1.0
  was_helpful     boolean,                            -- explicit user feedback (future)
  response_length integer     DEFAULT 0,

  -- Context at time of exchange
  member_count    integer,
  user_streak     integer,

  -- Source tracking
  source          text        NOT NULL DEFAULT 'webchat'
                    CHECK (source IN ('webchat', 'terminal', 'automation', 'discord')),
  model_used      text,
  tokens_used     integer     DEFAULT 0,

  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Primary retrieval: recent + relevant entries per circle
CREATE INDEX idx_knowledge_circle_cat ON blackswan_knowledge(circle_id, category, created_at DESC);
CREATE INDEX idx_knowledge_circle_recent ON blackswan_knowledge(circle_id, created_at DESC);
CREATE INDEX idx_knowledge_quality ON blackswan_knowledge(circle_id, quality_score DESC)
  WHERE quality_score >= 0.7;

-- Full-text search on user messages for keyword matching
CREATE INDEX idx_knowledge_msg_search ON blackswan_knowledge
  USING gin(to_tsvector('english', user_message));

-- RLS
ALTER TABLE blackswan_knowledge ENABLE ROW LEVEL SECURITY;

-- Circle members can read knowledge in their circles
CREATE POLICY "members_read_knowledge"
  ON blackswan_knowledge FOR SELECT
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

-- Service role can insert (edge function)
CREATE POLICY "service_insert_knowledge"
  ON blackswan_knowledge FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Service role can update quality scores
CREATE POLICY "service_update_knowledge"
  ON blackswan_knowledge FOR UPDATE
  USING (auth.role() = 'service_role');


-- ─── Knowledge retrieval function ────────────────────────────────────────────
-- Returns the most relevant past exchanges for a given message.
-- Uses a combination of: keyword match (ts_rank), recency, and quality.

CREATE OR REPLACE FUNCTION get_relevant_knowledge(
  p_circle_id uuid,
  p_message text,
  p_limit int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  category text,
  user_message text,
  bot_response text,
  summary text,
  quality_score real,
  created_at timestamptz,
  relevance_score real
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    k.id,
    k.category,
    k.user_message,
    k.bot_response,
    k.summary,
    k.quality_score,
    k.created_at,
    -- Combined score: keyword relevance + recency + quality
    (
      COALESCE(ts_rank(
        to_tsvector('english', k.user_message),
        plainto_tsquery('english', p_message)
      ), 0) * 3.0  -- keyword match weight
      +
      -- Recency bonus: newer entries score higher (max 1.0 for today, decays)
      GREATEST(0, 1.0 - EXTRACT(EPOCH FROM now() - k.created_at) / 2592000.0)
      +
      -- Quality bonus
      k.quality_score
    )::real AS relevance_score
  FROM blackswan_knowledge k
  WHERE k.circle_id = p_circle_id
  ORDER BY
    -- Prioritize keyword matches, then fall back to quality + recency
    (
      COALESCE(ts_rank(
        to_tsvector('english', k.user_message),
        plainto_tsquery('english', p_message)
      ), 0) * 3.0
      +
      GREATEST(0, 1.0 - EXTRACT(EPOCH FROM now() - k.created_at) / 2592000.0)
      +
      k.quality_score
    ) DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_relevant_knowledge(uuid, text, int) TO postgres, authenticated, service_role;


-- ─── Auto-cleanup: keep knowledge manageable ─────────────────────────────────
-- Keep max 500 entries per circle, pruning lowest quality + oldest first.

CREATE OR REPLACE FUNCTION prune_blackswan_knowledge()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM blackswan_knowledge
  WHERE id IN (
    SELECT id FROM (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY circle_id
          ORDER BY quality_score DESC, created_at DESC
        ) AS rn
      FROM blackswan_knowledge
    ) ranked
    WHERE rn > 500
  );
END;
$$;

-- Run weekly cleanup
SELECT cron.schedule(
  'prune-blackswan-knowledge',
  '0 3 * * 0',
  'SELECT prune_blackswan_knowledge()'
);

GRANT EXECUTE ON FUNCTION prune_blackswan_knowledge() TO postgres;
