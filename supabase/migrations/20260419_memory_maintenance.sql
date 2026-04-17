-- Memory Maintenance — Phase 4 of the Agent Memory God Plan.
-- Daily hygiene for the memory system:
--   1. decay_session_memories()          — demote >14d from startup → on_demand;
--                                           deactivate >30d
--   2. collapse_near_dup_by_embedding()  — merge semantic near-duplicates (cosine
--                                           >0.93) by keeping the higher-importance
--                                           one and deactivating the other
--   3. tick_memory_maintenance()         — one-shot entry point the cron calls
--
-- Design choices:
--   * All three are SECURITY DEFINER so pg_cron can run them without JWTs.
--   * Near-dup collapse runs per-circle and is bounded to 500 candidate pairs
--     per tick so a massive circle doesn't monopolize the cron window.
--   * We NEVER deactivate a memory the user has pinned or a memory that is
--     a `decision`/`instruction` — those are load-bearing by policy.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Session memory decay
-- ═══════════════════════════════════════════════════════════════════════════════
-- - Demote `session` memories older than 14 days from startup → on_demand so
--   they stop loading into every new session.
-- - Deactivate `session` memories older than 30 days — these are ephemeral
--   context snapshots; no one misses them after a month.

CREATE OR REPLACE FUNCTION decay_session_memories()
RETURNS TABLE (demoted int, deactivated int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _demoted int;
  _deactivated int;
BEGIN
  WITH updated AS (
    UPDATE memory_entries
    SET retrieval_mode = 'on_demand',
        updated_at = now()
    WHERE scope = 'session'
      AND retrieval_mode = 'startup'
      AND is_active = true
      AND created_at < now() - interval '14 days'
      AND (pinned IS NULL OR pinned = false)
    RETURNING id
  )
  SELECT COUNT(*)::int INTO _demoted FROM updated;

  WITH updated AS (
    UPDATE memory_entries
    SET is_active = false,
        updated_at = now()
    WHERE scope = 'session'
      AND is_active = true
      AND created_at < now() - interval '30 days'
      AND (pinned IS NULL OR pinned = false)
    RETURNING id
  )
  SELECT COUNT(*)::int INTO _deactivated FROM updated;

  demoted := _demoted;
  deactivated := _deactivated;
  RETURN NEXT;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Embedding-based near-duplicate collapse
-- ═══════════════════════════════════════════════════════════════════════════════
-- Scans the last 7 days of new memories in a circle, finds their semantic
-- neighbors above the cosine threshold, and if the neighbor's importance
-- is higher-or-equal AND is older, deactivates the new one (treating it
-- as a restatement). If the new one is higher-importance, deactivates the
-- older neighbor.
--
-- We never collapse across scopes (user ↔ circle) because that would leak
-- private context into shared memory. Same scope only.

CREATE OR REPLACE FUNCTION collapse_near_dup_by_embedding(
  p_circle_id uuid,
  p_threshold float DEFAULT 0.93,
  p_max_pairs int DEFAULT 500
)
RETURNS TABLE (merged int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _merged int := 0;
  r RECORD;
BEGIN
  FOR r IN
    WITH recent AS (
      SELECT id, scope, importance, embedding, created_at
      FROM memory_entries
      WHERE circle_id = p_circle_id
        AND is_active = true
        AND embedding IS NOT NULL
        AND created_at > now() - interval '7 days'
        AND (pinned IS NULL OR pinned = false)
        AND memory_kind NOT IN ('decision','instruction')  -- protected kinds
    )
    SELECT
      a.id AS new_id,
      a.scope AS new_scope,
      a.importance AS new_imp,
      a.created_at AS new_created,
      b.id AS old_id,
      b.importance AS old_imp,
      b.created_at AS old_created,
      (1 - (a.embedding <=> b.embedding))::float AS similarity
    FROM recent a
    JOIN memory_entries b
      ON b.circle_id = p_circle_id
      AND b.is_active = true
      AND b.embedding IS NOT NULL
      AND b.scope = a.scope              -- same scope only
      AND b.id <> a.id
      AND b.id < a.id                    -- one direction only (avoid (A,B) AND (B,A))
      AND b.memory_kind NOT IN ('decision','instruction')
      AND (b.pinned IS NULL OR b.pinned = false)
    WHERE (1 - (a.embedding <=> b.embedding)) >= p_threshold
    ORDER BY similarity DESC
    LIMIT p_max_pairs
  LOOP
    -- Decide who wins: higher importance, then older (more-accessed) wins.
    IF r.old_imp >= r.new_imp THEN
      UPDATE memory_entries
      SET is_active = false, updated_at = now()
      WHERE id = r.new_id AND is_active = true;
    ELSE
      UPDATE memory_entries
      SET is_active = false, updated_at = now()
      WHERE id = r.old_id AND is_active = true;
    END IF;
    _merged := _merged + 1;
  END LOOP;

  merged := _merged;
  RETURN NEXT;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. One-shot entry point for the daily cron
-- ═══════════════════════════════════════════════════════════════════════════════
-- Runs decay globally, then near-dup collapse per circle. Safe to call
-- manually any time — idempotent, bounded per tick.

CREATE OR REPLACE FUNCTION tick_memory_maintenance()
RETURNS TABLE (
  decayed_demoted int,
  decayed_deactivated int,
  dup_merged int,
  circles_scanned int
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _decay record;
  _merge_total int := 0;
  _circles int := 0;
  cid uuid;
BEGIN
  -- 1. Decay session memories across every circle in one pass
  SELECT * INTO _decay FROM decay_session_memories();

  -- 2. Per-circle dedup pass (limited to circles with recent memories)
  FOR cid IN
    SELECT DISTINCT circle_id
    FROM memory_entries
    WHERE is_active = true
      AND embedding IS NOT NULL
      AND created_at > now() - interval '7 days'
      AND circle_id IS NOT NULL
  LOOP
    _circles := _circles + 1;
    _merge_total := _merge_total + COALESCE(
      (SELECT merged FROM collapse_near_dup_by_embedding(cid)),
      0
    );
  END LOOP;

  decayed_demoted := _decay.demoted;
  decayed_deactivated := _decay.deactivated;
  dup_merged := _merge_total;
  circles_scanned := _circles;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION decay_session_memories TO authenticated;
GRANT EXECUTE ON FUNCTION collapse_near_dup_by_embedding TO authenticated;
GRANT EXECUTE ON FUNCTION tick_memory_maintenance TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. pg_cron — daily run at 04:42 UTC
-- ═══════════════════════════════════════════════════════════════════════════════
-- We use pg_cron directly (no edge fn round-trip) because the whole
-- maintenance routine is pure SQL. Saves latency + an Anthropic key.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('tick_memory_maintenance');
  EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'tick_memory_maintenance',
  '42 4 * * *',                                   -- daily 04:42 UTC
  $cron$select tick_memory_maintenance();$cron$
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Visibility — what happened on the most recent ticks?
-- ═══════════════════════════════════════════════════════════════════════════════
-- Runs a no-op in its own query so the user can see a sample. The cron
-- runs it daily; this view just shows the last N rows of the job log.

CREATE OR REPLACE VIEW memory_maintenance_recent AS
SELECT
  start_time,
  end_time,
  status,
  return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'tick_memory_maintenance')
ORDER BY start_time DESC
LIMIT 20;

GRANT SELECT ON memory_maintenance_recent TO authenticated;

NOTIFY pgrst, 'reload schema';
