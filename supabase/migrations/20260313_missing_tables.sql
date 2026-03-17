-- ─────────────────────────────────────────────────────────────────────────────
-- Consolidated migration: create all missing tables referenced by the app
-- Run this in Supabase SQL Editor to resolve 404 errors
--
-- Tables: friend_requests, friends, direct_messages, agents_bots, integrations,
--         agent_controls, agent_approvals, circle_memory, circle_memory_history,
--         user_api_keys, agent_personalities, custom_commands
-- Functions: store_user_api_key, get_user_api_key, delete_user_api_key,
--            list_user_api_keys, create_friendship, update_updated_at_column
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ═══════════════════════════════════════════════════════════════════════════════
--  SOCIAL / PROFILES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add customization columns to profiles (safe: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS theme_color VARCHAR(7) DEFAULT '#6366f1',
ADD COLUMN IF NOT EXISTS banner_url TEXT,
ADD COLUMN IF NOT EXISTS status_message TEXT,
ADD COLUMN IF NOT EXISTS linked_accounts JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS pinned_achievements TEXT[] DEFAULT ARRAY[]::TEXT[];


-- ─── agents_bots ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents_bots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  api_endpoint TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'chatbot' CHECK (type IN ('chatbot', 'assistant', 'integration', 'custom')),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_bots_owner_id ON agents_bots(owner_id);
ALTER TABLE agents_bots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agents_bots' AND policyname='Users can view their own agents') THEN
    CREATE POLICY "Users can view their own agents" ON agents_bots FOR SELECT USING (owner_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agents_bots' AND policyname='Users can manage their own agents') THEN
    CREATE POLICY "Users can manage their own agents" ON agents_bots FOR ALL USING (owner_id = auth.uid());
  END IF;
END $$;


-- ─── friend_requests ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS friend_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sender_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_id ON friend_requests(receiver_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender_id ON friend_requests(sender_id);
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='friend_requests' AND policyname='Users can view their sent requests') THEN
    CREATE POLICY "Users can view their sent requests" ON friend_requests FOR SELECT USING (sender_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='friend_requests' AND policyname='Users can view requests sent to them') THEN
    CREATE POLICY "Users can view requests sent to them" ON friend_requests FOR SELECT USING (receiver_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='friend_requests' AND policyname='Users can create friend requests') THEN
    CREATE POLICY "Users can create friend requests" ON friend_requests FOR INSERT WITH CHECK (sender_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='friend_requests' AND policyname='Users can update requests sent to them') THEN
    CREATE POLICY "Users can update requests sent to them" ON friend_requests FOR UPDATE USING (receiver_id = auth.uid());
  END IF;
END $$;


-- ─── friends ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS friends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  friend_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  since TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='friends' AND policyname='Users can view their friendships') THEN
    CREATE POLICY "Users can view their friendships" ON friends FOR SELECT USING (user_id = auth.uid() OR friend_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='friends' AND policyname='Users can create friendships') THEN
    CREATE POLICY "Users can create friendships" ON friends FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='friends' AND policyname='Users can remove their friendships') THEN
    CREATE POLICY "Users can remove their friendships" ON friends FOR DELETE USING (user_id = auth.uid() OR friend_id = auth.uid());
  END IF;
END $$;


-- ─── direct_messages ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'system')),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_sender_id ON direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_receiver_id ON direct_messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation ON direct_messages(sender_id, receiver_id);
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='direct_messages' AND policyname='Users can view their conversations') THEN
    CREATE POLICY "Users can view their conversations" ON direct_messages FOR SELECT USING (sender_id = auth.uid() OR receiver_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='direct_messages' AND policyname='Users can send messages') THEN
    CREATE POLICY "Users can send messages" ON direct_messages FOR INSERT WITH CHECK (sender_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='direct_messages' AND policyname='Users can update their received messages') THEN
    CREATE POLICY "Users can update their received messages" ON direct_messages FOR UPDATE USING (receiver_id = auth.uid());
  END IF;
END $$;


-- ─── integrations ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('discord', 'twitter', 'github', 'spotify', 'fitbit', 'strava', 'other')),
  platform_user_id TEXT NOT NULL,
  platform_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_sync TIMESTAMP WITH TIME ZONE,
  UNIQUE(user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='integrations' AND policyname='Users can manage their own integrations') THEN
    CREATE POLICY "Users can manage their own integrations" ON integrations FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;


-- ─── Friendship trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_friendship()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    INSERT INTO friends (user_id, friend_id, since)
    VALUES (NEW.sender_id, NEW.receiver_id, NOW())
    ON CONFLICT (user_id, friend_id) DO NOTHING;
    INSERT INTO friends (user_id, friend_id, since)
    VALUES (NEW.receiver_id, NEW.sender_id, NOW())
    ON CONFLICT (user_id, friend_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS friend_request_accepted ON friend_requests;
CREATE TRIGGER friend_request_accepted
  AFTER UPDATE ON friend_requests
  FOR EACH ROW EXECUTE FUNCTION create_friendship();

-- Generic updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_agents_bots_updated_at
  BEFORE UPDATE ON agents_bots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friend_requests_updated_at
  BEFORE UPDATE ON friend_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_direct_messages_updated_at
  BEFORE UPDATE ON direct_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ═══════════════════════════════════════════════════════════════════════════════
--  HITL — AGENT CONTROLS & APPROVALS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS circle_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid UNIQUE REFERENCES circles(id) ON DELETE CASCADE,
  content text DEFAULT '',
  last_edited_by uuid REFERENCES auth.users(id),
  last_edited_at timestamptz DEFAULT now(),
  version int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS circle_memory_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  content text,
  edited_by uuid REFERENCES auth.users(id),
  edited_at timestamptz DEFAULT now(),
  version int
);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  agent_name text NOT NULL,
  action_type text NOT NULL,
  description text NOT NULL,
  payload jsonb DEFAULT '{}',
  status text DEFAULT 'pending',
  requested_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  timeout_seconds int DEFAULT 300,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  agent_name text NOT NULL,
  is_paused boolean DEFAULT false,
  spending_limit_daily numeric(10,4) DEFAULT 10.00,
  require_approval_for text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(circle_id, session_key)
);

