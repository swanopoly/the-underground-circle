-- The Underground Circle - FIXED Database Migration Script
-- This version fixes foreign key naming and RLS issues

-- ============================================================================
-- Add missing columns to profiles table
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_address_eth TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_address_sol TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_chain TEXT CHECK (wallet_chain IN ('ethereum', 'solana'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme_color TEXT DEFAULT '#6366f1';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status_message TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS linked_accounts JSONB DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pinned_achievements TEXT[] DEFAULT '{}';

-- ============================================================================
-- Drop and recreate user_xp table with correct structure
-- ============================================================================

DROP TABLE IF EXISTS user_xp CASCADE;

CREATE TABLE user_xp (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT 'Newbie',
  grind_karma INTEGER NOT NULL DEFAULT 0,
  social_karma INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_xp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own XP" ON user_xp;
DROP POLICY IF EXISTS "Users can update their own XP" ON user_xp;

CREATE POLICY "Users can view their own XP"
  ON user_xp FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own XP"
  ON user_xp FOR UPDATE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_xp_user_id ON user_xp(user_id);
CREATE INDEX IF NOT EXISTS idx_user_xp_total_xp ON user_xp(total_xp DESC);

-- ============================================================================
-- Drop and recreate friends table with proper foreign key naming
-- ============================================================================

DROP TABLE IF EXISTS friends CASCADE;

CREATE TABLE friends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_friendship UNIQUE (user_id, friend_id)
);

ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their friendships" ON friends;
DROP POLICY IF EXISTS "Users can create friendships" ON friends;
DROP POLICY IF EXISTS "Users can delete their friendships" ON friends;

CREATE POLICY "Users can view their friendships"
  ON friends FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE POLICY "Users can create friendships"
  ON friends FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their friendships"
  ON friends FOR DELETE
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);

-- ============================================================================
-- Drop and recreate agents_bots table
-- ============================================================================

DROP TABLE IF EXISTS agents_bots CASCADE;

CREATE TABLE agents_bots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  api_endpoint TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('chatbot', 'assistant', 'integration', 'custom')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agents_bots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own agents" ON agents_bots;
DROP POLICY IF EXISTS "Users can create their own agents" ON agents_bots;
DROP POLICY IF EXISTS "Users can update their own agents" ON agents_bots;
DROP POLICY IF EXISTS "Users can delete their own agents" ON agents_bots;

CREATE POLICY "Users can view their own agents"
  ON agents_bots FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own agents"
  ON agents_bots FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own agents"
  ON agents_bots FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own agents"
  ON agents_bots FOR DELETE
  USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_agents_bots_owner_id ON agents_bots(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_bots_created_at ON agents_bots(created_at DESC);

-- ============================================================================
-- Drop and recreate integrations table
-- ============================================================================

DROP TABLE IF EXISTS integrations CASCADE;

CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'twitter', 'github', 'spotify', 'fitbit', 'strava', 'other')),
  platform_user_id TEXT NOT NULL,
  platform_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync TIMESTAMPTZ,
  CONSTRAINT unique_platform_integration UNIQUE (user_id, platform, platform_user_id)
);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own integrations" ON integrations;
DROP POLICY IF EXISTS "Users can create their own integrations" ON integrations;
DROP POLICY IF EXISTS "Users can update their own integrations" ON integrations;
DROP POLICY IF EXISTS "Users can delete their own integrations" ON integrations;

CREATE POLICY "Users can view their own integrations"
  ON integrations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own integrations"
  ON integrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own integrations"
  ON integrations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own integrations"
  ON integrations FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_integrations_platform ON integrations(platform);
CREATE INDEX IF NOT EXISTS idx_integrations_is_active ON integrations(is_active);

-- ============================================================================
-- Trigger function for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_agents_bots_updated_at ON agents_bots;
CREATE TRIGGER update_agents_bots_updated_at
  BEFORE UPDATE ON agents_bots
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

GRANT ALL ON user_xp TO authenticated;
GRANT ALL ON agents_bots TO authenticated;
GRANT ALL ON friends TO authenticated;
GRANT ALL ON integrations TO authenticated;

-- ============================================================================
-- Verification
-- ============================================================================

SELECT 'Migration complete! Tables created:' as status;

SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns 
   WHERE columns.table_name = tables.table_name) as column_count
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('user_xp', 'agents_bots', 'friends', 'integrations')
ORDER BY table_name;
