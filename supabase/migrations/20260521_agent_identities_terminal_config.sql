-- Persist Office-side terminal session preferences per user/agent identity.
-- The app also encodes the same config into the existing tags column as a
-- backward-compatible fallback, but this JSONB column is the durable source
-- once the migration is applied.

ALTER TABLE agent_identities
  ADD COLUMN IF NOT EXISTS terminal_config jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN agent_identities.terminal_config IS
  'Per-user Office terminal profile: default cwd, preferred model, launch mode, and default instructions for chat-assigned terminal sessions.';

NOTIFY pgrst, 'reload schema';
