-- ─── White-Label Configuration ──────────────────────────────────────────────
-- Custom branding per organization for enterprise customers.

CREATE TABLE whitelabel_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  app_name TEXT DEFAULT 'The Underground Circle',
  logo_url TEXT,
  favicon_url TEXT,
  primary_color TEXT DEFAULT '#6366f1',
  accent_color TEXT DEFAULT '#22c55e',
  background_color TEXT DEFAULT '#0a0a0a',
  card_color TEXT DEFAULT '#111111',
  border_color TEXT DEFAULT '#1a1a2e',
  text_color TEXT DEFAULT '#ffffff',
  font_family TEXT DEFAULT 'monospace',
  custom_domain TEXT,
  hide_branding BOOLEAN DEFAULT FALSE,
  custom_css TEXT,
  login_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whitelabel_domain ON whitelabel_config(custom_domain) WHERE custom_domain IS NOT NULL;
ALTER TABLE whitelabel_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view branding" ON whitelabel_config FOR SELECT USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
);

CREATE POLICY "Org owners can manage branding" ON whitelabel_config FOR ALL USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'owner')
);

-- Public access by domain for login page theming
CREATE POLICY "Public can view by domain" ON whitelabel_config FOR SELECT USING (
  custom_domain IS NOT NULL
);
