-- ?????????????????????????????????????????????????????????????????????????????
-- Task Agent Tracking ? Multi-Agent Assignments + Structured Task Runs
--
-- Adds first-class task agent assignments and structured run history so
-- dashboards, automations, and task execution share the same source of truth.
-- ?????????????????????????????????????????????????????????????????????????????

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS completion_policy text NOT NULL DEFAULT 'single_owner';

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_completion_policy_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_completion_policy_check
  CHECK (completion_policy IN ('single_owner', 'all_assigned', 'any_assigned'));

-- ?????????????????????????????????????????????????????????????????????????????
-- Task agent assignments
-- ?????????????????????????????????????????????????????????????????????????????

CREATE TABLE IF NOT EXISTS task_agent_assignments (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                 uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  circle_id               uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  agent_id                text        NOT NULL,
  role                    text        NOT NULL DEFAULT 'owner',
  assignment_type         text        NOT NULL DEFAULT 'manual',
  required_for_completion boolean     NOT NULL DEFAULT true,
  required_for_review     boolean     NOT NULL DEFAULT false,
  status                  text        NOT NULL DEFAULT 'assigned',
  order_index             integer     NOT NULL DEFAULT 0,
  assigned_by             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at             timestamptz NOT NULL DEFAULT now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, agent_id)
);

ALTER TABLE task_agent_assignments
  DROP CONSTRAINT IF EXISTS task_agent_assignments_role_check;
ALTER TABLE task_agent_assignments
  ADD CONSTRAINT task_agent_assignments_role_check
  CHECK (role IN ('owner', 'executor', 'reviewer', 'planner', 'observer'));

ALTER TABLE task_agent_assignments
  DROP CONSTRAINT IF EXISTS task_agent_assignments_assignment_type_check;
ALTER TABLE task_agent_assignments
  ADD CONSTRAINT task_agent_assignments_assignment_type_check
  CHECK (assignment_type IN ('manual', 'goal', 'plan', 'automation', 'legacy', 'suggested'));

ALTER TABLE task_agent_assignments
  DROP CONSTRAINT IF EXISTS task_agent_assignments_status_check;
