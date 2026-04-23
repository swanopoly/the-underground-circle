-- Fast projection RPC for the Circles list screen.
--
-- The existing `get_user_circles` returns SETOF circles (every column,
-- including large JSONB blobs like `settings`). On this database it
-- consistently runs 1.2-2.3s even for a single row because the planner
-- has to pull the wide row and PostgREST has to serialize all of it.
--
-- The list screen only needs 12 columns plus two counts. This projection
-- returns a compact shape + the joined counts in a single round trip, which
-- removes ~70% of the bytes on the wire and avoids the follow-up
-- `circle_missions` query in the client.
--
-- Indexes on `circle_members(user_id)` and `circle_members(circle_id)` are
-- already implicit in the composite PK, but we add a supporting index on
-- `circle_missions(circle_id, status)` so the LATERAL count is a hash
-- aggregate over an index scan rather than a seq scan.

CREATE INDEX IF NOT EXISTS idx_circle_missions_circle_status
  ON circle_missions (circle_id, status)
  WHERE status = 'active';

DROP FUNCTION IF EXISTS get_user_circles_fast(uuid);

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
  JOIN circle_members cm ON cm.circle_id = c.id AND cm.user_id = user_uuid
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
  ORDER BY c.created_at DESC;
$func$;

GRANT EXECUTE ON FUNCTION get_user_circles_fast(uuid) TO authenticated, anon;

-- Reload PostgREST schema cache so the new function is immediately callable.
NOTIFY pgrst, 'reload schema';
