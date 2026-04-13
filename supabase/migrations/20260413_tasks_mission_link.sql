-- Link Kanban tasks to missions
-- Allows tasks to be associated with a mission for proof-of-work generation

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS mission_id uuid REFERENCES circle_missions(id) ON DELETE SET NULL;

-- Index for querying tasks by mission
CREATE INDEX IF NOT EXISTS idx_tasks_mission ON tasks(mission_id) WHERE mission_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
