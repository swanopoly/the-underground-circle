-- Second Brain: user-private visibility model
-- 1. Fix UPDATE policy so only the creator (or admins) can update a note
-- 2. Add index for per-user brain queries

DROP POLICY IF EXISTS second_brain_notes_update ON circle_second_brain_notes;
CREATE POLICY second_brain_notes_update
  ON circle_second_brain_notes FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'moderator', 'creator')
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'moderator', 'creator')
    )
  );

CREATE INDEX IF NOT EXISTS idx_second_brain_notes_creator
  ON circle_second_brain_notes(circle_id, created_by, status, updated_at DESC);

NOTIFY pgrst, 'reload schema';
