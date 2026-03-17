-- Trading positions table for tracking open/closed positions with entry prices, stop-loss, take-profit
CREATE TABLE IF NOT EXISTS trading_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'long' CHECK (side IN ('long', 'short')),
  entry_price NUMERIC NOT NULL,
  current_price NUMERIC NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL,
  entry_value_usd NUMERIC NOT NULL DEFAULT 0,
  current_value_usd NUMERIC NOT NULL DEFAULT 0,
  unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
  unrealized_pnl_pct NUMERIC NOT NULL DEFAULT 0,
  stop_loss_price NUMERIC,
  take_profit_price NUMERIC,
  trailing_stop_pct NUMERIC,
  entry_tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'stopped_out', 'take_profit')),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_trading_positions_user_status ON trading_positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trading_positions_token ON trading_positions(token_mint);

-- RLS
ALTER TABLE trading_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own positions" ON trading_positions
  FOR ALL USING (auth.uid() = user_id);
