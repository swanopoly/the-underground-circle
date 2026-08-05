-- ─────────────────────────────────────────────────────────────────────────────
-- Slack OAuth — server-stored CSRF state tokens
--
-- Replaces the forgeable client-supplied btoa(JSON) `state` with a random,
-- server-stored nonce bound to the VERIFIED initiating user + a validated
-- circle, so an attacker can no longer bind their Slack workspace to a victim's
-- circle/org. See docs/EDGE_SECURITY_ADVISORY_2026-07-16.md finding #3.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS slack_oauth_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state       text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id   uuid REFERENCES circles(id) ON DELETE CASCADE,
  org_id      uuid,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slack_oauth_states_state ON slack_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_slack_oauth_states_expires ON slack_oauth_states(expires_at);

ALTER TABLE slack_oauth_states ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge function) may touch these rows.
CREATE POLICY "service_only_slack_oauth_states" ON slack_oauth_states
  FOR ALL USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
