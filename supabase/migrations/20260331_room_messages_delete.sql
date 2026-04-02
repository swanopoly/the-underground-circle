-- Allow circle members to delete room messages in their circles
-- Checks both project_rooms and circle_rooms since rooms can be in either table
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "rls_room_messages_delete" ON room_messages;

CREATE POLICY "rls_room_messages_delete" ON room_messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM project_rooms pr
      WHERE pr.id = room_messages.room_id
        AND pr.circle_id IN (SELECT get_my_circle_ids())
    )
    OR EXISTS (
      SELECT 1 FROM circle_rooms cr
      WHERE cr.id = room_messages.room_id
        AND cr.circle_id IN (SELECT get_my_circle_ids())
    )
  );
