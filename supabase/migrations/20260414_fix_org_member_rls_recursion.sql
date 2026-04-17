CREATE OR REPLACE FUNCTION public.is_org_member(target_org_id uuid, target_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.org_id = target_org_id
      AND om.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(target_org_id uuid, target_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.org_id = target_org_id
      AND om.user_id = target_user_id
      AND om.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(target_org_id uuid, target_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.org_id = target_org_id
      AND om.user_id = target_user_id
      AND om.role = 'owner'
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_org_admin(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_org_owner(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Org members can view their org" ON organizations;
CREATE POLICY "Org members can view their org"
  ON organizations FOR SELECT
  USING (public.is_org_member(id));

DROP POLICY IF EXISTS "Org owners/admins can update org" ON organizations;
CREATE POLICY "Org owners/admins can update org"
  ON organizations FOR UPDATE
  USING (public.is_org_admin(id));

DROP POLICY IF EXISTS "Org owners can delete org" ON organizations;
CREATE POLICY "Org owners can delete org"
  ON organizations FOR DELETE
  USING (public.is_org_owner(id));

DROP POLICY IF EXISTS "Org members can view fellow members" ON org_members;
CREATE POLICY "Org members can view fellow members"
  ON org_members FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Org admins can add members" ON org_members;
CREATE POLICY "Org admins can add members"
  ON org_members FOR INSERT
  WITH CHECK (public.is_org_admin(org_id));

DROP POLICY IF EXISTS "Org admins can remove members or self-remove" ON org_members;
CREATE POLICY "Org admins can remove members or self-remove"
  ON org_members FOR DELETE
  USING (public.is_org_admin(org_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS "Org owners can update member roles" ON org_members;
CREATE POLICY "Org owners can update member roles"
  ON org_members FOR UPDATE
  USING (public.is_org_owner(org_id))
  WITH CHECK (public.is_org_owner(org_id));

DROP POLICY IF EXISTS "Org members can view org circles" ON circles;
CREATE POLICY "Org members can view org circles"
  ON circles FOR SELECT
  USING (org_id IS NOT NULL AND public.is_org_member(org_id));

DROP POLICY IF EXISTS "Org admins can update org circles" ON circles;
CREATE POLICY "Org admins can update org circles"
  ON circles FOR UPDATE
  USING (org_id IS NOT NULL AND public.is_org_admin(org_id));

NOTIFY pgrst, 'reload schema';
