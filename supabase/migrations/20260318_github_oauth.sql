-- ─────────────────────────────────────────────────────────────────────────────
-- GitHub OAuth — state tokens + per-user GitHub tokens
-- ─────────────────────────────────────────────────────────────────────────────

-- OAuth state (temp, for CSRF protection during OAuth flow)
CREATE TABLE IF NOT EXISTS github_oauth_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state       text NOT NULL UNIQUE,
  circle_id   uuid REFERENCES circles(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_github_oauth_states_state ON github_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_github_oauth_states_expires ON github_oauth_states(expires_at);

-- Per-user GitHub tokens (replace PAT flow)
CREATE TABLE IF NOT EXISTS user_github_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token    text NOT NULL,
  github_username text NOT NULL,
  github_user_id  bigint NOT NULL,
  scopes          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE github_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_github_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role can touch oauth states (edge function only)
CREATE POLICY "service_only_oauth_states" ON github_oauth_states
  FOR ALL USING (false) WITH CHECK (false);

-- Users can see their own token existence (not the token value — query returns metadata only)
CREATE POLICY "users_own_github_token" ON user_github_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- Service role manages tokens (edge function inserts/updates)
CREATE POLICY "service_manages_github_tokens" ON user_github_tokens
  FOR ALL USING (false) WITH CHECK (false);

-- Cleanup: auto-expire old oauth states (run periodically or let edge fn handle it)
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM github_oauth_states WHERE expires_at < now();
END;
$$;

NOTIFY pgrst, 'reload schema';
