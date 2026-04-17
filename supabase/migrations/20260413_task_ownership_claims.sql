ALTER TABLE task_agent_assignments
  ADD COLUMN IF NOT EXISTS ownership_status text,
  ADD COLUMN IF NOT EXISTS ownership_summary text,
  ADD COLUMN IF NOT EXISTS required_connectors text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS required_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS missing_connectors text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS missing_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS ownership_updated_at timestamptz;

ALTER TABLE task_agent_assignments
  DROP CONSTRAINT IF EXISTS task_agent_assignments_ownership_status_check;

ALTER TABLE task_agent_assignments
  ADD CONSTRAINT task_agent_assignments_ownership_status_check
  CHECK (ownership_status IS NULL OR ownership_status IN ('full', 'assisted', 'blocked'));

CREATE INDEX IF NOT EXISTS idx_task_agent_assignments_ownership_status
  ON task_agent_assignments(task_id, ownership_status, updated_at DESC);

ALTER TABLE task_runs
  ADD COLUMN IF NOT EXISTS ownership_status text,
  ADD COLUMN IF NOT EXISTS ownership_summary text,
  ADD COLUMN IF NOT EXISTS required_connectors text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS required_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS missing_connectors text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS missing_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS ownership_updated_at timestamptz;

ALTER TABLE task_runs
  DROP CONSTRAINT IF EXISTS task_runs_ownership_status_check;

ALTER TABLE task_runs
  ADD CONSTRAINT task_runs_ownership_status_check
  CHECK (ownership_status IS NULL OR ownership_status IN ('full', 'assisted', 'blocked'));

CREATE INDEX IF NOT EXISTS idx_task_runs_ownership_status
  ON task_runs(task_id, ownership_status, started_at DESC);

NOTIFY pgrst, 'reload schema';
