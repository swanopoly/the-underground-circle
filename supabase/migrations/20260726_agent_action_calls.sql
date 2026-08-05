-- Durable cross-process mutation claim/start/finish ledger.
--
-- This closes the process-local idempotency gap in computerAppGrounding
-- without weakening its observe -> authorize -> dispatch -> verify contract.
-- Direct writes are denied: authenticated callers must use the three
-- SECURITY DEFINER RPCs, which bind the authenticated user to the exact
-- circle/run/tool/tool-use/action/argument/contract/idempotency identity.

CREATE TABLE IF NOT EXISTS public.agent_action_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  tool_use_id text NOT NULL,
  action_id text NOT NULL,
  tool_args_fingerprint text NOT NULL,
  contract_fingerprint text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'claimed' CHECK (state IN (
    'claimed',
    'dispatched',
    'verified',
    'failed',
    'outcome_unknown'
  )),
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_version integer NOT NULL DEFAULT 1 CHECK (state_version BETWEEN 1 AND 1000000),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 10000),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT agent_action_calls_tool_name_shape CHECK (
    char_length(tool_name) BETWEEN 1 AND 120
    AND tool_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT agent_action_calls_tool_use_id_shape CHECK (
    char_length(tool_use_id) BETWEEN 1 AND 180
    AND tool_use_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT agent_action_calls_action_id_shape CHECK (
    char_length(action_id) BETWEEN 1 AND 180
    AND action_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT agent_action_calls_idempotency_key_shape CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 180
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT agent_action_calls_tool_args_fingerprint_shape CHECK (
    tool_args_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT agent_action_calls_contract_fingerprint_shape CHECK (
    contract_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT agent_action_calls_metadata_shape CHECK (
    jsonb_typeof(metadata) = 'object'
    AND octet_length(metadata::text) <= 4096
  ),
  CONSTRAINT agent_action_calls_expiry_order CHECK (expires_at > claimed_at),
  CONSTRAINT agent_action_calls_state_timeline CHECK (
    (state = 'claimed' AND dispatched_at IS NULL AND finished_at IS NULL)
    OR (state = 'dispatched' AND dispatched_at IS NOT NULL AND finished_at IS NULL)
    OR (
      state IN ('verified', 'outcome_unknown')
      AND dispatched_at IS NOT NULL
      AND finished_at IS NOT NULL
    )
    OR (
      state = 'failed'
      AND dispatched_at IS NULL
      AND finished_at IS NOT NULL
    )
  ),
  CONSTRAINT agent_action_calls_finish_order CHECK (
    dispatched_at IS NULL OR dispatched_at >= claimed_at
  ),
  CONSTRAINT agent_action_calls_terminal_order CHECK (
    finished_at IS NULL OR finished_at >= COALESCE(dispatched_at, claimed_at)
  )
);

-- One durable idempotency key cannot move to another action, and one provider
-- call/action id cannot evade the first claim by minting another key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_action_calls_idempotency
  ON public.agent_action_calls(user_id, circle_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_action_calls_tool_use
  ON public.agent_action_calls(run_id, tool_use_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_action_calls_action
  ON public.agent_action_calls(run_id, action_id);
CREATE INDEX IF NOT EXISTS idx_agent_action_calls_run_created
  ON public.agent_action_calls(run_id, claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_action_calls_open_expiry
  ON public.agent_action_calls(state, expires_at)
  WHERE state IN ('claimed', 'dispatched', 'outcome_unknown');

ALTER TABLE public.agent_action_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_action_calls_owner_read ON public.agent_action_calls;
CREATE POLICY agent_action_calls_owner_read
  ON public.agent_action_calls
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.agent_action_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_action_calls TO authenticated;

-- Primitive-only, per-key metadata sanitizer used at both write RPCs.
-- Each key has one exact type plus an enum or bounded token format. URIs,
-- queries, free-form content, secrets, emails, and POSIX/Windows paths are
-- dropped before the database boundary and recorded with redacted=true.
CREATE OR REPLACE FUNCTION public._sanitize_agent_action_call_metadata(
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_output jsonb := '{}'::jsonb;
  v_key text;
  v_value jsonb;
  v_text text;
  v_redacted boolean := false;
BEGIN
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_key, v_value IN
    SELECT entry.key, entry.value
    FROM jsonb_each(p_metadata) AS entry
    ORDER BY entry.key
  LOOP
    IF NOT (
      v_key = ANY(ARRAY[
        'surface',
        'risk',
        'approvalId',
        'observationEpochId',
        'verificationKind',
        'errorCode',
        'recoveryCode',
        'evidenceCount',
        'blockerCount',
        'completionVerified',
        'outcomeUnknown',
        'source',
        'actor',
        'redacted'
      ]::text[])
    ) THEN
      v_redacted := true;
      CONTINUE;
    END IF;

    IF v_key = 'redacted' THEN
      IF v_value = 'true'::jsonb THEN v_redacted := true; END IF;
      CONTINUE;
    END IF;

    IF v_key IN (
      'completionVerified',
      'outcomeUnknown'
    ) THEN
      IF jsonb_typeof(v_value) = 'boolean' THEN
        v_output := v_output || jsonb_build_object(v_key, v_value);
      ELSE
        v_redacted := true;
      END IF;
      CONTINUE;
    END IF;

    IF v_key IN (
      'evidenceCount',
      'blockerCount'
    ) THEN
      IF (
        jsonb_typeof(v_value) = 'number'
        AND (v_value #>> '{}') ~ '^[0-9]+$'
        AND (v_value #>> '{}')::numeric BETWEEN 0 AND 10000
      ) THEN
        v_output := v_output || jsonb_build_object(v_key, v_value);
      ELSE
        v_redacted := true;
      END IF;
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_value) <> 'string' THEN
      v_redacted := true;
      CONTINUE;
    END IF;

    v_text := v_value #>> '{}';
    IF (
      v_text = ''
      OR char_length(v_text) > 240
      OR v_text <> btrim(v_text)
      OR v_text ~ '[[:cntrl:][:space:]]'
      OR v_text ~* (
        'bearer[[:space:]]+[a-z0-9._~+/-]+'
        '|(api|access|refresh|session)[ _-]?token[[:space:]]*[:=]'
        '|(api[ _-]?key|password|passcode|secret|credential)[[:space:]]*[:=]'
        '|(sk|ghp|github_pat|xox[baprs])[-_][a-z0-9_-]{8,}'
        '|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
        '|^[a-z][a-z0-9+.-]*:'
        '|(^|[?&])[a-z0-9_.~-]{1,64}=[^&[:space:]]*'
        '|^/'
        '|^[a-z]:[\\/]'
        '|^\\\\'
        '|(^|[\\/])users[\\/][^\\/[:space:]]+'
        '|%userprofile%'
        '|~[\\/]'
        '|[<>{}\[\]"''`]'
      )
    ) THEN
      v_redacted := true;
      CONTINUE;
    END IF;

    IF v_key = 'surface' THEN
      IF v_text = ANY(ARRAY[
        'browser',
        'desktop',
        'vault',
        'terminal',
        'file',
        'code',
        'research',
        'approval',
        'system'
      ]::text[]) THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'risk' THEN
      IF v_text = ANY(ARRAY['low', 'medium', 'high', 'critical']::text[]) THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'approvalId' THEN
      IF v_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        v_output := v_output || jsonb_build_object(v_key, lower(v_text));
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'observationEpochId' THEN
      IF char_length(v_text) BETWEEN 1 AND 180
        AND v_text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'verificationKind' THEN
      IF v_text = ANY(ARRAY[
        'app_state',
        'accessibility',
        'browser_dom',
        'artifact',
        'visual'
      ]::text[]) THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key IN ('errorCode', 'recoveryCode') THEN
      IF char_length(v_text) BETWEEN 1 AND 80
        AND v_text ~ '^[a-z][a-z0-9_.:-]*$'
      THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'source' THEN
      IF v_text = 'openswan_tool_runtime' THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'actor' THEN
      IF v_text = 'user_authorized_agent' THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSE
      v_redacted := true;
    END IF;
  END LOOP;

  IF v_redacted THEN
    v_output := v_output || '{"redacted":true}'::jsonb;
  END IF;
  IF octet_length(v_output::text) > 4096 THEN
    RETURN '{"redacted":true}'::jsonb;
  END IF;
  RETURN v_output;
END;
$$;

CREATE OR REPLACE FUNCTION public._agent_action_call_identity_input_valid(
  p_tool_name text,
  p_tool_use_id text,
  p_action_id text,
  p_tool_args_fingerprint text,
  p_contract_fingerprint text,
  p_idempotency_key text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    char_length(COALESCE(p_tool_name, '')) BETWEEN 1 AND 120
    AND p_tool_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND char_length(COALESCE(p_tool_use_id, '')) BETWEEN 1 AND 180
    AND p_tool_use_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND char_length(COALESCE(p_action_id, '')) BETWEEN 1 AND 180
    AND p_action_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND char_length(COALESCE(p_idempotency_key, '')) BETWEEN 8 AND 180
    AND p_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND p_tool_args_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND p_contract_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'
$$;

CREATE OR REPLACE FUNCTION public._agent_action_call_payload(
  p_call public.agent_action_calls,
  p_disposition text,
  p_include_claim_token boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', p_disposition,
    'id', p_call.id,
    'state', p_call.state,
    'userId', p_call.user_id,
    'circleId', p_call.circle_id,
    'runId', p_call.run_id,
    'tool', p_call.tool_name,
    'toolUseId', p_call.tool_use_id,
    'actionId', p_call.action_id,
    'toolArgsFingerprint', p_call.tool_args_fingerprint,
    'contractFingerprint', p_call.contract_fingerprint,
    'idempotencyKey', p_call.idempotency_key,
    'claimedAt', p_call.claimed_at,
    'expiresAt', p_call.expires_at,
    'dispatchedAt', p_call.dispatched_at,
    'finishedAt', p_call.finished_at,
    'stateVersion', p_call.state_version,
    'attemptCount', p_call.attempt_count,
    'metadata', p_call.metadata
  ) || CASE
    WHEN p_include_claim_token
      THEN jsonb_build_object('claimToken', p_call.claim_token)
    ELSE '{}'::jsonb
  END
$$;

CREATE OR REPLACE FUNCTION public._agent_action_call_error(
  p_code text,
  p_message text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'ok', false,
    'code', left(regexp_replace(COALESCE(p_code, 'invalid_input'), '[[:cntrl:]]+', ' ', 'g'), 80),
    'message', left(regexp_replace(COALESCE(p_message, 'Durable action call refused.'), '[[:cntrl:]]+', ' ', 'g'), 240)
  )
$$;

REVOKE ALL ON FUNCTION public._sanitize_agent_action_call_metadata(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agent_action_call_identity_input_valid(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agent_action_call_payload(public.agent_action_calls, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agent_action_call_error(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_agent_action_call(
  p_user_id uuid,
  p_circle_id uuid,
  p_run_id uuid,
  p_tool_name text,
  p_tool_use_id text,
  p_action_id text,
  p_tool_args_fingerprint text,
  p_contract_fingerprint text,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_ttl_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_ttl_seconds integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 120), 15), 900);
  v_metadata jsonb := public._sanitize_agent_action_call_metadata(p_metadata);
  v_inserted boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN public._agent_action_call_error(
      'not_authenticated',
      'The durable action claim is not bound to the authenticated user.'
    );
  END IF;
  IF NOT public._agent_action_call_identity_input_valid(
    p_tool_name,
    p_tool_use_id,
    p_action_id,
    p_tool_args_fingerprint,
    p_contract_fingerprint,
    p_idempotency_key
  ) THEN
    RETURN public._agent_action_call_error(
      'invalid_input',
      'The durable action claim has an invalid exact-call identity or SHA-256 binding.'
    );
  END IF;
  PERFORM 1
  FROM public.agent_runs AS run
  WHERE run.id = p_run_id
    AND run.user_id = p_user_id
    AND run.circle_id = p_circle_id;
  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'run_identity_mismatch',
      'The durable action claim does not match the authenticated parent run.'
    );
  END IF;

  BEGIN
    INSERT INTO public.agent_action_calls (
      user_id,
      circle_id,
      run_id,
      tool_name,
      tool_use_id,
      action_id,
      tool_args_fingerprint,
      contract_fingerprint,
      idempotency_key,
      metadata,
      claimed_at,
      expires_at,
      updated_at
    )
    VALUES (
      p_user_id,
      p_circle_id,
      p_run_id,
      p_tool_name,
      p_tool_use_id,
      p_action_id,
      p_tool_args_fingerprint,
      p_contract_fingerprint,
      p_idempotency_key,
      v_metadata,
      v_now,
      v_now + make_interval(secs => v_ttl_seconds),
      v_now
    )
    ON CONFLICT (user_id, circle_id, idempotency_key) DO NOTHING
    RETURNING * INTO v_call;
    v_inserted := FOUND;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent call may have won the tool_use_id/action_id constraint.
    -- Resolve and compare that committed row below; never retry the insert.
    v_inserted := false;
  END;

  IF v_inserted THEN
    RETURN public._agent_action_call_payload(v_call, 'claimed', true);
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE (
      action_call.user_id = p_user_id
      AND action_call.circle_id = p_circle_id
      AND action_call.idempotency_key = p_idempotency_key
    )
    OR (
      action_call.run_id = p_run_id
      AND action_call.tool_use_id = p_tool_use_id
    )
    OR (
      action_call.run_id = p_run_id
      AND action_call.action_id = p_action_id
    )
  ORDER BY
    CASE
      WHEN action_call.user_id = p_user_id
        AND action_call.circle_id = p_circle_id
        AND action_call.idempotency_key = p_idempotency_key
      THEN 0
      ELSE 1
    END,
    action_call.claimed_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'identity_conflict',
      'A concurrent durable action identity conflict was detected; no dispatch is authorized.'
    );
  END IF;
  IF (
    v_call.user_id <> p_user_id
    OR v_call.circle_id <> p_circle_id
    OR v_call.run_id <> p_run_id
    OR v_call.tool_name <> p_tool_name
    OR v_call.tool_use_id <> p_tool_use_id
    OR v_call.action_id <> p_action_id
    OR v_call.tool_args_fingerprint <> p_tool_args_fingerprint
    OR v_call.contract_fingerprint <> p_contract_fingerprint
    OR v_call.idempotency_key <> p_idempotency_key
  ) THEN
    RETURN public._agent_action_call_error(
      'identity_conflict',
      'This tool call, action, or idempotency key is already bound to another durable identity.'
    );
  END IF;

  IF v_call.state = 'claimed' AND v_call.expires_at <= v_now THEN
    UPDATE public.agent_action_calls
    SET
      claim_token = gen_random_uuid(),
      metadata = v_call.metadata || v_metadata,
      state_version = state_version + 1,
      attempt_count = attempt_count + 1,
      claimed_at = v_now,
      expires_at = v_now + make_interval(secs => v_ttl_seconds),
      updated_at = v_now
    WHERE id = v_call.id
    RETURNING * INTO v_call;
    RETURN public._agent_action_call_payload(v_call, 'claimed', true);
  END IF;

  IF v_call.state = 'claimed' THEN
    RETURN public._agent_action_call_payload(v_call, 'already_claimed', true);
  END IF;
  RETURN public._agent_action_call_payload(v_call, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_agent_action_call(
  p_user_id uuid,
  p_circle_id uuid,
  p_run_id uuid,
  p_tool_name text,
  p_tool_use_id text,
  p_action_id text,
  p_tool_args_fingerprint text,
  p_contract_fingerprint text,
  p_idempotency_key text,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN public._agent_action_call_error(
      'not_authenticated',
      'The durable action start is not bound to the authenticated user.'
    );
  END IF;
  IF p_claim_token IS NULL OR NOT public._agent_action_call_identity_input_valid(
    p_tool_name,
    p_tool_use_id,
    p_action_id,
    p_tool_args_fingerprint,
    p_contract_fingerprint,
    p_idempotency_key
  ) THEN
    RETURN public._agent_action_call_error(
      'invalid_input',
      'The durable action start has an invalid claim token or exact-call identity.'
    );
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE action_call.user_id = p_user_id
    AND action_call.circle_id = p_circle_id
    AND action_call.run_id = p_run_id
    AND action_call.tool_name = p_tool_name
    AND action_call.tool_use_id = p_tool_use_id
    AND action_call.action_id = p_action_id
    AND action_call.tool_args_fingerprint = p_tool_args_fingerprint
    AND action_call.contract_fingerprint = p_contract_fingerprint
    AND action_call.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.agent_action_calls AS conflict
      WHERE (
          conflict.user_id = p_user_id
          AND conflict.circle_id = p_circle_id
          AND conflict.idempotency_key = p_idempotency_key
        )
        OR (conflict.run_id = p_run_id AND conflict.tool_use_id = p_tool_use_id)
        OR (conflict.run_id = p_run_id AND conflict.action_id = p_action_id)
    ) THEN
      RETURN public._agent_action_call_error(
        'identity_conflict',
        'The durable action start does not match the originally claimed identity.'
      );
    END IF;
    RETURN public._agent_action_call_error(
      'claim_not_found',
      'No durable claim exists for this exact action call.'
    );
  END IF;
  IF v_call.claim_token <> p_claim_token THEN
    RETURN public._agent_action_call_error(
      'claim_token_mismatch',
      'The durable action claim token does not match.'
    );
  END IF;
  IF v_call.state <> 'claimed' THEN
    RETURN public._agent_action_call_payload(v_call, 'duplicate', false);
  END IF;
  IF v_call.expires_at <= v_now THEN
    RETURN public._agent_action_call_error(
      'claim_expired',
      'The durable action claim expired before handler entry; claim the same exact call again.'
    );
  END IF;

  UPDATE public.agent_action_calls
  SET
    state = 'dispatched',
    state_version = state_version + 1,
    dispatched_at = v_now,
    expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
    updated_at = v_now
  WHERE id = v_call.id
    AND state = 'claimed'
    AND claim_token = p_claim_token
  RETURNING * INTO v_call;

  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'state_conflict',
      'Another worker changed the durable action state before handler entry.'
    );
  END IF;
  RETURN public._agent_action_call_payload(v_call, 'started', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_agent_action_call(
  p_user_id uuid,
  p_circle_id uuid,
  p_run_id uuid,
  p_tool_name text,
  p_tool_use_id text,
  p_action_id text,
  p_tool_args_fingerprint text,
  p_contract_fingerprint text,
  p_idempotency_key text,
  p_claim_token uuid,
  p_final_state text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_metadata jsonb := public._sanitize_agent_action_call_metadata(p_metadata);
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN public._agent_action_call_error(
      'not_authenticated',
      'The durable action finish is not bound to the authenticated user.'
    );
  END IF;
  IF (
    p_claim_token IS NULL
    OR p_final_state NOT IN ('verified', 'failed', 'outcome_unknown')
    OR NOT public._agent_action_call_identity_input_valid(
      p_tool_name,
      p_tool_use_id,
      p_action_id,
      p_tool_args_fingerprint,
      p_contract_fingerprint,
      p_idempotency_key
    )
  ) THEN
    RETURN public._agent_action_call_error(
      'invalid_input',
      'The durable action finish has an invalid state, claim token, or exact-call identity.'
    );
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE action_call.user_id = p_user_id
    AND action_call.circle_id = p_circle_id
    AND action_call.run_id = p_run_id
    AND action_call.tool_name = p_tool_name
    AND action_call.tool_use_id = p_tool_use_id
    AND action_call.action_id = p_action_id
    AND action_call.tool_args_fingerprint = p_tool_args_fingerprint
    AND action_call.contract_fingerprint = p_contract_fingerprint
    AND action_call.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'claim_not_found',
      'No durable claim exists for this exact action call.'
    );
  END IF;
  IF v_call.claim_token <> p_claim_token THEN
    RETURN public._agent_action_call_error(
      'claim_token_mismatch',
      'The durable action claim token does not match.'
    );
  END IF;
  IF v_call.state IN ('verified', 'failed', 'outcome_unknown') THEN
    IF v_call.state = p_final_state THEN
      RETURN public._agent_action_call_payload(v_call, 'already_finished', false);
    END IF;
    RETURN public._agent_action_call_error(
      'state_conflict',
      'The durable action already has a different terminal outcome.'
    );
  END IF;
  IF v_call.state = 'claimed' AND p_final_state <> 'failed' THEN
    RETURN public._agent_action_call_error(
      'invalid_transition',
      'Only a known pre-dispatch failure may finish an action that never started.'
    );
  END IF;
  -- Concurrent claimers can temporarily hold the same lease token. Once one
  -- worker wins start, a pre-handler loser must not overwrite its in-flight
  -- dispatched row with failed.
  IF v_call.state = 'dispatched' AND p_final_state = 'failed' THEN
    RETURN public._agent_action_call_error(
      'invalid_transition',
      'A dispatched action cannot become failed; record outcome_unknown unless fresh proof verifies it.'
    );
  END IF;
  IF v_call.state NOT IN ('claimed', 'dispatched') THEN
    RETURN public._agent_action_call_error(
      'invalid_transition',
      'The durable action is not in a finishable state.'
    );
  END IF;

  UPDATE public.agent_action_calls
  SET
    state = p_final_state,
    metadata = metadata || v_metadata,
    state_version = state_version + 1,
    finished_at = v_now,
    expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
    updated_at = v_now
  WHERE id = v_call.id
    AND claim_token = p_claim_token
    AND state = v_call.state
  RETURNING * INTO v_call;

  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'state_conflict',
      'Another worker changed the durable action outcome before finish.'
    );
  END IF;
  RETURN public._agent_action_call_payload(v_call, 'finished', false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, jsonb, integer
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finish_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, text, jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, jsonb, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, text, jsonb
) TO authenticated;

COMMENT ON TABLE public.agent_action_calls IS
  'Durable exact-call mutation claims. claimed is a handler-entry lease; failed is known pre-dispatch only; dispatched is irreversible handler entry; outcome_unknown must be verified before any retry.';
COMMENT ON COLUMN public.agent_action_calls.metadata IS
  'Primitive-only allowlisted redacted metadata. Raw args, selectors, URLs, paths, content, screenshots, credentials, and provider payloads are forbidden.';

NOTIFY pgrst, 'reload schema';
