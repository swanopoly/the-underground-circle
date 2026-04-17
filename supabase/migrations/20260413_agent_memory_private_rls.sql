-- First-class private agent memory support.
-- Goal:
-- 1. Allow scope='agent' rows to use visibility='private'
-- 2. Let circle members still read shared memories
-- 3. Backfill agent memories that were previously downgraded to circle_shared
--    during the transition to first-class agent scope

DO $$
BEGIN
  ALTER TABLE memory_entries DROP CONSTRAINT IF EXISTS memory_entries_agent_scope_requirements;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE memory_entries
  ADD CONSTRAINT memory_entries_agent_scope_requirements
  CHECK (
    scope <> 'agent'
    OR (agent_id IS NOT NULL AND circle_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_memory_agent_private
  ON memory_entries(agent_id, user_id, updated_at DESC)
  WHERE scope = 'agent' AND visibility = 'private' AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_memory_agent_shared
  ON memory_entries(agent_id, circle_id, updated_at DESC)
  WHERE scope = 'agent' AND visibility IN ('room_shared', 'circle_shared', 'org_shared') AND is_active = true;

DROP POLICY IF EXISTS "memory_via_circle" ON memory_entries;
DROP POLICY IF EXISTS "memory_entries_access" ON memory_entries;
DROP POLICY IF EXISTS "memory_read" ON memory_entries;
DROP POLICY IF EXISTS "memory_insert" ON memory_entries;
DROP POLICY IF EXISTS "memory_update" ON memory_entries;
DROP POLICY IF EXISTS "memory_delete" ON memory_entries;
DROP POLICY IF EXISTS memory_select_shared ON memory_entries;
DROP POLICY IF EXISTS memory_select_private ON memory_entries;

CREATE POLICY memory_select_shared ON memory_entries
FOR SELECT TO authenticated
USING (
  visibility IN ('room_shared','circle_shared','org_shared')
  AND circle_id IN (
    SELECT circle_id
    FROM circle_members
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY memory_select_private ON memory_entries
FOR SELECT TO authenticated
USING (
  visibility = 'private'
  AND (
    user_id = auth.uid()
    OR (
      scope = 'agent'
      AND circle_id IN (
        SELECT circle_id
        FROM circle_members
        WHERE user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY memory_insert ON memory_entries
FOR INSERT TO authenticated
WITH CHECK (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY memory_update ON memory_entries
FOR UPDATE TO authenticated
USING (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  )
)
WITH CHECK (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY memory_delete ON memory_entries
FOR DELETE TO authenticated
USING (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
    )
  )
);

UPDATE memory_entries
SET
  visibility = 'private',
  updated_at = now(),
  metadata = jsonb_set(
    jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{migrated_to_private_agent_memory}',
      'true'::jsonb,
      true
    ),
    '{visibility_fallback_cleared_at}',
    to_jsonb(now()::text),
    true
  )
WHERE
  scope = 'agent'
  AND visibility = 'circle_shared'
  AND (
    metadata->>'namespace' IN ('agent_private_pattern', 'agent_private_blocker')
    OR metadata->>'access' = 'agent_private'
    OR metadata->>'intended_visibility' = 'private'
    OR metadata->>'visibility_fallback' = 'circle_shared'
  );

NOTIFY pgrst, 'reload schema';
