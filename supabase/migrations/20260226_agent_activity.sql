-- Agent Activity Feed
-- Captures everything SwanBot (and any agent) is doing across all sources
-- Sources: discord, webchat, cron, system

CREATE TABLE IF NOT EXISTS agent_activity (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  agent_name text NOT NULL DEFAULT 'SwanBot',
  source text NOT NULL CHECK (source IN ('discord', 'webchat', 'cron', 'system')),
  source_detail text, -- e.g. "general-chat", "heartbeat", "research-daily-synthesis"
  activity_type text NOT NULL CHECK (activity_type IN (
    'message_in', 'message_out', 'task_started', 'task_completed', 'task_failed', 'tool_call'
  )),
  title text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('running', 'completed', 'failed')),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_circle_id ON agent_activity(circle_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_created_at ON agent_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_activity_source ON agent_activity(source);

ALTER TABLE agent_activity ENABLE ROW LEVEL SECURITY;

-- Members of a circle can read its activity
CREATE POLICY "Members can read activity" ON agent_activity
  FOR SELECT USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

-- Service role (used by the OpenSwan hook) can insert
CREATE POLICY "Service role can insert" ON agent_activity
  FOR INSERT WITH CHECK (true);

-- Auto-clean: keep only 500 most recent per circle (run via pg_cron or manually)
-- SELECT cron.schedule('clean-agent-activity', '0 * * * *', $$
--   DELETE FROM agent_activity
--   WHERE id NOT IN (
--     SELECT id FROM agent_activity
--     ORDER BY created_at DESC
--     LIMIT 500
--   )
-- $$);
