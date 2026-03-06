-- ─── Billing Events ─────────────────────────────────────────────────────────
-- Logs synced from Stripe webhooks for audit trail

CREATE TABLE billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_billing_events_org ON billing_events(org_id);
CREATE INDEX idx_billing_events_type ON billing_events(event_type);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org owners/admins can view billing events"
  ON billing_events FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- ─── Org Features (feature flags per org, derived from plan) ────────────────

CREATE TABLE org_features (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  max_circles INTEGER NOT NULL DEFAULT 1,
  max_members_per_circle INTEGER NOT NULL DEFAULT 8,
  analytics_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  slack_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  teams_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sso_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  export_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  whitelabel_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  custom_branding BOOLEAN NOT NULL DEFAULT FALSE,
  goal_alignment BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE org_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view features"
  ON org_features FOR SELECT USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- ─── Feature Check RPC ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_org_feature(p_org_id UUID, p_feature TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result BOOLEAN;
BEGIN
  EXECUTE format('SELECT %I FROM org_features WHERE org_id = $1', p_feature)
    INTO result USING p_org_id;
  RETURN COALESCE(result, FALSE);
END;
$$;

-- ─── Auto-sync org_features when plan changes ──────────────────────────────

CREATE OR REPLACE FUNCTION sync_org_features()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO org_features (
    org_id, max_circles, max_members_per_circle,
    analytics_enabled, slack_enabled, teams_enabled,
    sso_enabled, export_enabled, whitelabel_enabled,
    custom_branding, goal_alignment
  ) VALUES (
    NEW.id,
    CASE NEW.plan WHEN 'free' THEN 1 WHEN 'pro' THEN 5 ELSE 9999 END,
    CASE NEW.plan WHEN 'free' THEN 8 WHEN 'pro' THEN 25 WHEN 'business' THEN 100 ELSE 9999 END,
    NEW.plan IN ('pro', 'business', 'enterprise'),
    NEW.plan IN ('pro', 'business', 'enterprise'),
    NEW.plan IN ('business', 'enterprise'),
    NEW.plan = 'enterprise',
    NEW.plan IN ('pro', 'business', 'enterprise'),
    NEW.plan = 'enterprise',
    NEW.plan IN ('business', 'enterprise'),
    NEW.plan IN ('business', 'enterprise')
  )
  ON CONFLICT (org_id) DO UPDATE SET
    max_circles = EXCLUDED.max_circles,
    max_members_per_circle = EXCLUDED.max_members_per_circle,
    analytics_enabled = EXCLUDED.analytics_enabled,
    slack_enabled = EXCLUDED.slack_enabled,
    teams_enabled = EXCLUDED.teams_enabled,
    sso_enabled = EXCLUDED.sso_enabled,
    export_enabled = EXCLUDED.export_enabled,
    whitelabel_enabled = EXCLUDED.whitelabel_enabled,
    custom_branding = EXCLUDED.custom_branding,
    goal_alignment = EXCLUDED.goal_alignment,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_org_features
  AFTER INSERT OR UPDATE OF plan ON organizations
  FOR EACH ROW EXECUTE FUNCTION sync_org_features();
