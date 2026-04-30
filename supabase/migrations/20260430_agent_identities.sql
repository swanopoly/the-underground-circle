-- Agent Identities — durable per-(user, sessionKey) identity for every
-- agent the user customizes. Custom name, color, spirit, soul prompt,
-- floor + desk assignment, bonding state, activity counters.
--
-- Previously 100% localStorage (`@agent_identity_store` in
-- src/lib/agentIdentity.ts). Browser cache clear → user lost every
-- custom name they'd given an agent (e.g. "rapid-slug" → "Sage"),
-- color choices, soul assignments, etc.
--
-- Keyed by sessionKey because agent.id is volatile across reconnections
-- (`${connId}::${sessionKey}` — connId changes, sessionKey is stable).

CREATE TABLE IF NOT EXISTS agent_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text NOT NULL,

  -- Customization
  custom_name text,
  custom_color text,
  spirit_id text,
  spirit_emoji text,
  soul_prompt text,
  custom_profile_id text,
  custom_profile_name text,
  appearance jsonb DEFAULT '{}',

  -- Office placement
  assigned_floor_id text,
  desk_index int,

  -- Bonding (mirrors agent_bonds.id when bonded)
  bond_id uuid,
  bond_level int,
  bond_xp int,
  is_primary boolean DEFAULT false,
  is_customized boolean DEFAULT false,
  bound_ai_provider text,
  bound_model text,

  -- Activity counters
  total_messages int NOT NULL DEFAULT 0,
  total_turns int NOT NULL DEFAULT 0,
  total_cost_all_time numeric(12,4) NOT NULL DEFAULT 0,
  total_tokens_all_time bigint NOT NULL DEFAULT 0,
  total_sessions_all_time int NOT NULL DEFAULT 0,
  most_used_model text,
  tags text[] DEFAULT '{}',

  -- Timestamps
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_identities_user
  ON agent_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_identities_session_key
  ON agent_identities(session_key);
CREATE INDEX IF NOT EXISTS idx_agent_identities_bond
  ON agent_identities(bond_id) WHERE bond_id IS NOT NULL;

ALTER TABLE agent_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own agent identities"
  ON agent_identities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own agent identities"
  ON agent_identities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own agent identities"
  ON agent_identities FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own agent identities"
  ON agent_identities FOR DELETE
  USING (auth.uid() = user_id);

-- Touch updated_at automatically.
CREATE OR REPLACE FUNCTION touch_agent_identities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_identities_touch_updated_at ON agent_identities;
CREATE TRIGGER agent_identities_touch_updated_at
  BEFORE UPDATE ON agent_identities
  FOR EACH ROW
  EXECUTE FUNCTION touch_agent_identities_updated_at();

NOTIFY pgrst, 'reload schema';
