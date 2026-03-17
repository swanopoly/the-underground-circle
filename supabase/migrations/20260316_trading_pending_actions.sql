-- ─── Trading Pending Actions ─────────────────────────────────────────────────
-- Queue for trade actions proposed by automations / AI agents.
-- User approves in the UI → Phantom signs → trade executes.

CREATE TABLE IF NOT EXISTS trading_pending_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id UUID REFERENCES circles(id) ON DELETE SET NULL,
  automation_run_id UUID,

  -- Action details
  action_type TEXT NOT NULL CHECK (action_type IN ('swap', 'dca_buy', 'limit_buy', 'limit_sell', 'stop_loss')),
  input_mint TEXT NOT NULL DEFAULT 'So11111111111111111111111111111111111111112',
  output_mint TEXT NOT NULL,
  amount_lamports BIGINT NOT NULL,           -- input amount in smallest unit
  slippage_bps INT DEFAULT 50,               -- 0.5% default
  max_price DECIMAL(20,8),                   -- skip if above this price
  reason TEXT,                               -- AI explanation of why

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired')),
  tx_hash TEXT,
  output_amount TEXT,
  error TEXT,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours'),

  -- Metadata
  proposed_by TEXT DEFAULT 'BlackSwan',       -- agent name
  source TEXT DEFAULT 'automation',           -- automation | manual | alert | dca
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trading_pending_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own pending actions"
  ON trading_pending_actions FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_pending_actions_user ON trading_pending_actions(user_id, status, created_at DESC);

NOTIFY pgrst, 'reload schema';
