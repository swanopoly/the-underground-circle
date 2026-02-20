-- The Underground Circle - Database Schema
-- Run this in your Supabase SQL editor

-- Users profile table
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Circles (crews of 5-8 people)
CREATE TABLE circles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  invite_code TEXT UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 8),
  max_members INTEGER DEFAULT 8 CHECK (max_members BETWEEN 3 AND 8),
  created_by UUID REFERENCES profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Circle membership
CREATE TABLE circle_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  circle_id UUID REFERENCES circles(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('creator', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(circle_id, user_id)
);

-- Daily check-ins (Proof of Work)
CREATE TABLE check_ins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  circle_id UUID REFERENCES circles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) <= 500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, circle_id, (created_at::date))
);

-- Messages (Circle Chat)
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  circle_id UUID REFERENCES circles(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) <= 1000),
  reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
  reactions JSONB DEFAULT '{}'::jsonb,
  is_bot BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks (Circle Task Board / Feed)
CREATE TABLE tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  circle_id UUID REFERENCES circles(id) ON DELETE CASCADE NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(title) <= 200),
  description TEXT CHECK (char_length(description) <= 500),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update own
CREATE POLICY "Profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Circles: members can read their circles
CREATE POLICY "Circle members can view circles" ON circles FOR SELECT
  USING (id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Authenticated users can create circles" ON circles FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Circle members: can view members of your circles
CREATE POLICY "View members of your circles" ON circle_members FOR SELECT
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Users can join circles" ON circle_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Creators can remove members" ON circle_members FOR DELETE
  USING (circle_id IN (SELECT id FROM circles WHERE created_by = auth.uid()) OR user_id = auth.uid());

-- Messages: circle members can view and send
CREATE POLICY "View messages in your circles" ON messages FOR SELECT
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Members can send messages" ON messages FOR INSERT
  WITH CHECK (auth.uid() = user_id AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Members can update message reactions" ON messages FOR UPDATE
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Tasks: circle members can view, create, update
CREATE POLICY "View tasks in your circles" ON tasks FOR SELECT
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Members can create tasks" ON tasks FOR INSERT
  WITH CHECK (auth.uid() = created_by AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Members can update tasks" ON tasks FOR UPDATE
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Check-ins: circle members can view and create
CREATE POLICY "View check-ins in your circles" ON check_ins FOR SELECT
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Users can create check-ins" ON check_ins FOR INSERT
  WITH CHECK (auth.uid() = user_id AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Function to auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Enable Realtime for messages (needed for live chat)
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
