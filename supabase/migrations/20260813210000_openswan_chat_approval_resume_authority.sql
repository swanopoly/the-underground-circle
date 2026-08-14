-- Race-free OpenSwan Chat approval-resume authority.
--
-- A Circle Chat thread is not an agent `chat_sessions` row. Keep the exact
-- Circle Chat thread and originating human message on `agent_runs` as their
-- own immutable lineage. The pair is optional for compatibility with the
-- OpenSwan Console and legacy writers, but when present it is complete,
-- owner/circle/thread exact, and available only to main_chat OpenSwan runs.
--
-- Cross-run approval consumption then happens through one authenticated RPC.
-- It locks current membership, both run rows, the thread, the source message,
-- and the approval before it checks terminal truth and stamps the existing
-- schema-v2 one-shot dispatch receipt. Same-run and category-auto consumption
-- keep using the existing section-28 state machine; this migration neither
-- replaces that trigger nor widens its table policies.

BEGIN;

DO $openswan_chat_resume_dependency_preflight$
BEGIN
  IF to_regclass('public.agent_runs') IS NULL
     OR to_regclass('public.agent_run_approvals') IS NULL
     OR to_regclass('public.circle_chat_threads') IS NULL
     OR to_regclass('public.circle_chat_thread_members') IS NULL
     OR to_regclass('public.circle_members') IS NULL
     OR to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: apply the agent-run and thread-scoped Chat migrations first'
      USING ERRCODE = '23514';
  END IF;

  IF to_regprocedure('public.is_valid_tool_v2_approval_payload(jsonb,boolean)') IS NULL
     OR to_regprocedure('public.guard_tool_v2_run_approval()') IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: apply SQL section 28 first'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.agent_run_approvals'::regclass
      AND trigger_row.tgname IN (
        'trg_guard_tool_v2_run_approval_insert',
        'trg_guard_tool_v2_run_approval_update',
        'trg_guard_tool_v2_run_approval_delete'
      )
      AND trigger_row.tgfoid = 'public.guard_tool_v2_run_approval()'::regprocedure
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) <> 3 THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: canonical section-28 approval triggers are unavailable'
      USING ERRCODE = '23514';
  END IF;

  IF to_regprocedure('public.guard_authenticated_message_mutation()') IS NULL
     OR to_regprocedure('public.guard_authenticated_chat_thread_mutation()') IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: apply SQL section 31 first'
      USING ERRCODE = '23514';
  END IF;

  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: pgcrypto digest(bytea,text) is required in the extensions schema'
      USING ERRCODE = '42883';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.messages'::regclass
      AND attribute.attname = 'thread_id'
      AND attribute.atttypid = 'uuid'::regtype
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.messages'::regclass
      AND attribute.attname = 'user_id'
      AND attribute.atttypid = 'uuid'::regtype
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.messages'::regclass
      AND attribute.attname = 'is_bot'
      AND attribute.atttypid = 'boolean'::regtype
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: canonical thread-scoped message columns are unavailable'
      USING ERRCODE = '23514';
  END IF;
END
$openswan_chat_resume_dependency_preflight$;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS source_message_id uuid;

DO $openswan_chat_resume_column_types$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.agent_runs'::regclass
      AND attribute.attname = 'thread_id'
      AND attribute.atttypid = 'uuid'::regtype
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.agent_runs'::regclass
      AND attribute.attname = 'source_message_id'
      AND attribute.atttypid = 'uuid'::regtype
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: agent-run lineage columns must be uuid'
      USING ERRCODE = '42804';
  END IF;
END
$openswan_chat_resume_column_types$;

-- The lineage pair is optional by contract: OpenSwan Console and legacy
-- main_chat rows have no Circle Chat message source.
ALTER TABLE public.agent_runs
  ALTER COLUMN thread_id DROP NOT NULL,
  ALTER COLUMN source_message_id DROP NOT NULL;

