-- Agent-run artifact integrity: immutable parent authority and artifacts.
--
-- The 20260408 base policy granted every current circle member FOR ALL access
-- to every artifact in that circle. That made canonical Chat artifact content
-- mutable/deletable by unrelated members. Converge to exactly two authenticated
-- policies: circle-member SELECT and exact run-owner INSERT. The parent run's
-- owner/circle/id becomes immutable to authenticated clients first, and new
-- runs must belong to the authenticated creator. Authenticated artifact
-- UPDATE/DELETE has neither a policy nor a table grant; service_role retains
-- its normal RLS bypass for trusted maintenance/recovery.

BEGIN;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- `agent_runs.user_id` is the artifact INSERT authority below. The historical
-- circle-member FOR ALL policy makes that column forgeable unless the parent
-- identity is independently locked first. Restrictive policies compose with
-- that legacy permissive policy: authenticated clients may create only their
-- own rows, mutate only their own rows, and directly delete only their own
-- rows. Service-role/Postgres maintenance keeps its normal RLS bypass.
DROP POLICY IF EXISTS agent_runs_owner_insert_guard_v1 ON public.agent_runs;
CREATE POLICY agent_runs_owner_insert_guard_v1
ON public.agent_runs
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
);

DROP POLICY IF EXISTS agent_runs_owner_update_guard_v1 ON public.agent_runs;
CREATE POLICY agent_runs_owner_update_guard_v1
ON public.agent_runs
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
);

-- This also closes the indirect artifact-delete path where a member deletes
-- another member's run and relies on ON DELETE CASCADE. PostgreSQL executes a
-- legitimate parent-circle FK cascade outside child RLS, so Circle deletion is
-- not stranded by this direct-delete guard.
DROP POLICY IF EXISTS agent_runs_owner_delete_guard_v1 ON public.agent_runs;
CREATE POLICY agent_runs_owner_delete_guard_v1
ON public.agent_runs
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
);

CREATE OR REPLACE FUNCTION public.guard_authenticated_agent_run_identity_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  trusted_writer boolean :=
    COALESCE(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin', 'service_role');
BEGIN
  IF trusted_writer THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF actor_id IS NULL OR NEW.user_id IS DISTINCT FROM actor_id THEN
      RAISE EXCEPTION 'agent_run_owner_required'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF actor_id IS NULL OR OLD.user_id IS DISTINCT FROM actor_id THEN
      RAISE EXCEPTION 'agent_run_owner_required'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'agent_run_identity_immutable'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'agent_run_identity_guard_invalid_operation'
    USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_authenticated_agent_run_identity_v1
ON public.agent_runs;
CREATE TRIGGER trg_guard_authenticated_agent_run_identity_v1
BEFORE INSERT OR UPDATE ON public.agent_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_authenticated_agent_run_identity_v1();

REVOKE ALL ON FUNCTION public.guard_authenticated_agent_run_identity_v1()
FROM PUBLIC, anon, authenticated;

ALTER TABLE public.agent_run_artifacts ENABLE ROW LEVEL SECURITY;

-- Remove known and unknown policy drift. PostgreSQL ORs permissive policies,
-- so leaving one historical FOR ALL policy would reopen mutation authority.
DO $block$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_artifacts'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.agent_run_artifacts',
      policy_row.policyname
    );
  END LOOP;
END;
$block$;

CREATE POLICY agent_run_artifacts_select_circle_member
ON public.agent_run_artifacts
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND public.user_is_circle_member(circle_id)
);

CREATE POLICY agent_run_artifacts_insert_run_owner
ON public.agent_run_artifacts
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND public.user_is_circle_member(circle_id)
  AND EXISTS (
    SELECT 1
    FROM public.agent_runs AS owning_run
    WHERE owning_run.id = agent_run_artifacts.run_id
      AND owning_run.circle_id = agent_run_artifacts.circle_id
      AND owning_run.user_id = auth.uid()
  )
  AND (
    step_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.agent_run_steps AS owning_step
      WHERE owning_step.id = agent_run_artifacts.step_id
        AND owning_step.run_id = agent_run_artifacts.run_id
        AND owning_step.circle_id = agent_run_artifacts.circle_id
    )
  )
);

REVOKE ALL ON TABLE public.agent_run_artifacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.agent_run_artifacts TO authenticated;
GRANT ALL ON TABLE public.agent_run_artifacts TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Catalog readiness only. This does not prove two-user behavioral RLS or that
-- the migration has been applied to a target project.
SELECT
  to_regclass('public.agent_run_artifacts') IS NOT NULL AS agent_run_artifacts_ready,
  to_regprocedure('public.guard_authenticated_agent_run_identity_v1()') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.agent_runs'::regclass
        AND trigger_row.tgname = 'trg_guard_authenticated_agent_run_identity_v1'
        AND trigger_row.tgenabled <> 'D'
        AND NOT trigger_row.tgisinternal
    ) AS agent_run_identity_guard_ready,
  (
    SELECT count(*) = 3
      AND bool_and(permissive = 'RESTRICTIVE')
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_runs'
      AND policyname IN (
        'agent_runs_owner_insert_guard_v1',
        'agent_runs_owner_update_guard_v1',
        'agent_runs_owner_delete_guard_v1'
      )
  ) AS agent_run_owner_policies_ready,
  (
    SELECT count(*) = 2
      AND bool_and(cmd IN ('SELECT', 'INSERT'))
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_artifacts'
  ) AS artifact_policies_converged,
  has_table_privilege('authenticated', 'public.agent_run_artifacts', 'SELECT')
    AND has_table_privilege('authenticated', 'public.agent_run_artifacts', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.agent_run_artifacts', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.agent_run_artifacts', 'DELETE')
    AS authenticated_artifact_grants_ready;
