-- Circle creation and creator membership must be one atomic database action.
-- The live trigger historically wrote role='owner', while circle_members only
-- accepts creator/admin/moderator/member. That mismatch rolled back every new
-- circle insert before a newly authenticated user could reach Chat.

BEGIN;

CREATE OR REPLACE FUNCTION public.add_creator_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
BEGIN
  INSERT INTO public.circle_members (circle_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'creator')
  ON CONFLICT (circle_id, user_id)
  DO UPDATE SET role = 'creator';

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM anon;
REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM authenticated;

DROP TRIGGER IF EXISTS trg_add_creator_as_member ON public.circles;
CREATE TRIGGER trg_add_creator_as_member
AFTER INSERT ON public.circles
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_as_member();

-- Repair circles created before the trigger drift. The unique membership key
-- guarantees exactly one membership for the creator, and creator is the
-- canonical highest circle role used by current client/tool authorization.
INSERT INTO public.circle_members (circle_id, user_id, role)
SELECT circle.id, circle.created_by, 'creator'
FROM public.circles AS circle
ON CONFLICT (circle_id, user_id)
DO UPDATE SET role = 'creator';

COMMIT;
