-- The Underground Circle - Database Migration Script
-- Run this in Supabase SQL Editor to create missing tables and columns

-- ============================================================================
-- Add missing columns to profiles table
-- ============================================================================

-- Add wallet columns (if they don't exist)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_address_eth TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_address_sol TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_chain TEXT CHECK (wallet_chain IN ('ethereum', 'solana'));

-- Add customization columns (if they don't exist)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme_color TEXT DEFAULT '#6366f1';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status_message TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS linked_accounts JSONB DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pinned_achievements TEXT[] DEFAULT '{}';

-- ============================================================================
-- Create user_xp table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_xp (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  total_xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT 'Newbie',
  grind_karma INTEGER NOT NULL DEFAULT 0,
  social_karma INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE user_xp ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_xp
CREATE POLICY "Users can view their own XP"
  ON user_xp FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own XP"
  ON user_xp FOR UPDATE
  USING (auth.uid() = id);

-- Create index
CREATE INDEX IF NOT EXISTS idx_user_xp_user_id ON user_xp(id);
CREATE INDEX IF NOT EXISTS idx_user_xp_total_xp ON user_xp(total_xp DESC);

-- ============================================================================
-- Create agents_bots table
-- ============================================================================

CREATE TABLE IF NOT EXISTS agents_bots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  api_endpoint TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('chatbot', 'assistant', 'integration', 'custom')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_owner FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE agents_bots ENABLE ROW LEVEL SECURITY;

-- RLS Policies for agents_bots
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agents_bots_owner_id ON agents_bots(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_bots_created_at ON agents_bots(created_at DESC);

-- ============================================================================
-- Create friends table
-- ============================================================================

CREATE TABLE IF NOT EXISTS friends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  friend_id UUID NOT NULL,
  since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friend FOREIGN KEY (friend_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT unique_friendship UNIQUE (user_id, friend_id)
);

-- Enable RLS
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

-- RLS Policies for friends
CREATE POLICY "Users can view their friendships"
  ON friends FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE POLICY "Users can create friendships"
  ON friends FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their friendships"
  ON friends FOR DELETE
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);

-- ============================================================================
-- Create integrations table
-- ============================================================================

CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'twitter', 'github', 'spotify', 'fitbit', 'strava', 'other')),
  platform_user_id TEXT NOT NULL,
  platform_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync TIMESTAMPTZ,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT unique_platform_integration UNIQUE (user_id, platform, platform_user_id)
);

-- Enable RLS
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for integrations
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_integrations_platform ON integrations(platform);
CREATE INDEX IF NOT EXISTS idx_integrations_is_active ON integrations(is_active);

-- ============================================================================
-- Create updated_at trigger function (if it doesn't exist)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to agents_bots
DROP TRIGGER IF EXISTS update_agents_bots_updated_at ON agents_bots;
CREATE TRIGGER update_agents_bots_updated_at
  BEFORE UPDATE ON agents_bots
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Create messages table (for circle chat)
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  circle_id UUID NOT NULL,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  reactions JSONB DEFAULT '{}',
  is_bot BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for messages
CREATE POLICY "Users can view messages in their circles"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM circle_members
      WHERE circle_members.circle_id = messages.circle_id
      AND circle_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create messages in their circles"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM circle_members
      WHERE circle_members.circle_id = messages.circle_id
      AND circle_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own messages"
  ON messages FOR DELETE
  USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_circle_id ON messages(circle_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_circle_created ON messages(circle_id, created_at DESC);

-- ============================================================================
-- Grant necessary permissions (if needed)
-- ============================================================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- Grant permissions on tables
GRANT ALL ON user_xp TO authenticated;
GRANT ALL ON agents_bots TO authenticated;
GRANT ALL ON friends TO authenticated;
GRANT ALL ON integrations TO authenticated;
GRANT ALL ON messages TO authenticated;

-- ============================================================================
-- Done!
-- ============================================================================

-- Verify tables were created
SELECT 
  'user_xp' AS table_name, 
  COUNT(*) AS row_count 
FROM user_xp
UNION ALL
SELECT 'agents_bots', COUNT(*) FROM agents_bots
UNION ALL
SELECT 'friends', COUNT(*) FROM friends
UNION ALL
SELECT 'integrations', COUNT(*) FROM integrations
UNION ALL
SELECT 'messages', COUNT(*) FROM messages;
