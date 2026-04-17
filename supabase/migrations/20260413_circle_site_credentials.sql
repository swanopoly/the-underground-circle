-- Circle-owned site credentials so integrations can be installed once
-- and reused across Office, chat, tasks, and automations.

CREATE TABLE IF NOT EXISTS circle_site_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN (
    'wordpress', 'shopify', 'squarespace', 'wix',
    'twitter', 'instagram', 'linkedin', 'facebook',
    'mailchimp', 'sendgrid', 'convertkit',
    'quickbooks', 'stripe', 'square',
    'cloudflare', 'vercel', 'netlify',
    'google_analytics', 'google_search_console',
    'hubspot', 'salesforce', 'pipedrive'
  )),
  site_url text,
  username text,
  credential_encrypted text NOT NULL,
  label text NOT NULL DEFAULT 'default',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(circle_id, platform, label)
);

CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_circle
  ON circle_site_credentials(circle_id, platform, is_active);

ALTER TABLE circle_site_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS circle_site_credentials_select ON circle_site_credentials;
CREATE POLICY circle_site_credentials_select
  ON circle_site_credentials FOR SELECT TO authenticated
  USING (
    circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS circle_site_credentials_manage_member ON circle_site_credentials;
CREATE POLICY circle_site_credentials_manage_member
  ON circle_site_credentials FOR ALL TO authenticated
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

CREATE OR REPLACE FUNCTION update_circle_site_credentials_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_circle_site_credentials_updated_at ON circle_site_credentials;
CREATE TRIGGER trg_circle_site_credentials_updated_at
  BEFORE UPDATE ON circle_site_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_circle_site_credentials_updated_at();

NOTIFY pgrst, 'reload schema';
