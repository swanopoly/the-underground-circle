-- Migration: Fix messages table for Circle Chat
-- Run this in Supabase Dashboard → SQL Editor
-- Date: 2026-03-04

-- ─── 1. Add missing columns ───────────────────────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_bot     BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions  JSONB   DEFAULT '{}';

-- ─── 2. Fix RLS policies ─────────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Drop old/broken policies
DROP POLICY IF EXISTS "circle members can read messages"  ON messages;
DROP POLICY IF EXISTS "users can insert own messages"     ON messages;
DROP POLICY IF EXISTS "users can update reactions"        ON messages;
DROP POLICY IF EXISTS "Enable read access for all users"  ON messages;
DROP POLICY IF EXISTS "Enable insert for authenticated"   ON messages;

-- SELECT: any circle member can read messages in their circle
CREATE POLICY "circle members can read messages" ON messages
  FOR SELECT USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

-- INSERT: authenticated members of the circle can post
CREATE POLICY "users can insert own messages" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE: members can update reactions on any message in their circle
CREATE POLICY "users can update reactions" ON messages
  FOR UPDATE USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

-- DELETE: users can only delete their own messages
CREATE POLICY "users can delete own messages" ON messages
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 3. Enable Realtime ───────────────────────────────────────────────────
-- Run this only if messages is not already in the realtime publication:
-- ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ─── 4. Index for performance ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_circle_created
  ON messages (circle_id, created_at ASC);
