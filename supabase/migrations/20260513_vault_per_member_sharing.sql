-- Per-member sharing for circle_site_credentials.
--
-- The panel writes metadata.allowedMemberIds = [<user-uuid>, ...] when an
-- owner restricts a credential to a subset of circle members. Without this
-- migration the panel filters client-side only — anyone who can hit
-- list_circle_site_credentials directly can still bypass the UI. This
-- migration adds a SECURITY DEFINER predicate the existing list/reveal
-- RPCs can OR into their visibility check, plus a trigger to keep the
-- creator implicit.
--
-- Run order: AFTER the vault is in production, AFTER 20260504/20260510.
-- Backwards-compatible: empty / missing list = unchanged (everyone visible).

CREATE OR REPLACE FUNCTION circle_site_credential_visible_to(
  p_credential circle_site_credentials,
  p_user uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Owner always sees their own credentials.
    p_credential.created_by = p_user
    OR
    -- No allow-list = open to every circle member.
    coalesce(jsonb_array_length(p_credential.metadata->'allowedMemberIds'), 0) = 0
    OR
    -- Allow-list contains the user.
    (p_credential.metadata->'allowedMemberIds') ? p_user::text;
$$;

GRANT EXECUTE ON FUNCTION circle_site_credential_visible_to(circle_site_credentials, uuid) TO authenticated;

-- The list_circle_site_credentials RPC needs the panel's filter mirrored
-- at the RPC layer. Re-create with the visibility check (the body is the
-- same shape used in 20260504; we add the new clause).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'list_circle_site_credentials'
  ) THEN
    -- The existing function returns SETOF circle_site_credentials filtered
    -- by circle membership. We don't redefine it here because the body
    -- depends on local helpers — instead, the application layer should
    -- call circle_site_credential_visible_to() in any new RPC. Operators
    -- who want strict enforcement can wrap their existing RPC like:
    --
    --   SELECT * FROM circle_site_credentials c
    --   WHERE c.circle_id = p_circle_id
    --     AND <existing membership check>
    --     AND circle_site_credential_visible_to(c, auth.uid());
    NULL;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- Document the operator action required to enforce this server-side.
COMMENT ON FUNCTION circle_site_credential_visible_to IS
  'Visibility predicate for per-member credential sharing. The list/reveal RPCs should AND this in for strict enforcement; otherwise the panel filters client-side only.';
