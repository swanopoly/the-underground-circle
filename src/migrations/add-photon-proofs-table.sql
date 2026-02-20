-- Migration: Add Photon Proof System
-- Date: 2026-02-17
-- Purpose: Enable morning photon sync feature with light verification

-- Create photon_proofs table
CREATE TABLE IF NOT EXISTS photon_proofs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  photo_url TEXT NOT NULL,
  light_level INTEGER NOT NULL CHECK (light_level >= 0 AND light_level <= 255),
  verified BOOLEAN NOT NULL DEFAULT false,
  streak INTEGER NOT NULL DEFAULT 1 CHECK (streak >= 0),
  latitude DECIMAL(10, 8) NULL,
  longitude DECIMAL(11, 8) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one proof per user per circle per day
  CONSTRAINT unique_daily_proof UNIQUE (user_id, circle_id, DATE(timestamp))
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_photon_proofs_user_id ON photon_proofs(user_id);
CREATE INDEX IF NOT EXISTS idx_photon_proofs_circle_id ON photon_proofs(circle_id);
CREATE INDEX IF NOT EXISTS idx_photon_proofs_timestamp ON photon_proofs(timestamp);
CREATE INDEX IF NOT EXISTS idx_photon_proofs_verified ON photon_proofs(verified);
CREATE INDEX IF NOT EXISTS idx_photon_proofs_streak ON photon_proofs(streak);

-- Create composite index for streak queries
CREATE INDEX IF NOT EXISTS idx_photon_proofs_user_circle_timestamp 
  ON photon_proofs(user_id, circle_id, timestamp DESC);

-- RLS Policies
ALTER TABLE photon_proofs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own proofs and proofs from circles they're members of
CREATE POLICY "Users can view photon proofs from their circles"
  ON photon_proofs FOR SELECT
  USING (
    user_id = auth.uid() OR 
    circle_id IN (
      SELECT circle_id FROM circle_members 
      WHERE user_id = auth.uid()
    )
  );

-- Users can only insert their own proofs
CREATE POLICY "Users can create their own photon proofs"
  ON photon_proofs FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can only update their own proofs (for streak corrections)
CREATE POLICY "Users can update their own photon proofs"
  ON photon_proofs FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Function to get user's current photon streak for a circle
CREATE OR REPLACE FUNCTION get_photon_streak(user_uuid UUID, circle_uuid UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_streak INTEGER := 0;
  check_date DATE := CURRENT_DATE;
  proof_exists BOOLEAN;
BEGIN
  -- Start from today and count backwards
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM photon_proofs 
      WHERE user_id = user_uuid 
        AND circle_id = circle_uuid 
        AND DATE(timestamp) = check_date
        AND verified = true
    ) INTO proof_exists;
    
    -- If no proof for this date, break the streak
    IF NOT proof_exists THEN
      EXIT;
    END IF;
    
    -- Increment streak and check previous day
    current_streak := current_streak + 1;
    check_date := check_date - INTERVAL '1 day';
    
    -- Safety limit to prevent infinite loops
    IF current_streak > 365 THEN
      EXIT;
    END IF;
  END LOOP;
  
  RETURN current_streak;
END;
$$;

-- Function to get circle's photon leaderboard
CREATE OR REPLACE FUNCTION get_circle_photon_leaderboard(circle_uuid UUID)
RETURNS TABLE(
  user_id UUID,
  username TEXT,
  display_name TEXT,
  current_streak INTEGER,
  total_proofs INTEGER,
  verified_proofs INTEGER,
  avg_light_level DECIMAL,
  last_proof_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id as user_id,
    u.username,
    u.display_name,
    get_photon_streak(u.id, circle_uuid) as current_streak,
    COUNT(pp.id)::INTEGER as total_proofs,
    COUNT(CASE WHEN pp.verified THEN 1 END)::INTEGER as verified_proofs,
    ROUND(AVG(pp.light_level), 1) as avg_light_level,
    MAX(DATE(pp.timestamp)) as last_proof_date
  FROM circle_members cm
  JOIN auth.users u ON u.id = cm.user_id
  LEFT JOIN photon_proofs pp ON pp.user_id = cm.user_id AND pp.circle_id = circle_uuid
  WHERE cm.circle_id = circle_uuid
  GROUP BY u.id, u.username, u.display_name
  ORDER BY current_streak DESC, total_proofs DESC;
END;
$$;

-- Function to check if user's morning app features should be unlocked
CREATE OR REPLACE FUNCTION is_morning_unlocked(user_uuid UUID, circle_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  today_proof_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM photon_proofs 
    WHERE user_id = user_uuid 
      AND circle_id = circle_uuid 
      AND DATE(timestamp) = CURRENT_DATE
  ) INTO today_proof_exists;
  
  RETURN today_proof_exists;
END;
$$;

-- Add notification trigger for streak milestones
CREATE OR REPLACE FUNCTION notify_photon_streak_milestone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check for milestone streaks (7, 30, 100, 365 days)
  IF NEW.streak IN (7, 30, 100, 365) THEN
    -- In a real implementation, this would trigger a notification
    -- For now, we'll just log it
    INSERT INTO system_events (event_type, user_id, metadata, created_at)
    VALUES (
      'photon_streak_milestone',
      NEW.user_id,
      jsonb_build_object(
        'circle_id', NEW.circle_id,
        'streak', NEW.streak,
        'milestone_type', CASE 
          WHEN NEW.streak = 7 THEN 'weekly'
          WHEN NEW.streak = 30 THEN 'monthly'
          WHEN NEW.streak = 100 THEN 'centurion'
          WHEN NEW.streak = 365 THEN 'annual'
        END
      ),
      NOW()
    );
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER photon_streak_milestone_trigger
  AFTER INSERT ON photon_proofs
  FOR EACH ROW
  EXECUTE FUNCTION notify_photon_streak_milestone();

-- Create system_events table if it doesn't exist (for notifications)
CREATE TABLE IF NOT EXISTS system_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_events_user_id ON system_events(user_id);
CREATE INDEX IF NOT EXISTS idx_system_events_type ON system_events(event_type);

-- Sample data (remove in production)
-- INSERT INTO photon_proofs (user_id, circle_id, timestamp, photo_url, light_level, verified, streak)
-- VALUES (
--   (SELECT id FROM auth.users LIMIT 1),
--   (SELECT id FROM circles LIMIT 1),
--   NOW(),
--   'https://example.com/sunrise.jpg',
--   180,
--   true,
--   1
-- );

COMMENT ON TABLE photon_proofs IS 'Stores morning photon sync verification photos and streaks';
COMMENT ON FUNCTION get_photon_streak IS 'Calculates current consecutive verified photon proof streak for a user in a circle';
COMMENT ON FUNCTION get_circle_photon_leaderboard IS 'Returns photon proof leaderboard for a circle';
COMMENT ON FUNCTION is_morning_unlocked IS 'Checks if user has submitted today''s photon proof to unlock morning features';