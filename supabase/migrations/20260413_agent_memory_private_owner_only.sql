-- Tighten private agent memory to true owner-only access.
-- This migration should be applied after 20260413_agent_memory_private_rls.sql.
--
-- Result:
-- - private user/session memory: owner only
-- - private agent memory: owner only
-- - shared room/circle/org memory: circle members
-- - agent-private memory remains cross-session for the same authenticated owner,
--   but is no longer readable by other circle members

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
  AND user_id = auth.uid()
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
    AND user_id = auth.uid()
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
    AND user_id = auth.uid()
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
    AND user_id = auth.uid()
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
    AND user_id = auth.uid()
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
  updated_at = now(),
  metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{owner_only_private_agent_memory}',
    'true'::jsonb,
    true
  )
WHERE
  scope = 'agent'
  AND visibility = 'private'
  AND user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