ALTER TABLE circles ADD COLUMN IF NOT EXISTS api_key text UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex');

ALTER TABLE circle_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_memory_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_controls ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='circle_memory' AND policyname='circle_memory_auth') THEN
    CREATE POLICY circle_memory_auth ON circle_memory FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='circle_memory_history' AND policyname='circle_memory_history_auth') THEN
    CREATE POLICY circle_memory_history_auth ON circle_memory_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_approvals' AND policyname='agent_approvals_auth') THEN
    CREATE POLICY agent_approvals_auth ON agent_approvals FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_controls' AND policyname='agent_controls_auth') THEN
    CREATE POLICY agent_controls_auth ON agent_controls FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
--  BYO API KEYS + AGENT PERSONALITIES + CUSTOM COMMANDS
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── user_api_keys ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_api_keys (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text        NOT NULL
                CHECK (provider IN (
                  'openai', 'anthropic', 'openrouter', 'groq',
                  'ollama', 'replicate', 'figma', 'stability'
                )),
  api_key_enc bytea       NOT NULL,
  label       text        DEFAULT 'default',
  endpoint    text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, label)
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id);
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_api_keys' AND policyname='users_manage_own_keys') THEN
    CREATE POLICY "users_manage_own_keys" ON user_api_keys FOR ALL
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_api_keys' AND policyname='service_role_access_keys') THEN
    CREATE POLICY "service_role_access_keys" ON user_api_keys FOR SELECT
      USING (auth.role() = 'service_role');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_user_api_keys_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS user_api_keys_updated_at ON user_api_keys;
CREATE TRIGGER user_api_keys_updated_at
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW EXECUTE FUNCTION update_user_api_keys_updated_at();


-- ─── API key functions ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION store_user_api_key(
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
  v_passphrase text;
BEGIN
  v_passphrase := coalesce(
    current_setting('app.settings.encryption_key', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ENCRYPTION_KEY' LIMIT 1),
    'tuc-default-enc-key-change-me'
  );
  INSERT INTO user_api_keys (user_id, provider, api_key_enc, label, endpoint)
  VALUES (
    auth.uid(), p_provider,
    pgp_sym_encrypt(p_api_key, v_passphrase),
    coalesce(p_label, 'default'), p_endpoint
  )
  ON CONFLICT (user_id, provider, label)
  DO UPDATE SET
    api_key_enc = pgp_sym_encrypt(p_api_key, v_passphrase),
    endpoint = coalesce(p_endpoint, user_api_keys.endpoint),
    is_active = true, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_api_key(
  p_user_id uuid,
  p_provider text,
  p_label text DEFAULT 'default'
)
RETURNS TABLE(api_key text, endpoint text) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_passphrase text;
BEGIN
  v_passphrase := coalesce(
    current_setting('app.settings.encryption_key', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ENCRYPTION_KEY' LIMIT 1),
    'tuc-default-enc-key-change-me'
  );
  RETURN QUERY
  SELECT
    pgp_sym_decrypt(k.api_key_enc, v_passphrase)::text AS api_key,
    k.endpoint
  FROM user_api_keys k
  WHERE k.user_id = p_user_id
    AND k.provider = p_provider
    AND (p_label IS NULL OR k.label = p_label)
    AND k.is_active = true
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION delete_user_api_key(p_key_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM user_api_keys WHERE id = p_key_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION list_user_api_keys()
RETURNS TABLE(
  id uuid, provider text, label text, endpoint text,
  is_active boolean, created_at timestamptz, updated_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT k.id, k.provider, k.label, k.endpoint,
         k.is_active, k.created_at, k.updated_at
  FROM user_api_keys k
  WHERE k.user_id = auth.uid()
  ORDER BY k.provider, k.label;
END;
$$;


-- ─── agent_personalities ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_personalities (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id   uuid        REFERENCES circles(id) ON DELETE CASCADE,
  agent_name  text        NOT NULL DEFAULT 'BlackSwan',
  personality text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, circle_id, agent_name)
);

ALTER TABLE agent_personalities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_personalities' AND policyname='users_manage_own_personalities') THEN
    CREATE POLICY "users_manage_own_personalities" ON agent_personalities FOR ALL
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_personalities' AND policyname='service_role_read_personalities') THEN
    CREATE POLICY "service_role_read_personalities" ON agent_personalities FOR SELECT
      USING (auth.role() = 'service_role');
  END IF;
END $$;


-- ─── custom_commands ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS custom_commands (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id       uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  created_by      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  command         text        NOT NULL,
  description     text,
  prompt_template text        NOT NULL,
  model           text        DEFAULT 'auto',
  is_shared       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(circle_id, command)
);

ALTER TABLE custom_commands ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='custom_commands' AND policyname='circle_members_read_commands') THEN
    CREATE POLICY "circle_members_read_commands" ON custom_commands FOR SELECT
      USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='custom_commands' AND policyname='creator_manages_commands') THEN
    CREATE POLICY "creator_manages_commands" ON custom_commands FOR ALL
      USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
--  REFRESH SCHEMA CACHE
-- ═══════════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
