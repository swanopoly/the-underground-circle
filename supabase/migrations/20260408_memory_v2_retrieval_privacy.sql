-- Memory V2: Semantic retrieval, privacy hardening, source linkage, evaluation
-- Based on deep research dossier: agent-memory-retrieval-privacy-and-sql-dossier

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Extend memory_entries with visibility, confidence, embedding support
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_entries' AND column_name = 'visibility') THEN
    ALTER TABLE memory_entries ADD COLUMN visibility text NOT NULL DEFAULT 'circle_shared'
      CHECK (visibility IN ('private','room_shared','circle_shared','org_shared'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_entries' AND column_name = 'confidence') THEN
    ALTER TABLE memory_entries ADD COLUMN confidence numeric(3,2) DEFAULT 0.75;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_entries' AND column_name = 'pinned') THEN
    ALTER TABLE memory_entries ADD COLUMN pinned boolean DEFAULT false;
  END IF;
END $$;

-- Set visibility for existing user-scope memories
UPDATE memory_entries SET visibility = 'private' WHERE scope = 'user' AND visibility = 'circle_shared';
UPDATE memory_entries SET visibility = 'room_shared' WHERE scope = 'room' AND visibility = 'circle_shared';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Replace RLS with command-specific policies
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "memory_via_circle" ON memory_entries;
DROP POLICY IF EXISTS "memory_entries_access" ON memory_entries;

-- SELECT: shared memories for circle members + private for owner only
CREATE POLICY memory_select_shared ON memory_entries FOR SELECT TO authenticated
USING (
  visibility IN ('room_shared','circle_shared','org_shared')
  AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

CREATE POLICY memory_select_private ON memory_entries FOR SELECT TO authenticated
USING (visibility = 'private' AND user_id = auth.uid());

-- INSERT: owner can insert private, circle members can insert shared
CREATE POLICY memory_insert ON memory_entries FOR INSERT TO authenticated
WITH CHECK (
  (visibility = 'private' AND user_id = auth.uid())
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  )
);

-- UPDATE: same rules as insert
CREATE POLICY memory_update ON memory_entries FOR UPDATE TO authenticated
USING (
  (visibility = 'private' AND user_id = auth.uid())
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  )
);

-- DELETE: owner for private, circle member for shared
CREATE POLICY memory_delete ON memory_entries FOR DELETE TO authenticated
USING (
  (visibility = 'private' AND user_id = auth.uid())
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  )
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Memory Sources — link memories to their origin
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS memory_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('message','run','step','artifact','approval','manual')),
  source_id uuid,
  excerpt text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_memory_sources_memory ON memory_sources(memory_id);

ALTER TABLE memory_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY memory_sources_access ON memory_sources FOR ALL TO authenticated
USING (memory_id IN (SELECT id FROM memory_entries WHERE
  (visibility = 'private' AND user_id = auth.uid())
  OR (visibility IN ('room_shared','circle_shared','org_shared')
      AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Memory Evaluations — quality checks
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS memory_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  evaluation_kind text NOT NULL CHECK (evaluation_kind IN ('quality','contradiction','sensitivity','durability','manual_review')),
  evaluator text NOT NULL DEFAULT 'auto',
  passed boolean,
  score numeric(3,2),
  feedback text,
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_memory_evaluations_memory ON memory_evaluations(memory_id);

ALTER TABLE memory_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY memory_evaluations_access ON memory_evaluations FOR ALL TO authenticated
USING (memory_id IN (SELECT id FROM memory_entries WHERE
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Run Context Snapshots — checkpointed compaction state
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS run_context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL,
  checkpoint_index int NOT NULL,
  summary text,
  active_plan text,
  open_questions text[] DEFAULT '{}',
  artifacts_snapshot jsonb DEFAULT '[]'::jsonb,
  source_message_count int DEFAULT 0,
  compacted_message_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_run_context_snapshots_run ON run_context_snapshots(run_id, checkpoint_index);

ALTER TABLE run_context_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY run_context_snapshots_access ON run_context_snapshots FOR ALL TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Memory Access Log — audit trail
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS memory_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  surface text,
  reason text NOT NULL CHECK (reason IN ('startup','retrieval','session_resume','manual_pin','search')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_memory_access_log_memory ON memory_access_log(memory_id);
CREATE INDEX idx_memory_access_log_run ON memory_access_log(run_id) WHERE run_id IS NOT NULL;

ALTER TABLE memory_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY memory_access_log_access ON memory_access_log FOR ALL TO authenticated
USING (user_id = auth.uid() OR run_id IN (
  SELECT id FROM agent_runs WHERE circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  )
));

-- Full-text search index on memory_entries for keyword retrieval
CREATE INDEX IF NOT EXISTS idx_memory_entries_fts
  ON memory_entries USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

NOTIFY pgrst, 'reload schema';
