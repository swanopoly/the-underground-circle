-- Vault schema alignment — fixes the gap between circle_site_credentials
-- table and what siteCredentialVault.ts (panel + edge fn) reads/writes.
--
-- Additive only — doesn't touch the encrypted blob, doesn't change RLS,
-- doesn't redefine the RPCs (those live in the deployed DB and could
-- have non-trivial encryption logic that we don't want to clobber).
--
-- Run via Supabase SQL Editor.

-- Drop the hardcoded platform CHECK so users can save credentials for
-- any platform — Klaviyo, Intercom, Plausible, Linear, Notion, GitHub,
-- Airtable, Render, Supabase admin, etc. The original list of ~22
-- platforms was a best-guess at install time; it's been a constant
-- friction source.
ALTER TABLE circle_site_credentials
  DROP CONSTRAINT IF EXISTS circle_site_credentials_platform_check;

-- Columns the lib expects but the original migration never created.
-- All optional so existing rows stay valid.
ALTER TABLE circle_site_credentials
  ADD COLUMN IF NOT EXISTS secret_kind text NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS login_url text,
  ADD COLUMN IF NOT EXISTS access_policy jsonb NOT NULL DEFAULT '{"require_approval": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS rotation_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Soft enum on secret_kind — same shape the panel exposes. Validates
-- new writes; doesn't fail on legacy rows that defaulted to 'password'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'circle_site_credentials_secret_kind_check'
  ) THEN
    ALTER TABLE circle_site_credentials
      ADD CONSTRAINT circle_site_credentials_secret_kind_check
      CHECK (secret_kind IN (
        'password', 'application_password', 'api_token',
        'oauth_token', 'session_cookie'
      ));
  END IF;
END$$;

-- Index for findSiteCredentialForUrl() — the lib walks the list and
-- matches hostname; making the lookup index-backed would still need
-- the host comparison done client-side, but indexing site_url and
-- login_url speeds up the initial fetch.
CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_site_url
  ON circle_site_credentials(circle_id, site_url) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_login_url
  ON circle_site_credentials(circle_id, login_url) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_rotation_due
  ON circle_site_credentials(circle_id, rotation_due_at)
  WHERE is_active AND rotation_due_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
