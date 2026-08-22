-- Device-private OpenSwan approval privacy and resolver authority.
--
-- SQL section 28 validates schema-v2 approval state transitions, but the
-- historical circle-wide agent_run_approvals policy lets any current circle
-- member read the payload and attempt those transitions. The
-- desktop.open_attachment approval is device-private authority: only the user
-- who requested the canonical row may read, resolve, or consume it. Restrictive
-- SELECT and UPDATE policies compose with every permissive policy, including
-- future FOR ALL drift, without replacing the existing approval state machine.
-- PostgreSQL and service_role maintenance retain their normal RLS bypass.

BEGIN;

-- §41 deliberately extends the §28 schema-v2 state machine. Abort intact if
-- the canonical transition function is absent instead of installing a privacy
-- boundary around otherwise unguarded approval mutations.
DO $device_private_approval_dependency_preflight$
BEGIN
  IF to_regprocedure('public.guard_tool_v2_run_approval()') IS NULL THEN
    RAISE EXCEPTION 'device_private_run_approval_authority: apply SQL section 28 first'
      USING ERRCODE = '23514';
  END IF;
END
$device_private_approval_dependency_preflight$;

ALTER TABLE public.agent_run_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_run_approvals_device_private_select_guard_v1
ON public.agent_run_approvals;

CREATE POLICY agent_run_approvals_device_private_select_guard_v1
ON public.agent_run_approvals
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  NOT COALESCE(
    payload->>'approvalSchemaVersion' = '2'
      AND payload->>'toolName' = 'desktop.open_attachment',
    false
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
);

DROP POLICY IF EXISTS agent_run_approvals_device_private_update_guard_v1
ON public.agent_run_approvals;

CREATE POLICY agent_run_approvals_device_private_update_guard_v1
ON public.agent_run_approvals
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  NOT COALESCE(
    payload->>'approvalSchemaVersion' = '2'
      AND payload->>'toolName' = 'desktop.open_attachment',
    false
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
)
WITH CHECK (
  NOT COALESCE(
    payload->>'approvalSchemaVersion' = '2'
      AND payload->>'toolName' = 'desktop.open_attachment',
    false
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
);

-- §28's SECURITY DEFINER transition function requires auth.uid(), including
-- when invoked by maintenance roles. Recreate only its UPDATE trigger so the
-- state machine remains mandatory for authenticated callers while actual
-- trusted database roles retain maintenance authority. Request/JWT fields
-- cannot manufacture current_user membership in these roles.
DROP TRIGGER IF EXISTS trg_guard_tool_v2_run_approval_update
ON public.agent_run_approvals;

CREATE TRIGGER trg_guard_tool_v2_run_approval_update
BEFORE UPDATE ON public.agent_run_approvals
FOR EACH ROW
WHEN (
  current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
  AND (
    (
      OLD.payload->>'approvalSchemaVersion' = '2'
      AND (
        OLD.payload ? 'toolName'
        OR OLD.payload ? 'toolApprovalDigest'
      )
    )
    OR (
      NEW.payload->>'approvalSchemaVersion' = '2'
      AND (
        NEW.payload ? 'toolName'
        OR NEW.payload ? 'toolApprovalDigest'
      )
    )
  )
)
EXECUTE FUNCTION public.guard_tool_v2_run_approval();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- §41 readiness (catalog convergence only; follow with an authenticated
-- two-member privacy/approve/reject/consume test plus trusted-writer
-- maintenance).
SELECT
  (
    SELECT count(*) = 1
      AND bool_and(permissive = 'RESTRICTIVE')
      AND bool_and(cmd = 'SELECT')
      AND bool_and(roles = ARRAY['authenticated']::name[])
      AND bool_and(qual IS NOT NULL)
      AND bool_and(with_check IS NULL)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_approvals'
      AND policyname = 'agent_run_approvals_device_private_select_guard_v1'
  ) AS device_private_approval_select_guard_ready,
  (
    SELECT count(*) = 1
      AND bool_and(permissive = 'RESTRICTIVE')
      AND bool_and(cmd = 'UPDATE')
      AND bool_and(roles = ARRAY['authenticated']::name[])
      AND bool_and(qual IS NOT NULL)
      AND bool_and(with_check IS NOT NULL)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_approvals'
      AND policyname = 'agent_run_approvals_device_private_update_guard_v1'
  ) AS device_private_approval_update_guard_ready,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.agent_run_approvals'::regclass
      AND trigger_row.tgname = 'trg_guard_tool_v2_run_approval_update'
      AND trigger_row.tgfoid = 'public.guard_tool_v2_run_approval()'::regprocedure
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) AS device_private_approval_state_machine_ready;
