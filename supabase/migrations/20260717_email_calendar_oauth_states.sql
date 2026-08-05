-- ─────────────────────────────────────────────────────────────────────────────
-- Email/Calendar OAuth — server-stored state nonces
--
-- Replaces passing the user's Supabase JWT as the OAuth `state` (which leaked
-- the live bearer into the IdP URL, browser history, and IdP logs) with an
-- opaque single-use nonce bound to the verified user + provider + scopes.
-- See docs/EDGE_SECURITY_ADVISORY_2026-07-16.md finding #6.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_calendar_oauth_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state       text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  scopes      text,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_calendar_oauth_states_state ON email_calendar_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_email_calendar_oauth_states_expires ON email_calendar_oauth_states(expires_at);

ALTER TABLE email_calendar_oauth_states ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge function) may touch these rows.
CREATE POLICY "service_only_email_calendar_oauth_states" ON email_calendar_oauth_states
  FOR ALL USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
