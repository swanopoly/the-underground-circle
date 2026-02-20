-- Row Level Security and Performance Migration
-- Created: 2026-02-13
-- Purpose: Enable RLS policies and add performance indexes for 100+ users

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view circle member profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Members can view their circles" ON circles;
DROP POLICY IF EXISTS "Authenticated users can create circles" ON circles;
DROP POLICY IF EXISTS "Creator can update circle" ON circles;
DROP POLICY IF EXISTS "Members can view fellow members" ON circle_members;
DROP POLICY IF EXISTS "Users can join circles" ON circle_members;
DROP POLICY IF EXISTS "Users can leave circles" ON circle_members;
DROP POLICY IF EXISTS "Members can view circle check-ins" ON check_ins;
DROP POLICY IF EXISTS "Members can create check-ins" ON check_ins;
DROP POLICY IF EXISTS "Members can view circle tasks" ON tasks;
DROP POLICY IF EXISTS "Members can create tasks" ON tasks;
DROP POLICY IF EXISTS "Members can update circle tasks" ON tasks;

-- Profiles: users can read profiles of people in their circles, update only their own
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can view circle member profiles" ON profiles FOR SELECT USING (
  id IN (SELECT user_id FROM circle_members WHERE circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Wallet address: only visible to circle members (already covered by profile policies)
-- But wallet_address update must verify ownership (handled in app layer with signature)

-- Circles: readable by members, creatable by authenticated users
CREATE POLICY "Members can view their circles" ON circles FOR SELECT USING (
  id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);
CREATE POLICY "Authenticated users can create circles" ON circles FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creator can update circle" ON circles FOR UPDATE USING (auth.uid() = created_by);

-- Circle members: visible to fellow members
CREATE POLICY "Members can view fellow members" ON circle_members FOR SELECT USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);
CREATE POLICY "Users can join circles" ON circle_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can leave circles" ON circle_members FOR DELETE USING (auth.uid() = user_id);

-- Check-ins: visible to circle members, creatable by members
CREATE POLICY "Members can view circle check-ins" ON check_ins FOR SELECT USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);
CREATE POLICY "Members can create check-ins" ON check_ins FOR INSERT WITH CHECK (
  auth.uid() = user_id AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

-- Tasks: visible to circle members, manageable by members
CREATE POLICY "Members can view circle tasks" ON tasks FOR SELECT USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);
CREATE POLICY "Members can create tasks" ON tasks FOR INSERT WITH CHECK (
  auth.uid() = created_by AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);
CREATE POLICY "Members can update circle tasks" ON tasks FOR UPDATE USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

-- Add indexes for performance at scale
CREATE INDEX IF NOT EXISTS idx_circle_members_user_id ON circle_members(user_id);
CREATE INDEX IF NOT EXISTS idx_circle_members_circle_id ON circle_members(circle_id);
CREATE INDEX IF NOT EXISTS idx_check_ins_circle_created ON check_ins(circle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_circle_status ON tasks(circle_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- Additional performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_circle_members_compound ON circle_members(user_id, circle_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_ins_user_id ON check_ins(user_id);