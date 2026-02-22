-- Combined migration: all missing tables, columns, RPCs
-- Run this in Supabase SQL Editor

-- 1. Discord Integration
ALTER TABLE circles ADD COLUMN IF NOT EXISTS discord_guild_id TEXT;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS discord_bot_token TEXT;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS discord_connected_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS discord_channels (
  id TEXT PRIMARY KEY,
  circle_id UUID REFERENCES circles(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type INTEGER DEFAULT 0,
  parent_id TEXT,
  position INTEGER DEFAULT 0,
  topic TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_discord_channels_circle ON discord_channels(circle_id);
ALTER TABLE discord_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Circle members can view discord channels" ON discord_channels;
CREATE POLICY "Circle members can view discord channels" ON discord_channels FOR SELECT USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

-- 2. Gamification columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS xp int DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level int DEFAULT 1;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS title text DEFAULT 'Recruit';
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS vote_count int DEFAULT 0;
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS proof jsonb DEFAULT NULL;

-- 3. Gamification tables
CREATE TABLE IF NOT EXISTS user_xp (
  id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  total_xp int NOT NULL DEFAULT 0,
  level int NOT NULL DEFAULT 1,
  title text NOT NULL DEFAULT 'Recruit',
  grind_karma int NOT NULL DEFAULT 0,
  social_karma int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS achievements (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL,
  xp_reward int NOT NULL,
  category text NOT NULL,
  requirement jsonb DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id text NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at timestamptz DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);

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

-- 4. RLS for gamification
ALTER TABLE user_xp ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_xp_select" ON user_xp;
CREATE POLICY "user_xp_select" ON user_xp FOR SELECT USING (true);
DROP POLICY IF EXISTS "user_xp_insert" ON user_xp;
CREATE POLICY "user_xp_insert" ON user_xp FOR INSERT WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS "user_xp_update" ON user_xp;
CREATE POLICY "user_xp_update" ON user_xp FOR UPDATE USING (id = auth.uid());

DROP POLICY IF EXISTS "xp_events_select" ON xp_events;
CREATE POLICY "xp_events_select" ON xp_events FOR SELECT USING (true);
DROP POLICY IF EXISTS "xp_events_insert" ON xp_events;
CREATE POLICY "xp_events_insert" ON xp_events FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "achievements_select" ON achievements;
CREATE POLICY "achievements_select" ON achievements FOR SELECT USING (true);

DROP POLICY IF EXISTS "user_achievements_select" ON user_achievements;
CREATE POLICY "user_achievements_select" ON user_achievements FOR SELECT USING (true);
DROP POLICY IF EXISTS "user_achievements_insert" ON user_achievements;
CREATE POLICY "user_achievements_insert" ON user_achievements FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "votes_select" ON votes;
CREATE POLICY "votes_select" ON votes FOR SELECT USING (true);
DROP POLICY IF EXISTS "votes_insert" ON votes;
CREATE POLICY "votes_insert" ON votes FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "votes_update" ON votes;
CREATE POLICY "votes_update" ON votes FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS "votes_delete" ON votes;
CREATE POLICY "votes_delete" ON votes FOR DELETE USING (user_id = auth.uid());

-- 5. award_xp function
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
  INSERT INTO xp_events (user_id, event_type, xp_amount, metadata)
  VALUES (p_user_id, p_event_type, p_amount, p_metadata);

  INSERT INTO user_xp (id, total_xp, level, title, updated_at)
  VALUES (p_user_id, p_amount, 1, 'Recruit', now())
  ON CONFLICT (id) DO UPDATE SET
    total_xp = user_xp.total_xp + p_amount,
    updated_at = now();

  IF p_event_type IN ('check_in', 'task_complete', 'streak_bonus', 'daily_login') THEN
    UPDATE user_xp SET grind_karma = grind_karma + p_amount WHERE id = p_user_id;
  ELSIF p_event_type IN ('upvote_received', 'circle_join', 'circle_create') THEN
    UPDATE user_xp SET social_karma = social_karma + p_amount WHERE id = p_user_id;
  END IF;

  SELECT total_xp INTO v_total_xp FROM user_xp WHERE id = p_user_id;
  v_level := LEAST(FLOOR(SQRT(v_total_xp::float / 50)) + 1, 100);
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

  UPDATE user_xp SET level = v_level, title = v_title WHERE id = p_user_id;
  UPDATE profiles SET xp = v_total_xp, level = v_level, title = v_title WHERE id = p_user_id;
  RETURN jsonb_build_object('total_xp', v_total_xp, 'level', v_level, 'title', v_title);
END;
$$;

-- 6. Challenges
CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  challenge_type text NOT NULL CHECK (challenge_type IN ('streak', 'checkins', 'tasks', 'xp')),
  target_value int NOT NULL DEFAULT 7,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '7 days')::date,
  created_by uuid NOT NULL REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  xp_reward int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenge_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  progress int NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  UNIQUE (challenge_id, user_id)
);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read circle challenges" ON challenges;
CREATE POLICY "Members can read circle challenges" ON challenges FOR SELECT USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Members can create challenges" ON challenges;
CREATE POLICY "Members can create challenges" ON challenges FOR INSERT WITH CHECK (
  created_by = auth.uid() AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Members can read challenge participants" ON challenge_participants;
CREATE POLICY "Members can read challenge participants" ON challenge_participants FOR SELECT USING (
  challenge_id IN (SELECT c.id FROM challenges c JOIN circle_members cm ON cm.circle_id = c.circle_id WHERE cm.user_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can join challenges" ON challenge_participants;
CREATE POLICY "Users can join challenges" ON challenge_participants FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Participants can update own progress" ON challenge_participants;
CREATE POLICY "Participants can update own progress" ON challenge_participants FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 7. get_user_circles RPC
CREATE OR REPLACE FUNCTION get_user_circles(user_uuid uuid DEFAULT auth.uid())
RETURNS SETOF circles
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $func$
  SELECT c.*
  FROM circles c
  JOIN circle_members cm ON cm.circle_id = c.id
  WHERE cm.user_id = user_uuid
  ORDER BY c.created_at DESC;
$func$;

-- 8. Circle settings columns
ALTER TABLE circles ADD COLUMN IF NOT EXISTS vibe text DEFAULT '';
ALTER TABLE circles ADD COLUMN IF NOT EXISTS rules text[] DEFAULT '{}';
ALTER TABLE circles ADD COLUMN IF NOT EXISTS circle_image_url text DEFAULT NULL;

-- Done
