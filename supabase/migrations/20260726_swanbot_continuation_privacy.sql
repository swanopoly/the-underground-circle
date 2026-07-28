-- SwanBot v2 continuation privacy sweeper
--
-- Continuation checkpoints can contain user text, local paths, tool arguments,
-- and tool results. Current SwanBot v2 stores only a bounded public envelope
-- plus an AES-256-GCM sealed snapshot in agent_runs.metadata.continuation.
-- This migration fails closed around that field:
--
--   1. Active legacy/plaintext, malformed/unsealed, state-incoherent, or
--      expired continuations are atomically closed and can never replay.
--   2. The continuation field is removed in the same compare-and-set update.
--   3. Durable outcome metadata is value-free and uses only stable enums.
--   4. Existing terminal legacy/plaintext checkpoints are scrubbed once when
--      this migration is applied.
--   5. pg_cron repeats the active-row sweep every three minutes when present.

-- Parse only the canonical ISO string emitted by Date#toISOString. Returning
-- NULL (never throwing) lets the validator and sweeper fail closed on hostile
-- or partially migrated JSON.
CREATE OR REPLACE FUNCTION public.parse_swanbot_continuation_timestamp(
  p_value text
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_timestamp timestamptz;
BEGIN
  IF p_value IS NULL
    OR p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  THEN
    RETURN NULL;
  END IF;

  v_timestamp := p_value::timestamptz;
  IF to_char(
    v_timestamp AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) IS DISTINCT FROM p_value
  THEN
    RETURN NULL;
  END IF;
  RETURN v_timestamp;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Validate only the public, value-free checkpoint envelope. Postgres does not
-- decrypt the snapshot, but it can reject plaintext/extra fields, malformed
-- identity/state/expiry metadata, and a structurally invalid crypto envelope.
CREATE OR REPLACE FUNCTION public.is_valid_swanbot_continuation_envelope(
  p_envelope jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_resume_state text;
  v_pending_count integer;
  v_paused_at timestamptz;
  v_expires_at timestamptz;
  v_snapshot jsonb;
  v_iv bytea;
  v_ciphertext bytea;
BEGIN
  IF p_envelope IS NULL OR jsonb_typeof(p_envelope) <> 'object' THEN
    RETURN false;
  END IF;

  IF NOT (
    p_envelope ?& ARRAY[
      'storageSchemaVersion',
      'encrypted',
      'continuationIdentity',
      'continuationVersion',
      'continuationNonce',
      'resumeState',
      'iter',
      'pendingTools',
      'pendingToolCount',
      'continuationCount',
      'pausedAt',
      'expiresAt',
      'snapshot'
    ]
  ) THEN
    RETURN false;
  END IF;

  -- No plaintext transcript/tool/result fields, nor unknown future fields, may
  -- hitch a ride beside the sealed snapshot.
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_envelope) AS envelope_key(key)
    WHERE NOT (
      envelope_key.key = ANY(ARRAY[
        'storageSchemaVersion',
        'encrypted',
        'continuationIdentity',
        'continuationVersion',
        'continuationNonce',
        'resumeState',
        'dispatchClaimId',
        'dispatchClaimedAt',
        'resumeClaimId',
        'resumeClaimedAt',
        'resumeLeaseExpiresAt',
        'iter',
        'pendingTools',
        'pendingToolCount',
        'continuationCount',
        'pausedAt',
        'expiresAt',
        'snapshot'
      ]::text[])
    )
  ) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_envelope->'storageSchemaVersion') <> 'number'
    OR p_envelope->>'storageSchemaVersion' <> '1'
    OR p_envelope->'encrypted' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(p_envelope->'continuationVersion') <> 'number'
    OR p_envelope->>'continuationVersion' <> '2'
    OR jsonb_typeof(p_envelope->'continuationIdentity') <> 'string'
    OR jsonb_typeof(p_envelope->'continuationNonce') <> 'string'
    OR (p_envelope->>'continuationIdentity')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR (p_envelope->>'continuationNonce')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RETURN false;
  END IF;

  v_resume_state := p_envelope->>'resumeState';
  IF jsonb_typeof(p_envelope->'resumeState') <> 'string'
    OR v_resume_state NOT IN ('pending', 'dispatch_claimed', 'results_claimed')
  THEN
    RETURN false;
  END IF;

  -- Claim fields are state-exact. A pending snapshot cannot smuggle a prior
  -- claim; a claimed snapshot cannot omit the authority that owns it.
  IF v_resume_state = 'pending' THEN
    IF p_envelope ?| ARRAY[
      'dispatchClaimId',
      'dispatchClaimedAt',
      'resumeClaimId',
      'resumeClaimedAt',
      'resumeLeaseExpiresAt'
    ] THEN
      RETURN false;
    END IF;
  ELSE
    IF NOT (p_envelope ?& ARRAY['dispatchClaimId', 'dispatchClaimedAt'])
      OR jsonb_typeof(p_envelope->'dispatchClaimId') <> 'string'
      OR (p_envelope->>'dispatchClaimId')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR public.parse_swanbot_continuation_timestamp(
        p_envelope->>'dispatchClaimedAt'
      ) IS NULL
    THEN
      RETURN false;
    END IF;
  END IF;

  IF v_resume_state = 'dispatch_claimed' THEN
    IF p_envelope ?| ARRAY[
      'resumeClaimId',
      'resumeClaimedAt',
      'resumeLeaseExpiresAt'
    ] THEN
      RETURN false;
    END IF;
  ELSIF v_resume_state = 'results_claimed' THEN
    IF NOT (
      p_envelope ?& ARRAY[
        'resumeClaimId',
        'resumeClaimedAt',
        'resumeLeaseExpiresAt'
      ]
    )
      OR jsonb_typeof(p_envelope->'resumeClaimId') <> 'string'
      OR (p_envelope->>'resumeClaimId')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR public.parse_swanbot_continuation_timestamp(
        p_envelope->>'resumeClaimedAt'
      ) IS NULL
      OR public.parse_swanbot_continuation_timestamp(
        p_envelope->>'resumeLeaseExpiresAt'
      ) IS NULL
      OR public.parse_swanbot_continuation_timestamp(
        p_envelope->>'resumeLeaseExpiresAt'
      ) <= public.parse_swanbot_continuation_timestamp(
        p_envelope->>'resumeClaimedAt'
      )
    THEN
      RETURN false;
    END IF;
  END IF;

  IF jsonb_typeof(p_envelope->'iter') <> 'number'
    OR (p_envelope->>'iter') !~ '^[1-9][0-9]*$'
    OR (p_envelope->>'iter')::numeric > 1000000
    OR jsonb_typeof(p_envelope->'continuationCount') <> 'number'
    OR (p_envelope->>'continuationCount') !~ '^(0|[1-9][0-9]*)$'
    OR (p_envelope->>'continuationCount')::numeric > 1000000
    OR jsonb_typeof(p_envelope->'pendingToolCount') <> 'number'
    OR (p_envelope->>'pendingToolCount') !~ '^(0|[1-9][0-9]*)$'
    OR jsonb_typeof(p_envelope->'pendingTools') <> 'array'
  THEN
    RETURN false;
  END IF;

  v_pending_count := (p_envelope->>'pendingToolCount')::integer;
  IF v_pending_count < 1
    OR v_pending_count > 40
    OR jsonb_array_length(p_envelope->'pendingTools') <> v_pending_count
  THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_envelope->'pendingTools')
      AS pending_tool(value)
    WHERE jsonb_typeof(pending_tool.value) <> 'object'
      OR NOT (pending_tool.value ?& ARRAY['id', 'name'])
      OR (
        SELECT count(*)
        FROM jsonb_object_keys(pending_tool.value)
      ) <> 2
      OR jsonb_typeof(pending_tool.value->'id') <> 'string'
      OR length(pending_tool.value->>'id') NOT BETWEEN 1 AND 200
      OR jsonb_typeof(pending_tool.value->'name') <> 'string'
      OR length(pending_tool.value->>'name') NOT BETWEEN 1 AND 180
      OR (pending_tool.value->>'name')
        !~ '^[A-Za-z][A-Za-z0-9_-]{0,79}(\.[A-Za-z0-9][A-Za-z0-9._:-]{0,99})?$'
  ) THEN
    RETURN false;
  END IF;

  IF (
    SELECT count(*) <> count(DISTINCT pending_tool.value->>'id')
    FROM jsonb_array_elements(p_envelope->'pendingTools')
      AS pending_tool(value)
  ) THEN
    RETURN false;
  END IF;

  v_paused_at := public.parse_swanbot_continuation_timestamp(
    p_envelope->>'pausedAt'
  );
  v_expires_at := public.parse_swanbot_continuation_timestamp(
    p_envelope->>'expiresAt'
  );
  IF v_paused_at IS NULL
    OR v_expires_at IS NULL
    OR v_expires_at IS DISTINCT FROM v_paused_at + interval '10 minutes'
  THEN
    RETURN false;
  END IF;

  v_snapshot := p_envelope->'snapshot';
  IF jsonb_typeof(v_snapshot) <> 'object'
    OR NOT (
      v_snapshot ?& ARRAY[
        'schemaVersion',
        'algorithm',
        'kdf',
        'keyVersion',
        'ivB64',
        'ciphertextB64'
      ]
    )
    OR (
      SELECT count(*)
      FROM jsonb_object_keys(v_snapshot)
    ) <> 6
    OR jsonb_typeof(v_snapshot->'schemaVersion') <> 'number'
    OR v_snapshot->>'schemaVersion' <> '1'
    OR v_snapshot->>'algorithm' <> 'AES-256-GCM'
    OR v_snapshot->>'kdf' <> 'SHA-256'
    OR jsonb_typeof(v_snapshot->'keyVersion') <> 'string'
    OR (v_snapshot->>'keyVersion') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    OR jsonb_typeof(v_snapshot->'ivB64') <> 'string'
    OR jsonb_typeof(v_snapshot->'ciphertextB64') <> 'string'
    OR length(v_snapshot->>'ivB64') <> 16
    OR (v_snapshot->>'ivB64') !~ '^[A-Za-z0-9+/]{16}$'
    OR length(v_snapshot->>'ciphertextB64') < 24
    OR length(v_snapshot->>'ciphertextB64') > 5592428
    OR length(v_snapshot->>'ciphertextB64') % 4 <> 0
    OR (v_snapshot->>'ciphertextB64') !~ '^[A-Za-z0-9+/]+={0,2}$'
  THEN
    RETURN false;
  END IF;

  v_iv := decode(v_snapshot->>'ivB64', 'base64');
  v_ciphertext := decode(v_snapshot->>'ciphertextB64', 'base64');
  IF octet_length(v_iv) <> 12
    OR translate(encode(v_iv, 'base64'), E'\n\r\t ', '')
      <> v_snapshot->>'ivB64'
    OR octet_length(v_ciphertext) < 16
    OR octet_length(v_ciphertext) > 4194320
    OR translate(encode(v_ciphertext, 'base64'), E'\n\r\t ', '')
      <> v_snapshot->>'ciphertextB64'
  THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_unsafe_swanbot_continuations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_swept_at timestamptz := clock_timestamp();
  v_swept_count integer := 0;
