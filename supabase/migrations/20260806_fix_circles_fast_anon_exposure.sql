-- ─── CRITICAL: unauthenticated circle + invite_code disclosure ──────────────
-- APPLIED LIVE 2026-08-06 after live exploit confirmation.
--
-- `get_user_circles_fast` (20260501_circles_list_fast.sql) is SECURITY DEFINER
-- and was GRANTed to `anon`, while `user_uuid` was only DEFAULTED to auth.uid()
-- — never CHECKED against it. With nothing but the public anon key that ships
-- in the web bundle, an unauthenticated caller could pass any user id and read
-- that user's circles INCLUDING `invite_code`. Because JoinCircleScreen joins
-- purely by invite code and the circle_members insert policy only requires
-- `auth.uid() = user_id`, that was a complete anonymous → full circle member
-- chain (chat, missions, memory, run ledger, integration metadata).
--
-- VERIFIED LIVE before the fix: an anon-key POST with another user's id
-- returned their circle row and invite code (HTTP 200).
--
-- Two independent defenses, because either alone would still be fragile:
--   1. REVOKE from anon — the function is for signed-in users only.
--   2. An in-body identity guard, so even an authenticated caller cannot read
--      another user's circles by passing their id. auth.uid() is now the only
--      identity the body will act on; a mismatched or null argument returns
--      zero rows rather than raising (callers treat empty as "no circles").
--
-- The projection, ordering, and column list are byte-identical to the original
-- so the Circles list screen is unaffected.

CREATE OR REPLACE FUNCTION get_user_circles_fast(user_uuid uuid DEFAULT auth.uid())
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  invite_code text,
  max_members int,
  created_by uuid,
  created_at timestamptz,
  circle_image_url text,
  user_role text,
  member_count bigint,
  active_missions bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT
    c.id,
    c.name,
    c.description,
    c.invite_code,
    c.max_members,
    c.created_by,
    c.created_at,
    c.circle_image_url,
    cm.role AS user_role,
    COALESCE(mem.member_count, 0) AS member_count,
    COALESCE(mis.active_missions, 0) AS active_missions
  FROM circles c
  JOIN circle_members cm ON cm.circle_id = c.id AND cm.user_id = auth.uid()
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS member_count
    FROM circle_members cm2
    WHERE cm2.circle_id = c.id
  ) mem ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS active_missions
    FROM circle_missions m
    WHERE m.circle_id = c.id AND m.status = 'active'
  ) mis ON true
  WHERE auth.uid() IS NOT NULL
    AND (user_uuid IS NULL OR user_uuid = auth.uid())
  ORDER BY c.created_at DESC;
$func$;

REVOKE EXECUTE ON FUNCTION get_user_circles_fast(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION get_user_circles_fast(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_circles_fast(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
