-- ─── MS Teams Integration ───────────────────────────────────────────────────
-- Connects Microsoft Teams to organizations and circles for notifications.

CREATE TABLE teams_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  circle_id UUID REFERENCES circles(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  team_name TEXT,
  bot_token TEXT,
  refresh_token TEXT,
  bot_id TEXT,
  default_channel_id TEXT,
  default_channel_name TEXT,
  scopes TEXT[],
  installed_by UUID REFERENCES profiles(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (org_id IS NOT NULL OR circle_id IS NOT NULL)
);

CREATE INDEX idx_teams_connections_org ON teams_connections(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX idx_teams_connections_circle ON teams_connections(circle_id) WHERE circle_id IS NOT NULL;
ALTER TABLE teams_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins manage teams" ON teams_connections FOR ALL USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  OR circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid() AND role = 'creator')
);

-- Teams channel mappings
CREATE TABLE teams_channel_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teams_connection_id UUID NOT NULL REFERENCES teams_connections(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  teams_channel_id TEXT NOT NULL,
  teams_channel_name TEXT,
  event_types TEXT[] DEFAULT ARRAY['check_in', 'streak_update'],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE teams_channel_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Circle creators manage teams mappings" ON teams_channel_mappings FOR ALL USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid() AND role = 'creator')
);

-- SSO providers config (for the SSO feature)
CREATE TABLE IF NOT EXISTS sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL DEFAULT 'saml',
  domain TEXT NOT NULL,
  metadata_url TEXT,
  entity_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sso_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners manage SSO" ON sso_providers FOR ALL USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'owner')
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('analytics', 'goals', 'engagement', 'comprehensive')),
  format TEXT NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf', 'csv')),
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  file_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  metadata JSONB DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_org ON reports(org_id);
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can view reports" ON reports FOR SELECT USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
);
CREATE POLICY "Org admins can manage reports" ON reports FOR ALL USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
);

-- Report schedules
CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  recipients TEXT[] DEFAULT '{}',
  next_run TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org admins manage schedules" ON report_schedules FOR ALL USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
);
