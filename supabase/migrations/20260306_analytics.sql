-- ─── Circle Analytics ───────────────────────────────────────────────────────
-- Daily aggregated metrics per circle for the analytics dashboard.

CREATE TABLE circle_analytics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  active_members INTEGER DEFAULT 0,
  total_check_ins INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  avg_streak NUMERIC(5,2) DEFAULT 0,
  agent_cost_total NUMERIC(10,4) DEFAULT 0,
  agent_tokens_total BIGINT DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_created INTEGER DEFAULT 0,
  UNIQUE(circle_id, date)
);
CREATE INDEX idx_analytics_daily ON circle_analytics_daily(circle_id, date DESC);
ALTER TABLE circle_analytics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Circle members can view analytics" ON circle_analytics_daily FOR SELECT USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);
