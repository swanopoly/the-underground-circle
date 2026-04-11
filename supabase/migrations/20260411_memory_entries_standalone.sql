-- Memory Entries — standalone migration (fixes FK references from 20260408_unified_agent_runs.sql)
-- The original migration referenced circles(circle_id) which should be circles(id).
-- This creates just the memory_entries table needed for the memory system to work.

CREATE TABLE IF NOT EXISTS memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: determines who sees this memory
  scope text NOT NULL CHECK (scope IN ('org','circle','room','user','session')),

  -- Scope bindings
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  room_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid,

  -- Content
  memory_kind text NOT NULL DEFAULT 'fact' CHECK (memory_kind IN ('fact','instruction','preference','decision','finding','policy','context')),
  title text NOT NULL DEFAULT '',
  content text NOT NULL,

  -- Source tracking
  source_run_id uuid,
  source_surface text,
  promoted_from uuid,

  -- Retrieval
  retrieval_mode text DEFAULT 'on_demand',
  importance real DEFAULT 0.5,
  visibility text DEFAULT 'private' CHECK (visibility IN ('private','circle_shared','public')),

  -- Lifecycle
  is_active boolean DEFAULT true,
  expires_at timestamptz,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_memory_circle ON memory_entries(circle_id, scope, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_memory_user ON memory_entries(user_id, is_active) WHERE is_active = true;

ALTER TABLE memory_entries ENABLE ROW LEVEL SECURITY;

-- RLS: circle members can see circle/room/session memories; users can see their own
CREATE POLICY "memory_read" ON memory_entries FOR SELECT
  USING (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
    OR user_id = auth.uid()
  );

CREATE POLICY "memory_insert" ON memory_entries FOR INSERT
  WITH CHECK (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
    OR user_id = auth.uid()
  );

CREATE POLICY "memory_update" ON memory_entries FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "memory_delete" ON memory_entries FOR DELETE
  USING (user_id = auth.uid());

-- Notify PostgREST to pick up new table
NOTIFY pgrst, 'reload schema';
