-- ─── Trading Bot Tables ──────────────────────────────────────────────────────
-- Supports: DCA configs, price alerts, wallet tracking, trade logging
-- Used by: heliusTrading.ts, automation-executor (trading automations)

-- Allow 'helius' as a provider in user_api_keys
ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;
ALTER TABLE user_api_keys ADD CONSTRAINT user_api_keys_provider_check
  CHECK (provider IN (
    'openai', 'anthropic', 'openrouter', 'groq',
    'ollama', 'replicate', 'figma', 'stability',
    'google', 'microsoft', 'yahoo', 'helius'
  ));

-- ── DCA Configs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trading_dca_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  input_mint TEXT NOT NULL DEFAULT 'So11111111111111111111111111111111111111112',
  output_mint TEXT NOT NULL,
  amount_per_interval BIGINT NOT NULL, -- in lamports
  interval_hours INT NOT NULL DEFAULT 24,
  max_price DECIMAL(20,8),
  is_active BOOLEAN DEFAULT true,
  last_executed TIMESTAMPTZ,
  total_executed INT DEFAULT 0,
  total_spent DECIMAL(20,8) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trading_dca_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own DCA configs"
  ON trading_dca_configs FOR ALL
  USING (auth.uid() = user_id);

-- ── Trade Alerts ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trading_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL DEFAULT '',
  alert_type TEXT NOT NULL CHECK (alert_type IN ('price_above', 'price_below', 'volume_spike', 'whale_move')),
  target_value DECIMAL(20,8) NOT NULL,
  current_value DECIMAL(20,8),
  triggered BOOLEAN DEFAULT false,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trading_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own alerts"
  ON trading_alerts FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_trading_alerts_active ON trading_alerts(user_id, triggered) WHERE triggered = false;

-- ── Tracked Wallets (Copy Trading) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trading_tracked_wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  label TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, wallet_address)
);

ALTER TABLE trading_tracked_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tracked wallets"
  ON trading_tracked_wallets FOR ALL
  USING (auth.uid() = user_id);

-- ── Trade Log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trading_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('swap', 'transfer', 'stake', 'dca_buy', 'alert_check', 'portfolio_scan')),
  input_mint TEXT,
  output_mint TEXT,
  input_amount TEXT,
  output_amount TEXT,
  price_usd DECIMAL(20,8),
  tx_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trading_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own trade log"
  ON trading_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own trades"
  ON trading_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_trading_log_user ON trading_log(user_id, created_at DESC);

-- ── Portfolio Snapshots (for P&L tracking) ──────────────────────────────────
-- Uses existing portfolio_snapshots table if it exists, otherwise creates one

CREATE TABLE IF NOT EXISTS trading_portfolio_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  total_value_usd DECIMAL(20,8) NOT NULL DEFAULT 0,
  sol_balance DECIMAL(20,8) NOT NULL DEFAULT 0,
  token_count INT DEFAULT 0,
  top_holdings JSONB DEFAULT '[]'::jsonb, -- [{mint, symbol, amount, usdValue}]
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trading_portfolio_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own snapshots"
  ON trading_portfolio_snapshots FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_trading_snapshots_user ON trading_portfolio_snapshots(user_id, created_at DESC);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
