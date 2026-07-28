-- Database authority guards
--
-- 1. Office terminal execution is claimed from one canonical durable message.
--    The authenticated claimant must be a current circle member and either own
--    the targeted Office agent or claim the circle-scoped synthetic BlackSwan.
-- 2. Office response streaming and completion are claimant-bound state
--    transitions, not unrestricted SECURITY DEFINER writes.
-- 3. Schema-v2 Chat and OpenSwan/SwanBot approvals are immutable exact-intent
--    audit rows with narrow resolve, expire, and one-shot consume transitions.

-- ─── Office response identity ────────────────────────────────────────────────

ALTER TABLE public.office_terminal_responses
  ADD COLUMN IF NOT EXISTS agent_subject_key text,
  ADD COLUMN IF NOT EXISTS claimant_user_id uuid REFERENCES auth.users(id);

UPDATE public.office_terminal_responses
SET agent_subject_key = 'office-agent:' || agent_id::text
WHERE agent_subject_key IS NULL
  AND agent_id IS NOT NULL;

UPDATE public.office_terminal_responses
SET agent_subject_key = 'legacy-response:' || id::text
WHERE agent_subject_key IS NULL;

ALTER TABLE public.office_terminal_responses
  ALTER COLUMN agent_subject_key SET NOT NULL,
  ALTER COLUMN agent_id DROP NOT NULL;

ALTER TABLE public.office_terminal_responses
  DROP CONSTRAINT IF EXISTS office_terminal_responses_message_agent_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_response_message_subject
  ON public.office_terminal_responses (message_id, agent_subject_key);

CREATE INDEX IF NOT EXISTS idx_terminal_response_claimant
  ON public.office_terminal_responses (claimant_user_id, status)
  WHERE claimant_user_id IS NOT NULL;

