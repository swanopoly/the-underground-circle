-- Per-step persistence for hybrid computer tasks. One row per sub-step
-- in a HybridPlan (file/app/browser). Lets the Focus Chain UI render
-- live transitions for the owner AND for teammates via Realtime, and
-- gives every hybrid run a durable audit trail across tab closes.

CREATE TABLE IF NOT EXISTS computer_task_steps (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid          NOT NULL REFERENCES computer_use_runs(id) ON DELETE CASCADE,
  circle_id       uuid          NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  step_index      integer       NOT NULL,
  step_kind       text          NOT NULL
                    CHECK (step_kind IN ('file', 'app', 'browser')),
  task            text          NOT NULL,
  rationale       text,
  status          text          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'completed', 'blocked', 'skipped')),
  output          jsonb,
  error           text,
  needs_approval  boolean       NOT NULL DEFAULT false,
  approved_at     timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_computer_task_steps_run
  ON computer_task_steps (run_id, step_index);

CREATE INDEX IF NOT EXISTS idx_computer_task_steps_circle_recent
  ON computer_task_steps (circle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_computer_task_steps_active
  ON computer_task_steps (run_id) WHERE status = 'active';

-- RLS — circle members can read steps for their circle; only the
-- parent run's owner (or service role) can write.
ALTER TABLE computer_task_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cts_read_members" ON computer_task_steps;
CREATE POLICY "cts_read_members"
  ON computer_task_steps FOR SELECT
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cts_owner_write" ON computer_task_steps;
CREATE POLICY "cts_owner_write"
  ON computer_task_steps FOR ALL
  USING (
    run_id IN (
      SELECT id FROM computer_use_runs WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    run_id IN (
      SELECT id FROM computer_use_runs WHERE user_id = auth.uid()
    )
  );

-- Add to Realtime publication so HybridFocusChain can subscribe.
ALTER PUBLICATION supabase_realtime ADD TABLE computer_task_steps;

NOTIFY pgrst, 'reload schema';