ALTER TABLE public.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_chat_thread_lineage_pair_v1,
  DROP CONSTRAINT IF EXISTS agent_runs_chat_thread_lineage_scope_v1,
  DROP CONSTRAINT IF EXISTS agent_runs_chat_thread_lineage_thread_fkey_v1,
  DROP CONSTRAINT IF EXISTS agent_runs_chat_thread_lineage_message_fkey_v1;

ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_chat_thread_lineage_pair_v1
    CHECK ((thread_id IS NULL) = (source_message_id IS NULL)),
  ADD CONSTRAINT agent_runs_chat_thread_lineage_scope_v1
    CHECK (
      thread_id IS NULL
      OR ((surface = 'main_chat' AND provider = 'openswan') IS TRUE)
    ),
  ADD CONSTRAINT agent_runs_chat_thread_lineage_thread_fkey_v1
    FOREIGN KEY (thread_id)
    REFERENCES public.circle_chat_threads(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT agent_runs_chat_thread_lineage_message_fkey_v1
    FOREIGN KEY (source_message_id)
    REFERENCES public.messages(id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_chat_source_lineage_v1
  ON public.agent_runs (circle_id, thread_id, source_message_id, created_at DESC)
  WHERE thread_id IS NOT NULL AND source_message_id IS NOT NULL;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- Historical agent_runs policy variants are circle-wide and permissive. A
-- peer may still read shared run telemetry, but cannot rewrite or delete a
-- protected Chat run owned by somebody else. Restrictive policies compose
-- with the current policy set without changing legacy/Console rows.
DROP POLICY IF EXISTS agent_runs_chat_lineage_update_owner_v1
ON public.agent_runs;
CREATE POLICY agent_runs_chat_lineage_update_owner_v1
ON public.agent_runs
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  thread_id IS NULL
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
)
WITH CHECK (
  thread_id IS NULL
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
);

DROP POLICY IF EXISTS agent_runs_chat_lineage_delete_owner_v1
ON public.agent_runs;
CREATE POLICY agent_runs_chat_lineage_delete_owner_v1
ON public.agent_runs
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  thread_id IS NULL
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
);

COMMENT ON COLUMN public.agent_runs.thread_id IS
  'Exact circle_chat_threads id for a protected main_chat OpenSwan run. This is not legacy chat_session_id.';
COMMENT ON COLUMN public.agent_runs.source_message_id IS
  'Exact non-bot human message that originated a protected main_chat OpenSwan run; immutable with thread_id once set.';

CREATE OR REPLACE FUNCTION public.guard_agent_run_chat_lineage_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_trusted_writer boolean :=
    COALESCE(auth.role(), '') = 'service_role'
    OR current_setting('role', true) IN ('postgres', 'supabase_admin', 'service_role')
    OR (
      COALESCE(current_setting('role', true), 'none') = 'none'
      AND session_user IN ('postgres', 'supabase_admin', 'service_role')
    );
  v_thread public.circle_chat_threads%ROWTYPE;
  v_message public.messages%ROWTYPE;
BEGIN
  IF (NEW.thread_id IS NULL) <> (NEW.source_message_id IS NULL) THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_pair_required'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    (
      OLD.thread_id IS NOT NULL
      AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.surface IS DISTINCT FROM OLD.surface
        OR NEW.provider IS DISTINCT FROM OLD.provider
        OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
        OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
      )
    )
    OR (
      OLD.thread_id IS NULL
      AND NEW.thread_id IS NOT NULL
      AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.surface IS DISTINCT FROM OLD.surface
        OR NEW.provider IS DISTINCT FROM OLD.provider
      )
    )
  ) THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_immutable'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.thread_id IS NOT NULL
     AND NOT v_trusted_writer
     AND (v_uid IS NULL OR OLD.user_id IS DISTINCT FROM v_uid) THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_owner_required'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Authenticated application writers must establish lineage with the INSERT.
  -- A trusted maintenance writer may backfill an exact legacy pair, after
  -- which the same immutable rule above applies to every writer.
  IF TG_OP = 'UPDATE'
     AND OLD.thread_id IS NULL
     AND NOT v_trusted_writer THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_must_be_set_on_insert'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.surface IS DISTINCT FROM 'main_chat'
     OR NEW.provider IS DISTINCT FROM 'openswan' THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_scope_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT v_trusted_writer THEN
    IF v_uid IS NULL OR NEW.user_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'agent_run_chat_lineage_owner_required'
        USING ERRCODE = '42501';
    END IF;
    PERFORM 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = NEW.circle_id
      AND membership.user_id = v_uid
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'agent_run_chat_lineage_membership_required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT thread.*
  INTO v_thread
  FROM public.circle_chat_threads AS thread
  WHERE thread.id = NEW.thread_id
  FOR SHARE;
  IF NOT FOUND OR v_thread.circle_id IS DISTINCT FROM NEW.circle_id THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_thread_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF v_thread.visibility IS DISTINCT FROM 'circle'
     AND v_thread.created_by IS DISTINCT FROM NEW.user_id THEN
    PERFORM 1
    FROM public.circle_chat_thread_members AS thread_member
    WHERE thread_member.thread_id = NEW.thread_id
      AND thread_member.user_id = NEW.user_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'agent_run_chat_lineage_thread_access_required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT message.*
  INTO v_message
  FROM public.messages AS message
  WHERE message.id = NEW.source_message_id
  FOR SHARE;
  IF NOT FOUND
     OR v_message.circle_id IS DISTINCT FROM NEW.circle_id
     OR v_message.thread_id IS DISTINCT FROM NEW.thread_id
     OR v_message.user_id IS DISTINCT FROM NEW.user_id
     OR v_message.is_bot IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_source_message_invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_agent_run_chat_lineage_v1
