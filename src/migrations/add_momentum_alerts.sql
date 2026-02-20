-- Momentum Alerts System - Database Schema
-- Engagement hook system to drive user retention through social triggers

-- Create momentum_alerts table
CREATE TABLE momentum_alerts (
  id text PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('circle_activity', 'peak_hours_ending', 'streak_bonus', 'competition')),
  title text NOT NULL,
  message text NOT NULL,
  action_text text NOT NULL,
  urgency_level text NOT NULL CHECK (urgency_level IN ('low', 'medium', 'high')),
  expires_at timestamptz NOT NULL,
  xp_bonus integer,
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT NOW(),
  dismissed_at timestamptz,
  acted_at timestamptz
);

-- Indexes for performance
CREATE INDEX momentum_alerts_user_id_idx ON momentum_alerts(user_id);
CREATE INDEX momentum_alerts_expires_at_idx ON momentum_alerts(expires_at);
CREATE INDEX momentum_alerts_circle_id_idx ON momentum_alerts(circle_id);
CREATE INDEX momentum_alerts_type_idx ON momentum_alerts(type);

-- RLS (Row Level Security) policies
ALTER TABLE momentum_alerts ENABLE ROW LEVEL SECURITY;

-- Users can only see their own alerts
CREATE POLICY "Users can view own momentum alerts" ON momentum_alerts
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own alerts (dismiss, mark as acted upon)
CREATE POLICY "Users can update own momentum alerts" ON momentum_alerts
  FOR UPDATE USING (auth.uid() = user_id);

-- System can insert alerts for any user
CREATE POLICY "System can insert momentum alerts" ON momentum_alerts
  FOR INSERT WITH CHECK (true);

-- Optional: Create a function to clean up expired alerts
CREATE OR REPLACE FUNCTION cleanup_expired_momentum_alerts()
RETURNS void AS $$
BEGIN
  DELETE FROM momentum_alerts 
  WHERE expires_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup to run daily (if using pg_cron extension)
-- SELECT cron.schedule('cleanup-momentum-alerts', '0 2 * * *', 'SELECT cleanup_expired_momentum_alerts();');

-- Insert initial comment for tracking
INSERT INTO schema_migrations (version) VALUES ('20260216_momentum_alerts') 
ON CONFLICT (version) DO NOTHING;