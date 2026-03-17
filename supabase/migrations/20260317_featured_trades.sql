-- Featured Trades System
-- AI-generated daily trade ideas with one-click execution and spirit learning

-- ─── Featured Trades ───────────────────────────────────────────────────────
-- Stores AI-generated trade recommendations

CREATE TABLE IF NOT EXISTS featured_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Trade details
  title text NOT NULL,                          -- "SOL Momentum Play"
  description text NOT NULL,                    -- Full analysis/rationale
  trade_type text NOT NULL DEFAULT 'swap',      -- swap | sequence
  direction text NOT NULL DEFAULT 'buy',        -- buy | sell
  confidence text NOT NULL DEFAULT 'medium',    -- high | medium | low
  timeframe text NOT NULL DEFAULT 'day',        -- scalp | day | swing | position
  -- Token info
  input_mint text NOT NULL,
  output_mint text NOT NULL,
  input_symbol text NOT NULL DEFAULT 'SOL',
  output_symbol text NOT NULL DEFAULT 'USDC',
  -- Amounts
  suggested_amount_sol numeric NOT NULL DEFAULT 0.1,
  suggested_slippage_bps int NOT NULL DEFAULT 50,
  -- Sequence support (multi-trade)
  sequence_id uuid,                             -- groups related trades
  sequence_order int DEFAULT 0,                 -- order within sequence
  -- AI analysis
  entry_reasoning text,                         -- why enter here
  exit_strategy text,                           -- when to exit
  risk_level text DEFAULT 'moderate',           -- low | moderate | high | extreme
  expected_return_pct numeric,                  -- projected % return
  stop_loss_pct numeric,                        -- suggested stop loss %
  -- Source
  generated_by text DEFAULT 'gemini+claude',    -- which AI pipeline
  research_sources jsonb DEFAULT '[]'::jsonb,   -- URLs/data used
  spirit_learnings_used jsonb DEFAULT '[]'::jsonb, -- past learnings referenced
  -- Status
  status text NOT NULL DEFAULT 'active',        -- active | executed | expired | cancelled
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_featured_trades_user ON featured_trades(user_id, status);
CREATE INDEX idx_featured_trades_active ON featured_trades(status, expires_at) WHERE status = 'active';
CREATE INDEX idx_featured_trades_sequence ON featured_trades(sequence_id) WHERE sequence_id IS NOT NULL;

-- RLS
ALTER TABLE featured_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own featured trades"
  ON featured_trades FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role inserts featured trades"
  ON featured_trades FOR INSERT
  WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE POLICY "Users update own featured trades"
  ON featured_trades FOR UPDATE
  USING (auth.uid() = user_id);


-- ─── Featured Trade Executions ──────────────────────────────────────────────
-- Tracks when a user actually executes a featured trade

CREATE TABLE IF NOT EXISTS featured_trade_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  featured_trade_id uuid NOT NULL REFERENCES featured_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Execution details
  tx_hash text,
  input_amount text,
  output_amount text,
  price_at_execution numeric,
  -- Outcome (filled later)
  price_at_close numeric,
  pnl_usd numeric,
  pnl_pct numeric,
  outcome text,                                 -- win | loss | breakeven | open
  closed_at timestamptz,
  -- Timestamps
  executed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fte_user ON featured_trade_executions(user_id);
CREATE INDEX idx_fte_trade ON featured_trade_executions(featured_trade_id);

ALTER TABLE featured_trade_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own executions"
  ON featured_trade_executions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own executions"
  ON featured_trade_executions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own executions"
  ON featured_trade_executions FOR UPDATE
  USING (auth.uid() = user_id);


-- ─── Spirit Learnings ───────────────────────────────────────────────────────
-- What the trader/analyst spirits learn from trade outcomes

CREATE TABLE IF NOT EXISTS spirit_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spirit_id text NOT NULL,                      -- 'trader' | 'analyst'
  -- Learning content
  learning_type text NOT NULL,                  -- pattern | mistake | insight | strategy
  title text NOT NULL,                          -- "BONK momentum fades after 3x"
  content text NOT NULL,                        -- detailed learning
  -- Context
  related_trade_id uuid REFERENCES featured_trades(id) ON DELETE SET NULL,
  related_token text,                           -- token symbol
  confidence_score numeric DEFAULT 0.5,         -- 0-1, updated as learning proves right/wrong
  times_applied int DEFAULT 0,                  -- how many times this learning was used
  times_correct int DEFAULT 0,                  -- how many times it led to good outcome
  -- Status
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spirit_learnings_user ON spirit_learnings(user_id, spirit_id);
CREATE INDEX idx_spirit_learnings_active ON spirit_learnings(is_active, confidence_score DESC);

ALTER TABLE spirit_learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own learnings"
  ON spirit_learnings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages learnings"
  ON spirit_learnings FOR ALL
  USING (auth.uid() = user_id OR auth.role() = 'service_role');


-- Notify PostgREST to pick up new tables
NOTIFY pgrst, 'reload schema';
