-- ─── Claude API usage log ───────────────────────────────────────────────────
-- One row per Claude API call, emitted by edge functions (swanbot-ai,
-- automation-executor, etc.) so we can measure the cache-read vs
-- cache-creation ratio — i.e. whether prompt caching is actually saving
-- money after the 2026-04-17 optimization pass.

CREATE TABLE IF NOT EXISTS claude_api_usage (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id              uuid          REFERENCES circles(id) ON DELETE CASCADE,
  user_id                uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  source                 text          NOT NULL,
  model                  text          NOT NULL,
  input_tokens           integer       NOT NULL DEFAULT 0,
  output_tokens          integer       NOT NULL DEFAULT 0,
  cache_creation_tokens  integer       NOT NULL DEFAULT 0,
  cache_read_tokens      integer       NOT NULL DEFAULT 0,
  estimated_cost         numeric(10,6) NOT NULL DEFAULT 0,
  duration_ms            integer,
  metadata               jsonb,
  created_at             timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claude_api_usage_circle_created
  ON claude_api_usage (circle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claude_api_usage_user_created
  ON claude_api_usage (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claude_api_usage_source_model
  ON claude_api_usage (source, model, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE claude_api_usage ENABLE ROW LEVEL SECURITY;

-- Circle members can read usage for their circle (cost transparency)
DROP POLICY IF EXISTS "usage_read_circle_members" ON claude_api_usage;
CREATE POLICY "usage_read_circle_members"
  ON claude_api_usage FOR SELECT
  USING (
    circle_id IS NULL OR circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

-- Inserts happen from edge functions using the service role, which bypasses
-- RLS. No INSERT policy needed for authenticated users.

-- ─── Summary RPC ─────────────────────────────────────────────────────────────
-- Aggregates usage over a lookback window. Frontend calls this instead of
-- scanning the raw log, so index scans stay cheap as the table grows.

CREATE OR REPLACE FUNCTION get_claude_usage_summary(
  p_circle_id uuid,
  p_days      integer DEFAULT 7
) RETURNS TABLE (
  total_cost            numeric,
  total_input           bigint,
  total_output          bigint,
  total_cache_creation  bigint,
  total_cache_read      bigint,
  request_count         bigint,
  cache_hit_rate        numeric
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    COALESCE(SUM(estimated_cost), 0)::numeric         AS total_cost,
    COALESCE(SUM(input_tokens), 0)::bigint             AS total_input,
    COALESCE(SUM(output_tokens), 0)::bigint            AS total_output,
    COALESCE(SUM(cache_creation_tokens), 0)::bigint    AS total_cache_creation,
    COALESCE(SUM(cache_read_tokens), 0)::bigint        AS total_cache_read,
    COUNT(*)::bigint                                   AS request_count,
    CASE
      WHEN COALESCE(SUM(cache_read_tokens + cache_creation_tokens + input_tokens), 0) > 0
      THEN (SUM(cache_read_tokens)::numeric
            / NULLIF(SUM(cache_read_tokens + cache_creation_tokens + input_tokens), 0)::numeric)
      ELSE 0
    END AS cache_hit_rate
  FROM claude_api_usage
  WHERE (p_circle_id IS NULL OR circle_id = p_circle_id)
    AND created_at >= now() - (p_days || ' days')::interval
    AND (
      p_circle_id IS NULL
      OR circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
    );
$$;

GRANT EXECUTE ON FUNCTION get_claude_usage_summary(uuid, integer) TO authenticated;

-- Per-model breakdown over the same window
CREATE OR REPLACE FUNCTION get_claude_usage_by_model(
  p_circle_id uuid,
  p_days      integer DEFAULT 7
) RETURNS TABLE (
  model          text,
  request_count  bigint,
  total_cost     numeric,
  cache_read     bigint,
  cache_creation bigint,
  input_tokens   bigint,
  output_tokens  bigint
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    u.model,
    COUNT(*)::bigint                          AS request_count,
    COALESCE(SUM(u.estimated_cost), 0)::numeric AS total_cost,
    COALESCE(SUM(u.cache_read_tokens), 0)::bigint     AS cache_read,
    COALESCE(SUM(u.cache_creation_tokens), 0)::bigint AS cache_creation,
    COALESCE(SUM(u.input_tokens), 0)::bigint  AS input_tokens,
    COALESCE(SUM(u.output_tokens), 0)::bigint AS output_tokens
  FROM claude_api_usage u
  WHERE (p_circle_id IS NULL OR u.circle_id = p_circle_id)
    AND u.created_at >= now() - (p_days || ' days')::interval
    AND (
      p_circle_id IS NULL
      OR u.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
    )
  GROUP BY u.model
  ORDER BY total_cost DESC;
$$;

GRANT EXECUTE ON FUNCTION get_claude_usage_by_model(uuid, integer) TO authenticated;

-- ─── Retention: drop rows older than 90 days on a daily cron ────────────────
-- Wrapped so the ops cron can call it without needing direct DELETE perms.
CREATE OR REPLACE FUNCTION purge_old_claude_api_usage() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM claude_api_usage
  WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END; $$;

GRANT EXECUTE ON FUNCTION purge_old_claude_api_usage() TO postgres;
