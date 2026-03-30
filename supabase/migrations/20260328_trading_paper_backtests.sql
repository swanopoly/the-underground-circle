-- Trading paper accounts, execution modes, and backtest runs

ALTER TABLE trading_log
  ADD COLUMN IF NOT EXISTS circle_id UUID REFERENCES circles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS strategy_name TEXT,
  ADD COLUMN IF NOT EXISTS backtest_run_id UUID,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE trading_log DROP CONSTRAINT IF EXISTS trading_log_execution_mode_check;
ALTER TABLE trading_log
  ADD CONSTRAINT trading_log_execution_mode_check
  CHECK (execution_mode IN ('live', 'paper', 'backtest'));

CREATE INDEX IF NOT EXISTS idx_trading_log_user_mode_created
  ON trading_log(user_id, execution_mode, created_at DESC);

ALTER TABLE trading_positions
  ADD COLUMN IF NOT EXISTS circle_id UUID REFERENCES circles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS strategy_name TEXT,
  ADD COLUMN IF NOT EXISTS backtest_run_id UUID;

ALTER TABLE trading_positions DROP CONSTRAINT IF EXISTS trading_positions_execution_mode_check;
ALTER TABLE trading_positions
  ADD CONSTRAINT trading_positions_execution_mode_check
  CHECK (execution_mode IN ('live', 'paper', 'backtest'));

CREATE INDEX IF NOT EXISTS idx_trading_positions_user_mode_status
  ON trading_positions(user_id, execution_mode, status);

CREATE TABLE IF NOT EXISTS trading_paper_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  base_currency_symbol TEXT NOT NULL DEFAULT 'USD',
  starting_balance_usd NUMERIC NOT NULL DEFAULT 10000,
  cash_balance_usd NUMERIC NOT NULL DEFAULT 10000,
  realized_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  total_trades INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, circle_id)
);

ALTER TABLE trading_paper_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own paper accounts"
  ON trading_paper_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trading_paper_accounts_user_circle
  ON trading_paper_accounts(user_id, circle_id);

CREATE TABLE IF NOT EXISTS trading_backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id UUID REFERENCES circles(id) ON DELETE SET NULL,
  strategy_key TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  timeframe_label TEXT NOT NULL DEFAULT '24h snapshot',
  initial_capital_usd NUMERIC NOT NULL DEFAULT 10000,
  final_equity_usd NUMERIC NOT NULL DEFAULT 0,
  net_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  net_pnl_pct NUMERIC NOT NULL DEFAULT 0,
  buy_hold_return_pct NUMERIC NOT NULL DEFAULT 0,
  max_drawdown_pct NUMERIC NOT NULL DEFAULT 0,
  total_trades INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  win_rate_pct NUMERIC NOT NULL DEFAULT 0,
  fee_bps INT NOT NULL DEFAULT 10,
  slippage_bps INT NOT NULL DEFAULT 15,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  equity_curve JSONB NOT NULL DEFAULT '[]'::jsonb,
  trade_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE trading_backtest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own backtest runs"
  ON trading_backtest_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trading_backtest_runs_user_created
  ON trading_backtest_runs(user_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
