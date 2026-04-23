-- Persist Computer Use agent runs so:
--  * users can review past tasks (history panel)
--  * the agent can see its recent context when starting a follow-up
--    ("continue the espresso research")
--  * admins can audit what the agent did on their circle
--
-- Only the task text, outcome, and structured findings are persisted.
-- Screenshots intentionally stay ephemeral on the client — storing image
-- binaries in Postgres balloons cost quickly and the live session URL
-- covers the "show me what it saw" need.

CREATE TABLE IF NOT EXISTS computer_use_runs (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id          uuid         NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id            uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  task               text         NOT NULL,
  status             text         NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'done', 'error', 'cancelled')),
  session_id         text,
  live_url           text,
  summary            text,
  findings           jsonb,
  iterations         integer      NOT NULL DEFAULT 0,
  input_tokens       integer      NOT NULL DEFAULT 0,
  output_tokens      integer      NOT NULL DEFAULT 0,
  estimated_cost     numeric(10,6) NOT NULL DEFAULT 0,
  error_message      text,
  final_screenshot_url text,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_computer_use_runs_circle_recent
  ON computer_use_runs (circle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_computer_use_runs_user
  ON computer_use_runs (user_id, created_at DESC);

-- RLS — circle members can read runs for their circle; only the run's
-- owner (or service role) can update / delete.
ALTER TABLE computer_use_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cu_runs_read_members" ON computer_use_runs;
CREATE POLICY "cu_runs_read_members"
  ON computer_use_runs FOR SELECT
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cu_runs_owner_write" ON computer_use_runs;
CREATE POLICY "cu_runs_owner_write"
  ON computer_use_runs FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