-- ─── Office invocation claim ─────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.invoke_agent(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.invoke_agent(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.invoke_agent(uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.invoke_agent(
  p_message_id uuid,
  p_circle_id uuid,
  p_expected_command_text text,
  p_agent_id uuid
)
RETURNS TABLE (
  response_id uuid,
  claim_disposition text,
  canonical_message_id uuid,
  canonical_circle_id uuid,
  canonical_sender_id uuid,
  canonical_command_text text,
  canonical_target_agent_id uuid,
  canonical_target_agent_ids uuid[],
  canonical_target_agent_name text,
  canonical_model text,
  canonical_agent_id uuid,
  canonical_agent_subject_key text,
  canonical_agent_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.office_terminal_messages%ROWTYPE;
  v_agent public.circle_office_agents%ROWTYPE;
  v_response_id uuid;
  v_subject_key text;
  v_agent_name text;
  v_target_name text;
  v_is_targeted boolean := false;
  v_disposition text := 'claimed';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'office_invocation_auth_required';
  END IF;
  IF p_message_id IS NULL
    OR p_circle_id IS NULL
    OR p_expected_command_text IS NULL
    OR length(p_expected_command_text) < 1
    OR length(p_expected_command_text) > 100000
  THEN
    RAISE EXCEPTION 'office_invocation_invalid_identity';
  END IF;

  SELECT message_row.*
  INTO v_message
  FROM public.office_terminal_messages AS message_row
  WHERE message_row.id = p_message_id
    AND message_row.circle_id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_invocation_message_not_found';
  END IF;
  IF v_message.command_text IS DISTINCT FROM p_expected_command_text THEN
    RAISE EXCEPTION 'office_invocation_command_mismatch';
  END IF;
  IF v_message.status NOT IN ('pending', 'invoked') THEN
    RAISE EXCEPTION 'office_invocation_message_not_executable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = p_circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'office_invocation_circle_membership_required';
  END IF;

  v_target_name := lower(btrim(COALESCE(v_message.target_agent_name, '')));
  IF p_agent_id IS NULL THEN
    IF v_message.sender_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'office_invocation_sender_claim_required';
    END IF;
    v_subject_key := 'blackswan';
    v_agent_name := 'BlackSwan';
    v_is_targeted := (
      v_message.target_agent_id IS NULL
      AND (
        v_target_name IN ('all', '@all', 'blackswan', '@blackswan', 'swan', '@swan')
        OR position('blackswan' IN v_target_name) > 0
        OR position('@swan' IN v_target_name) > 0
      )
    );
  ELSE
    SELECT agent_row.*
    INTO v_agent
    FROM public.circle_office_agents AS agent_row
    WHERE agent_row.id = p_agent_id
      AND agent_row.circle_id = p_circle_id
      AND agent_row.owner_id = v_uid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'office_invocation_agent_ownership_required';
    END IF;

    v_subject_key := 'office-agent:' || p_agent_id::text;
    v_agent_name := left(COALESCE(NULLIF(btrim(v_agent.name), ''), 'Office agent'), 120);
    v_is_targeted := (
      v_message.target_agent_id = p_agent_id
      OR p_agent_id = ANY(COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[]))
      OR (
        v_message.target_agent_id IS NULL
        AND cardinality(COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[])) = 0
        AND v_target_name IN ('all', '@all')
        AND v_agent.is_published = true
        AND v_agent.status <> 'offline'
      )
    );
  END IF;

  IF NOT v_is_targeted THEN
    RAISE EXCEPTION 'office_invocation_agent_out_of_scope';
  END IF;

  INSERT INTO public.office_terminal_responses (
    message_id,
    agent_id,
    agent_subject_key,
    agent_name,
    circle_id,
    claimant_user_id,
    status
  )
  VALUES (
    v_message.id,
    p_agent_id,
    v_subject_key,
    v_agent_name,
    v_message.circle_id,
    v_uid,
    'pending'
  )
  ON CONFLICT (message_id, agent_subject_key) DO NOTHING
  RETURNING id INTO v_response_id;

  IF v_response_id IS NULL THEN
    SELECT response_row.id
    INTO v_response_id
    FROM public.office_terminal_responses AS response_row
    WHERE response_row.message_id = v_message.id
      AND response_row.agent_subject_key = v_subject_key;
    v_disposition := 'duplicate';
  ELSE
    UPDATE public.office_terminal_messages AS message_row
    SET status = 'invoked',
        invoked_at = COALESCE(message_row.invoked_at, clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE message_row.id = v_message.id
      AND message_row.status = 'pending';
  END IF;

  RETURN QUERY
  SELECT
    v_response_id,
    v_disposition,
    v_message.id,
    v_message.circle_id,
    v_message.sender_id,
    v_message.command_text,
    v_message.target_agent_id,
    v_message.target_agent_ids,
    v_message.target_agent_name,
    v_message.model,
    p_agent_id,
    v_subject_key,
    v_agent_name;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_agent(uuid, uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoke_agent(uuid, uuid, text, uuid)
  TO authenticated;

-- ─── Claimant-bound response state ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.stream_response(uuid, text, text, bigint, integer);
DROP FUNCTION IF EXISTS public.stream_response(
  uuid, text, text, bigint, integer, text, bigint, bigint, bigint, bigint
);

CREATE OR REPLACE FUNCTION public.stream_response(
  p_response_id uuid,
  p_text text,
  p_status text,
  p_tokens bigint,
  p_latency_ms integer,
  p_model text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cache_creation_tokens bigint,
  p_cache_read_tokens bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_response public.office_terminal_responses%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'office_response_auth_required';
  END IF;
  IF p_response_id IS NULL
    OR p_status IS NULL
    OR p_status NOT IN ('streaming', 'done', 'error')
    OR p_text IS NULL
    OR length(p_text) > 1000000
    OR p_tokens IS NULL OR p_tokens < 0 OR p_tokens > 1000000000
    OR p_latency_ms IS NOT NULL
      AND (p_latency_ms < 0 OR p_latency_ms > 86400000)
    OR p_model IS NOT NULL AND length(p_model) > 200
    OR p_input_tokens IS NULL OR p_input_tokens < 0 OR p_input_tokens > 1000000000
    OR p_output_tokens IS NULL OR p_output_tokens < 0 OR p_output_tokens > 1000000000
    OR p_cache_creation_tokens IS NULL
      OR p_cache_creation_tokens < 0
      OR p_cache_creation_tokens > 1000000000
    OR p_cache_read_tokens IS NULL
      OR p_cache_read_tokens < 0
      OR p_cache_read_tokens > 1000000000
  THEN
    RAISE EXCEPTION 'office_response_invalid_values';
  END IF;

  SELECT response_row.*
  INTO v_response
  FROM public.office_terminal_responses AS response_row
  WHERE response_row.id = p_response_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_response.claimant_user_id IS DISTINCT FROM v_uid
    OR v_response.status NOT IN ('pending', 'streaming')
  THEN
    RAISE EXCEPTION 'office_response_claim_not_live';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = v_response.circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'office_response_circle_membership_required';
  END IF;

  UPDATE public.office_terminal_responses AS response_row
  SET response_text = p_text,
      status = p_status,
      token_count = p_tokens,
      latency_ms = p_latency_ms,
      model = COALESCE(p_model, response_row.model),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      cache_creation_tokens = p_cache_creation_tokens,
      cache_read_tokens = p_cache_read_tokens,
      updated_at = clock_timestamp()
  WHERE response_row.id = p_response_id
    AND response_row.claimant_user_id = v_uid
    AND response_row.status = v_response.status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_response_state_conflict';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.stream_response(
  uuid, text, text, bigint, integer, text, bigint, bigint, bigint, bigint
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stream_response(
  uuid, text, text, bigint, integer, text, bigint, bigint, bigint, bigint
) TO authenticated;

DROP FUNCTION IF EXISTS public.mark_message_done(uuid);

CREATE OR REPLACE FUNCTION public.mark_message_done(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.office_terminal_messages%ROWTYPE;
  v_target_name text;
BEGIN
  IF v_uid IS NULL OR p_message_id IS NULL THEN
    RAISE EXCEPTION 'office_completion_auth_required';
  END IF;

  SELECT message_row.*
  INTO v_message
  FROM public.office_terminal_messages AS message_row
  WHERE message_row.id = p_message_id
    AND message_row.status = 'invoked'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = v_message.circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'office_completion_circle_membership_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.office_terminal_responses AS response_row
    WHERE response_row.message_id = p_message_id
      AND response_row.claimant_user_id = v_uid
      AND response_row.status IN ('done', 'error')
  ) THEN
    RAISE EXCEPTION 'office_completion_claim_required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.office_terminal_responses AS response_row
    WHERE response_row.message_id = p_message_id
      AND response_row.status IN ('pending', 'streaming')
  ) THEN
    RETURN false;
  END IF;

  -- Do not let a fast responder close a multi-target message before the other
  -- durable targets have claimed it. Explicit UUID targets must each reach a
  -- terminal response. For @all, use the published non-offline Office roster
  -- dispatched by the client, plus the synthetic BlackSwan subject.
  IF v_message.target_agent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.office_terminal_responses AS response_row
      WHERE response_row.message_id = p_message_id
        AND response_row.agent_subject_key =
          'office-agent:' || v_message.target_agent_id::text
        AND response_row.status IN ('done', 'error')
    )
  THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(
      COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[])
    ) AS expected_target(agent_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.office_terminal_responses AS response_row
      WHERE response_row.message_id = p_message_id
        AND response_row.agent_subject_key =
          'office-agent:' || expected_target.agent_id::text
        AND response_row.status IN ('done', 'error')
    )
  ) THEN
    RETURN false;
  END IF;

  v_target_name := lower(btrim(COALESCE(v_message.target_agent_name, '')));
  IF v_message.target_agent_id IS NULL
    AND cardinality(
      COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[])
    ) = 0
    AND v_target_name IN ('all', '@all')
    AND EXISTS (
      SELECT 1
      FROM public.circle_office_agents AS expected_agent
      WHERE expected_agent.circle_id = v_message.circle_id
        AND expected_agent.is_published = true
        AND expected_agent.status <> 'offline'
        AND NOT EXISTS (
          SELECT 1
          FROM public.office_terminal_responses AS response_row
          WHERE response_row.message_id = p_message_id
            AND response_row.agent_subject_key =
              'office-agent:' || expected_agent.id::text
            AND response_row.status IN ('done', 'error')
        )
    )
  THEN
    RETURN false;
  END IF;

  IF (
    v_target_name IN ('all', '@all', 'blackswan', '@blackswan', 'swan', '@swan')
    OR (
      cardinality(
        COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[])
      ) > 0
      AND (
        position('blackswan' IN v_target_name) > 0
        OR position('@swan' IN v_target_name) > 0
      )
    )
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.office_terminal_responses AS response_row
      WHERE response_row.message_id = p_message_id
        AND response_row.agent_subject_key = 'blackswan'
        AND response_row.status IN ('done', 'error')
    )
  THEN
    RETURN false;
  END IF;

  UPDATE public.office_terminal_messages AS message_row
  SET status = 'done',
      updated_at = clock_timestamp()
  WHERE message_row.id = p_message_id
    AND message_row.status = 'invoked';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_message_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_message_done(uuid) TO authenticated;

