-- ─────────────────────────────────────────────────────────────────────────────
-- BYO API Keys, Agent Personalities, and Custom Commands
--
-- 1. user_api_keys — encrypted storage for user-provided LLM API keys
-- 2. agent_personalities — per-user agent personality configs (SOUL.md)
-- 3. custom_commands — user-defined slash commands per circle
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ─── 1. user_api_keys ──────────────────────────────────────────────────────

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
  endpoint    text,       -- custom endpoint override (e.g. Ollama URL)
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, label)
);

CREATE INDEX idx_user_api_keys_user ON user_api_keys(user_id);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_keys"
  ON user_api_keys FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role needs access for edge functions
CREATE POLICY "service_role_access_keys"
  ON user_api_keys FOR SELECT
  USING (auth.role() = 'service_role');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_user_api_keys_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER user_api_keys_updated_at
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW EXECUTE FUNCTION update_user_api_keys_updated_at();


-- ─── Store API Key (encrypts) ──────────────────────────────────────────────

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
    auth.uid(),
    p_provider,
    pgp_sym_encrypt(p_api_key, v_passphrase),
    coalesce(p_label, 'default'),
    p_endpoint
  )
  ON CONFLICT (user_id, provider, label)
  DO UPDATE SET
    api_key_enc = pgp_sym_encrypt(p_api_key, v_passphrase),
    endpoint = coalesce(p_endpoint, user_api_keys.endpoint),
    is_active = true,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- ─── Get API Key (decrypts — service role only for edge functions) ─────────

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


-- ─── Delete API Key ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_user_api_key(p_key_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM user_api_keys
  WHERE id = p_key_id AND user_id = auth.uid();
END;
$$;


-- ─── List API Keys (metadata only, never returns the actual key) ──────────

CREATE OR REPLACE FUNCTION list_user_api_keys()
RETURNS TABLE(
  id uuid,
  provider text,
  label text,
  endpoint text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    k.id, k.provider, k.label, k.endpoint,
    k.is_active, k.created_at, k.updated_at
  FROM user_api_keys k
  WHERE k.user_id = auth.uid()
  ORDER BY k.provider, k.label;
END;
$$;


-- ─── 2. agent_personalities ────────────────────────────────────────────────

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

CREATE POLICY "users_manage_own_personalities"
  ON agent_personalities FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "service_role_read_personalities"
  ON agent_personalities FOR SELECT
  USING (auth.role() = 'service_role');


-- ─── 3. custom_commands ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS custom_commands (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id       uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  created_by      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  command         text        NOT NULL,           -- e.g., 'review', 'brainstorm'
  description     text,
  prompt_template text        NOT NULL,           -- markdown with {{variables}}
  model           text        DEFAULT 'auto',
  is_shared       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(circle_id, command)
);

ALTER TABLE custom_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "circle_members_read_commands"
  ON custom_commands FOR SELECT
  USING (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  );

CREATE POLICY "creator_manages_commands"
  ON custom_commands FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());


-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
