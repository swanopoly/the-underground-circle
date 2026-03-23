-- Agent Connect Tokens — persistent API keys for CLI agent hooks
-- Users generate these in-app; hooks/MCP servers use them to authenticate
-- with the agent-connect edge function.

CREATE TABLE IF NOT EXISTS agent_connect_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  label text DEFAULT 'default',
  circle_id uuid REFERENCES circles(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Index for fast token lookups (the hot path)
CREATE INDEX IF NOT EXISTS idx_agent_connect_tokens_token ON agent_connect_tokens(token);

-- Index for listing user's tokens
CREATE INDEX IF NOT EXISTS idx_agent_connect_tokens_user ON agent_connect_tokens(user_id);

-- RLS: users can only see/manage their own tokens
ALTER TABLE agent_connect_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tokens"
  ON agent_connect_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tokens"
  ON agent_connect_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tokens"
  ON agent_connect_tokens FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own tokens"
  ON agent_connect_tokens FOR UPDATE
  USING (auth.uid() = user_id);

-- Notify PostgREST to pick up the new table
NOTIFY pgrst, 'reload schema';
