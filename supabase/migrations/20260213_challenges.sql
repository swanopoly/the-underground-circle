-- Weekly Challenges System + Proof of Work on check-ins

-- Challenges table
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

-- Challenge participants table
CREATE TABLE IF NOT EXISTS challenge_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  progress int NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  UNIQUE (challenge_id, user_id)
);

-- RLS for challenges
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;

-- Members can read challenges in their circles
DO $$ BEGIN
CREATE POLICY "Members can read circle challenges"
  ON challenges FOR SELECT
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Creators can insert challenges
DO $$ BEGIN
CREATE POLICY "Members can create challenges"
  ON challenges FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Participants can read
DO $$ BEGIN
CREATE POLICY "Members can read challenge participants"
  ON challenge_participants FOR SELECT
  USING (
    challenge_id IN (
      SELECT c.id FROM challenges c
      JOIN circle_members cm ON cm.circle_id = c.circle_id
      WHERE cm.user_id = auth.uid()
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can join challenges
DO $$ BEGIN
CREATE POLICY "Users can join challenges"
  ON challenge_participants FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Participants can update their own progress
DO $$ BEGIN
CREATE POLICY "Participants can update own progress"
  ON challenge_participants FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add proof column to check_ins
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS proof jsonb DEFAULT NULL;

-- Challenge template comments:
-- Template 1: "7-Day Streak Challenge" - type: streak, target: 7, xp_reward: 200
--   Description: "Check in every day for 7 days straight. No excuses."
-- Template 2: "10 Check-ins Sprint" - type: checkins, target: 10, xp_reward: 150
--   Description: "Hit 10 check-ins this week across any circles."
-- Template 3: "XP Grinder" - type: xp, target: 500, xp_reward: 300
--   Description: "Earn 500 XP in one week. Grind hard."
