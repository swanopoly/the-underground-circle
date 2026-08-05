-- ─────────────────────────────────────────────────────────────────────────────
-- Figma OAuth — server-stored state nonces
--
-- Replaces passing the user's Supabase JWT as the OAuth `state` (which leaked
-- the live bearer into the Figma authorize URL, browser history, and Figma's
-- logs) with an opaque single-use nonce bound to the verified user.
-- See docs/EDGE_SECURITY_ADVISORY_2026-07-16.md finding #7.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS figma_oauth_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state       text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_figma_oauth_states_state ON figma_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_figma_oauth_states_expires ON figma_oauth_states(expires_at);

ALTER TABLE figma_oauth_states ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge function) may touch these rows.
CREATE POLICY "service_only_figma_oauth_states" ON figma_oauth_states
  FOR ALL USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
