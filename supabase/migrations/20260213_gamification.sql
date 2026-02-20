-- Gamification System Migration
-- Tables: user_xp, xp_events, achievements, user_achievements, votes
-- Plus alterations to profiles and check_ins

-- 1. Add columns to existing tables
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS xp int DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level int DEFAULT 1;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS title text DEFAULT 'Recruit';

ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS vote_count int DEFAULT 0;

-- 2. user_xp table
CREATE TABLE IF NOT EXISTS user_xp (
  id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  total_xp int NOT NULL DEFAULT 0,
  level int NOT NULL DEFAULT 1,
  title text NOT NULL DEFAULT 'Recruit',
  grind_karma int NOT NULL DEFAULT 0,
  social_karma int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- 3. xp_events table
CREATE TABLE IF NOT EXISTS xp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  xp_amount int NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xp_events_user_id ON xp_events(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_events_type ON xp_events(event_type);

-- 4. achievements table
CREATE TABLE IF NOT EXISTS achievements (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL,
  xp_reward int NOT NULL,
  category text NOT NULL,
  requirement jsonb DEFAULT '{}'
);

-- 5. user_achievements table
CREATE TABLE IF NOT EXISTS user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id text NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at timestamptz DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);

-- 6. votes table
CREATE TABLE IF NOT EXISTS votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  vote int NOT NULL CHECK (vote IN (1, -1)),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_target ON votes(target_type, target_id);

-- 7. Seed achievements
INSERT INTO achievements (id, name, description, icon, xp_reward, category, requirement) VALUES
  ('first_blood', 'First Blood', 'Complete your first check-in', '🩸', 50, 'grind', '{"type": "check_in_count", "count": 1}'),
  ('streak_3', 'On Fire', 'Hit a 3-day streak', '🔥', 100, 'streak', '{"type": "streak", "count": 3}'),
  ('streak_7', 'Unstoppable', 'Hit a 7-day streak', '⚡', 250, 'streak', '{"type": "streak", "count": 7}'),
  ('streak_30', 'Diamond Hands', 'Hit a 30-day streak', '💎', 1000, 'streak', '{"type": "streak", "count": 30}'),
  ('streak_100', 'Underground King', 'Hit a 100-day streak', '👑', 5000, 'streak', '{"type": "streak", "count": 100}'),
  ('circle_creator', 'Architect', 'Create your first circle', '🏗️', 150, 'social', '{"type": "circle_created", "count": 1}'),
  ('circle_joiner', 'Connected', 'Join 3 circles', '🤝', 100, 'social', '{"type": "circles_joined", "count": 3}'),
  ('social_butterfly', 'Social Butterfly', 'Get 50 upvotes total', '🦋', 200, 'social', '{"type": "upvotes_received", "count": 50}'),
  ('top_grinder', 'Top Grinder', 'Most check-ins in your circle for a week', '🏆', 500, 'grind', '{"type": "top_grinder"}'),
  ('first_task', 'Task Master', 'Complete your first task', '✅', 75, 'grind', '{"type": "task_count", "count": 1}'),
  ('ten_tasks', 'Executioner', 'Complete 10 tasks', '🎯', 300, 'grind', '{"type": "task_count", "count": 10}'),
  ('wallet_connected', 'Crypto Native', 'Connect a wallet', '💰', 50, 'special', '{"type": "wallet_connected"}'),
  ('early_adopter', 'Early Adopter', 'Join during beta', '🌅', 200, 'special', '{"type": "early_adopter"}'),
  ('hundred_checkins', 'The Grind Never Stops', '100 total check-ins', '💯', 1000, 'grind', '{"type": "check_in_count", "count": 100}'),
  ('wave_starter', 'Wave Starter', 'Get 10+ upvotes on a single check-in', '🌊', 250, 'social', '{"type": "single_checkin_upvotes", "count": 10}')
ON CONFLICT (id) DO NOTHING;

-- 8. RLS Policies
ALTER TABLE user_xp ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- user_xp: everyone can read
CREATE POLICY "user_xp_select" ON user_xp FOR SELECT USING (true);
CREATE POLICY "user_xp_insert" ON user_xp FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "user_xp_update" ON user_xp FOR UPDATE USING (id = auth.uid());

-- xp_events: everyone can read, only own insert
CREATE POLICY "xp_events_select" ON xp_events FOR SELECT USING (true);
CREATE POLICY "xp_events_insert" ON xp_events FOR INSERT WITH CHECK (user_id = auth.uid());

-- achievements: everyone can read
CREATE POLICY "achievements_select" ON achievements FOR SELECT USING (true);

-- user_achievements: everyone can read
CREATE POLICY "user_achievements_select" ON user_achievements FOR SELECT USING (true);
CREATE POLICY "user_achievements_insert" ON user_achievements FOR INSERT WITH CHECK (user_id = auth.uid());

-- votes: own CRUD
CREATE POLICY "votes_select" ON votes FOR SELECT USING (true);
CREATE POLICY "votes_insert" ON votes FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "votes_update" ON votes FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "votes_delete" ON votes FOR DELETE USING (user_id = auth.uid());

-- 9. award_xp function
CREATE OR REPLACE FUNCTION award_xp(
  p_user_id uuid,
  p_amount int,
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_xp int;
  v_level int;
  v_title text;
BEGIN
  -- Insert xp event
  INSERT INTO xp_events (user_id, event_type, xp_amount, metadata)
  VALUES (p_user_id, p_event_type, p_amount, p_metadata);

  -- Upsert user_xp
  INSERT INTO user_xp (id, total_xp, level, title, updated_at)
  VALUES (p_user_id, p_amount, 1, 'Recruit', now())
  ON CONFLICT (id) DO UPDATE SET
    total_xp = user_xp.total_xp + p_amount,
    updated_at = now();

  -- Update karma
  IF p_event_type IN ('check_in', 'task_complete', 'streak_bonus', 'daily_login') THEN
    UPDATE user_xp SET grind_karma = grind_karma + p_amount WHERE id = p_user_id;
  ELSIF p_event_type IN ('upvote_received', 'circle_join', 'circle_create') THEN
    UPDATE user_xp SET social_karma = social_karma + p_amount WHERE id = p_user_id;
  END IF;

  -- Get new total
  SELECT total_xp INTO v_total_xp FROM user_xp WHERE id = p_user_id;

  -- Calculate level: floor(sqrt(total_xp / 50)) + 1, capped at 100
  v_level := LEAST(FLOOR(SQRT(v_total_xp::float / 50)) + 1, 100);

  -- Calculate title based on level
  v_title := CASE
    WHEN v_level >= 50 THEN 'Underground King'
    WHEN v_level >= 40 THEN 'Underground Boss'
    WHEN v_level >= 30 THEN 'Legend'
    WHEN v_level >= 25 THEN 'OG'
    WHEN v_level >= 20 THEN 'Elite'
    WHEN v_level >= 15 THEN 'Veteran'
    WHEN v_level >= 10 THEN 'Hustler'
    WHEN v_level >= 5 THEN 'Grinder'
    ELSE 'Recruit'
  END;

  -- Update user_xp with level/title
  UPDATE user_xp SET level = v_level, title = v_title WHERE id = p_user_id;

  -- Update denormalized profiles columns
  UPDATE profiles SET xp = v_total_xp, level = v_level, title = v_title WHERE id = p_user_id;

  RETURN jsonb_build_object('total_xp', v_total_xp, 'level', v_level, 'title', v_title);
END;
$$;
