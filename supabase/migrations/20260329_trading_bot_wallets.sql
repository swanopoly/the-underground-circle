-- Built-in Solana bot wallet for unattended trading
-- Stores only public metadata in a table; secret key stays encrypted in user_api_keys.

ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;
ALTER TABLE user_api_keys ADD CONSTRAINT user_api_keys_provider_check
  CHECK (provider IN (
    'openai', 'anthropic', 'openrouter', 'groq',
    'ollama', 'replicate', 'figma', 'stability',
    'google', 'microsoft', 'yahoo', 'helius', 'solana_bot_wallet'
  ));

CREATE TABLE IF NOT EXISTS trading_bot_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Autopilot Wallet',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  last_balance_lamports BIGINT NOT NULL DEFAULT 0,
  last_funded_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, circle_id),
  UNIQUE(public_key)
);

ALTER TABLE trading_bot_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own trading bot wallets"
  ON trading_bot_wallets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trading_bot_wallets_user_circle
  ON trading_bot_wallets(user_id, circle_id);

CREATE OR REPLACE FUNCTION update_trading_bot_wallets_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trading_bot_wallets_updated_at ON trading_bot_wallets;
CREATE TRIGGER trading_bot_wallets_updated_at
  BEFORE UPDATE ON trading_bot_wallets
  FOR EACH ROW EXECUTE FUNCTION update_trading_bot_wallets_updated_at();

CREATE OR REPLACE FUNCTION store_user_api_key_for_user(
  p_user_id uuid,
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
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  v_passphrase := coalesce(
    current_setting('app.settings.encryption_key', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ENCRYPTION_KEY' LIMIT 1),
    'tuc-default-enc-key-change-me'
  );

  INSERT INTO user_api_keys (user_id, provider, api_key_enc, label, endpoint)
  VALUES (
    p_user_id,
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

CREATE TABLE IF NOT EXISTS trading_bot_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  strategy_mode TEXT NOT NULL DEFAULT 'hybrid' CHECK (strategy_mode IN ('hybrid', 'featured_only', 'queue_only')),
  min_confidence TEXT NOT NULL DEFAULT 'high' CHECK (min_confidence IN ('high', 'medium', 'low')),
  max_trade_sol NUMERIC NOT NULL DEFAULT 0.25,
  max_daily_trades INT NOT NULL DEFAULT 3,
  allow_featured_trades BOOLEAN NOT NULL DEFAULT true,
  allow_pending_actions BOOLEAN NOT NULL DEFAULT true,
  slippage_bps_cap INT NOT NULL DEFAULT 150,
  auto_pause_on_error BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_trade_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, circle_id)
);

ALTER TABLE trading_bot_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own trading bot configs"
  ON trading_bot_configs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trading_bot_configs_user_circle
  ON trading_bot_configs(user_id, circle_id);

CREATE OR REPLACE FUNCTION update_trading_bot_configs_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trading_bot_configs_updated_at ON trading_bot_configs;
CREATE TRIGGER trading_bot_configs_updated_at
  BEFORE UPDATE ON trading_bot_configs
  FOR EACH ROW EXECUTE FUNCTION update_trading_bot_configs_updated_at();

NOTIFY pgrst, 'reload schema';
