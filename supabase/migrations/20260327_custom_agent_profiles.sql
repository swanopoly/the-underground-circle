-- Custom Agent Profiles — user-created SOULs saved to their account
-- These appear alongside the built-in spirits as custom options

CREATE TABLE IF NOT EXISTS custom_agent_profiles (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                  text        NOT NULL,
  emoji                 text        DEFAULT '🤖',
  color                 text        DEFAULT '#6366f1',
  tagline               text,
  category              text        DEFAULT 'custom',
  system_prompt         text        NOT NULL DEFAULT '',
  skill_bundle          text        DEFAULT '',
  risk_tier             text        DEFAULT 'medium' CHECK (risk_tier IN ('low','medium','high','critical')),
  action_posture        text        DEFAULT 'propose',
  evidence_posture      text        DEFAULT 'high',
  communication_density text        DEFAULT 'normal',
  skepticism            text        DEFAULT 'medium',
  escalation_trigger    text        DEFAULT '',
  is_shared             boolean     DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_agent_profiles_user_id ON custom_agent_profiles(user_id);

ALTER TABLE custom_agent_profiles ENABLE ROW LEVEL SECURITY;

-- Users can manage their own profiles
CREATE POLICY "custom_profiles_own" ON custom_agent_profiles FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can read shared profiles from others
CREATE POLICY "custom_profiles_shared_read" ON custom_agent_profiles FOR SELECT TO authenticated
  USING (is_shared = true);
