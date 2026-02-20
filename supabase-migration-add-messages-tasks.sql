-- Migration: Add messages and tasks tables
-- Run this in your Supabase SQL editor if you already have the base schema

-- Messages (Circle Chat)
CREATE TABLE IF NOT EXISTS messages (
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
CREATE TABLE IF NOT EXISTS tasks (
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

-- RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Message policies
CREATE POLICY "View messages in your circles" ON messages FOR SELECT
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Members can send messages" ON messages FOR INSERT
  WITH CHECK (auth.uid() = user_id AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Members can update message reactions" ON messages FOR UPDATE
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Task policies
CREATE POLICY "View tasks in your circles" ON tasks FOR SELECT
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Members can create tasks" ON tasks FOR INSERT
  WITH CHECK (auth.uid() = created_by AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));
CREATE POLICY "Members can update tasks" ON tasks FOR UPDATE
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Enable Realtime for live chat
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
