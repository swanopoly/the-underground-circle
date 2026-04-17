-- Add first-class agent memory scope and binding.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'memory_entries' AND column_name = 'agent_id'
  ) THEN
    ALTER TABLE memory_entries ADD COLUMN agent_id text;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE memory_entries DROP CONSTRAINT IF EXISTS memory_entries_scope_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE memory_entries
  ADD CONSTRAINT memory_entries_scope_check
  CHECK (scope IN ('org','circle','room','user','session','agent'));

CREATE INDEX IF NOT EXISTS idx_memory_agent
  ON memory_entries(agent_id, circle_id, is_active)
  WHERE agent_id IS NOT NULL AND is_active = true;

UPDATE memory_entries
SET
  scope = 'agent',
  agent_id = COALESCE(agent_id, metadata->>'agentId'),
  user_id = NULL,
  visibility = CASE
    WHEN visibility = 'private' THEN 'circle_shared'
    ELSE visibility
  END,
  updated_at = now()
WHERE
  COALESCE(agent_id, metadata->>'agentId') IS NOT NULL
  AND scope = 'user'
  AND (
    metadata->>'source' = 'agent_task_completion'
    OR metadata->>'source' = 'agent_task_blocker'
    OR title ILIKE 'Agent pattern:%'
    OR title ILIKE 'Agent blocker:%'
  );

NOTIFY pgrst, 'reload schema';