ON public.agent_runs;
CREATE TRIGGER trg_guard_agent_run_chat_lineage_v1
BEFORE INSERT OR UPDATE ON public.agent_runs
FOR EACH ROW
EXECUTE FUNCTION public.guard_agent_run_chat_lineage_v1();

REVOKE ALL ON FUNCTION public.guard_agent_run_chat_lineage_v1()
FROM PUBLIC, anon, authenticated;

-- The historical approval policy is circle-wide. Circle peers may keep the
-- product's existing read visibility, but an explicit Chat approval is
-- mutation authority owned by its requester. Protect both the unconsumed and
-- consumed schema-v2 shapes so a peer cannot resolve first or mutate later.
-- Auto approvals and non-Chat/legacy runs deliberately keep their established
-- behavior. SECURITY DEFINER makes the source-run classification independent
-- of permissive agent_runs RLS drift, while current membership prevents this
-- boolean helper from becoming a cross-circle run-id oracle.
CREATE OR REPLACE FUNCTION public.is_protected_openswan_chat_ask_approval_v1(
  p_run_id uuid,
  p_circle_id uuid,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE((
    auth.uid() IS NOT NULL
    AND p_run_id IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND jsonb_typeof(p_payload) = 'object'
    AND p_payload->>'approvalSchemaVersion' = '2'
    AND p_payload->>'approvalMode' = 'ask'
    AND (
      public.is_valid_tool_v2_approval_payload(p_payload, false)
      OR public.is_valid_tool_v2_approval_payload(p_payload, true)
    )
    AND EXISTS (
      SELECT 1
      FROM public.agent_runs AS source_run
      JOIN public.circle_members AS membership
        ON membership.circle_id = source_run.circle_id
       AND membership.user_id = auth.uid()
      WHERE source_run.id = p_run_id
        AND source_run.circle_id = p_circle_id
        AND source_run.surface = 'main_chat'
        AND source_run.provider = 'openswan'
        AND source_run.thread_id IS NOT NULL
        AND source_run.source_message_id IS NOT NULL
    )
  ), false);
$function$;

REVOKE ALL ON FUNCTION public.is_protected_openswan_chat_ask_approval_v1(
  uuid, uuid, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_protected_openswan_chat_ask_approval_v1(
  uuid, uuid, jsonb
) TO authenticated;

ALTER TABLE public.agent_run_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_run_approvals_chat_ask_requester_update_v1
ON public.agent_run_approvals;
CREATE POLICY agent_run_approvals_chat_ask_requester_update_v1
ON public.agent_run_approvals
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  NOT public.is_protected_openswan_chat_ask_approval_v1(
    run_id,
    circle_id,
    payload
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
)
WITH CHECK (
  NOT public.is_protected_openswan_chat_ask_approval_v1(
    run_id,
    circle_id,
    payload
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
);

-- Read-only custody preflight. This exposes no approval payload and grants no
-- dispatch authority: it only tells the authenticated owner whether the exact
-- consume predicates are true in this statement snapshot. Callers must treat
-- false, an RPC/schema-cache miss, and every error as a hard no-claim result.
-- A subsequent race is harmless because the consuming RPC repeats the checks
-- under row locks before it writes the one-shot dispatch receipt.
DROP FUNCTION IF EXISTS public.can_consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
);

CREATE FUNCTION public.can_consume_openswan_chat_approval_resume_v1(
  p_approval_id uuid,
  p_source_run_id uuid,
  p_current_run_id uuid,
  p_circle_id uuid,
  p_thread_id uuid,
  p_source_message_id uuid,
  p_tool_name text,
  p_tool_approval_digest text,
  p_tool_use_id text,
  p_iteration integer,
  p_dispatch_binding_digest text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_source_run public.agent_runs%ROWTYPE;
  v_current_run public.agent_runs%ROWTYPE;
  v_thread public.circle_chat_threads%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_approval public.agent_run_approvals%ROWTYPE;
  v_terminal jsonb;
  v_now timestamptz;
  v_expires_at timestamptz;
  v_authority_json text;
  v_expected_binding_digest text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_auth_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_approval_id IS NULL
     OR p_source_run_id IS NULL
     OR p_current_run_id IS NULL
     OR p_source_run_id = p_current_run_id
     OR p_circle_id IS NULL
     OR p_thread_id IS NULL
     OR p_source_message_id IS NULL
     OR p_tool_name IS NULL
     OR p_tool_name !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
     OR p_tool_approval_digest IS NULL
     OR p_tool_approval_digest !~ '^approval-v2:sha256:[0-9a-f]{64}$'
     OR p_tool_use_id IS NULL
     OR p_tool_use_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
     OR p_tool_use_id IS DISTINCT FROM 'approval-resume:' || p_approval_id::text
     OR p_iteration IS NULL
     OR p_iteration < 1
     OR p_iteration > 8
     OR p_dispatch_binding_digest IS NULL
     OR p_dispatch_binding_digest !~ '^authority-v2:sha256:[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = v_uid;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT run_row.*
  INTO v_source_run
  FROM public.agent_runs AS run_row
  WHERE run_row.id = p_source_run_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT run_row.*
  INTO v_current_run
  FROM public.agent_runs AS run_row
  WHERE run_row.id = p_current_run_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_terminal := v_source_run.metadata->'terminal';
  IF v_source_run.user_id IS DISTINCT FROM v_uid
     OR v_source_run.circle_id IS DISTINCT FROM p_circle_id
     OR v_source_run.thread_id IS DISTINCT FROM p_thread_id
     OR v_source_run.source_message_id IS DISTINCT FROM p_source_message_id
     OR v_source_run.provider IS DISTINCT FROM 'openswan'
     OR v_source_run.surface IS DISTINCT FROM 'main_chat'
     OR v_source_run.status IS DISTINCT FROM 'failed'
     OR jsonb_typeof(v_terminal) IS DISTINCT FROM 'object'
     OR v_terminal->>'state' IS DISTINCT FROM 'partial'
     OR v_terminal->>'reason' IS DISTINCT FROM 'action_coverage_incomplete'
     OR v_terminal->'completionVerified' IS DISTINCT FROM 'false'::jsonb THEN
    RETURN false;
  END IF;

  IF v_current_run.user_id IS DISTINCT FROM v_uid
     OR v_current_run.circle_id IS DISTINCT FROM p_circle_id
     OR v_current_run.thread_id IS DISTINCT FROM p_thread_id
     OR v_current_run.source_message_id IS DISTINCT FROM p_source_message_id
     OR v_current_run.provider IS DISTINCT FROM 'openswan'
     OR v_current_run.surface IS DISTINCT FROM 'main_chat'
     OR v_current_run.status NOT IN ('queued', 'planning', 'running')
     OR COALESCE(v_current_run.metadata ? 'terminal', false) THEN
    RETURN false;
  END IF;

  SELECT thread.*
  INTO v_thread
  FROM public.circle_chat_threads AS thread
  WHERE thread.id = p_thread_id;
  IF NOT FOUND
     OR v_thread.circle_id IS DISTINCT FROM p_circle_id
     OR COALESCE(v_thread.archived, false) THEN
    RETURN false;
  END IF;

  IF v_thread.visibility IS DISTINCT FROM 'circle'
     AND v_thread.created_by IS DISTINCT FROM v_uid THEN
    PERFORM 1
    FROM public.circle_chat_thread_members AS thread_member
    WHERE thread_member.thread_id = p_thread_id
      AND thread_member.user_id = v_uid;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
  END IF;

  SELECT message.*
  INTO v_message
  FROM public.messages AS message
  WHERE message.id = p_source_message_id;
  IF NOT FOUND
     OR v_message.circle_id IS DISTINCT FROM p_circle_id
     OR v_message.thread_id IS DISTINCT FROM p_thread_id
     OR v_message.user_id IS DISTINCT FROM v_uid
     OR v_message.is_bot IS DISTINCT FROM false THEN
    RETURN false;
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.agent_run_approvals AS approval_row
  WHERE approval_row.id = p_approval_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_now := statement_timestamp();
  IF v_approval.timeout_seconds IS NULL
     OR v_approval.timeout_seconds < 1
     OR v_approval.timeout_seconds > 86400
     OR v_approval.requested_at IS NULL
     OR v_approval.resolved_at IS NULL THEN
    RETURN false;
  END IF;
  v_expires_at := v_approval.requested_at
    + make_interval(secs => v_approval.timeout_seconds);

  IF v_approval.run_id IS DISTINCT FROM p_source_run_id
     OR v_approval.circle_id IS DISTINCT FROM p_circle_id
     OR v_approval.requested_by IS DISTINCT FROM v_uid::text
     OR v_approval.resolved_by IS DISTINCT FROM v_uid
     OR v_approval.status IS DISTINCT FROM 'approved'
     OR v_approval.metadata IS DISTINCT FROM '{}'::jsonb
     OR v_approval.requested_at > v_approval.resolved_at
     OR v_approval.resolved_at > v_now
     OR v_approval.resolved_at >= v_expires_at
     OR v_now >= v_expires_at
     OR NOT public.is_valid_tool_v2_approval_payload(v_approval.payload, false)
     OR v_approval.payload->>'approvalMode' IS DISTINCT FROM 'ask'
     OR v_approval.payload->>'toolName' IS DISTINCT FROM p_tool_name
     OR v_approval.payload->>'toolName' = 'desktop.open_attachment'
     OR v_approval.payload->>'toolApprovalDigest' IS DISTINCT FROM p_tool_approval_digest
     OR v_approval.payload ? 'dispatchReceiptSchemaVersion'
     OR v_approval.payload ? 'dispatchBindingDigest'
     OR v_approval.payload ? 'dispatchConsumedAt' THEN
    RETURN false;
  END IF;

  v_authority_json :=
      '{"approvalDigest":' || to_json(p_tool_approval_digest)::text
    || ',"approvalId":' || to_json(p_approval_id::text)::text
    || ',"approvalRunId":' || to_json(p_source_run_id::text)::text
    || ',"circleId":' || to_json(p_circle_id::text)::text
    || ',"iteration":' || p_iteration::text
    || ',"runId":' || to_json(p_current_run_id::text)::text
    || ',"schemaVersion":2'
    || ',"source":"cross_run"'
    || ',"status":"approved"'
    || ',"toolName":' || to_json(p_tool_name)::text
    || ',"toolUseId":' || to_json(p_tool_use_id)::text
    || ',"userId":' || to_json(v_uid::text)::text
    || '}';
  v_expected_binding_digest := 'authority-v2:sha256:' || encode(
    extensions.digest(convert_to(v_authority_json, 'UTF8'), 'sha256'),
    'hex'
  );

  RETURN p_dispatch_binding_digest = v_expected_binding_digest;
END
$function$;

REVOKE ALL ON FUNCTION public.can_consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
) TO authenticated;

DROP FUNCTION IF EXISTS public.consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
);

CREATE FUNCTION public.consume_openswan_chat_approval_resume_v1(
  p_approval_id uuid,
  p_source_run_id uuid,
  p_current_run_id uuid,
  p_circle_id uuid,
  p_thread_id uuid,
  p_source_message_id uuid,
  p_tool_name text,
  p_tool_approval_digest text,
  p_tool_use_id text,
  p_iteration integer,
  p_dispatch_binding_digest text
)
RETURNS TABLE (
  approval_id uuid,
  approval_run_id uuid,
  dispatch_run_id uuid,
  circle_id uuid,
  thread_id uuid,
  source_message_id uuid,
  tool_name text,
  tool_approval_digest text,
  receipt_source text,
  approval_status text,
  dispatch_binding_digest text,
  dispatch_consumed_at text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_locked_run_count integer := 0;
  v_source_run public.agent_runs%ROWTYPE;
  v_current_run public.agent_runs%ROWTYPE;
  v_thread public.circle_chat_threads%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_approval public.agent_run_approvals%ROWTYPE;
  v_terminal jsonb;
  v_now timestamptz;
  v_expires_at timestamptz;
  v_consumed_at_text text;
  v_authority_json text;
  v_expected_binding_digest text;
  v_consumed_payload jsonb;
  v_written_payload jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_auth_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_approval_id IS NULL
     OR p_source_run_id IS NULL
     OR p_current_run_id IS NULL
     OR p_source_run_id = p_current_run_id
     OR p_circle_id IS NULL
     OR p_thread_id IS NULL
     OR p_source_message_id IS NULL
     OR p_tool_name IS NULL
     OR p_tool_name !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
     OR p_tool_approval_digest IS NULL
     OR p_tool_approval_digest !~ '^approval-v2:sha256:[0-9a-f]{64}$'
     OR p_tool_use_id IS NULL
     OR p_tool_use_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
     OR p_tool_use_id IS DISTINCT FROM 'approval-resume:' || p_approval_id::text
     OR p_iteration IS NULL
     OR p_iteration < 1
     OR p_iteration > 8
     OR p_dispatch_binding_digest IS NULL
     OR p_dispatch_binding_digest !~ '^authority-v2:sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_identity_invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Keep membership live for the whole transaction. A concurrent revocation
  -- must finish before or after this consume, never between its checks.
  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = v_uid
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_membership_required'
      USING ERRCODE = '42501';
  END IF;

  -- Deterministic id order prevents two inverse source/current requests from
  -- deadlocking. Both rows stay locked through approval consumption.
  PERFORM run_row.id
  FROM public.agent_runs AS run_row
  WHERE run_row.id IN (p_source_run_id, p_current_run_id)
  ORDER BY run_row.id
  FOR UPDATE;
  GET DIAGNOSTICS v_locked_run_count = ROW_COUNT;
  IF v_locked_run_count <> 2 THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_run_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT run_row.*
  INTO STRICT v_source_run
  FROM public.agent_runs AS run_row
  WHERE run_row.id = p_source_run_id;

  SELECT run_row.*
  INTO STRICT v_current_run
  FROM public.agent_runs AS run_row
  WHERE run_row.id = p_current_run_id;

  v_terminal := v_source_run.metadata->'terminal';
  IF v_source_run.user_id IS DISTINCT FROM v_uid
     OR v_source_run.circle_id IS DISTINCT FROM p_circle_id
     OR v_source_run.thread_id IS DISTINCT FROM p_thread_id
     OR v_source_run.source_message_id IS DISTINCT FROM p_source_message_id
     OR v_source_run.provider IS DISTINCT FROM 'openswan'
     OR v_source_run.surface IS DISTINCT FROM 'main_chat'
     OR v_source_run.status IS DISTINCT FROM 'failed'
     OR jsonb_typeof(v_terminal) IS DISTINCT FROM 'object'
     OR v_terminal->>'state' IS DISTINCT FROM 'partial'
     OR v_terminal->>'reason' IS DISTINCT FROM 'action_coverage_incomplete'
     OR v_terminal->'completionVerified' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_source_run_not_eligible'
      USING ERRCODE = '55000';
  END IF;

  IF v_current_run.user_id IS DISTINCT FROM v_uid
     OR v_current_run.circle_id IS DISTINCT FROM p_circle_id
     OR v_current_run.thread_id IS DISTINCT FROM p_thread_id
     OR v_current_run.source_message_id IS DISTINCT FROM p_source_message_id
     OR v_current_run.provider IS DISTINCT FROM 'openswan'
     OR v_current_run.surface IS DISTINCT FROM 'main_chat'
     OR v_current_run.status NOT IN ('queued', 'planning', 'running')
     OR COALESCE(v_current_run.metadata ? 'terminal', false) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_current_run_not_eligible'
      USING ERRCODE = '55000';
  END IF;

  SELECT thread.*
  INTO v_thread
  FROM public.circle_chat_threads AS thread
  WHERE thread.id = p_thread_id
  FOR SHARE;
  IF NOT FOUND
     OR v_thread.circle_id IS DISTINCT FROM p_circle_id
     OR COALESCE(v_thread.archived, false) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_thread_not_live'
      USING ERRCODE = '42501';
  END IF;

  IF v_thread.visibility IS DISTINCT FROM 'circle'
     AND v_thread.created_by IS DISTINCT FROM v_uid THEN
    PERFORM 1
    FROM public.circle_chat_thread_members AS thread_member
    WHERE thread_member.thread_id = p_thread_id
      AND thread_member.user_id = v_uid
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'openswan_chat_approval_resume_thread_access_required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT message.*
  INTO v_message
  FROM public.messages AS message
  WHERE message.id = p_source_message_id
  FOR SHARE;
  IF NOT FOUND
     OR v_message.circle_id IS DISTINCT FROM p_circle_id
     OR v_message.thread_id IS DISTINCT FROM p_thread_id
     OR v_message.user_id IS DISTINCT FROM v_uid
     OR v_message.is_bot IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_source_message_invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.agent_run_approvals AS approval_row
  WHERE approval_row.id = p_approval_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_approval_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_now := clock_timestamp();
  IF v_approval.timeout_seconds IS NULL
     OR v_approval.timeout_seconds < 1
     OR v_approval.timeout_seconds > 86400
     OR v_approval.requested_at IS NULL
     OR v_approval.resolved_at IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_approval_not_live'
      USING ERRCODE = '55000';
  END IF;
  v_expires_at := v_approval.requested_at
    + make_interval(secs => v_approval.timeout_seconds);

  IF v_approval.run_id IS DISTINCT FROM p_source_run_id
     OR v_approval.circle_id IS DISTINCT FROM p_circle_id
     OR v_approval.requested_by IS DISTINCT FROM v_uid::text
     OR v_approval.resolved_by IS DISTINCT FROM v_uid
     OR v_approval.status IS DISTINCT FROM 'approved'
     OR v_approval.metadata IS DISTINCT FROM '{}'::jsonb
     OR v_approval.requested_at > v_approval.resolved_at
     OR v_approval.resolved_at > v_now
     OR v_approval.resolved_at >= v_expires_at
     OR v_now >= v_expires_at
     OR NOT public.is_valid_tool_v2_approval_payload(v_approval.payload, false)
     OR v_approval.payload->>'approvalMode' IS DISTINCT FROM 'ask'
     OR v_approval.payload->>'toolName' IS DISTINCT FROM p_tool_name
     OR v_approval.payload->>'toolName' = 'desktop.open_attachment'
     OR v_approval.payload->>'toolApprovalDigest' IS DISTINCT FROM p_tool_approval_digest
     OR v_approval.payload ? 'dispatchReceiptSchemaVersion'
     OR v_approval.payload ? 'dispatchBindingDigest'
     OR v_approval.payload ? 'dispatchConsumedAt' THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_approval_not_live'
      USING ERRCODE = '55000';
  END IF;

  -- Match `stableApprovalJson` exactly. Its flat authority object is sorted by
  -- key and JSON.stringify emits no whitespace. The database recomputes this
  -- digest instead of trusting an arbitrary client-provided receipt binding.
  v_authority_json :=
      '{"approvalDigest":' || to_json(p_tool_approval_digest)::text
    || ',"approvalId":' || to_json(p_approval_id::text)::text
    || ',"approvalRunId":' || to_json(p_source_run_id::text)::text
    || ',"circleId":' || to_json(p_circle_id::text)::text
    || ',"iteration":' || p_iteration::text
    || ',"runId":' || to_json(p_current_run_id::text)::text
    || ',"schemaVersion":2'
    || ',"source":"cross_run"'
    || ',"status":"approved"'
    || ',"toolName":' || to_json(p_tool_name)::text
    || ',"toolUseId":' || to_json(p_tool_use_id)::text
    || ',"userId":' || to_json(v_uid::text)::text
    || '}';
  v_expected_binding_digest := 'authority-v2:sha256:' || encode(
    extensions.digest(convert_to(v_authority_json, 'UTF8'), 'sha256'),
    'hex'
  );
  IF p_dispatch_binding_digest IS DISTINCT FROM v_expected_binding_digest THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_dispatch_binding_invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Re-sample database time immediately before the write. The approval may
  -- have been barely live when its locked row was first read.
  v_now := clock_timestamp();
  IF v_now >= v_expires_at THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_approval_not_live'
      USING ERRCODE = '55000';
  END IF;

  v_consumed_at_text := to_char(
    v_now AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_consumed_payload := v_approval.payload || jsonb_build_object(
    'dispatchReceiptSchemaVersion', 2,
    'dispatchBindingDigest', v_expected_binding_digest,
    'dispatchConsumedAt', v_consumed_at_text
  );
  IF NOT public.is_valid_tool_v2_approval_payload(v_consumed_payload, true) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_consumed_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agent_run_approvals AS approval_row
  SET payload = v_consumed_payload
  WHERE approval_row.id = p_approval_id
    AND approval_row.run_id = p_source_run_id
    AND approval_row.circle_id = p_circle_id
    AND approval_row.requested_by = v_uid::text
    AND approval_row.resolved_by = v_uid
    AND approval_row.status = 'approved'
    AND approval_row.payload IS NOT DISTINCT FROM v_approval.payload
    AND clock_timestamp() < v_expires_at
  RETURNING approval_row.payload INTO v_written_payload;
  IF NOT FOUND
     OR v_written_payload->>'dispatchBindingDigest'
       IS DISTINCT FROM v_expected_binding_digest THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_consume_conflict'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    p_approval_id,
    p_source_run_id,
    p_current_run_id,
    p_circle_id,
    p_thread_id,
    p_source_message_id,
    p_tool_name,
    p_tool_approval_digest,
    'cross_run'::text,
    'approved'::text,
    v_expected_binding_digest,
    v_consumed_at_text;
END
$function$;

REVOKE ALL ON FUNCTION public.consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Catalog readiness only. Follow with authenticated cross-user/thread/replay
-- and locked status-race behavior before relying on this authority boundary.
SELECT
  (
    SELECT count(*) = 2
      AND bool_and(attribute.atttypid = 'uuid'::regtype)
      AND bool_and(NOT attribute.attnotnull)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.agent_runs'::regclass
      AND attribute.attname IN ('thread_id', 'source_message_id')
      AND NOT attribute.attisdropped
  ) AS openswan_chat_run_lineage_columns_ready,
  (
    SELECT count(*) = 4
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.agent_runs'::regclass
      AND constraint_row.conname IN (
        'agent_runs_chat_thread_lineage_pair_v1',
        'agent_runs_chat_thread_lineage_scope_v1',
        'agent_runs_chat_thread_lineage_thread_fkey_v1',
        'agent_runs_chat_thread_lineage_message_fkey_v1'
      )
      AND constraint_row.convalidated
  ) AS openswan_chat_run_lineage_constraints_ready,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.agent_runs'::regclass
      AND constraint_row.conname = 'agent_runs_chat_thread_lineage_thread_fkey_v1'
      AND constraint_row.confrelid = 'public.circle_chat_threads'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'r'
      AND constraint_row.convalidated
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.agent_runs'::regclass
      AND constraint_row.conname = 'agent_runs_chat_thread_lineage_message_fkey_v1'
      AND constraint_row.confrelid = 'public.messages'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'r'
      AND constraint_row.convalidated
  ) AS openswan_chat_run_lineage_exact_fks_ready,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.agent_runs'::regclass
      AND trigger_row.tgname = 'trg_guard_agent_run_chat_lineage_v1'
      AND trigger_row.tgfoid = 'public.guard_agent_run_chat_lineage_v1()'::regprocedure
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) AS openswan_chat_run_lineage_trigger_ready,
  (
    SELECT count(*) = 2
      AND bool_and(permissive = 'RESTRICTIVE')
      AND bool_and(cmd IN ('UPDATE', 'DELETE'))
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_runs'
      AND policyname IN (
        'agent_runs_chat_lineage_update_owner_v1',
        'agent_runs_chat_lineage_delete_owner_v1'
      )
  ) AS openswan_chat_run_lineage_owner_policies_ready,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_approvals'
      AND policyname = 'agent_run_approvals_chat_ask_requester_update_v1'
      AND permissive = 'RESTRICTIVE'
      AND cmd = 'UPDATE'
  )
  AND to_regprocedure(
    'public.is_protected_openswan_chat_ask_approval_v1(uuid,uuid,jsonb)'
  ) IS NOT NULL AS openswan_chat_approval_requester_policy_ready,
  to_regprocedure(
    'public.can_consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)'
  ) IS NOT NULL
  AND has_function_privilege(
    'authenticated',
    'public.can_consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.can_consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  ) AS openswan_chat_approval_resume_preflight_rpc_ready,
  to_regprocedure(
    'public.consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)'
  ) IS NOT NULL
  AND has_function_privilege(
    'authenticated',
    'public.consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  ) AS openswan_chat_approval_resume_rpc_ready;
