-- Mission Streaks — daily task-completion streaks per (user, circle).
--
-- Previously 100% localStorage. When the browser cache cleared the user's
-- streak counter and milestone XP-bonuses vanished. This adds a durable
-- backing table; src/lib/missionStreaks.ts dual-persists on every save.
--
-- Streaks are scoped per-circle because missions are per-circle. A user
-- in 3 circles has 3 independent streaks.

CREATE TABLE IF NOT EXISTS mission_streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  current_streak int NOT NULL DEFAULT 0,
  longest_streak int NOT NULL DEFAULT 0,
  last_completion_date date,
  total_tasks_completed int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One streak row per (user, circle). Circle is nullable for users who
  -- haven't joined a circle yet — they get a single global streak row.
  UNIQUE (user_id, circle_id)
);

CREATE INDEX IF NOT EXISTS idx_mission_streaks_user
  ON mission_streaks(user_id);
CREATE INDEX IF NOT EXISTS idx_mission_streaks_circle
  ON mission_streaks(circle_id) WHERE circle_id IS NOT NULL;

ALTER TABLE mission_streaks ENABLE ROW LEVEL SECURITY;

-- A user reads + writes only their own streak rows.
CREATE POLICY "Users read own mission streaks"
  ON mission_streaks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own mission streaks"
  ON mission_streaks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own mission streaks"
  ON mission_streaks FOR UPDATE
  USING (auth.uid() = user_id);

-- Touch updated_at automatically.
CREATE OR REPLACE FUNCTION touch_mission_streaks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mission_streaks_touch_updated_at ON mission_streaks;
CREATE TRIGGER mission_streaks_touch_updated_at
  BEFORE UPDATE ON mission_streaks
  FOR EACH ROW
  EXECUTE FUNCTION touch_mission_streaks_updated_at();

NOTIFY pgrst, 'reload schema';
