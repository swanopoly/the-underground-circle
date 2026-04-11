-- Fix session memory race condition — prevent duplicate session memories at DB level
-- The 20s poller can create duplicates when multiple tabs/processes run simultaneously.
-- This unique index ensures only one session memory per (circle, source, title, user).

-- First, clean up existing duplicates (keep the most recently updated one)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY circle_id, source_surface, title, COALESCE(user_id, '00000000-0000-0000-0000-000000000000')
    ORDER BY updated_at DESC
  ) AS rn
  FROM memory_entries
  WHERE scope = 'session' AND is_active = true
)
UPDATE memory_entries SET is_active = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Create partial unique index for active session memories
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_session_dedup
  ON memory_entries (circle_id, source_surface, title, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'))
  WHERE scope = 'session' AND is_active = true;

NOTIFY pgrst, 'reload schema';
