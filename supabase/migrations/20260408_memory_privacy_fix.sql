-- Fix memory_entries RLS: user-scope memories should only be visible to their owner
-- Previously: any circle member could read any user-scope memory in that circle
-- Now: user-scope memories require user_id = auth.uid()

DROP POLICY IF EXISTS "memory_via_circle" ON memory_entries;

CREATE POLICY "memory_entries_access" ON memory_entries FOR ALL
  USING (
    CASE
      -- User-scope memories: only the owner can see them
      WHEN scope = 'user' THEN user_id = auth.uid()
      -- Session-scope memories: owner or circle members
      WHEN scope = 'session' THEN (user_id = auth.uid() OR circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
      -- Circle/room/org scope: any circle member
      ELSE circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
    END
  );

-- Add columns for memory quality and retrieval (from deep research recommendations)
DO $$
BEGIN
  -- Importance score (0.0 to 1.0) — how critical this memory is
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_entries' AND column_name = 'importance') THEN
    ALTER TABLE memory_entries ADD COLUMN importance numeric(3,2) DEFAULT 0.5;
  END IF;

  -- Retrieval mode: when should this memory be loaded
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_entries' AND column_name = 'retrieval_mode') THEN
    ALTER TABLE memory_entries ADD COLUMN retrieval_mode text DEFAULT 'on_demand' CHECK (retrieval_mode IN ('startup', 'on_demand', 'never_auto'));
  END IF;

  -- Status lifecycle: candidate → active → stale → retracted
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_entries' AND column_name = 'status') THEN
    ALTER TABLE memory_entries ADD COLUMN status text DEFAULT 'active' CHECK (status IN ('candidate', 'active', 'stale', 'retracted'));
  END IF;

  -- Supersedes: when a memory replaces another
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_entries' AND column_name = 'supersedes_id') THEN
    ALTER TABLE memory_entries ADD COLUMN supersedes_id uuid REFERENCES memory_entries(id);
  END IF;

  -- Access tracking for relevance scoring
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_entries' AND column_name = 'last_accessed_at') THEN
    ALTER TABLE memory_entries ADD COLUMN last_accessed_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_entries' AND column_name = 'access_count') THEN
    ALTER TABLE memory_entries ADD COLUMN access_count int DEFAULT 0;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
