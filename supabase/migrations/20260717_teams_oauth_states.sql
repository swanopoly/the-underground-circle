-- ─────────────────────────────────────────────────────────────────────────────
-- Microsoft Teams OAuth — server-stored CSRF state tokens
--
-- Replaces the forgeable client-supplied btoa(JSON) `state` with a random,
-- server-stored nonce bound to the VERIFIED initiating user + a validated
-- org/circle, so an unauthenticated attacker can no longer bind a Teams bot
-- token to a victim's circle/org. See docs/EDGE_SECURITY_ADVISORY_2026-07-16.md
-- finding #teams (second sweep).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams_oauth_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state       text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  circle_id   uuid REFERENCES circles(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teams_oauth_states_state   ON teams_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_teams_oauth_states_expires ON teams_oauth_states(expires_at);

ALTER TABLE teams_oauth_states ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge function) may touch these rows.
CREATE POLICY "service_only_teams_oauth_states" ON teams_oauth_states
  FOR ALL USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