-- Durable Office execution state is RPC-owned. Keep SELECT and the existing
-- sender DELETE path, but prevent direct REST writes from preempting claims or
-- bypassing claimant/status compare-and-set transitions.
REVOKE INSERT, UPDATE ON TABLE public.office_terminal_responses
  FROM authenticated, anon;
REVOKE UPDATE ON TABLE public.office_terminal_messages
  FROM authenticated, anon;

-- ─── Schema-v2 payload validators ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_valid_chat_v2_approval_payload(
  p_payload jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    jsonb_typeof(p_payload) = 'object'
    AND p_payload->>'approvalSchemaVersion' = '2'
    AND p_payload->>'approvalIntentFingerprint'
      ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND p_payload->>'userId'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND p_payload->>'redacted' = 'true'
    AND length(COALESCE(p_payload->>'source', '')) BETWEEN 1 AND 80
    AND length(COALESCE(p_payload->>'intentKind', '')) BETWEEN 1 AND 80
    AND length(COALESCE(p_payload->>'executionKind', '')) BETWEEN 1 AND 120
    AND length(COALESCE(p_payload->>'risk', '')) BETWEEN 1 AND 40
    AND (
      NOT (p_payload ? 'roomId')
      OR p_payload->'roomId' = 'null'::jsonb
      OR p_payload->>'roomId'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND (
      NOT (p_payload ? 'threadId')
      OR p_payload->'threadId' = 'null'::jsonb
      OR p_payload->>'threadId'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_payload) AS payload_keys(payload_key)
      WHERE payload_key <> ALL (ARRAY[
        'approvalSchemaVersion',
        'approvalIntentFingerprint',
        'source',
        'intentKind',
        'executionKind',
        'risk',
        'userId',
        'roomId',
        'threadId',
        'redacted'
      ])
    )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.is_valid_tool_v2_approval_payload(
  p_payload jsonb,
  p_allow_dispatch boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    jsonb_typeof(p_payload) = 'object'
    AND p_payload->>'approvalSchemaVersion' = '2'
    AND p_payload->>'toolName'
      ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    AND p_payload->>'toolApprovalDigest'
      ~ '^approval-v2:sha256:[0-9a-f]{64}$'
    AND p_payload->>'toolApprovalKey' = p_payload->>'toolApprovalDigest'
    AND p_payload->>'toolApprovalKeyVersion' = '2'
    AND p_payload->>'policyFamily'
      ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    AND p_payload->>'approvalMode' IN ('ask', 'auto')
    AND jsonb_typeof(p_payload->'mutatesState') = 'boolean'
    AND jsonb_typeof(p_payload->'externalSideEffect') = 'boolean'
    AND (
      NOT (p_payload ? 'autoApproveCategory')
      OR p_payload->>'autoApproveCategory'
        ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    )
    AND (
      NOT (p_payload ? 'floorCategory')
      OR p_payload->>'floorCategory'
        ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    )
    AND (
      (
        NOT p_allow_dispatch
        AND NOT (p_payload ? 'dispatchReceiptSchemaVersion')
        AND NOT (p_payload ? 'dispatchBindingDigest')
        AND NOT (p_payload ? 'dispatchConsumedAt')
      )
      OR (
        p_allow_dispatch
        AND p_payload->>'dispatchReceiptSchemaVersion' = '2'
        AND p_payload->>'dispatchBindingDigest'
          ~ '^authority-v2:sha256:[0-9a-f]{64}$'
        AND p_payload->>'dispatchConsumedAt'
          ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_payload) AS payload_keys(payload_key)
      WHERE payload_key <> ALL (ARRAY[
        'approvalSchemaVersion',
        'toolName',
        'toolApprovalDigest',
        'toolApprovalKey',
        'toolApprovalKeyVersion',
        'policyFamily',
        'approvalMode',
        'mutatesState',
        'externalSideEffect',
        'autoApproveCategory',
        'floorCategory',
        'dispatchReceiptSchemaVersion',
        'dispatchBindingDigest',
        'dispatchConsumedAt'
      ])
    )
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_valid_chat_v2_approval_payload(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_valid_tool_v2_approval_payload(jsonb, boolean)
  FROM PUBLIC, anon, authenticated;

-- ─── Chat schema-v2 approval state machine ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_chat_v2_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old_v2 boolean := false;
  v_new_v2 boolean := false;
  v_expires_at timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_v2 := OLD.action_type LIKE 'chat.%'
      AND OLD.payload->>'approvalSchemaVersion' = '2';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_v2 := NEW.action_type LIKE 'chat.%'
      AND NEW.payload->>'approvalSchemaVersion' = '2';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'chat_v2_approval_delete_forbidden';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'chat_v2_approval_auth_required';
  END IF;
  IF TG_OP = 'UPDATE' AND (NOT v_old_v2 OR NOT v_new_v2) THEN
    RAISE EXCEPTION 'chat_v2_approval_schema_conversion_forbidden';
  END IF;
  IF NOT public.is_valid_chat_v2_approval_payload(NEW.payload) THEN
    RAISE EXCEPTION 'chat_v2_approval_payload_invalid';
  END IF;
  IF TG_OP = 'INSERT'
    AND NEW.payload->>'userId' <> v_uid::text
  THEN
    RAISE EXCEPTION 'chat_v2_approval_requester_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = NEW.circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'chat_v2_approval_membership_required';
  END IF;
  IF NEW.timeout_seconds IS NULL
    OR NEW.timeout_seconds < 1
    OR NEW.timeout_seconds > 86400
    OR length(NEW.action_type) > 200
    OR length(NEW.session_key) > 240
    OR length(NEW.agent_name) > 160
    OR length(NEW.description) > 500
  THEN
    RAISE EXCEPTION 'chat_v2_approval_values_invalid';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending'
      OR NEW.resolved_by IS NOT NULL
      OR NEW.resolved_at IS NOT NULL
      OR NEW.applied_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'chat_v2_approval_insert_must_be_pending';
    END IF;
    NEW.requested_at := clock_timestamp();
    NEW.created_at := COALESCE(NEW.created_at, NEW.requested_at);
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.session_key IS DISTINCT FROM OLD.session_key
    OR NEW.agent_name IS DISTINCT FROM OLD.agent_name
    OR NEW.action_type IS DISTINCT FROM OLD.action_type
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.timeout_seconds IS DISTINCT FROM OLD.timeout_seconds
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'chat_v2_approval_binding_immutable';
  END IF;

  v_expires_at := OLD.requested_at
    + make_interval(secs => OLD.timeout_seconds);

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    IF clock_timestamp() >= v_expires_at
      OR OLD.applied_at IS NOT NULL
      OR NEW.applied_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'chat_v2_approval_not_live';
    END IF;
    NEW.resolved_by := v_uid;
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('pending', 'approved', 'auto_approved')
    AND NEW.status = 'expired'
  THEN
    IF OLD.payload->>'userId' <> v_uid::text
      OR OLD.applied_at IS NOT NULL
      OR NEW.applied_at IS NOT NULL
      OR clock_timestamp() < v_expires_at
    THEN
      RAISE EXCEPTION 'chat_v2_approval_expiration_forbidden';
    END IF;
    NEW.resolved_by := OLD.resolved_by;
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('approved', 'auto_approved')
    AND NEW.status = OLD.status
    AND OLD.applied_at IS NULL
    AND NEW.applied_at IS NOT NULL
  THEN
    IF OLD.payload->>'userId' <> v_uid::text
      OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
      OR clock_timestamp() >= v_expires_at
    THEN
      RAISE EXCEPTION 'chat_v2_approval_consumption_forbidden';
    END IF;
    NEW.applied_at := clock_timestamp();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'chat_v2_approval_transition_forbidden';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_chat_v2_approval_insert
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_chat_v2_approval_insert
BEFORE INSERT ON public.agent_approvals
FOR EACH ROW
WHEN (
  NEW.action_type LIKE 'chat.%'
  AND NEW.payload->>'approvalSchemaVersion' = '2'
)
EXECUTE FUNCTION public.guard_chat_v2_approval();

DROP TRIGGER IF EXISTS trg_guard_chat_v2_approval_update
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_chat_v2_approval_update
BEFORE UPDATE ON public.agent_approvals
FOR EACH ROW
WHEN (
  (
    OLD.action_type LIKE 'chat.%'
    AND OLD.payload->>'approvalSchemaVersion' = '2'
  )
  OR (
    NEW.action_type LIKE 'chat.%'
    AND NEW.payload->>'approvalSchemaVersion' = '2'
  )
)
EXECUTE FUNCTION public.guard_chat_v2_approval();

DROP TRIGGER IF EXISTS trg_guard_chat_v2_approval_delete
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_chat_v2_approval_delete
BEFORE DELETE ON public.agent_approvals
FOR EACH ROW
WHEN (
  OLD.action_type LIKE 'chat.%'
  AND OLD.payload->>'approvalSchemaVersion' = '2'
)
EXECUTE FUNCTION public.guard_chat_v2_approval();

REVOKE ALL ON FUNCTION public.guard_chat_v2_approval()
  FROM PUBLIC, anon, authenticated;

-- ─── OpenSwan/SwanBot schema-v2 approval state machine ───────────────────────

CREATE OR REPLACE FUNCTION public.guard_tool_v2_run_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old_candidate boolean := false;
  v_new_candidate boolean := false;
  v_expires_at timestamptz;
  v_consumed_at timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_candidate := OLD.payload->>'approvalSchemaVersion' = '2'
      AND (
        OLD.payload ? 'toolName'
        OR OLD.payload ? 'toolApprovalDigest'
      );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_candidate := NEW.payload->>'approvalSchemaVersion' = '2'
      AND (
        NEW.payload ? 'toolName'
        OR NEW.payload ? 'toolApprovalDigest'
      );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tool_v2_approval_delete_forbidden';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'tool_v2_approval_auth_required';
  END IF;
  IF TG_OP = 'UPDATE'
    AND (NOT v_old_candidate OR NOT v_new_candidate)
  THEN
    RAISE EXCEPTION 'tool_v2_approval_schema_conversion_forbidden';
  END IF;
  IF TG_OP = 'INSERT'
    AND NEW.requested_by IS DISTINCT FROM v_uid::text
  THEN
    RAISE EXCEPTION 'tool_v2_approval_requester_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = NEW.circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'tool_v2_approval_membership_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_runs AS run_row
    WHERE run_row.id = NEW.run_id
      AND run_row.circle_id = NEW.circle_id
      AND (
        TG_OP <> 'INSERT'
        OR run_row.user_id = v_uid
      )
  ) THEN
    RAISE EXCEPTION 'tool_v2_approval_run_scope_invalid';
  END IF;
  IF NEW.timeout_seconds IS NULL
    OR NEW.timeout_seconds < 1
    OR NEW.timeout_seconds > 86400
    OR length(NEW.title) > 240
    OR length(COALESCE(NEW.description, '')) > 500
    OR COALESCE(NEW.metadata, '{}'::jsonb) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'tool_v2_approval_values_invalid';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_valid_tool_v2_approval_payload(NEW.payload, false) THEN
      RAISE EXCEPTION 'tool_v2_approval_payload_invalid';
    END IF;
    IF NEW.status = 'pending' THEN
      IF NEW.payload->>'approvalMode' <> 'ask'
        OR NEW.resolved_by IS NOT NULL
        OR NEW.resolved_at IS NOT NULL
      THEN
        RAISE EXCEPTION 'tool_v2_pending_approval_invalid';
      END IF;
    ELSIF NEW.status = 'auto_approved' THEN
      IF NEW.payload->>'approvalMode' <> 'auto'
        OR NOT (NEW.payload ? 'autoApproveCategory')
        OR NEW.payload ? 'floorCategory'
      THEN
        RAISE EXCEPTION 'tool_v2_auto_approval_invalid';
      END IF;
      NEW.resolved_by := v_uid;
      NEW.resolved_at := clock_timestamp();
    ELSE
      RAISE EXCEPTION 'tool_v2_approval_insert_status_invalid';
    END IF;
    NEW.requested_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.step_id IS DISTINCT FROM OLD.step_id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.approval_kind IS DISTINCT FROM OLD.approval_kind
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.timeout_seconds IS DISTINCT FROM OLD.timeout_seconds
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.metadata IS DISTINCT FROM OLD.metadata
  THEN
    RAISE EXCEPTION 'tool_v2_approval_binding_immutable';
  END IF;

  v_expires_at := OLD.requested_at
    + make_interval(secs => OLD.timeout_seconds);

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    IF NOT public.is_valid_tool_v2_approval_payload(OLD.payload, false)
      OR NEW.payload IS DISTINCT FROM OLD.payload
      OR clock_timestamp() >= v_expires_at
    THEN
      RAISE EXCEPTION 'tool_v2_approval_not_live';
    END IF;
    NEW.resolved_by := v_uid;
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('pending', 'approved', 'auto_approved')
    AND NEW.status = 'expired'
  THEN
    IF NOT public.is_valid_tool_v2_approval_payload(OLD.payload, false)
      OR OLD.requested_by <> v_uid::text
      OR NEW.payload IS DISTINCT FROM OLD.payload
      OR clock_timestamp() < v_expires_at
    THEN
      RAISE EXCEPTION 'tool_v2_approval_expiration_forbidden';
    END IF;
    NEW.resolved_by := OLD.resolved_by;
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('approved', 'auto_approved')
    AND NEW.status = OLD.status
    AND NOT (OLD.payload ? 'dispatchBindingDigest')
    AND NEW.payload ? 'dispatchBindingDigest'
  THEN
    IF OLD.requested_by <> v_uid::text
      OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
      OR clock_timestamp() >= v_expires_at
      OR NOT public.is_valid_tool_v2_approval_payload(OLD.payload, false)
      OR NOT public.is_valid_tool_v2_approval_payload(NEW.payload, true)
      OR (
        NEW.payload - ARRAY[
          'dispatchReceiptSchemaVersion',
          'dispatchBindingDigest',
          'dispatchConsumedAt'
        ]::text[]
      ) IS DISTINCT FROM OLD.payload
    THEN
      RAISE EXCEPTION 'tool_v2_approval_consumption_forbidden';
    END IF;

    BEGIN
      v_consumed_at := (NEW.payload->>'dispatchConsumedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'tool_v2_approval_consumed_at_invalid';
    END;
    IF v_consumed_at < OLD.requested_at
      OR v_consumed_at >= v_expires_at
      OR v_consumed_at < clock_timestamp() - interval '5 minutes'
      OR v_consumed_at > clock_timestamp() + interval '30 seconds'
    THEN
      RAISE EXCEPTION 'tool_v2_approval_consumed_at_not_live';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'tool_v2_approval_transition_forbidden';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tool_v2_run_approval_insert
  ON public.agent_run_approvals;
CREATE TRIGGER trg_guard_tool_v2_run_approval_insert
BEFORE INSERT ON public.agent_run_approvals
FOR EACH ROW
WHEN (
  NEW.payload->>'approvalSchemaVersion' = '2'
  AND (
    NEW.payload ? 'toolName'
    OR NEW.payload ? 'toolApprovalDigest'
  )
)
EXECUTE FUNCTION public.guard_tool_v2_run_approval();

DROP TRIGGER IF EXISTS trg_guard_tool_v2_run_approval_update
  ON public.agent_run_approvals;
CREATE TRIGGER trg_guard_tool_v2_run_approval_update
BEFORE UPDATE ON public.agent_run_approvals
FOR EACH ROW
WHEN (
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
EXECUTE FUNCTION public.guard_tool_v2_run_approval();

DROP TRIGGER IF EXISTS trg_guard_tool_v2_run_approval_delete
  ON public.agent_run_approvals;
CREATE TRIGGER trg_guard_tool_v2_run_approval_delete
BEFORE DELETE ON public.agent_run_approvals
FOR EACH ROW
WHEN (
  OLD.payload->>'approvalSchemaVersion' = '2'
  AND (
    OLD.payload ? 'toolName'
    OR OLD.payload ? 'toolApprovalDigest'
  )
)
EXECUTE FUNCTION public.guard_tool_v2_run_approval();

REVOKE ALL ON FUNCTION public.guard_tool_v2_run_approval()
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.office_terminal_responses.agent_subject_key IS
  'Canonical Office response subject. UUID-backed agents use office-agent:<uuid>; synthetic BlackSwan uses blackswan.';
COMMENT ON COLUMN public.office_terminal_responses.claimant_user_id IS
  'Authenticated user who atomically won this response claim and alone may stream or finish it.';

NOTIFY pgrst, 'reload schema';
