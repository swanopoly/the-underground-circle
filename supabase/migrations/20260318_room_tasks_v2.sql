-- 20260318_room_tasks_v2.sql
-- Add agentic task support: task_type, last_result, status column on room_tasks

-- Task type: general | web_research | run_script | file_ops | db_query | api_call
ALTER TABLE room_tasks ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'general';

-- Last execution result (structured JSON)
ALTER TABLE room_tasks ADD COLUMN IF NOT EXISTS last_result jsonb;

-- Execution status: idle | running | done | error
ALTER TABLE room_tasks ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'idle';

-- Ensure last_run_at exists (should already, but safe)
ALTER TABLE room_tasks ADD COLUMN IF NOT EXISTS last_run_at timestamptz;

-- Index for filtering by task_type
CREATE INDEX IF NOT EXISTS idx_room_tasks_task_type ON room_tasks (task_type);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_room_tasks_status ON room_tasks (status);
