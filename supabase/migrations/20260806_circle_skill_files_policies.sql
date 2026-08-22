-- ─── circle_skill_files: apply the intended RLS policies ────────────────────
-- APPLIED LIVE 2026-08-06.
--
-- The table was created in production with RLS ENABLED and ZERO policies —
-- RLS-on + no-policy is silently deny-all, so every read AND write failed for
-- every user. The correct, membership-scoped policies were written in
-- docs/RUN_THIS_SQL.sql §15 (and supabase/migrations/20260507_circle_skill_files.sql)
-- but only the table half was ever applied.
--
-- Found by an empirical sweep, not by reading source: circle_skill_files had
-- 0 rows and 0 policies while the client actively reads/writes it
-- (skillLibrary.ts:207,239; skillLibraryWrite.ts:189). circle_skills is also
-- empty, so the skill library is non-functional end to end — which is why the
-- bundled canonical skills never applied to any turn.
--
-- These are verbatim the intended policies: every verb requires membership of
-- the circle that owns the parent skill (circle_skills → circle_members),
-- with UPDATE carrying a matching WITH CHECK. Verified after apply: 4 policies
-- present (r/a/w/d) and an anon request is still refused (42501).
--
-- NOTE: restoring the policies does not populate the library. Canonical skills
-- are still seeded only by the creator-gated "Add canonical skills" action in
-- CircleSettingsScreen — that adoption gap is tracked separately.

DROP POLICY IF EXISTS "circle_skill_files_read" ON circle_skill_files;
CREATE POLICY "circle_skill_files_read" ON circle_skill_files FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM circle_skills cs
      JOIN circle_members cm ON cm.circle_id = cs.circle_id
     WHERE cs.id = circle_skill_files.skill_id
       AND cm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "circle_skill_files_insert" ON circle_skill_files;
CREATE POLICY "circle_skill_files_insert" ON circle_skill_files FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM circle_skills cs
      JOIN circle_members cm ON cm.circle_id = cs.circle_id
     WHERE cs.id = circle_skill_files.skill_id
       AND cm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "circle_skill_files_update" ON circle_skill_files;
CREATE POLICY "circle_skill_files_update" ON circle_skill_files FOR UPDATE
  USING (EXISTS (SELECT 1 FROM circle_skills cs JOIN circle_members cm ON cm.circle_id = cs.circle_id WHERE cs.id = circle_skill_files.skill_id AND cm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM circle_skills cs JOIN circle_members cm ON cm.circle_id = cs.circle_id WHERE cs.id = circle_skill_files.skill_id AND cm.user_id = auth.uid()));

DROP POLICY IF EXISTS "circle_skill_files_delete" ON circle_skill_files;
CREATE POLICY "circle_skill_files_delete" ON circle_skill_files FOR DELETE USING (
  EXISTS (SELECT 1 FROM circle_skills cs JOIN circle_members cm ON cm.circle_id = cs.circle_id WHERE cs.id = circle_skill_files.skill_id AND cm.user_id = auth.uid())
);
