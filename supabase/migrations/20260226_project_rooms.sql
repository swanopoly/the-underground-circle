-- Project Rooms: Shared workspaces where agents group to work on a project
-- All circle members see the same rooms and agent activity in real time

CREATE TABLE IF NOT EXISTS project_rooms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL, -- url-safe, e.g. "underground-circle-v2"
  description text,
  color text DEFAULT '#6366f1',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  tags text[] DEFAULT '{}',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (circle_id, slug)
);

CREATE TABLE IF NOT EXISTS project_room_agents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid REFERENCES project_rooms(id) ON DELETE CASCADE,
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  agent_session_key text NOT NULL,
  agent_name text NOT NULL DEFAULT 'SwanBot',
  current_task text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'offline')),
  source text DEFAULT 'system', -- 'discord', 'webchat', 'cron', 'system'
  joined_at timestamptz DEFAULT now(),
  last_active_at timestamptz DEFAULT now(),
  UNIQUE (room_id, agent_session_key)
);

CREATE TABLE IF NOT EXISTS project_room_activity (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid REFERENCES project_rooms(id) ON DELETE CASCADE,
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  agent_session_key text,
  agent_name text NOT NULL DEFAULT 'SwanBot',
  activity_type text NOT NULL CHECK (activity_type IN (
    'joined', 'left', 'task_started', 'task_completed', 'task_failed',
    'checkpoint', 'message', 'file_changed', 'handoff'
  )),
  title text NOT NULL,
  body text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_project_rooms_circle ON project_rooms(circle_id);
CREATE INDEX IF NOT EXISTS idx_room_agents_room ON project_room_agents(room_id);
CREATE INDEX IF NOT EXISTS idx_room_agents_session ON project_room_agents(agent_session_key);
CREATE INDEX IF NOT EXISTS idx_room_activity_room ON project_room_activity(room_id, created_at DESC);

-- RLS
ALTER TABLE project_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_room_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_room_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Circle members read rooms" ON project_rooms
  FOR SELECT USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "Circle members create rooms" ON project_rooms
  FOR INSERT WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "Circle members update rooms" ON project_rooms
  FOR UPDATE USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access rooms" ON project_rooms
  FOR ALL USING (true);

CREATE POLICY "Circle members read room agents" ON project_room_agents
  FOR SELECT USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "Service role manage room agents" ON project_room_agents
  FOR ALL USING (true);

CREATE POLICY "Circle members read room activity" ON project_room_activity
  FOR SELECT USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "Service role insert room activity" ON project_room_activity
  FOR INSERT WITH CHECK (true);

-- Auto-update updated_at on project_rooms
CREATE OR REPLACE FUNCTION update_project_rooms_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_rooms_updated_at
  BEFORE UPDATE ON project_rooms
  FOR EACH ROW EXECUTE FUNCTION update_project_rooms_updated_at();

-- Sweep offline agents (run via pg_cron or manually)
-- Marks agents offline if last_active_at > 2 minutes ago
CREATE OR REPLACE FUNCTION sweep_offline_room_agents()
RETURNS void AS $$
BEGIN
  UPDATE project_room_agents
  SET status = 'offline'
  WHERE status != 'offline'
    AND last_active_at < now() - interval '2 minutes';
END;
$$ LANGUAGE plpgsql;