BEGIN
  WITH candidates AS MATERIALIZED (
    SELECT
      run_row.id,
      run_row.final_stop_reason,
      run_row.metadata->'continuation' AS continuation,
      CASE
        WHEN NOT (run_row.metadata ? 'continuation')
          THEN 'continuation_checkpoint_missing'
        WHEN jsonb_typeof(run_row.metadata->'continuation') <> 'object'
          OR run_row.metadata->'continuation'->'encrypted'
            IS DISTINCT FROM 'true'::jsonb
          THEN 'continuation_checkpoint_legacy_or_unsealed'
        WHEN NOT public.is_valid_swanbot_continuation_envelope(
          run_row.metadata->'continuation'
        )
          THEN 'continuation_checkpoint_malformed'
        WHEN public.parse_swanbot_continuation_timestamp(
          run_row.metadata->'continuation'->>'expiresAt'
        ) <= v_swept_at
          THEN 'continuation_checkpoint_expired'
        ELSE 'continuation_checkpoint_state_mismatch'
      END AS close_reason
    FROM public.agent_runs AS run_row
    WHERE run_row.status = 'running'
      AND run_row.metadata->>'version' = 'swanbot-v2-ai'
      AND run_row.final_stop_reason IN (
        'client_pending',
        'client_dispatching',
        'client_resuming'
      )
      AND (
        NOT (run_row.metadata ? 'continuation')
        OR NOT public.is_valid_swanbot_continuation_envelope(
          run_row.metadata->'continuation'
        )
        OR public.parse_swanbot_continuation_timestamp(
          run_row.metadata->'continuation'->>'expiresAt'
        ) <= v_swept_at
        OR run_row.final_stop_reason IS DISTINCT FROM CASE
          WHEN run_row.metadata->'continuation'->>'resumeState' = 'pending'
            THEN 'client_pending'
          WHEN run_row.metadata->'continuation'->>'resumeState' = 'dispatch_claimed'
            THEN 'client_dispatching'
          WHEN run_row.metadata->'continuation'->>'resumeState' = 'results_claimed'
            THEN 'client_resuming'
          ELSE NULL
        END
      )
  ),
  closed AS (
    UPDATE public.agent_runs AS run_row
    SET status = 'failed',
        final_stop_reason = 'error',
        completed_at = v_swept_at,
        updated_at = v_swept_at,
        metadata = (
          CASE
            WHEN jsonb_typeof(run_row.metadata) = 'object'
              THEN run_row.metadata
            ELSE '{}'::jsonb
          END
          - ARRAY['continuation', 'continuationResumeOutcome']::text[]
        ) || jsonb_build_object(
          'version', 'swanbot-v2-ai',
          'continuationResumeOutcome', jsonb_build_object(
            'schemaVersion', 1,
            'status', CASE
              WHEN candidate.final_stop_reason = 'client_pending'
                THEN 'failed_before_dispatch'
              ELSE 'outcome_unknown'
            END,
            'reason', candidate.close_reason,
            'replayAllowed', false
          )
        )
    FROM candidates AS candidate
    WHERE run_row.id = candidate.id
      AND run_row.status = 'running'
      AND run_row.final_stop_reason = candidate.final_stop_reason
      AND run_row.metadata->>'version' = 'swanbot-v2-ai'
      AND run_row.metadata->'continuation'
        IS NOT DISTINCT FROM candidate.continuation
    RETURNING run_row.id
  )
  SELECT count(*)::integer
  INTO v_swept_count
  FROM closed;

  RETURN v_swept_count;
