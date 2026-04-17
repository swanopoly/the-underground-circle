-- Durable resumable checkpoints for feed task runs.

CREATE TABLE IF NOT EXISTS task_run_context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  checkpoint_index int NOT NULL,
  summary text,
  blockers text[] DEFAULT '{}'::text[],
  next_actions text[] DEFAULT '{}'::text[],
  artifacts_snapshot jsonb DEFAULT '[]'::jsonb,
  deliverable_excerpt text,
  source_step_count int DEFAULT 0,
  compacted_step_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_run_context_snapshots_run
  ON task_run_context_snapshots(task_run_id, checkpoint_index DESC);

CREATE INDEX IF NOT EXISTS idx_task_run_context_snapshots_task
  ON task_run_context_snapshots(task_id, created_at DESC);

ALTER TABLE task_run_context_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_run_context_snapshots_select ON task_run_context_snapshots;
CREATE POLICY task_run_context_snapshots_select
  ON task_run_context_snapshots FOR SELECT TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS task_run_context_snapshots_insert ON task_run_context_snapshots;
CREATE POLICY task_run_context_snapshots_insert
  ON task_run_context_snapshots FOR INSERT TO authenticated
  WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS task_run_context_snapshots_update ON task_run_context_snapshots;
CREATE POLICY task_run_context_snapshots_update
  ON task_run_context_snapshots FOR UPDATE TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE task_run_context_snapshots;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

NOTIFY pgrst, 'reload schema';
