-- Close legacy world-readable collaboration policies.
--
-- These tables contain private circle work, proof, profile preferences, and
-- activity metadata. Older dashboard-created policies used USING (true), so
-- the public anon key embedded in the web app could read every row despite
-- RLS being enabled. Retain the client workflows, but scope every row to the
-- authenticated user's circles (or to the user's own profile/activity).

BEGIN;

CREATE OR REPLACE FUNCTION public.shares_circle_with_user(p_other_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_other_user_id IS NOT NULL
    AND (
      p_other_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.circle_members AS mine
        JOIN public.circle_members AS theirs
          ON theirs.circle_id = mine.circle_id
        WHERE mine.user_id = auth.uid()
          AND theirs.user_id = p_other_user_id
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_access_reaction_target(
  p_check_in_id uuid,
  p_message_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND ((p_check_in_id IS NULL) <> (p_message_id IS NULL))
    AND (
      EXISTS (
        SELECT 1
        FROM public.check_ins AS check_in
        JOIN public.circle_members AS member
          ON member.circle_id = check_in.circle_id
         AND member.user_id = auth.uid()
        WHERE check_in.id = p_check_in_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.messages AS message
        JOIN public.circle_members AS member
          ON member.circle_id = message.circle_id
         AND member.user_id = auth.uid()
        WHERE message.id = p_message_id
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_access_check_in(p_check_in_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.check_ins AS check_in
      JOIN public.circle_members AS member
        ON member.circle_id = check_in.circle_id
       AND member.user_id = auth.uid()
      WHERE check_in.id = p_check_in_id
    );
$function$;

REVOKE ALL ON FUNCTION public.shares_circle_with_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_reaction_target(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_check_in(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_circle_with_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_reaction_target(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_check_in(uuid) TO authenticated;

-- Anonymous clients do not need direct access to private collaboration rows.
REVOKE ALL ON TABLE public.check_ins FROM anon;
REVOKE ALL ON TABLE public.pins FROM anon;
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.reactions FROM anon;
REVOKE ALL ON TABLE public.tasks FROM anon;
REVOKE ALL ON TABLE public.user_achievements FROM anon;
REVOKE ALL ON TABLE public.votes FROM anon;
REVOKE ALL ON TABLE public.xp_events FROM anon;

-- Remove historical blanket grants too. RLS covers row operations, but
-- TRUNCATE is not row-scoped and should never be available to web clients.
REVOKE ALL ON TABLE public.check_ins FROM authenticated;
REVOKE ALL ON TABLE public.pins FROM authenticated;
REVOKE ALL ON TABLE public.profiles FROM authenticated;
REVOKE ALL ON TABLE public.reactions FROM authenticated;
REVOKE ALL ON TABLE public.tasks FROM authenticated;
REVOKE ALL ON TABLE public.user_achievements FROM authenticated;
REVOKE ALL ON TABLE public.votes FROM authenticated;
REVOKE ALL ON TABLE public.xp_events FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.check_ins TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.pins TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.reactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tasks TO authenticated;
GRANT SELECT, INSERT ON TABLE public.user_achievements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.votes TO authenticated;
GRANT SELECT, INSERT ON TABLE public.xp_events TO authenticated;

-- Profiles: self or a user who shares at least one circle.
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view circle member profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view shared profiles" ON public.profiles;
CREATE POLICY "Authenticated users can view shared profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.shares_circle_with_user(id));

-- Check-ins: members read; the author can write only inside a joined circle.
DROP POLICY IF EXISTS "View check-ins" ON public.check_ins;
DROP POLICY IF EXISTS "Members can view circle check-ins" ON public.check_ins;
DROP POLICY IF EXISTS "Users can view check-ins in their circles" ON public.check_ins;
DROP POLICY IF EXISTS "Users can create check-ins" ON public.check_ins;
DROP POLICY IF EXISTS "Users can create their own check-ins" ON public.check_ins;
DROP POLICY IF EXISTS "Users can update their own check-ins" ON public.check_ins;
DROP POLICY IF EXISTS "Circle members can view check-ins" ON public.check_ins;
DROP POLICY IF EXISTS "Circle members can create own check-ins" ON public.check_ins;
DROP POLICY IF EXISTS "Circle members can update own check-ins" ON public.check_ins;
CREATE POLICY "Circle members can view check-ins"
ON public.check_ins FOR SELECT TO authenticated
USING (public.user_is_circle_member(circle_id));
CREATE POLICY "Circle members can create own check-ins"
ON public.check_ins FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.user_is_circle_member(circle_id));
CREATE POLICY "Circle members can update own check-ins"
ON public.check_ins FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND public.user_is_circle_member(circle_id))
WITH CHECK (user_id = auth.uid() AND public.user_is_circle_member(circle_id));

-- Pins: member-visible, owner-managed, exact circle binding.
DROP POLICY IF EXISTS "View pins" ON public.pins;
DROP POLICY IF EXISTS "Create pins" ON public.pins;
DROP POLICY IF EXISTS "Delete own pins" ON public.pins;
DROP POLICY IF EXISTS "Circle members can view pins" ON public.pins;
DROP POLICY IF EXISTS "Circle members can create own pins" ON public.pins;
DROP POLICY IF EXISTS "Circle members can delete own pins" ON public.pins;
CREATE POLICY "Circle members can view pins"
ON public.pins FOR SELECT TO authenticated
USING (public.user_is_circle_member(circle_id));
CREATE POLICY "Circle members can create own pins"
ON public.pins FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.user_is_circle_member(circle_id));
CREATE POLICY "Circle members can delete own pins"
ON public.pins FOR DELETE TO authenticated
USING (user_id = auth.uid() AND public.user_is_circle_member(circle_id));

-- Tasks: remove the permissive read and creator-only cross-circle insert path.
DROP POLICY IF EXISTS "View tasks" ON public.tasks;
DROP POLICY IF EXISTS "View tasks in your circles" ON public.tasks;
DROP POLICY IF EXISTS "Members can view circle tasks" ON public.tasks;
DROP POLICY IF EXISTS "Create tasks" ON public.tasks;
DROP POLICY IF EXISTS "Members can create tasks" ON public.tasks;
DROP POLICY IF EXISTS "Members can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Circle members can view tasks" ON public.tasks;
DROP POLICY IF EXISTS "Circle members can create tasks" ON public.tasks;
DROP POLICY IF EXISTS "Circle members can update tasks" ON public.tasks;
CREATE POLICY "Circle members can view tasks"
ON public.tasks FOR SELECT TO authenticated
USING (public.user_is_circle_member(circle_id));
CREATE POLICY "Circle members can create tasks"
ON public.tasks FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND public.user_is_circle_member(circle_id));
CREATE POLICY "Circle members can update tasks"
ON public.tasks FOR UPDATE TO authenticated
USING (public.user_is_circle_member(circle_id))
WITH CHECK (public.user_is_circle_member(circle_id));

-- Reactions are visible/writable only when their one exact target is visible.
DROP POLICY IF EXISTS "View reactions" ON public.reactions;
DROP POLICY IF EXISTS "Add reactions" ON public.reactions;
DROP POLICY IF EXISTS "Remove own reactions" ON public.reactions;
DROP POLICY IF EXISTS "Circle members can view reactions" ON public.reactions;
DROP POLICY IF EXISTS "Circle members can add own reactions" ON public.reactions;
DROP POLICY IF EXISTS "Circle members can remove own reactions" ON public.reactions;
CREATE POLICY "Circle members can view reactions"
ON public.reactions FOR SELECT TO authenticated
USING (public.can_access_reaction_target(check_in_id, message_id));
CREATE POLICY "Circle members can add own reactions"
ON public.reactions FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND length(emoji) BETWEEN 1 AND 32
  AND public.can_access_reaction_target(check_in_id, message_id)
);
CREATE POLICY "Circle members can remove own reactions"
ON public.reactions FOR DELETE TO authenticated
USING (
  user_id = auth.uid()
  AND public.can_access_reaction_target(check_in_id, message_id)
);

-- The only shipped vote target is a check-in. Bind every operation to a
-- check-in visible to the current circle member.
DROP POLICY IF EXISTS "votes_select" ON public.votes;
DROP POLICY IF EXISTS "votes_insert" ON public.votes;
DROP POLICY IF EXISTS "votes_update" ON public.votes;
DROP POLICY IF EXISTS "votes_delete" ON public.votes;
DROP POLICY IF EXISTS "Circle members can view check-in votes" ON public.votes;
DROP POLICY IF EXISTS "Circle members can add own check-in votes" ON public.votes;
DROP POLICY IF EXISTS "Circle members can update own check-in votes" ON public.votes;
DROP POLICY IF EXISTS "Circle members can delete own check-in votes" ON public.votes;
CREATE POLICY "Circle members can view check-in votes"
ON public.votes FOR SELECT TO authenticated
USING (target_type = 'check_in' AND public.can_access_check_in(target_id));
CREATE POLICY "Circle members can add own check-in votes"
ON public.votes FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND target_type = 'check_in'
  AND vote IN (-1, 1)
  AND public.can_access_check_in(target_id)
);
CREATE POLICY "Circle members can update own check-in votes"
ON public.votes FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND target_type = 'check_in' AND public.can_access_check_in(target_id))
WITH CHECK (
  user_id = auth.uid()
  AND target_type = 'check_in'
  AND vote IN (-1, 1)
  AND public.can_access_check_in(target_id)
);
CREATE POLICY "Circle members can delete own check-in votes"
ON public.votes FOR DELETE TO authenticated
USING (user_id = auth.uid() AND target_type = 'check_in' AND public.can_access_check_in(target_id));

-- Achievement and XP history may be shown to circle peers, never to anon or
-- unrelated accounts. Existing self-write rules remain in force.
DROP POLICY IF EXISTS "user_achievements_select" ON public.user_achievements;
DROP POLICY IF EXISTS "Circle peers can view user achievements" ON public.user_achievements;
CREATE POLICY "Circle peers can view user achievements"
ON public.user_achievements FOR SELECT TO authenticated
USING (public.shares_circle_with_user(user_id));

DROP POLICY IF EXISTS "xp_events_select" ON public.xp_events;
DROP POLICY IF EXISTS "Circle peers can view XP events" ON public.xp_events;
CREATE POLICY "Circle peers can view XP events"
ON public.xp_events FOR SELECT TO authenticated
USING (public.shares_circle_with_user(user_id));

NOTIFY pgrst, 'reload schema';

COMMIT;
