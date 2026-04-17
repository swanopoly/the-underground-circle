-- Generic circle-owned integrations and secret storage.
-- This is the durable backend layer for company-grade connectors.

CREATE TABLE IF NOT EXISTS circle_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN (
    'github', 'wordpress', 'slack', 'teams', 'discord', 'helius',
    'aws', 'cloudflare', 'hubspot',
    'google_analytics', 'google_search_console', 'google_ads', 'meta_ads',
    'stripe', 'shopify', 'mailchimp', 'convertkit',
    'salesforce', 'pipedrive', 'vercel', 'netlify', 'figma', 'notion'
  )),
  label text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'degraded', 'disabled', 'planned')),
  connection_scope text NOT NULL DEFAULT 'circle' CHECK (connection_scope IN ('circle', 'room', 'user')),
  display_name text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  capability_flags text[] NOT NULL DEFAULT '{}'::text[],
  installed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(circle_id, provider, label)
);

CREATE INDEX IF NOT EXISTS idx_circle_integrations_circle
  ON circle_integrations(circle_id, provider, is_active);

CREATE TABLE IF NOT EXISTS circle_integration_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES circle_integrations(id) ON DELETE CASCADE,
  key text NOT NULL,
  value_encrypted text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(integration_id, key)
);

CREATE INDEX IF NOT EXISTS idx_circle_integration_secrets_integration
  ON circle_integration_secrets(integration_id);

ALTER TABLE circle_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_integration_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS circle_integrations_select ON circle_integrations;
CREATE POLICY circle_integrations_select
  ON circle_integrations FOR SELECT TO authenticated
  USING (
    circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS circle_integrations_manage_member ON circle_integrations;
CREATE POLICY circle_integrations_manage_member
  ON circle_integrations FOR ALL TO authenticated
  USING (
    circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'moderator')
    )
  )
  WITH CHECK (
    circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'moderator')
    )
  );

DROP POLICY IF EXISTS circle_integration_secrets_select ON circle_integration_secrets;
CREATE POLICY circle_integration_secrets_select
  ON circle_integration_secrets FOR SELECT TO authenticated
  USING (
    integration_id IN (
      SELECT id
      FROM circle_integrations
      WHERE circle_id IN (
        SELECT circle_id
        FROM circle_members
        WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS circle_integration_secrets_manage_member ON circle_integration_secrets;
CREATE POLICY circle_integration_secrets_manage_member
  ON circle_integration_secrets FOR ALL TO authenticated
  USING (
    integration_id IN (
      SELECT id
      FROM circle_integrations
      WHERE circle_id IN (
        SELECT circle_id
        FROM circle_members
        WHERE user_id = auth.uid()
          AND role IN ('owner', 'admin', 'moderator')
      )
    )
  )
  WITH CHECK (
    integration_id IN (
      SELECT id
      FROM circle_integrations
      WHERE circle_id IN (
        SELECT circle_id
        FROM circle_members
        WHERE user_id = auth.uid()
          AND role IN ('owner', 'admin', 'moderator')
      )
    )
  );

CREATE OR REPLACE FUNCTION update_circle_integrations_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_circle_integrations_updated_at ON circle_integrations;
CREATE TRIGGER trg_circle_integrations_updated_at
  BEFORE UPDATE ON circle_integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_circle_integrations_updated_at();

CREATE OR REPLACE FUNCTION update_circle_integration_secrets_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_circle_integration_secrets_updated_at ON circle_integration_secrets;
CREATE TRIGGER trg_circle_integration_secrets_updated_at
  BEFORE UPDATE ON circle_integration_secrets
  FOR EACH ROW
  EXECUTE FUNCTION update_circle_integration_secrets_updated_at();

NOTIFY pgrst, 'reload schema';
