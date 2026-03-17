-- BlackSwan Memory: Persistent per-circle learning across sessions
-- Run in Supabase SQL Editor (migration system is broken)

CREATE TABLE IF NOT EXISTS blackswan_memory (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  key text NOT NULL,
  value text NOT NULL,
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('user_preference', 'circle_pattern', 'topic_context', 'gotcha', 'general')),
  importance int NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  access_count int NOT NULL DEFAULT 0,
  last_accessed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(circle_id, key)
);

ALTER TABLE blackswan_memory ENABLE ROW LEVEL SECURITY;

-- Only accessible via service role (edge functions)
CREATE POLICY "service_role_full_access" ON blackswan_memory
  FOR ALL TO service_role USING (true);

-- Members can read their circle's memories
CREATE POLICY "members_read_own_circle" ON blackswan_memory
  FOR SELECT TO authenticated
  USING (circle_id IN (SELECT get_my_circle_ids()));

CREATE INDEX idx_bsm_circle ON blackswan_memory(circle_id);
CREATE INDEX idx_bsm_circle_cat ON blackswan_memory(circle_id, category);
CREATE INDEX idx_bsm_circle_importance ON blackswan_memory(circle_id, importance DESC);

-- Function to bump memory access tracking (called from edge fn)
CREATE OR REPLACE FUNCTION bump_memory_access(p_circle_id uuid, p_memory_ids uuid[])
RETURNS void AS $$
BEGIN
  UPDATE blackswan_memory
  SET access_count = access_count + 1,
      last_accessed_at = now()
  WHERE circle_id = p_circle_id
    AND id = ANY(p_memory_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Scheduled cleanup: decay old low-importance memories (run weekly via pg_cron)
-- SELECT cron.schedule('blackswan-memory-decay', '0 3 * * 0', $$
--   DELETE FROM blackswan_memory
--   WHERE importance <= 3
--     AND updated_at < now() - interval '30 days'
--     AND access_count < 2;
--   UPDATE blackswan_memory
--   SET importance = importance - 1
--   WHERE importance > 1
--     AND updated_at < now() - interval '60 days'
--     AND access_count < 5;
-- $$);

NOTIFY pgrst, 'reload schema';
