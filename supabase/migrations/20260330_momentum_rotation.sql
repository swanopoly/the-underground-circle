-- Add momentum_rotation strategy mode and trading_bot_holdings table

-- Expand strategy_mode CHECK to include momentum_rotation
ALTER TABLE trading_bot_configs DROP CONSTRAINT IF EXISTS trading_bot_configs_strategy_mode_check;
ALTER TABLE trading_bot_configs ADD CONSTRAINT trading_bot_configs_strategy_mode_check
  CHECK (strategy_mode IN ('hybrid', 'featured_only', 'queue_only', 'momentum_rotation'));

-- Holdings snapshot: tracks token positions and momentum signals per scan
CREATE TABLE IF NOT EXISTS trading_bot_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL DEFAULT '',
  balance NUMERIC NOT NULL DEFAULT 0,
  entry_price NUMERIC,
  current_price NUMERIC,
  signal_score INT NOT NULL DEFAULT 0,
  signal_action TEXT NOT NULL DEFAULT 'hold' CHECK (signal_action IN ('exit', 'enter', 'hold')),
  last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, circle_id, token_mint)
);

ALTER TABLE trading_bot_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own trading bot holdings"
  ON trading_bot_holdings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trading_bot_holdings_user_circle
  ON trading_bot_holdings(user_id, circle_id);

CREATE OR REPLACE FUNCTION update_trading_bot_holdings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trading_bot_holdings_updated_at ON trading_bot_holdings;
CREATE TRIGGER trading_bot_holdings_updated_at
  BEFORE UPDATE ON trading_bot_holdings
  FOR EACH ROW EXECUTE FUNCTION update_trading_bot_holdings_updated_at();

NOTIFY pgrst, 'reload schema';
