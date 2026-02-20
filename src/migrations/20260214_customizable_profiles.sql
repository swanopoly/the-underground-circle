-- Migration: Customizable Profiles & Social Features
-- Date: 2026-02-14

-- Add new columns to profiles table for customization
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS theme_color VARCHAR(7) DEFAULT '#6366f1',
ADD COLUMN IF NOT EXISTS banner_url TEXT,
ADD COLUMN IF NOT EXISTS status_message TEXT,
ADD COLUMN IF NOT EXISTS linked_accounts JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS pinned_achievements TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Create agents_bots table
CREATE TABLE IF NOT EXISTS agents_bots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  api_endpoint TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'chatbot' CHECK (type IN ('chatbot', 'assistant', 'integration', 'custom')),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create friend_requests table
CREATE TABLE IF NOT EXISTS friend_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sender_id, receiver_id)
);

-- Create friends table
CREATE TABLE IF NOT EXISTS friends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  friend_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  since TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Create direct_messages table
CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'system')),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create integrations table
CREATE TABLE IF NOT EXISTS integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('discord', 'twitter', 'github', 'spotify', 'fitbit', 'strava', 'other')),
  platform_user_id TEXT NOT NULL,
  platform_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_sync TIMESTAMP WITH TIME ZONE,
  UNIQUE(user_id, platform)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_agents_bots_owner_id ON agents_bots(owner_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_id ON friend_requests(receiver_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender_id ON friend_requests(sender_id);
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_sender_id ON direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_receiver_id ON direct_messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation ON direct_messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);

-- Enable Row Level Security
ALTER TABLE agents_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for agents_bots
CREATE POLICY "Users can view their own agents" ON agents_bots
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "Users can manage their own agents" ON agents_bots
  FOR ALL USING (owner_id = auth.uid());

-- RLS Policies for friend_requests
CREATE POLICY "Users can view their sent requests" ON friend_requests
  FOR SELECT USING (sender_id = auth.uid());

CREATE POLICY "Users can view requests sent to them" ON friend_requests
  FOR SELECT USING (receiver_id = auth.uid());

CREATE POLICY "Users can create friend requests" ON friend_requests
  FOR INSERT WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Users can update requests sent to them" ON friend_requests
  FOR UPDATE USING (receiver_id = auth.uid());

-- RLS Policies for friends
CREATE POLICY "Users can view their friendships" ON friends
  FOR SELECT USING (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "Users can create friendships" ON friends
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can remove their friendships" ON friends
  FOR DELETE USING (user_id = auth.uid() OR friend_id = auth.uid());

-- RLS Policies for direct_messages
CREATE POLICY "Users can view their conversations" ON direct_messages
  FOR SELECT USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "Users can send messages" ON direct_messages
  FOR INSERT WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Users can update their received messages" ON direct_messages
  FOR UPDATE USING (receiver_id = auth.uid());

-- RLS Policies for integrations
CREATE POLICY "Users can manage their own integrations" ON integrations
  FOR ALL USING (user_id = auth.uid());

-- Create functions for automatic friendship creation
CREATE OR REPLACE FUNCTION create_friendship()
RETURNS TRIGGER AS $$
BEGIN
  -- When a friend request is accepted, create the friendship
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    -- Create friendship in both directions
    INSERT INTO friends (user_id, friend_id, since)
    VALUES (NEW.sender_id, NEW.receiver_id, NOW())
    ON CONFLICT (user_id, friend_id) DO NOTHING;
    
    INSERT INTO friends (user_id, friend_id, since)
    VALUES (NEW.receiver_id, NEW.sender_id, NOW())
    ON CONFLICT (user_id, friend_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic friendship creation
DROP TRIGGER IF EXISTS friend_request_accepted ON friend_requests;
CREATE TRIGGER friend_request_accepted
  AFTER UPDATE ON friend_requests
  FOR EACH ROW
  EXECUTE FUNCTION create_friendship();

-- Create function to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_agents_bots_updated_at
  BEFORE UPDATE ON agents_bots
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friend_requests_updated_at
  BEFORE UPDATE ON friend_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_direct_messages_updated_at
  BEFORE UPDATE ON direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();