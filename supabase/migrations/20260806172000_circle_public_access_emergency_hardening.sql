-- Emergency circle-discovery and membership hardening.
--
-- Live review found that a legacy `USING (true)` SELECT policy exposed every
-- column in `circles` to the anon role, including invite codes and stored API
-- credentials. Public discovery and joining now use narrow authenticated RPCs;
-- raw circle rows remain visible only to their creator or current members.

BEGIN;

ALTER TABLE public.circles
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_circles_public_created_at
  ON public.circles (created_at DESC, id)
  WHERE is_public IS TRUE;

-- RLS policies on circle_members must not query circle_members directly. These
-- fixed-search-path helpers deliberately bypass RLS for one bounded predicate.
CREATE OR REPLACE FUNCTION public.current_user_created_circle(p_circle_id uuid)
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
      FROM public.circles AS circle
      WHERE circle.id = p_circle_id
        AND circle.created_by = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public.public_circle_join_is_available(p_circle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_is_public boolean;
  selected_max_members integer;
  selected_member_count bigint;
BEGIN
  IF auth.uid() IS NULL OR p_circle_id IS NULL THEN
    RETURN false;
  END IF;

  -- A row lock serializes this legacy direct-insert compatibility path with
  -- both RPC join paths, so max_members cannot be overrun by concurrent joins.
  SELECT circle.is_public, circle.max_members
  INTO selected_is_public, selected_max_members
  FROM public.circles AS circle
  WHERE circle.id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND OR selected_is_public IS NOT TRUE THEN
    RETURN false;
  END IF;

  SELECT count(*)
  INTO selected_member_count
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id;

  RETURN selected_member_count < greatest(coalesce(selected_max_members, 8), 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.current_user_created_circle(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_created_circle(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_created_circle(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.public_circle_join_is_available(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_circle_join_is_available(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.public_circle_join_is_available(uuid) TO authenticated;

-- Remove every pre-existing SELECT policy instead of relying on a list of
-- historical names. A single permissive policy would OR with the safe policy
-- and reopen the full row.
DO $block$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'circles'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.circles',
      policy_row.policyname
    );
  END LOOP;
END;
$block$;

CREATE POLICY "Authenticated members and creators can view circles"
ON public.circles
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    created_by = auth.uid()
    OR public.user_is_circle_member(id)
  )
);

-- A public/anon table grant defeats the intended API boundary even when the
-- application only calls safe RPCs. Signed-in members still need raw-row reads
-- for current Circle detail/settings screens, and RLS constrains those rows.
REVOKE SELECT ON TABLE public.circles FROM PUBLIC;
REVOKE SELECT ON TABLE public.circles FROM anon;
GRANT SELECT ON TABLE public.circles TO authenticated;

-- A filter supplied by a client is not an authorization boundary. Multiple
-- legacy SELECT-only policies have existed under different names, and each
-- allowed callers to enumerate pending invite rows (including their codes).
-- Remove the whole SELECT-only policy class instead of pinning one historical
-- name. The scoped `circle_invites_manage` FOR ALL policy is intentionally
-- preserved for circle managers; invite resolution is otherwise RPC-only.
DO $block$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'circle_invites'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.circle_invites',
      policy_row.policyname
    );
  END LOOP;
END;
$block$;

REVOKE SELECT ON TABLE public.circle_invites FROM PUBLIC;
REVOKE SELECT ON TABLE public.circle_invites FROM anon;
GRANT SELECT ON TABLE public.circle_invites TO authenticated;

-- Remove all old INSERT policies, including the legacy `user_id = auth.uid()`
-- policy and creator FOR ALL policy. Direct inserts are retained only for the
-- two existing app flows: creator bootstrap and capacity-checked public join.
DO $block$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'circle_members'
      AND cmd IN ('INSERT', 'ALL')
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.circle_members',
      policy_row.policyname
    );
  END LOOP;
END;
$block$;

DROP POLICY IF EXISTS "Circle creators can update members" ON public.circle_members;
DROP POLICY IF EXISTS "Circle creators can remove members" ON public.circle_members;
DROP POLICY IF EXISTS "Users can bootstrap or join public circles" ON public.circle_members;

CREATE POLICY "Users can bootstrap or join public circles"
ON public.circle_members
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND (
    (
      role = 'creator'
      AND public.current_user_created_circle(circle_id)
    )
    OR (
      role = 'member'
      AND public.public_circle_join_is_available(circle_id)
    )
  )
);

CREATE POLICY "Circle creators can update members"
ON public.circle_members
FOR UPDATE
TO authenticated
USING (public.current_user_created_circle(circle_id))
WITH CHECK (public.current_user_created_circle(circle_id));

CREATE POLICY "Circle creators can remove members"
ON public.circle_members
FOR DELETE
TO authenticated
USING (public.current_user_created_circle(circle_id));

-- Safe, signed-in discovery. The return type intentionally excludes
-- invite_code, api_key, settings, Discord credentials, tab visibility, and
-- every future circles column unless it is deliberately added here.
CREATE OR REPLACE FUNCTION public.discover_public_circles(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  max_members integer,
  created_at timestamptz,
  circle_image_url text,
  member_count bigint,
  active_missions bigint,
  is_member boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  normalized_search text := pg_catalog.left(
    pg_catalog.btrim(coalesce(p_search, '')),
    80
  );
  bounded_limit integer := least(
    greatest(coalesce(p_limit, 50), 1),
    50
  );
  bounded_offset integer := least(
    greatest(coalesce(p_offset, 0), 0),
    500
  );
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'authentication_required';
  END IF;

  RETURN QUERY
  SELECT
    circle.id,
    circle.name,
    circle.description,
    circle.max_members,
    circle.created_at,
    circle.circle_image_url,
    (
      SELECT count(*)
      FROM public.circle_members AS membership_count
      WHERE membership_count.circle_id = circle.id
    )::bigint AS member_count,
    (
      SELECT count(*)
      FROM public.circle_missions AS mission
      WHERE mission.circle_id = circle.id
        AND mission.status = 'active'
    )::bigint AS active_missions,
    EXISTS (
      SELECT 1
      FROM public.circle_members AS caller_membership
      WHERE caller_membership.circle_id = circle.id
        AND caller_membership.user_id = caller_id
    ) AS is_member
  FROM public.circles AS circle
  WHERE circle.is_public IS TRUE
    AND (
      normalized_search = ''
      OR pg_catalog.strpos(
        pg_catalog.lower(coalesce(circle.name, '') || ' ' || coalesce(circle.description, '')),
        pg_catalog.lower(normalized_search)
      ) > 0
    )
  ORDER BY circle.created_at DESC, circle.id
  LIMIT bounded_limit
  OFFSET bounded_offset;
END;
$function$;

-- Capacity-checked, idempotent public-circle join. This returns only the safe
-- fields needed to navigate after success.
CREATE OR REPLACE FUNCTION public.join_public_circle(p_circle_id uuid)
RETURNS TABLE (
  circle_id uuid,
  circle_name text,
  circle_description text,
  max_members integer,
  circle_image_url text,
  member_count bigint,
  membership_role text,
  joined_at timestamptz,
  already_member boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  selected_name text;
  selected_description text;
  selected_max_members integer;
  selected_image_url text;
  selected_is_public boolean;
  selected_member_count bigint;
  selected_role text;
  selected_joined_at timestamptz;
  was_already_member boolean := false;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'authentication_required';
  END IF;
  IF p_circle_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'circle_not_available';
  END IF;

  SELECT
    circle.name,
    circle.description,
    circle.max_members,
    circle.circle_image_url,
    circle.is_public
  INTO
    selected_name,
    selected_description,
    selected_max_members,
    selected_image_url,
    selected_is_public
  FROM public.circles AS circle
  WHERE circle.id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'circle_not_available';
  END IF;

  SELECT membership.role, membership.joined_at
  INTO selected_role, selected_joined_at
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = caller_id;

  IF FOUND THEN
    was_already_member := true;
  ELSE
    IF selected_is_public IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'circle_not_available';
    END IF;

    SELECT count(*)
    INTO selected_member_count
    FROM public.circle_members AS membership
    WHERE membership.circle_id = p_circle_id;

    IF selected_member_count >= greatest(
      coalesce(selected_max_members, 8),
      1
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'circle_full';
    END IF;

    INSERT INTO public.circle_members (circle_id, user_id, role)
    VALUES (p_circle_id, caller_id, 'member')
    RETURNING role, circle_members.joined_at
    INTO selected_role, selected_joined_at;

    selected_member_count := selected_member_count + 1;
  END IF;

  IF selected_member_count IS NULL THEN
    SELECT count(*)
    INTO selected_member_count
    FROM public.circle_members AS membership
    WHERE membership.circle_id = p_circle_id;
  END IF;

  RETURN QUERY SELECT
    p_circle_id,
    selected_name,
    selected_description,
    selected_max_members,
    selected_image_url,
    selected_member_count,
    selected_role,
    selected_joined_at,
    was_already_member;
END;
$function$;

-- Invite-code joins accept both the circles.invite_code used by the primary
-- Join screen and managed circle_invites records used by share/email links.
-- Codes are normalized, length-bounded, and never returned to the caller.
CREATE OR REPLACE FUNCTION public.join_circle_by_invite_code(p_invite_code text)
RETURNS TABLE (
  circle_id uuid,
  circle_name text,
  circle_description text,
  max_members integer,
  circle_image_url text,
  member_count bigint,
  membership_role text,
  joined_at timestamptz,
  already_member boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  caller_email text := pg_catalog.lower(
    coalesce(auth.jwt() ->> 'email', '')
  );
  normalized_code text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_invite_code, ''))
  );
  selected_circle_id uuid;
  selected_name text;
  selected_description text;
  selected_max_members integer;
  selected_image_url text;
  selected_member_count bigint;
  selected_role text := 'member';
  selected_joined_at timestamptz;
  selected_invite_id uuid;
  selected_invite_type text;
  selected_invite_email text;
  selected_invite_role text;
  selected_invite_max_uses integer;
  selected_invite_use_count integer;
  managed_match_count integer := 0;
  direct_match_count integer := 0;
  desired_role text := 'member';
  was_already_member boolean := false;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'authentication_required';
  END IF;
  IF pg_catalog.length(normalized_code) < 4
    OR pg_catalog.length(normalized_code) > 64
    OR normalized_code !~ '^[a-z0-9_-]+$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_not_available';
  END IF;

  SELECT count(*)
  INTO managed_match_count
  FROM public.circle_invites AS invite
  WHERE pg_catalog.lower(invite.invite_code) = normalized_code
    AND invite.status = 'pending'
    AND (invite.expires_at IS NULL OR invite.expires_at > pg_catalog.now())
    AND (
      coalesce(invite.max_uses, 0) = 0
      OR invite.use_count < invite.max_uses
    );

  -- Case-insensitive normalization must never pick an arbitrary row if legacy
  -- data contains codes that differ only by case.
  IF managed_match_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_not_available';
  END IF;

  IF managed_match_count = 1 THEN
    SELECT
      invite.id,
      invite.circle_id,
      invite.invite_type,
      invite.email,
      invite.role,
      invite.max_uses,
      invite.use_count
    INTO
      selected_invite_id,
      selected_circle_id,
      selected_invite_type,
      selected_invite_email,
      selected_invite_role,
      selected_invite_max_uses,
      selected_invite_use_count
    FROM public.circle_invites AS invite
    WHERE pg_catalog.lower(invite.invite_code) = normalized_code
      AND invite.status = 'pending'
      AND (invite.expires_at IS NULL OR invite.expires_at > pg_catalog.now())
      AND (
        coalesce(invite.max_uses, 0) = 0
        OR invite.use_count < invite.max_uses
      )
    FOR UPDATE;

    IF selected_invite_type = 'email'
      AND (
        caller_email = ''
        OR pg_catalog.lower(coalesce(selected_invite_email, '')) <> caller_email
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_not_available';
    END IF;
    desired_role := CASE
      WHEN selected_invite_role = 'admin' THEN 'admin'
      ELSE 'member'
    END;
  ELSE
    SELECT count(*)
    INTO direct_match_count
    FROM public.circles AS circle
    WHERE pg_catalog.lower(circle.invite_code) = normalized_code;

    IF direct_match_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_not_available';
    END IF;

    SELECT circle.id
    INTO selected_circle_id
    FROM public.circles AS circle
    WHERE pg_catalog.lower(circle.invite_code) = normalized_code
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_not_available';
    END IF;
  END IF;

  SELECT
    circle.name,
    circle.description,
    circle.max_members,
    circle.circle_image_url
  INTO
    selected_name,
    selected_description,
    selected_max_members,
    selected_image_url
  FROM public.circles AS circle
  WHERE circle.id = selected_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_not_available';
  END IF;

  SELECT membership.role, membership.joined_at
  INTO selected_role, selected_joined_at
  FROM public.circle_members AS membership
  WHERE membership.circle_id = selected_circle_id
    AND membership.user_id = caller_id;

  IF FOUND THEN
    was_already_member := true;
  ELSE
    SELECT count(*)
    INTO selected_member_count
    FROM public.circle_members AS membership
    WHERE membership.circle_id = selected_circle_id;

    IF selected_member_count >= greatest(
      coalesce(selected_max_members, 8),
      1
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'circle_full';
    END IF;

    INSERT INTO public.circle_members (circle_id, user_id, role)
    VALUES (selected_circle_id, caller_id, desired_role)
    RETURNING role, circle_members.joined_at
    INTO selected_role, selected_joined_at;

    selected_member_count := selected_member_count + 1;

    IF selected_invite_id IS NOT NULL THEN
      UPDATE public.circle_invites AS invite
      SET
        use_count = invite.use_count + 1,
        status = CASE
          WHEN coalesce(invite.max_uses, 0) > 0
            AND invite.use_count + 1 >= invite.max_uses
          THEN 'accepted'
          ELSE invite.status
        END
      WHERE invite.id = selected_invite_id;
    END IF;
  END IF;

  IF selected_member_count IS NULL THEN
    SELECT count(*)
    INTO selected_member_count
    FROM public.circle_members AS membership
    WHERE membership.circle_id = selected_circle_id;
  END IF;

  RETURN QUERY SELECT
    selected_circle_id,
    selected_name,
    selected_description,
    selected_max_members,
    selected_image_url,
    selected_member_count,
    selected_role,
    selected_joined_at,
    was_already_member;
END;
$function$;

REVOKE ALL ON FUNCTION public.discover_public_circles(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discover_public_circles(text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.discover_public_circles(text, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.join_public_circle(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_public_circle(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_public_circle(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.join_circle_by_invite_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_circle_by_invite_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_circle_by_invite_code(text) TO authenticated;

COMMENT ON FUNCTION public.discover_public_circles(text, integer, integer) IS
  'Authenticated, bounded public-circle discovery with an explicit non-secret projection.';
COMMENT ON FUNCTION public.join_public_circle(uuid) IS
  'Authenticated, capacity-serialized and idempotent join for an opted-in public circle.';
COMMENT ON FUNCTION public.join_circle_by_invite_code(text) IS
  'Authenticated, normalized and capacity-serialized invite join without invite disclosure.';

-- PostgreSQL views run with owner privileges unless security_invoker is set.
-- These public/auth-readable views must preserve the caller's underlying RLS.
DO $block$
DECLARE
  view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'memory_embedding_coverage',
    'memory_maintenance_recent',
    'memory_soul_coverage',
    'memory_with_souls',
    'soul_wisdom_staleness',
    'training_safe_automations',
    'training_safe_github_events',
    'training_safe_goals',
    'training_safe_mission_agents',
    'training_safe_mission_tasks',
    'training_safe_missions',
    'training_safe_proof_of_work',
    'training_safe_tasks'
  ]::text[]
  LOOP
    IF pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', 'public', view_name)
    ) IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'ALTER VIEW public.%I SET (security_invoker = true)',
        view_name
      );
    END IF;
  END LOOP;
END;
$block$;

NOTIFY pgrst, 'reload schema';

COMMIT;
