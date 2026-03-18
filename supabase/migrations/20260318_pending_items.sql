-- pg_cron sweeper for offline agent detection
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
END;
$$;

SELECT cron.schedule('sweep-offline-agents', '*/2 * * * *', 'SELECT sweep_offline_agents()');

CREATE INDEX IF NOT EXISTS idx_circle_office_agents_last_active
  ON circle_office_agents (last_active_at)
  WHERE is_published = true;

GRANT EXECUTE ON FUNCTION sweep_offline_agents() TO postgres;

-- step_away_sessions: track when users hand off to their agent
CREATE TABLE IF NOT EXISTS step_away_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id     uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  agent_id      uuid        REFERENCES circle_office_agents(id) ON DELETE SET NULL,
  task          text        NOT NULL,
  context       text,
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  outcome       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE step_away_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_step_away" ON step_away_sessions
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "circle_members_read_step_away" ON step_away_sessions
  FOR SELECT USING (circle_id IN (SELECT get_my_circle_ids()));

CREATE INDEX IF NOT EXISTS idx_step_away_user ON step_away_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_step_away_circle ON step_away_sessions(circle_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
