-- Add 'totp_seed' to the secret_kind soft enum so TOTP seeds can live in
-- the encrypted secret column instead of bleeding into JSONB metadata.
-- Run this in the Supabase SQL editor; the panel surfaces a friendly
-- error if the user attempts a TOTP save before the migration lands.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'circle_site_credentials_secret_kind_check'
  ) THEN
    ALTER TABLE circle_site_credentials
      DROP CONSTRAINT circle_site_credentials_secret_kind_check;
  END IF;

  ALTER TABLE circle_site_credentials
    ADD CONSTRAINT circle_site_credentials_secret_kind_check
    CHECK (secret_kind IN (
      'password',
      'application_password',
      'api_token',
      'oauth_token',
      'session_cookie',
      'totp_seed'
    ));
END$$;

NOTIFY pgrst, 'reload schema';
