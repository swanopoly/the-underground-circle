-- ─── Slack Integration ──────────────────────────────────────────────────────
-- Connects Slack workspaces to organizations and circles for cross-platform notifications.

-- Slack workspace connections
CREATE TABLE slack_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  circle_id UUID REFERENCES circles(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  team_name TEXT,
  bot_token TEXT NOT NULL,
  bot_user_id TEXT,
  default_channel_id TEXT,
  default_channel_name TEXT,
  scopes TEXT[],
  installed_by UUID REFERENCES profiles(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (org_id IS NOT NULL OR circle_id IS NOT NULL)
);
CREATE INDEX idx_slack_connections_org ON slack_connections(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX idx_slack_connections_circle ON slack_connections(circle_id) WHERE circle_id IS NOT NULL;
ALTER TABLE slack_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org admins manage slack" ON slack_connections FOR ALL USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  OR circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid() AND role = 'creator')
);

-- Slack channel mappings
CREATE TABLE slack_channel_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_connection_id UUID NOT NULL REFERENCES slack_connections(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  slack_channel_id TEXT NOT NULL,
  slack_channel_name TEXT,
  event_types TEXT[] DEFAULT ARRAY['check_in', 'streak_update'],
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE slack_channel_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Circle creators manage mappings" ON slack_channel_mappings FOR ALL USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid() AND role = 'creator')
);
