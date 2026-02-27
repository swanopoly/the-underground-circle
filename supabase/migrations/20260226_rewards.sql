-- User points ledger
CREATE TABLE IF NOT EXISTS user_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  total_points bigint default 0,
  lifetime_points bigint default 0,
  current_streak int default 0,
  longest_streak int default 0,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(user_id)
);

-- Points transactions log
CREATE TABLE IF NOT EXISTS points_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  points int not null,
  reason text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- User badges earned
CREATE TABLE IF NOT EXISTS user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  badge_id text not null,
  earned_at timestamptz default now(),
  points_at_earn bigint default 0,
  unique(user_id, badge_id)
);

-- RLS
ALTER TABLE user_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_points' AND policyname='user_points_own') THEN
    CREATE POLICY user_points_own ON user_points FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='points_transactions' AND policyname='points_tx_own') THEN
    CREATE POLICY points_tx_own ON points_transactions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_badges' AND policyname='user_badges_own') THEN
    CREATE POLICY user_badges_own ON user_badges FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
  -- Allow reading others' badges (for circle leaderboards)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_badges' AND policyname='user_badges_read_all') THEN
    CREATE POLICY user_badges_read_all ON user_badges FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_points' AND policyname='user_points_read_all') THEN
    CREATE POLICY user_points_read_all ON user_points FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