ALTER TABLE task_agent_assignments
  ADD CONSTRAINT task_agent_assignments_status_check
  CHECK (status IN ('assigned', 'in_progress', 'completed', 'blocked', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_task_agent_assignments_task_id
  ON task_agent_assignments(task_id, order_index ASC, assigned_at ASC);
CREATE INDEX IF NOT EXISTS idx_task_agent_assignments_circle_id
  ON task_agent_assignments(circle_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_agent_assignments_agent_id
  ON task_agent_assignments(agent_id, assigned_at DESC);

ALTER TABLE task_agent_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_agent_assignments_select ON task_agent_assignments;
CREATE POLICY task_agent_assignments_select
  ON task_agent_assignments FOR SELECT TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS task_agent_assignments_insert ON task_agent_assignments;
CREATE POLICY task_agent_assignments_insert
  ON task_agent_assignments FOR INSERT TO authenticated
  WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS task_agent_assignments_update ON task_agent_assignments;
CREATE POLICY task_agent_assignments_update
  ON task_agent_assignments FOR UPDATE TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS task_agent_assignments_delete ON task_agent_assignments;
CREATE POLICY task_agent_assignments_delete
  ON task_agent_assignments FOR DELETE TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION update_task_agent_assignments_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = 'public';

DROP TRIGGER IF EXISTS trg_task_agent_assignments_updated_at ON task_agent_assignments;
CREATE TRIGGER trg_task_agent_assignments_updated_at
  BEFORE UPDATE ON task_agent_assignments
  FOR EACH ROW EXECUTE FUNCTION update_task_agent_assignments_updated_at();

-- Backfill legacy task owner assignments
INSERT INTO task_agent_assignments (
  task_id,
  circle_id,
  agent_id,
  role,
  assignment_type,
  required_for_completion,
  required_for_review,
  status,
  order_index,
  assigned_by,
  assigned_at,
  started_at,
  completed_at
)
SELECT
  t.id,
  t.circle_id,
  t.assigned_agent_id,
  'owner',
  'legacy',
  true,
  false,
  CASE
    WHEN t.status = 'done' THEN 'completed'
    WHEN t.status IN ('in_progress', 'peer_review', 'review', 'approved') THEN 'in_progress'
    ELSE 'assigned'
  END,
  0,
  t.created_by,
  t.created_at,
  CASE WHEN t.status IN ('in_progress', 'peer_review', 'review', 'approved', 'done') THEN coalesce(t.updated_at, t.created_at) END,
  CASE WHEN t.status = 'done' THEN t.completed_at END
FROM tasks t
WHERE t.assigned_agent_id IS NOT NULL
ON CONFLICT (task_id, agent_id) DO NOTHING;

CREATE OR REPLACE FUNCTION sync_primary_task_agent_assignment()
RETURNS trigger AS $$
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL THEN
    INSERT INTO task_agent_assignments (
      task_id,
      circle_id,
      agent_id,
      role,
      assignment_type,
      required_for_completion,
      required_for_review,
      status,
      order_index,
      assigned_by,
      assigned_at
    ) VALUES (
      NEW.id,
      NEW.circle_id,
      NEW.assigned_agent_id,
      'owner',
      'legacy',
      true,
      false,
      CASE
        WHEN NEW.status = 'done' THEN 'completed'
        WHEN NEW.status IN ('in_progress', 'peer_review', 'review', 'approved') THEN 'in_progress'
        ELSE 'assigned'
      END,
      0,
      NEW.created_by,
      now()
    )
    ON CONFLICT (task_id, agent_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = 'public';

DROP TRIGGER IF EXISTS trg_sync_primary_task_agent_assignment ON tasks;
CREATE TRIGGER trg_sync_primary_task_agent_assignment
  AFTER INSERT OR UPDATE OF assigned_agent_id, status ON tasks
  FOR EACH ROW EXECUTE FUNCTION sync_primary_task_agent_assignment();

-- ?????????????????????????????????????????????????????????????????????????????
-- Structured task runs
-- ?????????????????????????????????????????????????????????????????????????????

CREATE TABLE IF NOT EXISTS task_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  circle_id       uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  assignment_id   uuid        REFERENCES task_agent_assignments(id) ON DELETE SET NULL,
  agent_id        text        NOT NULL,
  parent_run_id   uuid        REFERENCES task_runs(id) ON DELETE SET NULL,
  run_kind        text        NOT NULL DEFAULT 'execute',
  status          text        NOT NULL DEFAULT 'running',
  trigger_source  text        NOT NULL DEFAULT 'manual',
  input_payload   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  output_payload  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  summary         text,
  artifact_refs   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  cost            numeric(10,6) DEFAULT 0,
  token_count     integer     DEFAULT 0,
  duration_ms     integer,
  error_message   text,
  model_used      text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

ALTER TABLE task_runs
  DROP CONSTRAINT IF EXISTS task_runs_run_kind_check;
ALTER TABLE task_runs
  ADD CONSTRAINT task_runs_run_kind_check
  CHECK (run_kind IN ('plan', 'execute', 'review', 'automation', 'orchestrator'));

ALTER TABLE task_runs
  DROP CONSTRAINT IF EXISTS task_runs_status_check;
ALTER TABLE task_runs
  ADD CONSTRAINT task_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'blocked', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_task_runs_task_id
  ON task_runs(task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_circle_id
  ON task_runs(circle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_agent_id
  ON task_runs(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_assignment_id
  ON task_runs(assignment_id, started_at DESC);

ALTER TABLE task_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_runs_select ON task_runs;
CREATE POLICY task_runs_select
  ON task_runs FOR SELECT TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS task_runs_insert ON task_runs;
CREATE POLICY task_runs_insert
  ON task_runs FOR INSERT TO authenticated
  WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS task_runs_update ON task_runs;
CREATE POLICY task_runs_update
  ON task_runs FOR UPDATE TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS task_runs_delete ON task_runs;
CREATE POLICY task_runs_delete
  ON task_runs FOR DELETE TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

ALTER TABLE task_comments
  ADD COLUMN IF NOT EXISTS task_run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL;

ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS task_run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL;
ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS agent_id text;

CREATE INDEX IF NOT EXISTS idx_automation_runs_task_id ON automation_runs(task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_task_run_id ON automation_runs(task_run_id);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE task_agent_assignments;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE task_runs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

NOTIFY pgrst, 'reload schema';