END;
$$;

REVOKE ALL ON FUNCTION public.parse_swanbot_continuation_timestamp(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_valid_swanbot_continuation_envelope(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_unsafe_swanbot_continuations()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_unsafe_swanbot_continuations()
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_agent_runs_active_swanbot_continuation
  ON public.agent_runs (updated_at)
  WHERE status = 'running'
    AND final_stop_reason IN (
      'client_pending',
      'client_dispatching',
      'client_resuming'
    )
    AND metadata->>'version' = 'swanbot-v2-ai';

-- One-time active cleanup. This uses the same atomic status/metadata CAS as the
-- scheduled job, so a concurrent continuation claim cannot be overwritten.
SELECT public.sweep_unsafe_swanbot_continuations();

-- One-time privacy scrub for every checkpoint on a terminal/non-active row.
-- Terminal work can never resume, so even a valid ciphertext is unnecessary
-- retained data. Historical run status is kept; only the checkpoint is removed.
UPDATE public.agent_runs AS run_row
SET metadata = (
      run_row.metadata
      - ARRAY['continuation', 'continuationResumeOutcome']::text[]
    ) || jsonb_build_object(
      'continuationResumeOutcome', jsonb_build_object(
        'schemaVersion', 1,
        'status', 'checkpoint_scrubbed',
        'reason', CASE
          WHEN jsonb_typeof(run_row.metadata->'continuation') <> 'object'
            OR run_row.metadata->'continuation'->'encrypted'
              IS DISTINCT FROM 'true'::jsonb
            THEN 'continuation_checkpoint_legacy_or_unsealed'
          WHEN public.is_valid_swanbot_continuation_envelope(
            run_row.metadata->'continuation'
          )
            THEN 'continuation_checkpoint_terminal_scrub'
          ELSE 'continuation_checkpoint_malformed'
        END,
        'replayAllowed', false
      )
    ),
    updated_at = clock_timestamp()
WHERE run_row.metadata->>'version' = 'swanbot-v2-ai'
  AND run_row.metadata ? 'continuation'
  AND NOT (
    run_row.status = 'running'
    AND run_row.final_stop_reason IN (
      'client_pending',
      'client_dispatching',
      'client_resuming'
    )
  );

-- Authenticated clients may read their normal RLS-visible run telemetry, but
-- they are never execution authority for a sealed SwanBot v2 checkpoint.
-- Without this trigger, the historical FOR ALL member policy on agent_runs
-- lets a member copy ciphertext to another row or rewrite the continuation
-- state outside the service-role edge function's compare-and-set protocol.
CREATE OR REPLACE FUNCTION public.is_protected_swanbot_v2_continuation_run(
  p_status text,
  p_final_stop_reason text,
  p_metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    p_metadata ? 'continuation'
    OR (
      p_metadata->>'version' = 'swanbot-v2-ai'
      AND p_status = 'running'
      AND p_final_stop_reason IN (
        'client_pending',
        'client_dispatching',
        'client_resuming'
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_swanbot_v2_continuation_run()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_protected boolean := false;
  v_new_protected boolean := false;
  v_cancelled_at timestamptz;
  v_trusted_writer boolean :=
    COALESCE(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin');
BEGIN
  IF v_trusted_writer THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Keep the predicate helper private without making ordinary authenticated
  -- writes depend on EXECUTE permission for a nested function. The guard is a
  -- security-invoker trigger, so calling the revoked helper here would turn
  -- every agent_runs write into a permission error, including unrelated rows.
  IF TG_OP <> 'INSERT' THEN
    v_old_protected := COALESCE(
      OLD.metadata ? 'continuation'
      OR (
        OLD.metadata->>'version' = 'swanbot-v2-ai'
        AND OLD.status = 'running'
        AND OLD.final_stop_reason IN (
          'client_pending',
          'client_dispatching',
          'client_resuming'
        )
      ),
      false
    );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_protected := COALESCE(
      NEW.metadata ? 'continuation'
      OR (
        NEW.metadata->>'version' = 'swanbot-v2-ai'
        AND NEW.status = 'running'
        AND NEW.final_stop_reason IN (
          'client_pending',
          'client_dispatching',
          'client_resuming'
        )
      ),
      false
    );
  END IF;

  IF TG_OP = 'INSERT' AND v_new_protected THEN
    RAISE EXCEPTION 'swanbot_v2_continuation_clone_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' AND v_old_protected THEN
    RAISE EXCEPTION 'swanbot_v2_continuation_delete_forbidden'
      USING ERRCODE = '42501';
  END IF;

  -- Preserve the existing two-write STOP UI without granting execution-state
  -- authority. Only the exact owning user may perform running -> cancelled,
  -- and the first write may change only status plus its two terminal timestamps.
  -- In particular, the sealed continuation, claim ids, owner, circle, and every
  -- other metadata/row field must remain byte-identical.
  IF TG_OP = 'UPDATE'
    AND v_old_protected
    AND v_new_protected
    AND OLD.status = 'running'
    AND NEW.status = 'cancelled'
    AND auth.uid() IS NOT NULL
    AND auth.uid() = OLD.user_id
    AND NEW.completed_at IS NOT NULL
    AND NEW.updated_at IS NOT NULL
    AND NEW.completed_at IS DISTINCT FROM OLD.completed_at
    AND NEW.updated_at IS DISTINCT FROM OLD.updated_at
    AND (
      to_jsonb(NEW)
      - ARRAY['status', 'completed_at', 'updated_at']::text[]
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD)
      - ARRAY['status', 'completed_at', 'updated_at']::text[]
    )
  THEN
    RETURN NEW;
  END IF;

  -- The UI follows STOP with one provenance-only metadata merge. Permit it only
  -- once, only for the same owner, and only while every non-provenance field
  -- (including metadata.continuation) remains exact. This is deliberately not a
  -- general metadata escape hatch on protected rows.
  IF TG_OP = 'UPDATE'
    AND v_old_protected
    AND v_new_protected
    AND OLD.status = 'cancelled'
    AND NEW.status = 'cancelled'
    AND auth.uid() IS NOT NULL
    AND auth.uid() = OLD.user_id
    AND NEW.updated_at IS NOT NULL
    AND NEW.updated_at IS DISTINCT FROM OLD.updated_at
    AND (OLD.metadata ? 'cancelled_by') IS NOT TRUE
    AND (OLD.metadata ? 'cancelled_at') IS NOT TRUE
    AND (OLD.metadata ? 'cancelled_from') IS NOT TRUE
    AND jsonb_typeof(NEW.metadata->'cancelled_by') = 'string'
    AND NEW.metadata->>'cancelled_by' = 'user'
    AND jsonb_typeof(NEW.metadata->'cancelled_at') = 'string'
    AND length(NEW.metadata->>'cancelled_at') = 24
    AND NEW.metadata->>'cancelled_at'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND (
      NOT (NEW.metadata ? 'cancelled_from')
      OR (
        jsonb_typeof(NEW.metadata->'cancelled_from') = 'string'
        AND NEW.metadata->>'cancelled_from' = 'recent_runs_panel'
      )
    )
    AND (
      to_jsonb(NEW)
      - ARRAY['metadata', 'updated_at']::text[]
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD)
      - ARRAY['metadata', 'updated_at']::text[]
    )
    AND (
      NEW.metadata
      - ARRAY['cancelled_by', 'cancelled_at', 'cancelled_from']::text[]
    ) IS NOT DISTINCT FROM (
      OLD.metadata
      - ARRAY['cancelled_by', 'cancelled_at', 'cancelled_from']::text[]
    )
  THEN
    BEGIN
      v_cancelled_at := (NEW.metadata->>'cancelled_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'swanbot_v2_continuation_cancel_provenance_forbidden'
        USING ERRCODE = '42501';
    END;
    IF to_char(
      v_cancelled_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) IS DISTINCT FROM NEW.metadata->>'cancelled_at'
    THEN
      RAISE EXCEPTION 'swanbot_v2_continuation_cancel_provenance_forbidden'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND (v_old_protected OR v_new_protected)
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'swanbot_v2_continuation_rewrite_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_swanbot_v2_continuation_run
  ON public.agent_runs;
CREATE TRIGGER trg_guard_swanbot_v2_continuation_run
BEFORE INSERT OR UPDATE OR DELETE ON public.agent_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_swanbot_v2_continuation_run();

REVOKE ALL ON FUNCTION public.is_protected_swanbot_v2_continuation_run(
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_swanbot_v2_continuation_run()
  FROM PUBLIC, anon, authenticated;

-- pg_cron is optional in local/self-hosted environments. Unschedule first so
-- rerunning the migration never stacks duplicate jobs.
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable; run sweep_unsafe_swanbot_continuations() manually';
  ELSE
    BEGIN
      EXECUTE
        'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1'
        USING 'sweep-unsafe-swanbot-continuations';
      EXECUTE
        'SELECT cron.schedule($1, $2, $3)'
        USING
          'sweep-unsafe-swanbot-continuations',
          '*/3 * * * *',
          'SELECT public.sweep_unsafe_swanbot_continuations()';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron unavailable; run sweep_unsafe_swanbot_continuations() manually';
    END;
  END IF;
END;
$cron$;

COMMENT ON FUNCTION public.sweep_unsafe_swanbot_continuations() IS
  'Service-only privacy/no-replay sweeper for unsafe or expired SwanBot v2 continuation checkpoints.';
COMMENT ON FUNCTION public.guard_swanbot_v2_continuation_run() IS
  'Prevents authenticated clients from cloning, deleting, or rewriting protected SwanBot v2 continuation execution state.';

NOTIFY pgrst, 'reload schema';
