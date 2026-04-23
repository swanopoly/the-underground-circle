-- ═══════════════════════════════════════════════════════════════════════════
-- UNDERGROUND CIRCLE — PENDING MIGRATIONS (bundled 2026-04-17)
--
-- Paste this entire file into Supabase SQL Editor and run it once.
--
-- What's in here (in dependency order):
--   1. 20260228_custom_themes          — user-created office themes
--   2. 20260301_agent_appearances      — profiles.agent_appearance JSONB
--   3. 20260301_office_layout          — profiles.office_layout JSONB
--   4. 20260318_pending_items          — pg_cron offline sweeper + step_away_sessions
--   5. 20260423_claude_api_usage       — Anthropic API cost + cache-hit logging
--   6. 20260424_proof_validations      — persist circle members' votes on
--                                        each other's proof-of-work
--
-- Idempotent: safe to re-run. Every CREATE has IF NOT EXISTS, policies are
-- dropped-before-created, and the cron schedule is guarded against duplicates.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. CUSTOM THEMES  (20260228_custom_themes)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_custom_themes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id         uuid        REFERENCES circles(id) ON DELETE SET NULL,
  name              text        NOT NULL DEFAULT 'My Theme',
  environment_type  text        NOT NULL DEFAULT 'office',
  colors            jsonb       NOT NULL DEFAULT '{}',
  is_shared         boolean     DEFAULT false,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_themes_user   ON user_custom_themes(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_themes_circle ON user_custom_themes(circle_id) WHERE is_shared = true;

ALTER TABLE user_custom_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own themes"                    ON user_custom_themes;
DROP POLICY IF EXISTS "Users can read shared themes in their circles" ON user_custom_themes;
DROP POLICY IF EXISTS "Users can create own themes"                  ON user_custom_themes;
DROP POLICY IF EXISTS "Users can update own themes"                  ON user_custom_themes;
DROP POLICY IF EXISTS "Users can delete own themes"                  ON user_custom_themes;

CREATE POLICY "Users can read own themes"
  ON user_custom_themes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read shared themes in their circles"
  ON user_custom_themes FOR SELECT
  USING (
    is_shared = true
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create own themes"
  ON user_custom_themes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own themes"
  ON user_custom_themes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own themes"
  ON user_custom_themes FOR DELETE
  USING (auth.uid() = user_id);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. AGENT APPEARANCES  (20260301_agent_appearances)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS agent_appearance jsonb DEFAULT '{}';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. OFFICE LAYOUT  (20260301_office_layout)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS office_layout jsonb DEFAULT '{}';


-- ───────────────────────────────────────────────────────────────────────────
-- 4. PENDING ITEMS  (20260318_pending_items)
--    - pg_cron sweeper that flips idle agents to 'offline' after 3 min
--    - step_away_sessions table for the Step Away & Hand Off ritual
-- ───────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION sweep_offline_agents()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE circle_office_agents
     SET status = 'offline', updated_at = now()
   WHERE status IN ('idle', 'building')
     AND last_active_at IS NOT NULL
     AND last_active_at < now() - INTERVAL '3 minutes'
     AND is_published = true;
END; $$;

GRANT EXECUTE ON FUNCTION sweep_offline_agents() TO postgres;

-- Guard against re-running: unschedule by name if it already exists.
DO $$
BEGIN
  PERFORM cron.unschedule('sweep-offline-agents');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule('sweep-offline-agents', '*/2 * * * *', 'SELECT sweep_offline_agents()');

CREATE INDEX IF NOT EXISTS idx_circle_office_agents_last_active
  ON circle_office_agents (last_active_at)
  WHERE is_published = true;

CREATE TABLE IF NOT EXISTS step_away_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id   uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  agent_id    uuid        REFERENCES circle_office_agents(id) ON DELETE SET NULL,
  task        text        NOT NULL,
  context     text,
  status      text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'completed', 'cancelled')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  outcome     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE step_away_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_step_away"           ON step_away_sessions;
DROP POLICY IF EXISTS "circle_members_read_step_away" ON step_away_sessions;

CREATE POLICY "users_own_step_away"
  ON step_away_sessions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "circle_members_read_step_away"
  ON step_away_sessions FOR SELECT
  USING (circle_id IN (SELECT get_my_circle_ids()));

CREATE INDEX IF NOT EXISTS idx_step_away_user   ON step_away_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_step_away_circle ON step_away_sessions(circle_id, created_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 5. CLAUDE API USAGE  (20260423_claude_api_usage)
--    Logs every Claude API call from edge functions so the UI can show spend
--    and cache-hit rate. Two summary RPCs + daily retention helper.
-- ───────────────────────────────────────────────────────────────────────────

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

ALTER TABLE claude_api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_read_circle_members" ON claude_api_usage;
CREATE POLICY "usage_read_circle_members"
  ON claude_api_usage FOR SELECT
  USING (
    circle_id IS NULL OR circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

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
    COALESCE(SUM(estimated_cost), 0)::numeric          AS total_cost,
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
    COUNT(*)::bigint                                  AS request_count,
    COALESCE(SUM(u.estimated_cost), 0)::numeric       AS total_cost,
    COALESCE(SUM(u.cache_read_tokens), 0)::bigint     AS cache_read,
    COALESCE(SUM(u.cache_creation_tokens), 0)::bigint AS cache_creation,
    COALESCE(SUM(u.input_tokens), 0)::bigint          AS input_tokens,
    COALESCE(SUM(u.output_tokens), 0)::bigint         AS output_tokens
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

CREATE OR REPLACE FUNCTION purge_old_claude_api_usage()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM claude_api_usage WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END; $$;

GRANT EXECUTE ON FUNCTION purge_old_claude_api_usage() TO postgres;


-- ───────────────────────────────────────────────────────────────────────────
-- 6. PROOF VALIDATIONS  (20260424_proof_validations)
--    Persists circle members' votes on each other's check-ins. Trigger
--    materializes validation_score / validation_count back into
--    check_ins.proof so the existing UI keeps working.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proof_validations (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id   uuid         NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  validator_id  uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_valid      boolean      NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (check_in_id, validator_id)
);

CREATE INDEX IF NOT EXISTS idx_proof_validations_check_in
  ON proof_validations (check_in_id);
CREATE INDEX IF NOT EXISTS idx_proof_validations_validator
  ON proof_validations (validator_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_proof_validation_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_check_in_id   uuid;
  v_valid_count   integer;
  v_invalid_count integer;
  v_total         integer;
BEGIN
  v_check_in_id := COALESCE(NEW.check_in_id, OLD.check_in_id);

  SELECT
    COUNT(*) FILTER (WHERE is_valid),
    COUNT(*) FILTER (WHERE NOT is_valid),
    COUNT(*)
    INTO v_valid_count, v_invalid_count, v_total
  FROM proof_validations
  WHERE check_in_id = v_check_in_id;

  UPDATE check_ins
     SET proof = COALESCE(proof, '{}'::jsonb) || jsonb_build_object(
       'validation_score', v_valid_count - v_invalid_count,
       'validation_count', v_total
     )
   WHERE id = v_check_in_id;

  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_proof_validation_counts ON proof_validations;
CREATE TRIGGER trg_proof_validation_counts
AFTER INSERT OR UPDATE OR DELETE ON proof_validations
FOR EACH ROW EXECUTE FUNCTION update_proof_validation_counts();

ALTER TABLE proof_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proof_validations_read_circle"      ON proof_validations;
DROP POLICY IF EXISTS "proof_validations_insert_own_vote"  ON proof_validations;

CREATE POLICY "proof_validations_read_circle"
  ON proof_validations FOR SELECT
  USING (
    check_in_id IN (
      SELECT ci.id
      FROM check_ins ci
      INNER JOIN circle_members cm ON cm.circle_id = ci.circle_id
      WHERE cm.user_id = auth.uid()
    )
  );

CREATE POLICY "proof_validations_insert_own_vote"
  ON proof_validations FOR INSERT
  WITH CHECK (
    validator_id = auth.uid()
    AND check_in_id IN (
      SELECT ci.id
      FROM check_ins ci
      INNER JOIN circle_members cm ON cm.circle_id = ci.circle_id
      WHERE cm.user_id = auth.uid()
        AND ci.user_id <> auth.uid()
    )
  );


-- ───────────────────────────────────────────────────────────────────────────
-- Done. Ask PostgREST to reload the schema so the new tables/RPCs are
-- visible to the REST API immediately.
-- ───────────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
