-- Scheduled-action mutation guard
--
-- A provider timeout after a request leaves the database unable to distinguish
-- "safe to retry" from "the mutation landed but its response was lost".  These
-- additive columns persist the claim and irreversible dispatch boundary so the
-- runner can fail closed without replaying an ambiguous mutation.

ALTER TABLE public.scheduled_actions
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_unknown_at timestamptz;

ALTER TABLE public.scheduled_actions
  ALTER COLUMN requires_approval SET DEFAULT true,
  ALTER COLUMN max_retries SET DEFAULT 0;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint AS con
  JOIN pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'scheduled_actions'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  ORDER BY con.oid
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.scheduled_actions DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;

  ALTER TABLE public.scheduled_actions
    ADD CONSTRAINT scheduled_actions_status_check
    CHECK (status IN (
      'pending',
      'running',
      'succeeded',
      'failed',
      'canceled',
      'outcome_unknown'
    ));
END
$$;

CREATE INDEX IF NOT EXISTS idx_scheduled_actions_dispatched_unresolved
  ON public.scheduled_actions (dispatched_at)
  WHERE status IN ('running', 'outcome_unknown')
    AND dispatched_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_action_approval_session
  ON public.agent_approvals (session_key)
  WHERE session_key LIKE 'scheduled-action:v2:%';

CREATE OR REPLACE FUNCTION public.guard_scheduled_action_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'scheduled_action approvals are runner-created';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scheduled_action approvals are immutable audit rows';
  END IF;
  IF auth.uid() IS NULL OR OLD.payload->>'userId' <> auth.uid()::text THEN
    RAISE EXCEPTION 'scheduled_action approval resolver mismatch';
  END IF;
  IF (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.session_key IS DISTINCT FROM OLD.session_key
    OR NEW.agent_name IS DISTINCT FROM OLD.agent_name
    OR NEW.action_type IS DISTINCT FROM OLD.action_type
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.timeout_seconds IS DISTINCT FROM OLD.timeout_seconds
    OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
  ) THEN
    RAISE EXCEPTION 'scheduled_action approval binding is immutable';
  END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    NEW.resolved_by := auth.uid();
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid scheduled_action approval transition';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_scheduled_action_approval_insert
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_scheduled_action_approval_insert
BEFORE INSERT ON public.agent_approvals
FOR EACH ROW
WHEN (NEW.action_type LIKE 'scheduled_action.%')
EXECUTE FUNCTION public.guard_scheduled_action_approval();

DROP TRIGGER IF EXISTS trg_guard_scheduled_action_approval_update
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_scheduled_action_approval_update
BEFORE UPDATE ON public.agent_approvals
FOR EACH ROW
WHEN (
  OLD.action_type LIKE 'scheduled_action.%'
  OR NEW.action_type LIKE 'scheduled_action.%'
)
EXECUTE FUNCTION public.guard_scheduled_action_approval();

DROP TRIGGER IF EXISTS trg_guard_scheduled_action_approval_delete
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_scheduled_action_approval_delete
BEFORE DELETE ON public.agent_approvals
FOR EACH ROW
WHEN (OLD.action_type LIKE 'scheduled_action.%')
EXECUTE FUNCTION public.guard_scheduled_action_approval();

CREATE OR REPLACE FUNCTION public.guard_scheduled_action_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR OLD.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'scheduled_action owner mismatch';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.dispatched_at IS NOT NULL
      OR OLD.status IN ('running', 'succeeded', 'outcome_unknown')
    THEN
      RAISE EXCEPTION 'dispatched scheduled_action audit rows are sealed';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.dispatched_at IS NOT NULL THEN
    RAISE EXCEPTION 'dispatched scheduled_action rows are sealed';
  END IF;

  IF OLD.status = 'failed' AND NEW.status = 'pending' THEN
    IF (
      NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.payload IS DISTINCT FROM OLD.payload
      OR NEW.recurrence IS DISTINCT FROM OLD.recurrence
      OR NEW.recurrence_label IS DISTINCT FROM OLD.recurrence_label
      OR NEW.parent_action_id IS DISTINCT FROM OLD.parent_action_id
      OR NEW.approval_id IS NOT NULL
      OR NEW.claim_token IS NOT NULL
      OR NEW.claimed_at IS NOT NULL
      OR NEW.dispatched_at IS NOT NULL
      OR NEW.outcome_unknown_at IS NOT NULL
      OR NEW.started_at IS NOT NULL
      OR NEW.completed_at IS NOT NULL
      OR NEW.result IS NOT NULL
      OR NEW.error IS NOT NULL
      OR NEW.retry_count <> 0
      OR NEW.max_retries <> 0
      OR NEW.requires_approval IS NOT TRUE
    ) THEN
      RAISE EXCEPTION 'unsafe scheduled_action retry transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'canceled' THEN
    IF (
      NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.payload IS DISTINCT FROM OLD.payload
      OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
      OR NEW.claim_token IS NOT NULL
      OR NEW.claimed_at IS NOT NULL
      OR NEW.dispatched_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'unsafe scheduled_action cancellation transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'pending' THEN
    IF (
      NEW.approval_id IS DISTINCT FROM OLD.approval_id
      OR NEW.claim_token IS NOT NULL
      OR NEW.claimed_at IS NOT NULL
      OR NEW.dispatched_at IS NOT NULL
      OR NEW.outcome_unknown_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'scheduled_action execution state is runner-owned';
    END IF;
    NEW.requires_approval := true;
    NEW.max_retries := 0;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid scheduled_action state transition';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_scheduled_action_state
  ON public.scheduled_actions;
CREATE TRIGGER trg_guard_scheduled_action_state
BEFORE UPDATE OR DELETE ON public.scheduled_actions
FOR EACH ROW
EXECUTE FUNCTION public.guard_scheduled_action_state();

COMMENT ON COLUMN public.scheduled_actions.claim_token IS
  'Opaque lease won by one runner while status moves pending to running.';
COMMENT ON COLUMN public.scheduled_actions.dispatched_at IS
  'Irreversible boundary stamped immediately before the one scheduled mutation attempt. A non-null value forbids replay.';
COMMENT ON COLUMN public.scheduled_actions.outcome_unknown_at IS
  'Terminal ambiguity marker used when a dispatched mutation cannot be verified.';

NOTIFY pgrst, 'reload schema';
