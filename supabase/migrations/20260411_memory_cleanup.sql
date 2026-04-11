-- Memory system cleanup: fix RLS, add TTL, drop legacy table
-- See docs/NEXT_LEVEL_PLAN.md

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Fix circle_memory RLS — require circle membership (was USING(true))
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "circle_memory_auth" ON circle_memory;
DROP POLICY IF EXISTS "circle_memory_select" ON circle_memory;
DROP POLICY IF EXISTS "circle_memory_insert" ON circle_memory;
DROP POLICY IF EXISTS "circle_memory_update" ON circle_memory;

-- Only circle members can read/write their circle's memory doc
CREATE POLICY "cm_doc_select" ON circle_memory FOR SELECT
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "cm_doc_insert" ON circle_memory FOR INSERT
  WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "cm_doc_update" ON circle_memory FOR UPDATE
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Same for history
DROP POLICY IF EXISTS "circle_memory_history_auth" ON circle_memory_history;

CREATE POLICY "cm_history_select" ON circle_memory_history FOR SELECT
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Session memory TTL — deactivate old session memories
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cleanup_stale_session_memories()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Mark session memories older than 30 days as inactive
  UPDATE memory_entries
  SET is_active = false, updated_at = now()
  WHERE scope = 'session'
    AND is_active = true
    AND updated_at < now() - interval '30 days';

  -- Also demote old startup memories to on_demand if they haven't been accessed in 14 days
  UPDATE memory_entries
  SET retrieval_mode = 'on_demand', updated_at = now()
  WHERE retrieval_mode = 'startup'
    AND scope = 'session'
    AND is_active = true
    AND updated_at < now() - interval '14 days';
END;
$$;

-- Run cleanup daily at 4am UTC (if pg_cron is available)
DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-stale-session-memories',
    '0 4 * * *',
    'SELECT cleanup_stale_session_memories()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available — run cleanup_stale_session_memories() manually';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Drop legacy blackswan_memory table (no longer written to)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS blackswan_memory CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Done
-- ═══════════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
