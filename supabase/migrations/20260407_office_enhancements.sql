-- Office Enhancement migrations: Status indicators, Standup entries, Mentions
-- Run via Supabase SQL Editor

-- Status indicators
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_status jsonb DEFAULT '{"mode":"available","note":null,"expiresAt":null}'::jsonb;

-- Standup entries for status board
CREATE TABLE IF NOT EXISTS standup_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  yesterday text NOT NULL DEFAULT '',
  today text NOT NULL DEFAULT '',
  blockers text NOT NULL DEFAULT '',
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(circle_id, user_id, entry_date)
);
ALTER TABLE standup_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_manage_standups" ON standup_entries FOR ALL USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

-- Mentions
CREATE TABLE IF NOT EXISTS mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_content text NOT NULL,
  source_type text NOT NULL DEFAULT 'chat',
  source_id text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_mentions" ON mentions FOR SELECT USING (target_user_id = auth.uid());
CREATE POLICY "members_insert_mentions" ON mentions FOR INSERT WITH CHECK (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);
CREATE POLICY "users_update_own_mentions" ON mentions FOR UPDATE USING (target_user_id = auth.uid());
ALTER PUBLICATION supabase_realtime ADD TABLE mentions;
CREATE INDEX idx_mentions_target ON mentions(target_user_id, read_at);
