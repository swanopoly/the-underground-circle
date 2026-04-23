-- ═══════════════════════════════════════════════════════════════════════════
-- Mission favorites ("pins") — per-user, per-mission bookmark so users can
-- float their 1–2 most-important missions to the top of the list.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mission_favorites (
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_id  uuid         NOT NULL REFERENCES circle_missions(id) ON DELETE CASCADE,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mission_id)
);

-- Lookup path: "which missions has this user pinned?"
CREATE INDEX IF NOT EXISTS idx_mission_favorites_user
  ON mission_favorites (user_id, created_at DESC);
-- Reverse lookup for "how many users have pinned this mission?" aggregates.
CREATE INDEX IF NOT EXISTS idx_mission_favorites_mission
  ON mission_favorites (mission_id);

ALTER TABLE mission_favorites ENABLE ROW LEVEL SECURITY;

-- Users see + manage only their own pins. Pinning a mission requires
-- membership in its circle so users can't pin missions they can't see.
DROP POLICY IF EXISTS "favorites_read_own"   ON mission_favorites;
DROP POLICY IF EXISTS "favorites_insert_own" ON mission_favorites;
DROP POLICY IF EXISTS "favorites_delete_own" ON mission_favorites;

CREATE POLICY "favorites_read_own"
  ON mission_favorites FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "favorites_insert_own"
  ON mission_favorites FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND mission_id IN (
      SELECT cm.id FROM circle_missions cm
      INNER JOIN circle_members m ON m.circle_id = cm.circle_id
      WHERE m.user_id = auth.uid()
    )
  );

CREATE POLICY "favorites_delete_own"
  ON mission_favorites FOR DELETE
  USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
