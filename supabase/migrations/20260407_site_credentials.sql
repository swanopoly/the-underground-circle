-- Encrypted credential storage for external site integrations
CREATE TABLE IF NOT EXISTS user_site_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN (
    'wordpress', 'shopify', 'squarespace', 'wix',
    'twitter', 'instagram', 'linkedin', 'facebook',
    'mailchimp', 'sendgrid', 'convertkit',
    'quickbooks', 'stripe', 'square'
  )),
  site_url text,
  username text,
  credential_encrypted text NOT NULL,
  label text DEFAULT 'default',
  metadata jsonb DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, platform, label)
);
ALTER TABLE user_site_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_credentials" ON user_site_credentials FOR ALL USING (user_id = auth.uid());
