-- Universal Computer Task Roots (V1)
--
-- One authenticated, request-bound root is admitted before planning,
-- approval, bridge preparation, or provider execution. The row is
-- coordination state only: it never authorizes a mutation. Every actual
-- side effect still needs its exact tool policy plus agent_action_calls (or a
-- provider idempotency contract), and every task completion still needs an
-- independently validated acceptance receipt.

BEGIN;

DO $dependency$
BEGIN
  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'undefined_function',
      MESSAGE = 'Universal computer-task roots require pgcrypto digest(bytea,text) in the extensions schema.';
  END IF;
END;
$dependency$;

CREATE TABLE IF NOT EXISTS public.computer_task_roots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE
    REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL
    REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id uuid
    REFERENCES public.circle_chat_threads(id) ON DELETE RESTRICT,
  schema_version integer NOT NULL DEFAULT 1
    CHECK (schema_version = 1),
  root_fingerprint text NOT NULL
    CHECK (root_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'),
  request_identity_fingerprint text NOT NULL
    CHECK (request_identity_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'),
  task_fingerprint text NOT NULL
    CHECK (task_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'admitted'
    CHECK (state IN (
      'admitted',
      'running',
      'waiting_approval',
      'waiting_input',
      'paused',
      'verification_only',
      'completed',
      'failed',
      'cancelled'
    )),
  replay_policy text NOT NULL DEFAULT 'normal'
    CHECK (replay_policy IN ('normal', 'verification_only', 'terminal')),
  revision integer NOT NULL DEFAULT 0
    CHECK (revision BETWEEN 0 AND 2147483647),
  root_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  UNIQUE (user_id, circle_id, request_identity_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_computer_task_roots_circle_updated
  ON public.computer_task_roots(circle_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_computer_task_roots_active
  ON public.computer_task_roots(user_id, circle_id, updated_at DESC)
  WHERE state NOT IN ('completed', 'failed', 'cancelled');

ALTER TABLE public.computer_task_roots ENABLE ROW LEVEL SECURITY;

-- The request fingerprint includes the exact Chat thread. Letting PostgreSQL
-- null that binding would leave an apparently readable root whose immutable
-- snapshot no longer matches its row. Preserve the audit scope instead.
ALTER TABLE public.computer_task_roots
  DROP CONSTRAINT IF EXISTS computer_task_roots_thread_id_fkey;
ALTER TABLE public.computer_task_roots
  ADD CONSTRAINT computer_task_roots_thread_id_fkey
  FOREIGN KEY (thread_id)
  REFERENCES public.circle_chat_threads(id)
  ON DELETE RESTRICT;

DROP POLICY IF EXISTS computer_task_roots_select_exact_actor
  ON public.computer_task_roots;

CREATE POLICY computer_task_roots_select_exact_actor
  ON public.computer_task_roots
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = computer_task_roots.circle_id
        AND member.user_id = auth.uid()
    )
    AND (
      thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = computer_task_roots.thread_id
          AND thread.circle_id = computer_task_roots.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = auth.uid()
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = auth.uid()
            )
          )
      )
    )
  );

REVOKE ALL ON TABLE public.computer_task_roots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.computer_task_roots TO authenticated;

-- agent_runs historically allows every circle member to update/delete every
-- wrapper row. A computer-task wrapper is coordination state owned by the
-- exact authenticated actor and must only be changed by the SECURITY DEFINER
-- root RPCs. Restrictive policies compose with the legacy permissive policy.
CREATE OR REPLACE FUNCTION public.is_computer_task_root_run_v1(
  p_run_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.computer_task_roots AS root
    WHERE root.run_id = p_run_id
  );
$function$;

REVOKE ALL ON FUNCTION public.is_computer_task_root_run_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_computer_task_root_run_v1(uuid)
  TO authenticated;

DROP POLICY IF EXISTS agent_runs_computer_task_root_update_guard
  ON public.agent_runs;
CREATE POLICY agent_runs_computer_task_root_update_guard
  ON public.agent_runs
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (NOT public.is_computer_task_root_run_v1(id))
  WITH CHECK (NOT public.is_computer_task_root_run_v1(id));

DROP POLICY IF EXISTS agent_runs_computer_task_root_delete_guard
  ON public.agent_runs;
CREATE POLICY agent_runs_computer_task_root_delete_guard
  ON public.agent_runs
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (NOT public.is_computer_task_root_run_v1(id));

CREATE OR REPLACE FUNCTION public.is_valid_computer_task_root_timestamp_v1(
  p_value text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_value IS NULL OR p_value !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  THEN
    RETURN false;
  END IF;

  PERFORM p_value::timestamptz;
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_valid_computer_task_root_timestamp_v1(text)
  FROM PUBLIC, anon, authenticated;

-- Match the key-sorted JSON serialization used by
-- buildComputerAppToolArgsFingerprintAsync. Root identity payloads contain
-- only bounded ASCII keys/values, booleans, integers, arrays, and JSON null.
CREATE OR REPLACE FUNCTION public.computer_task_root_canonical_json_v1(
  p_value jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_type text := jsonb_typeof(p_value);
  v_result text;
BEGIN
  IF v_type = 'object' THEN
    SELECT '{' || COALESCE(string_agg(
      to_jsonb(entry.key)::text || ':' ||
        public.computer_task_root_canonical_json_v1(entry.value),
      ',' ORDER BY entry.key COLLATE "C"
    ), '') || '}'
    INTO v_result
    FROM jsonb_each(p_value) AS entry(key, value);
    RETURN v_result;
  END IF;

  IF v_type = 'array' THEN
    SELECT '[' || COALESCE(string_agg(
      public.computer_task_root_canonical_json_v1(entry.value),
      ',' ORDER BY entry.ordinal
    ), '') || ']'
    INTO v_result
    FROM jsonb_array_elements(p_value)
      WITH ORDINALITY AS entry(value, ordinal);
    RETURN v_result;
  END IF;

  RETURN p_value::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.computer_task_root_fingerprint_v1(
  p_value jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT 'args-v2:sha256:' || encode(
    extensions.digest(
      convert_to(
        public.computer_task_root_canonical_json_v1(p_value),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

REVOKE ALL ON FUNCTION public.computer_task_root_canonical_json_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.computer_task_root_fingerprint_v1(jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_valid_computer_task_root_nested_v1(
  p_snapshot jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_created_at text := p_snapshot->>'createdAt';
  v_updated_at text := p_snapshot->>'updatedAt';
  v_entry jsonb;
  v_index integer;
  v_length integer;
  v_attempt_ids text[] := ARRAY[]::text[];
  v_active_attempt_count integer := 0;
  v_checkpoint_ids text[] := ARRAY[]::text[];
  v_last_checkpoint_at text := NULL;
  v_acceptance jsonb := p_snapshot->'acceptance';
  v_acceptance_attempt_id text := NULL;
  v_acceptance_bound_at text := NULL;
  v_predicate_ids text[] := ARRAY[]::text[];
  v_action_ids text[] := ARRAY[]::text[];
  v_action_state text;
  v_action_id text;
  v_action_frontier_seen boolean := false;
  v_action_manifest jsonb;
  v_action_manifests jsonb := '[]'::jsonb;
  v_dispatch_binding jsonb;
  v_lease jsonb := p_snapshot->'foregroundLease';
  v_latch jsonb := p_snapshot->'interruptLatch';
BEGIN
  IF jsonb_typeof(p_snapshot) <> 'object'
    OR NOT public.is_valid_computer_task_root_timestamp_v1(v_created_at)
    OR NOT public.is_valid_computer_task_root_timestamp_v1(v_updated_at)
    OR jsonb_typeof(p_snapshot->'attempts') <> 'array'
    OR jsonb_typeof(p_snapshot->'checkpoints') <> 'array'
  THEN
    RETURN false;
  END IF;

  v_length := jsonb_array_length(p_snapshot->'attempts');
  IF v_length > 64 THEN
    RETURN false;
  END IF;
  IF v_length > 0 THEN
    FOR v_index IN 0..v_length - 1 LOOP
      v_entry := p_snapshot->'attempts'->v_index;
      IF jsonb_typeof(v_entry) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(v_entry)) <> 7
        OR (v_entry - ARRAY[
          'attemptId', 'index', 'kind', 'parentAttemptId', 'state',
          'startedAt', 'finishedAt'
        ]) <> '{}'::jsonb
        OR COALESCE(v_entry->>'attemptId', '')
          !~ '^computer_attempt_[0-9a-f]{64}$'
        OR v_entry->>'attemptId' <> 'computer_attempt_' || substring(
          public.computer_task_root_fingerprint_v1(jsonb_build_object(
            'schemaVersion', 1,
            'namespace', 'computer_task_attempt',
            'rootFingerprint', p_snapshot->>'rootFingerprint',
            'index', v_index,
            'kind', v_entry->>'kind',
            'parentAttemptId', v_entry->'parentAttemptId'
          )) FROM 16
        )
        OR v_entry->>'attemptId' = ANY(v_attempt_ids)
        OR jsonb_typeof(v_entry->'index') <> 'number'
        OR COALESCE(v_entry->>'index', '') !~ '^[0-9]{1,10}$'
        OR COALESCE(v_entry->>'kind', '') NOT IN (
          'deterministic', 'provider', 'compiler', 'connected_agent',
          'capability_buildout', 'recovery'
        )
        OR COALESCE(v_entry->>'state', '') NOT IN (
          'active', 'completed', 'failed', 'cancelled'
        )
        OR NOT public.is_valid_computer_task_root_timestamp_v1(
          v_entry->>'startedAt'
        )
        OR v_entry->>'startedAt' < v_created_at
        OR v_entry->>'startedAt' > v_updated_at
      THEN
        RETURN false;
      END IF;
      IF (v_entry->>'index')::bigint <> v_index THEN
        RETURN false;
      END IF;
      IF v_entry->'parentAttemptId' <> 'null'::jsonb
        AND (
          COALESCE(v_entry->>'parentAttemptId', '')
            !~ '^computer_attempt_[0-9a-f]{64}$'
          OR NOT (v_entry->>'parentAttemptId' = ANY(v_attempt_ids))
        )
      THEN
        RETURN false;
      END IF;
      IF v_entry->>'state' = 'active' THEN
        IF v_entry->'finishedAt' <> 'null'::jsonb THEN
          RETURN false;
        END IF;
        v_active_attempt_count := v_active_attempt_count + 1;
        IF v_active_attempt_count > 1 THEN
          RETURN false;
        END IF;
      ELSE
        IF NOT public.is_valid_computer_task_root_timestamp_v1(
            v_entry->>'finishedAt'
          )
          OR v_entry->>'finishedAt' < v_entry->>'startedAt'
          OR v_entry->>'finishedAt' > v_updated_at
        THEN
          RETURN false;
        END IF;
      END IF;
      v_attempt_ids := array_append(v_attempt_ids, v_entry->>'attemptId');
    END LOOP;
  END IF;

  v_length := jsonb_array_length(p_snapshot->'checkpoints');
  IF v_length > 256 THEN
    RETURN false;
  END IF;
  IF v_length > 0 THEN
    FOR v_index IN 0..v_length - 1 LOOP
      v_entry := p_snapshot->'checkpoints'->v_index;
      IF jsonb_typeof(v_entry) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(v_entry)) <> 7
        OR (v_entry - ARRAY[
          'checkpointId', 'sequence', 'attemptId', 'kind', 'rootState',
          'recordedAt', 'evidenceFingerprint'
        ]) <> '{}'::jsonb
        OR COALESCE(v_entry->>'checkpointId', '')
          !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,239}$'
        OR v_entry->>'checkpointId' = ANY(v_checkpoint_ids)
        OR jsonb_typeof(v_entry->'sequence') <> 'number'
        OR COALESCE(v_entry->>'sequence', '') !~ '^[0-9]{1,10}$'
        OR COALESCE(v_entry->>'kind', '') NOT IN (
          'plan', 'observation', 'approval', 'action', 'verification',
          'recovery', 'terminal'
        )
        OR COALESCE(v_entry->>'rootState', '') NOT IN (
          'admitted', 'running', 'waiting_approval', 'waiting_input',
          'paused', 'verification_only', 'completed', 'failed', 'cancelled'
        )
        OR NOT public.is_valid_computer_task_root_timestamp_v1(
          v_entry->>'recordedAt'
        )
        OR v_entry->>'recordedAt' < v_created_at
        OR v_entry->>'recordedAt' > v_updated_at
        OR (
          v_last_checkpoint_at IS NOT NULL
          AND v_entry->>'recordedAt' < v_last_checkpoint_at
        )
      THEN
        RETURN false;
      END IF;
      IF (v_entry->>'sequence')::bigint <> v_index + 1 THEN
        RETURN false;
      END IF;
      IF v_entry->'attemptId' <> 'null'::jsonb
        AND (
          COALESCE(v_entry->>'attemptId', '')
            !~ '^computer_attempt_[0-9a-f]{64}$'
          OR NOT (v_entry->>'attemptId' = ANY(v_attempt_ids))
        )
      THEN
        RETURN false;
      END IF;
      IF v_entry->'evidenceFingerprint' <> 'null'::jsonb
        AND COALESCE(v_entry->>'evidenceFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
      THEN
        RETURN false;
      END IF;
      v_checkpoint_ids := array_append(
        v_checkpoint_ids,
        v_entry->>'checkpointId'
      );
      v_last_checkpoint_at := v_entry->>'recordedAt';
    END LOOP;
  END IF;

  IF v_acceptance <> 'null'::jsonb THEN
    IF jsonb_typeof(v_acceptance) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_acceptance)) <> 6
      OR (v_acceptance - ARRAY[
        'schemaVersion', 'acceptanceFingerprint', 'attemptId', 'boundAt',
        'predicateFingerprints', 'actions'
      ]) <> '{}'::jsonb
      OR jsonb_typeof(v_acceptance->'schemaVersion') <> 'number'
      OR v_acceptance->>'schemaVersion' <> '1'
      OR COALESCE(v_acceptance->>'acceptanceFingerprint', '')
        !~ '^args-v2:sha256:[0-9a-f]{64}$'
      OR COALESCE(v_acceptance->>'attemptId', '')
        !~ '^computer_attempt_[0-9a-f]{64}$'
      OR NOT (v_acceptance->>'attemptId' = ANY(v_attempt_ids))
      OR NOT public.is_valid_computer_task_root_timestamp_v1(
        v_acceptance->>'boundAt'
      )
      OR v_acceptance->>'boundAt' < v_created_at
      OR v_acceptance->>'boundAt' > v_updated_at
      OR jsonb_typeof(v_acceptance->'predicateFingerprints') <> 'array'
      OR jsonb_array_length(v_acceptance->'predicateFingerprints') NOT BETWEEN 1 AND 64
      OR jsonb_typeof(v_acceptance->'actions') <> 'array'
      OR jsonb_array_length(v_acceptance->'actions') NOT BETWEEN 1 AND 128
    THEN
      RETURN false;
    END IF;
    v_acceptance_attempt_id := v_acceptance->>'attemptId';
    v_acceptance_bound_at := v_acceptance->>'boundAt';

    v_length := jsonb_array_length(v_acceptance->'predicateFingerprints');
    FOR v_index IN 0..v_length - 1 LOOP
      v_entry := v_acceptance->'predicateFingerprints'->v_index;
      IF jsonb_typeof(v_entry) <> 'string'
        OR trim(BOTH '"' FROM v_entry::text)
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        OR trim(BOTH '"' FROM v_entry::text) = ANY(v_predicate_ids)
      THEN
        RETURN false;
      END IF;
      v_predicate_ids := array_append(
        v_predicate_ids,
        trim(BOTH '"' FROM v_entry::text)
      );
    END LOOP;

    v_length := jsonb_array_length(v_acceptance->'actions');
    FOR v_index IN 0..v_length - 1 LOOP
      v_entry := v_acceptance->'actions'->v_index;
      v_action_manifest := jsonb_build_object(
        'actionId', v_entry->>'actionId',
        'index', v_index,
        'attemptId', v_acceptance_attempt_id,
        'tool', v_entry->>'tool',
        'toolArgsFingerprint', v_entry->>'toolArgsFingerprint',
        'authorizationFingerprint', v_entry->>'authorizationFingerprint',
        'idempotencyKey', v_entry->>'idempotencyKey',
        'mutatesState', v_entry->'mutatesState',
        'requiresForegroundLease', v_entry->'requiresForegroundLease'
      );
      IF jsonb_typeof(v_entry) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(v_entry)) <> 14
        OR (v_entry - ARRAY[
          'actionId', 'index', 'attemptId', 'tool', 'toolArgsFingerprint',
          'authorizationFingerprint', 'idempotencyKey', 'mutatesState',
          'requiresForegroundLease', 'acceptanceBindingFingerprint', 'state',
          'proofFingerprint', 'dispatchBinding', 'updatedAt'
        ]) <> '{}'::jsonb
        OR COALESCE(v_entry->>'actionId', '')
          !~ '^computer_action_[0-9a-f]{64}$'
        OR v_entry->>'actionId' <> 'computer_action_' || substring(
          public.computer_task_root_fingerprint_v1(jsonb_build_object(
            'schemaVersion', 1,
            'namespace', 'computer_task_child_action',
            'rootFingerprint', p_snapshot->>'rootFingerprint',
            'attemptId', v_acceptance_attempt_id,
            'index', v_index,
            'tool', v_entry->>'tool',
            'toolArgsFingerprint', v_entry->>'toolArgsFingerprint',
            'authorizationFingerprint',
              v_entry->>'authorizationFingerprint'
          )) FROM 16
        )
        OR v_entry->>'actionId' = ANY(v_action_ids)
        OR jsonb_typeof(v_entry->'index') <> 'number'
        OR COALESCE(v_entry->>'index', '') !~ '^[0-9]{1,10}$'
        OR v_entry->>'attemptId' <> v_acceptance_attempt_id
        OR COALESCE(v_entry->>'tool', '')
          !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
        OR COALESCE(v_entry->>'toolArgsFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        OR COALESCE(v_entry->>'authorizationFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        OR COALESCE(v_entry->>'idempotencyKey', '')
          !~ '^computer-task\.[0-9a-f]{64}$'
        OR v_entry->>'idempotencyKey' <> 'computer-task.' || substring(
          public.computer_task_root_fingerprint_v1(jsonb_build_object(
            'schemaVersion', 1,
            'namespace', 'computer_task_action_idempotency',
            'rootFingerprint', p_snapshot->>'rootFingerprint',
            'actionId', v_entry->>'actionId'
          )) FROM 16
        )
        OR jsonb_typeof(v_entry->'mutatesState') <> 'boolean'
        OR jsonb_typeof(v_entry->'requiresForegroundLease') <> 'boolean'
        OR COALESCE(v_entry->>'acceptanceBindingFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        OR v_entry->>'acceptanceBindingFingerprint' <>
          public.computer_task_root_fingerprint_v1(jsonb_build_object(
            'schemaVersion', 1,
            'namespace', 'computer_task_action_acceptance_binding',
            'rootFingerprint', p_snapshot->>'rootFingerprint',
            'acceptanceFingerprint',
              v_acceptance->>'acceptanceFingerprint',
            'action', v_action_manifest
          ))
        OR COALESCE(v_entry->>'state', '') NOT IN (
          'planned', 'claimed', 'dispatched', 'verified', 'failed',
          'outcome_unknown'
        )
        OR NOT public.is_valid_computer_task_root_timestamp_v1(
          v_entry->>'updatedAt'
        )
        OR v_entry->>'updatedAt' < v_acceptance_bound_at
        OR v_entry->>'updatedAt' > v_updated_at
      THEN
        RETURN false;
      END IF;
      v_action_manifests := v_action_manifests ||
        jsonb_build_array(v_action_manifest);
      v_dispatch_binding := v_entry->'dispatchBinding';
      IF v_dispatch_binding <> 'null'::jsonb THEN
        IF jsonb_typeof(v_dispatch_binding) <> 'object'
          OR (
            SELECT count(*)
            FROM jsonb_object_keys(v_dispatch_binding)
          ) <> 9
          OR (v_dispatch_binding - ARRAY[
            'schemaVersion', 'source', 'callIdentityFingerprint',
            'authorizationCategory', 'mutationAuthority',
            'policyBindingFingerprint', 'verifierBindingFingerprint',
            'replayBindingFingerprint', 'boundAt'
          ]) <> '{}'::jsonb
          OR jsonb_typeof(v_dispatch_binding->'schemaVersion') <> 'number'
          OR v_dispatch_binding->>'schemaVersion' <> '1'
          OR COALESCE(v_dispatch_binding->>'source', '') NOT IN (
            'compiler', 'provider', 'deterministic', 'connected_agent',
            'capability_buildout', 'recovery'
          )
          OR NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_snapshot->'attempts') AS owner(value)
            WHERE owner.value->>'attemptId' = v_acceptance_attempt_id
              AND owner.value->>'kind' = v_dispatch_binding->>'source'
          )
          OR COALESCE(
            v_dispatch_binding->>'callIdentityFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
          OR COALESCE(v_dispatch_binding->>'authorizationCategory', '')
            NOT IN (
              'read_only', 'direct_request', 'plan_approval',
              'per_action_approval', 'provider_native', 'proposal_only',
              'unsupported'
            )
          OR COALESCE(v_dispatch_binding->>'mutationAuthority', '')
            NOT IN (
              'read_only', 'action_ledger', 'provider_idempotency',
              'proposal_only', 'unsupported'
            )
          OR COALESCE(
            v_dispatch_binding->>'policyBindingFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
          OR COALESCE(
            v_dispatch_binding->>'verifierBindingFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
          OR COALESCE(
            v_dispatch_binding->>'replayBindingFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
          OR NOT public.is_valid_computer_task_root_timestamp_v1(
            v_dispatch_binding->>'boundAt'
          )
          OR v_dispatch_binding->>'boundAt' < v_acceptance_bound_at
          OR v_dispatch_binding->>'boundAt' > v_entry->>'updatedAt'
          OR (
            (v_entry->>'mutatesState')::boolean
            AND (
              v_dispatch_binding->>'authorizationCategory' = 'read_only'
              OR v_dispatch_binding->>'mutationAuthority' = 'read_only'
            )
          )
          OR (
            NOT (v_entry->>'mutatesState')::boolean
            AND (
              v_dispatch_binding->>'authorizationCategory' <> 'read_only'
              OR v_dispatch_binding->>'mutationAuthority' <> 'read_only'
            )
          )
        THEN
          RETURN false;
        END IF;
      END IF;
      IF (v_entry->>'index')::bigint <> v_index
        OR (
          (v_entry->>'requiresForegroundLease')::boolean
          AND NOT (v_entry->>'mutatesState')::boolean
        )
      THEN
        RETURN false;
      END IF;
      v_action_state := v_entry->>'state';
      IF v_action_state <> 'planned'
        AND (
          v_dispatch_binding = 'null'::jsonb
          OR v_dispatch_binding->>'authorizationCategory' IN (
            'proposal_only', 'unsupported'
          )
          OR v_dispatch_binding->>'mutationAuthority' IN (
            'proposal_only', 'unsupported'
          )
          OR (
            (v_entry->>'mutatesState')::boolean
            AND v_dispatch_binding->>'mutationAuthority' NOT IN (
              'action_ledger', 'provider_idempotency'
            )
          )
          OR (
            NOT (v_entry->>'mutatesState')::boolean
            AND (
              v_dispatch_binding->>'authorizationCategory' <> 'read_only'
              OR v_dispatch_binding->>'mutationAuthority' <> 'read_only'
            )
          )
        )
      THEN
        RETURN false;
      END IF;
      IF NOT v_action_frontier_seen THEN
        IF v_action_state <> 'verified' THEN
          v_action_frontier_seen := true;
        END IF;
      ELSIF v_action_state <> 'planned' THEN
        RETURN false;
      END IF;
      IF v_action_state = 'verified' THEN
        IF COALESCE(v_entry->>'proofFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        THEN
          RETURN false;
        END IF;
      ELSIF v_action_state = 'outcome_unknown' THEN
        IF v_entry->'proofFingerprint' <> 'null'::jsonb
          AND COALESCE(v_entry->>'proofFingerprint', '')
            !~ '^args-v2:sha256:[0-9a-f]{64}$'
        THEN
          RETURN false;
        END IF;
      ELSIF v_entry->'proofFingerprint' <> 'null'::jsonb THEN
        RETURN false;
      END IF;
      v_action_ids := array_append(v_action_ids, v_entry->>'actionId');
    END LOOP;
    IF v_acceptance->>'acceptanceFingerprint' <>
      public.computer_task_root_fingerprint_v1(jsonb_build_object(
        'schemaVersion', 1,
        'namespace', 'computer_task_acceptance',
        'rootFingerprint', p_snapshot->>'rootFingerprint',
        'attemptId', v_acceptance_attempt_id,
        'predicateFingerprints', v_acceptance->'predicateFingerprints',
        'actions', v_action_manifests
      ))
    THEN
      RETURN false;
    END IF;
  END IF;

  IF v_lease <> 'null'::jsonb THEN
    IF jsonb_typeof(v_lease) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_lease)) <> 7
      OR (v_lease - ARRAY[
        'leaseId', 'actionId', 'targetFingerprint', 'acquiredAt',
        'expiresAt', 'status', 'releasedAt'
      ]) <> '{}'::jsonb
      OR COALESCE(v_lease->>'leaseId', '')
        !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,239}$'
      OR COALESCE(v_lease->>'actionId', '')
        !~ '^computer_action_[0-9a-f]{64}$'
      OR NOT (v_lease->>'actionId' = ANY(v_action_ids))
      OR COALESCE(v_lease->>'targetFingerprint', '')
        !~ '^args-v2:sha256:[0-9a-f]{64}$'
      OR NOT public.is_valid_computer_task_root_timestamp_v1(
        v_lease->>'acquiredAt'
      )
      OR NOT public.is_valid_computer_task_root_timestamp_v1(
        v_lease->>'expiresAt'
      )
      OR v_lease->>'acquiredAt' < v_created_at
      OR v_lease->>'acquiredAt' > v_updated_at
      OR (v_lease->>'expiresAt')::timestamptz
        <= (v_lease->>'acquiredAt')::timestamptz
      OR (v_lease->>'expiresAt')::timestamptz
        - (v_lease->>'acquiredAt')::timestamptz > interval '15 minutes'
      OR COALESCE(v_lease->>'status', '') NOT IN (
        'active', 'released', 'revoked'
      )
    THEN
      RETURN false;
    END IF;
    IF v_lease->>'status' = 'active' THEN
      IF v_lease->'releasedAt' <> 'null'::jsonb
        OR (v_lease->>'expiresAt')::timestamptz
          <= v_updated_at::timestamptz
        OR v_latch <> 'null'::jsonb
        OR p_snapshot->>'replayPolicy' = 'terminal'
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_acceptance->'actions') AS action(value)
          WHERE action.value->>'actionId' = v_lease->>'actionId'
            AND (action.value->>'mutatesState')::boolean
            AND (action.value->>'requiresForegroundLease')::boolean
            AND action.value->>'state' IN (
              'planned', 'claimed', 'dispatched'
            )
            AND (
              action.value->>'state' = 'dispatched'
              AND p_snapshot->>'state' = 'verification_only'
              OR action.value->>'state' IN ('planned', 'claimed')
              AND p_snapshot->>'state' = 'running'
            )
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(p_snapshot->'attempts') AS owner(value)
              WHERE owner.value->>'attemptId' = action.value->>'attemptId'
                AND owner.value->>'state' = 'active'
            )
        )
      THEN
        RETURN false;
      END IF;
      IF p_snapshot->>'replayPolicy' = 'verification_only' THEN
        SELECT action.value->>'state'
        INTO v_action_state
        FROM jsonb_array_elements(v_acceptance->'actions') AS action(value)
        WHERE action.value->>'actionId' = v_lease->>'actionId';
        IF v_action_state <> 'dispatched' THEN
          RETURN false;
        END IF;
      END IF;
    ELSE
      IF NOT public.is_valid_computer_task_root_timestamp_v1(
          v_lease->>'releasedAt'
        )
        OR v_lease->>'releasedAt' < v_lease->>'acquiredAt'
        OR v_lease->>'releasedAt' > v_updated_at
      THEN
        RETURN false;
      END IF;
    END IF;
  END IF;

  IF v_latch <> 'null'::jsonb THEN
    IF jsonb_typeof(v_latch) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_latch)) <> 3
      OR (v_latch - ARRAY['kind', 'latchedAt', 'revision']) <> '{}'::jsonb
      OR COALESCE(v_latch->>'kind', '') NOT IN (
        'stop_requested', 'human_foreground_override'
      )
      OR NOT public.is_valid_computer_task_root_timestamp_v1(
        v_latch->>'latchedAt'
      )
      OR v_latch->>'latchedAt' < v_created_at
      OR v_latch->>'latchedAt' > v_updated_at
      OR jsonb_typeof(v_latch->'revision') <> 'number'
      OR COALESCE(v_latch->>'revision', '') !~ '^[0-9]{1,10}$'
    THEN
      RETURN false;
    END IF;
    IF (v_latch->>'revision')::bigint NOT BETWEEN 1
      AND (p_snapshot->>'revision')::bigint
      OR v_active_attempt_count <> 0
    THEN
      RETURN false;
    END IF;
    IF v_latch->>'kind' = 'stop_requested'
      AND (
        p_snapshot->>'state' <> 'cancelled'
        OR p_snapshot->>'replayPolicy' <> 'terminal'
      )
    THEN
      RETURN false;
    END IF;
    IF v_latch->>'kind' = 'human_foreground_override'
      AND (
        p_snapshot->>'state' <> 'verification_only'
        OR p_snapshot->>'replayPolicy' <> 'verification_only'
        OR p_snapshot->'terminalAt' <> 'null'::jsonb
      )
    THEN
      RETURN false;
    END IF;
  END IF;

  IF p_snapshot->>'state' IN ('completed', 'failed', 'cancelled')
    AND v_active_attempt_count <> 0
  THEN
    RETURN false;
  END IF;
  IF v_acceptance <> 'null'::jsonb
    AND p_snapshot->>'state' NOT IN ('completed', 'failed', 'cancelled')
    AND p_snapshot#>>'{interruptLatch,kind}'
      IS DISTINCT FROM 'human_foreground_override'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_snapshot->'attempts') AS owner(value)
      WHERE owner.value->>'attemptId' = v_acceptance_attempt_id
        AND owner.value->>'state' = 'active'
    )
  THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_valid_computer_task_root_nested_v1(jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_valid_computer_task_root_snapshot_v1(
  p_snapshot jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE((
    jsonb_typeof(p_snapshot) = 'object'
    AND octet_length(p_snapshot::text) BETWEEN 64 AND 256000
    AND jsonb_typeof(p_snapshot->'schemaVersion') = 'number'
    AND p_snapshot->>'schemaVersion' = '1'
    AND COALESCE(p_snapshot->>'rootId', '')
      ~ '^computer_task_[0-9a-f]{64}$'
    AND COALESCE(p_snapshot->>'rootFingerprint', '')
      ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND COALESCE(p_snapshot->>'requestIdentityFingerprint', '')
      ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND COALESCE(p_snapshot->>'taskFingerprint', '')
      ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND jsonb_typeof(p_snapshot->'request') = 'object'
    AND jsonb_typeof(p_snapshot#>'{request,schemaVersion}') = 'number'
    AND p_snapshot#>>'{request,schemaVersion}' = '1'
    AND COALESCE(p_snapshot#>>'{request,requestIdentity}', '')
      ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,239}$'
    AND COALESCE(p_snapshot#>>'{request,userId}', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND COALESCE(p_snapshot#>>'{request,circleId}', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND (
      p_snapshot#>'{request,threadId}' = 'null'::jsonb
      OR COALESCE(p_snapshot#>>'{request,threadId}', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    AND p_snapshot#>>'{request,source}' IN (
      'chat', 'office', 'automation', 'api', 'connected_agent', 'system'
    )
    AND public.is_valid_computer_task_root_timestamp_v1(
      p_snapshot#>>'{request,admittedAt}'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_snapshot->'request') AS request_keys(request_key)
      WHERE request_key <> ALL (ARRAY[
        'schemaVersion',
        'requestIdentity',
        'userId',
        'circleId',
        'threadId',
        'source',
        'admittedAt'
      ])
    )
    AND jsonb_typeof(p_snapshot->'revision') = 'number'
    AND COALESCE(p_snapshot->>'revision', '') ~ '^[0-9]{1,10}$'
    AND (p_snapshot->>'revision')::bigint BETWEEN 0 AND 2147483647
    AND p_snapshot->>'state' IN (
      'admitted',
      'running',
      'waiting_approval',
      'waiting_input',
      'paused',
      'verification_only',
      'completed',
      'failed',
      'cancelled'
    )
    AND p_snapshot->>'replayPolicy' IN ('normal', 'verification_only', 'terminal')
    AND (
      p_snapshot->'interruptLatch' = 'null'::jsonb
      OR jsonb_typeof(p_snapshot->'interruptLatch') = 'object'
    )
    AND jsonb_typeof(p_snapshot->'attempts') = 'array'
    AND jsonb_array_length(p_snapshot->'attempts') <= 64
    AND jsonb_typeof(p_snapshot->'checkpoints') = 'array'
    AND jsonb_array_length(p_snapshot->'checkpoints') <= 256
    AND public.is_valid_computer_task_root_nested_v1(p_snapshot)
    AND (
      p_snapshot->'foregroundLease' = 'null'::jsonb
      OR jsonb_typeof(p_snapshot->'foregroundLease') = 'object'
    )
    AND (
      p_snapshot->'acceptance' = 'null'::jsonb
      OR jsonb_typeof(p_snapshot->'acceptance') = 'object'
    )
    AND (
      p_snapshot->'completionProofFingerprint' = 'null'::jsonb
      OR COALESCE(p_snapshot->>'completionProofFingerprint', '')
        ~ '^args-v2:sha256:[0-9a-f]{64}$'
    )
    AND public.is_valid_computer_task_root_timestamp_v1(
      p_snapshot->>'createdAt'
    )
    AND public.is_valid_computer_task_root_timestamp_v1(
      p_snapshot->>'updatedAt'
    )
    AND p_snapshot->>'createdAt' = p_snapshot#>>'{request,admittedAt}'
    AND p_snapshot->>'requestIdentityFingerprint' =
      public.computer_task_root_fingerprint_v1(jsonb_build_object(
        'schemaVersion', 1,
        'namespace', 'computer_task_request_identity',
        'requestIdentity', p_snapshot#>>'{request,requestIdentity}',
        'userId', p_snapshot#>>'{request,userId}',
        'circleId', p_snapshot#>>'{request,circleId}',
        'threadId', p_snapshot#>'{request,threadId}',
        'source', p_snapshot#>>'{request,source}'
      ))
    AND p_snapshot->>'rootFingerprint' =
      public.computer_task_root_fingerprint_v1(jsonb_build_object(
        'schemaVersion', 1,
        'namespace', 'computer_task_root',
        'requestIdentityFingerprint',
          p_snapshot->>'requestIdentityFingerprint',
        'taskFingerprint', p_snapshot->>'taskFingerprint',
        'source', p_snapshot#>>'{request,source}'
      ))
    AND p_snapshot->>'rootId' =
      'computer_task_' || substring(p_snapshot->>'rootFingerprint' FROM 16)
    AND p_snapshot->>'updatedAt' >= p_snapshot->>'createdAt'
    AND (
      p_snapshot->'terminalAt' = 'null'::jsonb
      OR public.is_valid_computer_task_root_timestamp_v1(
        p_snapshot->>'terminalAt'
      )
    )
    AND (
      p_snapshot->>'state' IN ('completed', 'failed', 'cancelled')
    ) = (p_snapshot->'terminalAt' <> 'null'::jsonb)
    AND (
      p_snapshot->>'state' = 'completed'
      OR p_snapshot->'completionProofFingerprint' = 'null'::jsonb
    )
    AND (
      p_snapshot->>'state' <> 'completed'
      OR (
        p_snapshot->>'replayPolicy' = 'terminal'
        AND p_snapshot->'completionProofFingerprint' <> 'null'::jsonb
        AND jsonb_typeof(p_snapshot->'acceptance') = 'object'
        AND jsonb_typeof(p_snapshot#>'{acceptance,actions}') = 'array'
        AND jsonb_array_length(p_snapshot#>'{acceptance,actions}') BETWEEN 1 AND 128
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_snapshot#>'{acceptance,actions}') AS action(value)
          WHERE action.value->>'state' <> 'verified'
        )
      )
    )
    AND (
      p_snapshot->>'state' NOT IN ('failed', 'cancelled')
      OR p_snapshot->>'replayPolicy' = 'terminal'
    )
    AND (
      p_snapshot->>'state' <> 'verification_only'
      OR (
        p_snapshot->>'replayPolicy' = 'verification_only'
        AND (
          p_snapshot#>>'{interruptLatch,kind}' = 'human_foreground_override'
          OR (
            jsonb_typeof(p_snapshot->'acceptance') = 'object'
            AND jsonb_typeof(p_snapshot#>'{acceptance,actions}') = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(p_snapshot#>'{acceptance,actions}') AS action(value)
              WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
            )
          )
        )
      )
    )
    AND (
      p_snapshot->>'state' IN ('completed', 'failed', 'cancelled')
      OR NOT (
        jsonb_typeof(p_snapshot#>'{acceptance,actions}') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_snapshot#>'{acceptance,actions}') AS action(value)
          WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
        )
      )
      OR (
        p_snapshot->>'state' = 'verification_only'
        AND p_snapshot->>'replayPolicy' = 'verification_only'
      )
    )
    AND (
      p_snapshot->>'state' <> 'cancelled'
      OR p_snapshot#>>'{interruptLatch,kind}' = 'stop_requested'
    )
    AND (
      p_snapshot->>'state' IN ('completed', 'failed', 'cancelled', 'verification_only')
      OR (
        p_snapshot->>'replayPolicy' = 'normal'
        AND p_snapshot->'interruptLatch' = 'null'::jsonb
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_snapshot) AS snapshot_keys(snapshot_key)
      WHERE snapshot_key <> ALL (ARRAY[
        'schemaVersion',
        'rootId',
        'rootFingerprint',
        'requestIdentityFingerprint',
        'taskFingerprint',
        'request',
        'revision',
        'state',
        'replayPolicy',
        'interruptLatch',
        'attempts',
        'checkpoints',
        'foregroundLease',
        'acceptance',
        'completionProofFingerprint',
        'createdAt',
        'updatedAt',
        'terminalAt'
      ])
    )
  ), false);
$function$;

REVOKE ALL ON FUNCTION public.is_valid_computer_task_root_snapshot_v1(jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admit_computer_task_root_v1(
  p_circle_id uuid,
  p_thread_id uuid,
  p_request_identity_fingerprint text,
  p_task_fingerprint text,
  p_root_fingerprint text,
  p_root_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.computer_task_roots%ROWTYPE;
  v_created public.computer_task_roots%ROWTYPE;
  v_run_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_authenticated',
      'message', 'Authenticated computer-task admission is required.'
    );
  END IF;

  IF (
    p_circle_id IS NULL
    OR COALESCE(p_request_identity_fingerprint, '')
      !~ '^args-v2:sha256:[0-9a-f]{64}$'
    OR COALESCE(p_task_fingerprint, '')
      !~ '^args-v2:sha256:[0-9a-f]{64}$'
    OR COALESCE(p_root_fingerprint, '')
      !~ '^args-v2:sha256:[0-9a-f]{64}$'
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'Computer-task root admission did not match its exact request snapshot.'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS member
    WHERE member.circle_id = p_circle_id
      AND member.user_id = v_actor
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'scope_denied',
      'message', 'Computer-task root admission is outside the authenticated circle.'
    );
  END IF;

  IF p_thread_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = p_thread_id
      AND thread.circle_id = p_circle_id
      AND (
        thread.visibility = 'circle'
        OR thread.created_by = v_actor
        OR EXISTS (
          SELECT 1
          FROM public.circle_chat_thread_members AS thread_member
          WHERE thread_member.thread_id = thread.id
            AND thread_member.user_id = v_actor
        )
      )
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'scope_denied',
      'message', 'Computer-task root admission is outside the authenticated chat thread.'
    );
  END IF;

  -- Serialize competing clients before either can create the wrapper run.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':' || p_circle_id::text || ':' || p_request_identity_fingerprint,
    0
  ));

  SELECT *
  INTO v_existing
  FROM public.computer_task_roots AS root
  WHERE root.user_id = v_actor
    AND root.circle_id = p_circle_id
    AND root.request_identity_fingerprint = p_request_identity_fingerprint
  ORDER BY root.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF (
      v_existing.thread_id IS NOT DISTINCT FROM p_thread_id
      AND v_existing.root_fingerprint = p_root_fingerprint
      AND v_existing.task_fingerprint = p_task_fingerprint
    ) THEN
      RETURN jsonb_build_object(
        'schemaVersion', 1,
        'ok', true,
        'disposition', 'duplicate',
        'rootRowId', v_existing.id,
        'runId', v_existing.run_id,
        'revision', v_existing.revision,
        'state', v_existing.state,
        'rootSnapshot', v_existing.root_snapshot
      );
    END IF;
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'identity_conflict',
      'message', 'The admitted request identity is already bound to a different root or task.'
    );
  END IF;

  -- Only a genuinely new admission pays the bounded snapshot-validation and
  -- identity-derivation cost. Exact duplicates return the already-authorized
  -- canonical row, so refresh does not depend on the client's old timestamp.
  IF (
    NOT public.is_valid_computer_task_root_snapshot_v1(p_root_snapshot)
    OR p_root_snapshot->>'rootFingerprint' <> p_root_fingerprint
    OR p_root_snapshot->>'requestIdentityFingerprint' <> p_request_identity_fingerprint
    OR p_root_snapshot->>'taskFingerprint' <> p_task_fingerprint
    OR p_root_snapshot->>'revision' <> '0'
    OR p_root_snapshot->>'state' <> 'admitted'
    OR p_root_snapshot->>'replayPolicy' <> 'normal'
    OR p_root_snapshot->>'rootId'
      <> 'computer_task_' || substring(p_root_fingerprint FROM 16)
    OR p_root_snapshot->'interruptLatch' <> 'null'::jsonb
    OR p_root_snapshot->'attempts' <> '[]'::jsonb
    OR p_root_snapshot->'checkpoints' <> '[]'::jsonb
    OR p_root_snapshot->'foregroundLease' <> 'null'::jsonb
    OR p_root_snapshot->'acceptance' <> 'null'::jsonb
    OR p_root_snapshot->'completionProofFingerprint' <> 'null'::jsonb
    OR p_root_snapshot->'terminalAt' <> 'null'::jsonb
    OR p_root_snapshot->>'createdAt' <> p_root_snapshot->>'updatedAt'
    OR (p_root_snapshot->>'createdAt')::timestamptz
      NOT BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
    OR p_root_snapshot#>>'{request,userId}' <> v_actor::text
    OR p_root_snapshot#>>'{request,circleId}' <> p_circle_id::text
    OR (
      p_thread_id IS NULL
      AND p_root_snapshot#>'{request,threadId}' <> 'null'::jsonb
    )
    OR (
      p_thread_id IS NOT NULL
      AND p_root_snapshot#>>'{request,threadId}' <> p_thread_id::text
    )
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'Computer-task root admission did not match its exact request snapshot.'
    );
  END IF;

  INSERT INTO public.agent_runs (
    circle_id,
    user_id,
    surface,
    title,
    goal,
    mode,
    provider,
    status,
    metadata
  ) VALUES (
    p_circle_id,
    v_actor,
    'main_chat',
    'Computer task',
    NULL,
    'act',
    'openswan',
    'planning',
    jsonb_build_object(
      'schemaVersion', 3,
      'executionKind', 'run_computer_task',
      'universalComputerTaskRoot', true,
      'computerTaskRootId', p_root_snapshot->>'rootId',
      'computerTaskRootFingerprint', p_root_fingerprint,
      'requestIdentityFingerprint', p_request_identity_fingerprint,
      'taskFingerprint', p_task_fingerprint,
      'circleChatThreadId', p_thread_id,
      'computerTaskRootState', 'admitted',
      'computerTaskRootRevision', 0,
      'taskCompletionVerified', false,
      'rootCoordinationOnly', true,
      'redacted', true
    )
  )
  RETURNING id INTO v_run_id;

  INSERT INTO public.computer_task_roots (
    run_id,
    circle_id,
    user_id,
    thread_id,
    schema_version,
    root_fingerprint,
    request_identity_fingerprint,
    task_fingerprint,
    state,
    replay_policy,
    revision,
    root_snapshot,
    created_at,
    updated_at,
    terminal_at
  ) VALUES (
    v_run_id,
    p_circle_id,
    v_actor,
    p_thread_id,
    1,
    p_root_fingerprint,
    p_request_identity_fingerprint,
    p_task_fingerprint,
    'admitted',
    'normal',
    0,
    p_root_snapshot,
    (p_root_snapshot->>'createdAt')::timestamptz,
    (p_root_snapshot->>'updatedAt')::timestamptz,
    NULL
  )
  RETURNING * INTO v_created;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', 'created',
    'rootRowId', v_created.id,
    'runId', v_created.run_id,
    'revision', v_created.revision,
    'state', v_created.state,
    'rootSnapshot', v_created.root_snapshot
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_computer_task_root_v1(
  p_root_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_authenticated',
      'message', 'Authenticated computer-task root access is required.'
    );
  END IF;

  IF p_root_row_id IS NULL THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'A computer-task root identifier is required.'
    );
  END IF;

  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_found',
      'message', 'The authenticated computer-task root was not found.'
    );
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', 'read',
    'rootRowId', v_root.id,
    'runId', v_root.run_id,
    'revision', v_root.revision,
    'state', v_root.state,
    'rootSnapshot', v_root.root_snapshot
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.transition_computer_task_root_v1(
  uuid, integer, jsonb
);

CREATE OR REPLACE FUNCTION public.transition_computer_task_root_v1(
  p_root_row_id uuid,
  p_expected_revision integer,
  p_transition_type text,
  p_root_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
  v_next_revision integer;
  v_next_state text;
  v_next_replay_policy text;
  v_next_terminal_at timestamptz;
  v_run_status text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_authenticated',
      'message', 'Authenticated computer-task transition is required.'
    );
  END IF;
  IF (
    p_root_row_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR p_transition_type IS NULL
    OR p_transition_type NOT IN (
      'begin_attempt',
      'finish_attempt',
      'bind_acceptance',
      'bind_action_dispatch',
      'record_action_state',
      'append_checkpoint',
      'bind_foreground_lease',
      'release_foreground_lease',
      'set_waiting',
      'stop_requested',
      'human_foreground_override',
      'complete',
      'fail'
    )
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'Computer-task transition snapshot was invalid.'
    );
  END IF;

  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_found',
      'message', 'The authenticated computer-task root was not found.'
    );
  END IF;

  IF v_root.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'state_conflict',
      'message', 'The computer-task root revision changed before this transition.',
      'currentRevision', v_root.revision,
      'rootSnapshot', v_root.root_snapshot
    );
  END IF;

  IF NOT public.is_valid_computer_task_root_snapshot_v1(p_root_snapshot) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'Computer-task transition snapshot was invalid.'
    );
  END IF;

  v_next_revision := (p_root_snapshot->>'revision')::integer;
  v_next_state := p_root_snapshot->>'state';
  v_next_replay_policy := p_root_snapshot->>'replayPolicy';

  IF (
    v_next_revision <> v_root.revision + 1
    OR p_root_snapshot->>'rootFingerprint' <> v_root.root_fingerprint
    OR p_root_snapshot->>'requestIdentityFingerprint' <> v_root.request_identity_fingerprint
    OR p_root_snapshot->>'taskFingerprint' <> v_root.task_fingerprint
    OR p_root_snapshot->>'rootId' <> v_root.root_snapshot->>'rootId'
    OR p_root_snapshot->'request' IS DISTINCT FROM v_root.root_snapshot->'request'
    OR p_root_snapshot->>'createdAt' <> v_root.root_snapshot->>'createdAt'
    OR p_root_snapshot->>'updatedAt' < v_root.root_snapshot->>'updatedAt'
    OR (p_root_snapshot->>'updatedAt')::timestamptz > now() + interval '1 minute'
    OR p_root_snapshot#>>'{request,userId}' <> v_root.user_id::text
    OR p_root_snapshot#>>'{request,circleId}' <> v_root.circle_id::text
    OR (
      v_root.thread_id IS NULL
      AND p_root_snapshot#>'{request,threadId}' <> 'null'::jsonb
    )
    OR (
      v_root.thread_id IS NOT NULL
      AND p_root_snapshot#>>'{request,threadId}' <> v_root.thread_id::text
    )
    OR v_root.state IN ('completed', 'failed', 'cancelled')
    OR (
      v_root.state = 'verification_only'
      AND v_next_state NOT IN (
        'running', 'verification_only', 'completed', 'failed', 'cancelled'
      )
    )
    OR (
      v_root.state = 'admitted'
      AND v_next_state NOT IN (
        'admitted', 'running', 'waiting_approval', 'waiting_input', 'paused',
        'verification_only', 'failed', 'cancelled'
      )
    )
    OR (
      v_root.state = 'running'
      AND v_next_state NOT IN (
        'running', 'waiting_approval', 'waiting_input', 'paused',
        'verification_only', 'completed', 'failed', 'cancelled'
      )
    )
    OR (
      v_root.state IN ('waiting_approval', 'waiting_input', 'paused')
      AND v_next_state NOT IN (
        v_root.state, 'running', 'waiting_approval', 'waiting_input', 'paused',
        'verification_only', 'completed', 'failed', 'cancelled'
      )
    )
    OR (
      v_root.replay_policy = 'terminal'
      AND v_next_replay_policy <> 'terminal'
    )
    OR (
      v_root.replay_policy = 'verification_only'
      AND v_next_replay_policy = 'normal'
      AND p_transition_type <> 'record_action_state'
    )
    OR (
      v_root.replay_policy = 'verification_only'
      AND p_transition_type NOT IN (
        'append_checkpoint', 'record_action_state',
        'release_foreground_lease', 'stop_requested',
        'human_foreground_override'
      )
    )
    OR (
      v_root.root_snapshot->'interruptLatch' <> 'null'::jsonb
      AND p_root_snapshot->'interruptLatch' IS DISTINCT FROM v_root.root_snapshot->'interruptLatch'
      AND p_transition_type <> 'stop_requested'
    )
    OR (
      v_root.root_snapshot->'acceptance' <> 'null'::jsonb
      AND p_root_snapshot->'acceptance' IS DISTINCT FROM v_root.root_snapshot->'acceptance'
      AND p_transition_type NOT IN (
        'bind_action_dispatch', 'record_action_state'
      )
    )
    OR CASE p_transition_type
      WHEN 'append_checkpoint' THEN
        (p_root_snapshot - ARRAY['revision', 'updatedAt', 'checkpoints'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'updatedAt', 'checkpoints'])
      WHEN 'begin_attempt' THEN
        (p_root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'attempts'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'attempts'])
      WHEN 'finish_attempt' THEN
        (p_root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'attempts'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'attempts'])
      WHEN 'bind_acceptance' THEN
        (p_root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'acceptance'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'acceptance'])
      WHEN 'bind_action_dispatch' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'updatedAt', 'acceptance'
        ])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'updatedAt', 'acceptance'
        ])
      WHEN 'record_action_state' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'updatedAt',
          'acceptance', 'foregroundLease'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'updatedAt',
          'acceptance', 'foregroundLease'
        ])
      WHEN 'bind_foreground_lease' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'updatedAt', 'foregroundLease'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'updatedAt', 'foregroundLease'
        ])
      WHEN 'release_foreground_lease' THEN
        (p_root_snapshot - ARRAY['revision', 'updatedAt', 'foregroundLease'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'updatedAt', 'foregroundLease'])
      WHEN 'set_waiting' THEN
        (p_root_snapshot - ARRAY['revision', 'state', 'updatedAt'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'state', 'updatedAt'])
      WHEN 'stop_requested' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'interruptLatch', 'attempts',
          'foregroundLease', 'updatedAt', 'terminalAt'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'interruptLatch', 'attempts',
          'foregroundLease', 'updatedAt', 'terminalAt'
        ])
      WHEN 'human_foreground_override' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'interruptLatch', 'attempts',
          'foregroundLease', 'updatedAt'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'interruptLatch', 'attempts',
          'foregroundLease', 'updatedAt'
        ])
      WHEN 'complete' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'attempts',
          'completionProofFingerprint', 'updatedAt', 'terminalAt'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'attempts',
          'completionProofFingerprint', 'updatedAt', 'terminalAt'
        ])
      WHEN 'fail' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'attempts', 'updatedAt', 'terminalAt'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'attempts', 'updatedAt', 'terminalAt'
        ])
      ELSE true
    END
    OR (
      p_transition_type = 'append_checkpoint'
      AND (
        v_next_state <> v_root.state
        OR p_root_snapshot->'attempts' IS DISTINCT FROM v_root.root_snapshot->'attempts'
        OR p_root_snapshot->'foregroundLease' IS DISTINCT FROM v_root.root_snapshot->'foregroundLease'
        OR p_root_snapshot->'acceptance' IS DISTINCT FROM v_root.root_snapshot->'acceptance'
        OR jsonb_array_length(p_root_snapshot->'checkpoints')
          <> jsonb_array_length(v_root.root_snapshot->'checkpoints') + 1
        OR ((p_root_snapshot->'checkpoints')
          - (jsonb_array_length(p_root_snapshot->'checkpoints') - 1))
          IS DISTINCT FROM v_root.root_snapshot->'checkpoints'
        OR jsonb_typeof(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
        ) <> 'object'
        OR (
          SELECT count(*)
          FROM jsonb_object_keys(
            p_root_snapshot->'checkpoints'
              ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
          ) AS checkpoint_key(key)
        ) <> 7
        OR (
          (p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1))
          - ARRAY[
            'checkpointId', 'sequence', 'attemptId', 'kind', 'rootState',
            'recordedAt', 'evidenceFingerprint'
          ]
        ) <> '{}'::jsonb
        OR COALESCE(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'checkpointId',
          ''
        ) !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,239}$'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'checkpoints') AS prior(value)
          WHERE prior.value->>'checkpointId' =
            p_root_snapshot->'checkpoints'
              ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
              ->>'checkpointId'
        )
        OR COALESCE(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'sequence',
          ''
        ) !~ '^[0-9]{1,10}$'
        OR (
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'sequence'
        )::bigint <> jsonb_array_length(p_root_snapshot->'checkpoints')
        OR COALESCE(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'kind',
          ''
        ) NOT IN (
          'plan', 'observation', 'approval', 'action', 'verification',
          'recovery', 'terminal'
        )
        OR COALESCE(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'rootState',
          ''
        ) <> v_root.state
        OR p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'recordedAt' <> p_root_snapshot->>'updatedAt'
        OR (
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->'attemptId' <> 'null'::jsonb
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_root.root_snapshot->'attempts') AS attempt(value)
            WHERE attempt.value->>'attemptId' =
              p_root_snapshot->'checkpoints'
                ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
                ->>'attemptId'
          )
        )
        OR (
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->'evidenceFingerprint' <> 'null'::jsonb
          AND COALESCE(
            p_root_snapshot->'checkpoints'
              ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
              ->>'evidenceFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
        )
      )
    )
    OR (
      p_transition_type = 'begin_attempt'
      AND (
        v_next_state <> 'running'
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts') + 1
        OR ((p_root_snapshot->'attempts')
          - (jsonb_array_length(p_root_snapshot->'attempts') - 1))
          IS DISTINCT FROM v_root.root_snapshot->'attempts'
        OR jsonb_typeof(
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
        ) <> 'object'
        OR (
          SELECT count(*)
          FROM jsonb_object_keys(
            p_root_snapshot->'attempts'
              ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
          ) AS attempt_key(key)
        ) <> 7
        OR (
          (p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1))
          - ARRAY[
            'attemptId', 'index', 'kind', 'parentAttemptId', 'state',
            'startedAt', 'finishedAt'
          ]
        ) <> '{}'::jsonb
        OR COALESCE(
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'attemptId',
          ''
        ) !~ '^computer_attempt_[0-9a-f]{64}$'
        OR COALESCE(
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'index',
          ''
        ) !~ '^[0-9]{1,10}$'
        OR (
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'index'
        )::bigint <> jsonb_array_length(p_root_snapshot->'attempts') - 1
        OR COALESCE(
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'kind',
          ''
        ) NOT IN (
          'deterministic', 'provider', 'compiler', 'connected_agent',
          'capability_buildout', 'recovery'
        )
        OR p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'state' <> 'active'
        OR p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'startedAt' <> p_root_snapshot->>'updatedAt'
        OR p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->'finishedAt' <> 'null'::jsonb
        OR (
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->'parentAttemptId' <> 'null'::jsonb
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_root.root_snapshot->'attempts') AS parent(value)
            WHERE parent.value->>'attemptId' =
              p_root_snapshot->'attempts'
                ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
                ->>'parentAttemptId'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts') AS attempt(value)
          WHERE attempt.value->>'state' = 'active'
        )
      )
    )
    OR (
      p_transition_type = 'finish_attempt'
      AND (
        v_next_state <> 'paused'
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR (
          SELECT count(*)
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
        ) <> 1
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND (
              prior.value->>'state' <> 'active'
              OR prior.value->>'attemptId' =
                v_root.root_snapshot#>>'{acceptance,attemptId}'
              OR prior.value->'finishedAt' <> 'null'::jsonb
              OR next.value->>'state' NOT IN (
                'completed', 'failed', 'cancelled'
              )
              OR next.value->>'finishedAt' <> p_root_snapshot->>'updatedAt'
              OR (next.value - ARRAY['state', 'finishedAt'])
                IS DISTINCT FROM
                (prior.value - ARRAY['state', 'finishedAt'])
            )
        )
      )
    )
    OR (
      p_transition_type = 'bind_acceptance'
      AND (
        v_next_state <> 'running'
        OR v_root.root_snapshot->'acceptance' <> 'null'::jsonb
        OR jsonb_typeof(p_root_snapshot->'acceptance') <> 'object'
        OR p_root_snapshot#>>'{acceptance,boundAt}'
          <> p_root_snapshot->>'updatedAt'
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            AS attempt(value)
          WHERE attempt.value->>'attemptId' =
              p_root_snapshot#>>'{acceptance,attemptId}'
            AND attempt.value->>'state' = 'active'
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            AS action(value)
          WHERE action.value->>'state' <> 'planned'
            OR action.value->'proofFingerprint' <> 'null'::jsonb
            OR action.value->'dispatchBinding' <> 'null'::jsonb
            OR action.value->>'updatedAt' <>
              p_root_snapshot#>>'{acceptance,boundAt}'
        )
      )
    )
    OR (
      p_transition_type = 'bind_action_dispatch'
      AND (
        v_next_state <> 'running'
        OR v_root.replay_policy <> 'normal'
        OR jsonb_typeof(v_root.root_snapshot->'acceptance')
          IS DISTINCT FROM 'object'
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            AS attempt(value)
          WHERE attempt.value->>'attemptId' =
              v_root.root_snapshot#>>'{acceptance,attemptId}'
            AND attempt.value->>'state' = 'active'
        )
        OR jsonb_array_length(p_root_snapshot#>'{acceptance,actions}')
          <> jsonb_array_length(v_root.root_snapshot#>'{acceptance,actions}')
        OR ((p_root_snapshot->'acceptance') - (ARRAY['actions']::text[]))
          IS DISTINCT FROM
          ((v_root.root_snapshot->'acceptance') - (ARRAY['actions']::text[]))
        OR (
          SELECT count(*)
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
        ) <> 1
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND (
              prior.value->>'state' <> 'planned'
              OR next.value->>'state' <> 'planned'
              OR prior.value->'dispatchBinding' <> 'null'::jsonb
              OR jsonb_typeof(next.value->'dispatchBinding') <> 'object'
              OR (next.value - ARRAY['dispatchBinding', 'updatedAt'])
                IS DISTINCT FROM
                (prior.value - ARRAY['dispatchBinding', 'updatedAt'])
              OR next.value->>'updatedAt' <> p_root_snapshot->>'updatedAt'
              OR next.value#>>'{dispatchBinding,boundAt}' <>
                p_root_snapshot->>'updatedAt'
            )
        )
      )
    )
    OR (
      p_transition_type = 'record_action_state'
      AND (
        v_next_state NOT IN ('running', 'verification_only')
        OR jsonb_typeof(v_root.root_snapshot#>'{acceptance,actions}')
          IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_root_snapshot#>'{acceptance,actions}')
          <> jsonb_array_length(v_root.root_snapshot#>'{acceptance,actions}')
        OR ((p_root_snapshot->'acceptance') - (ARRAY['actions']::text[]))
          IS DISTINCT FROM
          ((v_root.root_snapshot->'acceptance') - (ARRAY['actions']::text[]))
        OR (
          SELECT count(*)
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
        ) <> 1
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND (
              (next.value - ARRAY['state', 'proofFingerprint', 'updatedAt'])
                IS DISTINCT FROM
                (prior.value - ARRAY['state', 'proofFingerprint', 'updatedAt'])
              OR NOT (
                prior.value->>'state' = 'planned'
                  AND next.value->>'state' = 'claimed'
                OR prior.value->>'state' = 'claimed'
                  AND next.value->>'state' IN ('dispatched', 'failed')
                OR prior.value->>'state' = 'dispatched'
                  AND next.value->>'state' IN ('verified', 'outcome_unknown')
                OR prior.value->>'state' = 'outcome_unknown'
                  AND next.value->>'state' = 'verified'
              )
              OR (
                prior.value->>'state' = 'planned'
                AND next.value->>'state' = 'claimed'
                AND (
                  jsonb_typeof(next.value->'dispatchBinding')
                    IS DISTINCT FROM 'object'
                  OR next.value#>>'{dispatchBinding,authorizationCategory}'
                    IN ('proposal_only', 'unsupported')
                  OR (
                    (next.value->>'mutatesState')::boolean
                    AND next.value#>>'{dispatchBinding,mutationAuthority}'
                      NOT IN ('action_ledger', 'provider_idempotency')
                  )
                  OR (
                    NOT (next.value->>'mutatesState')::boolean
                    AND next.value#>>'{dispatchBinding,mutationAuthority}'
                      <> 'read_only'
                  )
                )
              )
              OR (
                next.value->>'state' IN ('claimed', 'dispatched')
                AND NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(
                    v_root.root_snapshot->'attempts'
                  ) AS owner(value)
                  WHERE owner.value->>'attemptId' = next.value->>'attemptId'
                    AND owner.value->>'state' = 'active'
                )
              )
              OR next.value->>'updatedAt' <> p_root_snapshot->>'updatedAt'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND next.value->>'state' = 'claimed'
            AND (
              EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  v_root.root_snapshot#>'{acceptance,actions}'
                ) AS other(value)
                WHERE (
                  (other.value->>'index')::integer
                    < (next.value->>'index')::integer
                  AND other.value->>'state' <> 'verified'
                )
                OR (
                  other.value->>'actionId' <> next.value->>'actionId'
                  AND other.value->>'state' IN ('claimed', 'dispatched')
                )
              )
            )
        )
        OR (
          v_root.replay_policy = 'verification_only'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              v_root.root_snapshot#>'{acceptance,actions}'
            ) WITH ORDINALITY AS prior(value, ordinal)
            JOIN jsonb_array_elements(
              p_root_snapshot#>'{acceptance,actions}'
            ) WITH ORDINALITY AS next(value, ordinal)
              USING (ordinal)
            WHERE prior.value IS DISTINCT FROM next.value
              AND NOT (
                prior.value->>'state' = 'dispatched'
                AND next.value->>'state' IN ('verified', 'outcome_unknown')
                OR prior.value->>'state' = 'outcome_unknown'
                AND next.value->>'state' = 'verified'
              )
          )
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND next.value->>'state' = 'dispatched'
            AND (next.value->>'requiresForegroundLease')::boolean
            AND (
              p_root_snapshot#>>'{foregroundLease,status}'
                IS DISTINCT FROM 'active'
              OR p_root_snapshot#>>'{foregroundLease,actionId}'
                IS DISTINCT FROM
                next.value->>'actionId'
              OR p_root_snapshot#>>'{foregroundLease,expiresAt}' IS NULL
              OR (p_root_snapshot#>>'{foregroundLease,expiresAt}')::timestamptz
                <= (p_root_snapshot->>'updatedAt')::timestamptz
            )
        )
        OR (
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
              AS action(value)
            WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
          )
          AND (
            v_next_state <> 'verification_only'
            OR v_next_replay_policy <> 'verification_only'
          )
        )
        OR (
          NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
              AS action(value)
            WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
          )
          AND v_root.root_snapshot#>>'{interruptLatch,kind}'
            IS DISTINCT FROM 'human_foreground_override'
          AND (
            v_next_state <> 'running'
            OR v_next_replay_policy <> 'normal'
          )
        )
        OR p_root_snapshot->'foregroundLease' IS DISTINCT FROM (
          CASE
            WHEN v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  v_root.root_snapshot#>'{acceptance,actions}'
                ) WITH ORDINALITY AS prior(value, ordinal)
                JOIN jsonb_array_elements(
                  p_root_snapshot#>'{acceptance,actions}'
                ) WITH ORDINALITY AS next(value, ordinal)
                  USING (ordinal)
                WHERE prior.value IS DISTINCT FROM next.value
                  AND next.value->>'actionId' =
                    v_root.root_snapshot#>>'{foregroundLease,actionId}'
                  AND next.value->>'state' IN (
                    'verified', 'failed', 'outcome_unknown'
                  )
              )
            THEN jsonb_set(
              jsonb_set(
                COALESCE(
                  NULLIF(
                    v_root.root_snapshot->'foregroundLease',
                    'null'::jsonb
                  ),
                  '{}'::jsonb
                ),
                '{status}',
                '"released"'::jsonb
              ),
              '{releasedAt}',
              to_jsonb(p_root_snapshot->>'updatedAt')
            )
            ELSE v_root.root_snapshot->'foregroundLease'
          END
        )
      )
    )
    OR (
      p_transition_type = 'bind_foreground_lease'
      AND (
        v_next_state <> 'running'
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR p_root_snapshot#>>'{foregroundLease,status}' <> 'active'
        OR p_root_snapshot#>'{foregroundLease,releasedAt}' <> 'null'::jsonb
        OR p_root_snapshot#>>'{foregroundLease,acquiredAt}'
          <> p_root_snapshot->>'updatedAt'
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            AS action(value)
          WHERE action.value->>'actionId' =
              p_root_snapshot#>>'{foregroundLease,actionId}'
            AND (action.value->>'requiresForegroundLease')::boolean
            AND action.value->>'state' IN ('planned', 'claimed')
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                v_root.root_snapshot->'attempts'
              ) AS owner(value)
              WHERE owner.value->>'attemptId' = action.value->>'attemptId'
                AND owner.value->>'state' = 'active'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                v_root.root_snapshot#>'{acceptance,actions}'
              ) AS other(value)
              WHERE (
                (other.value->>'index')::integer <
                  (action.value->>'index')::integer
                AND other.value->>'state' <> 'verified'
              )
              OR (
                other.value->>'actionId' <> action.value->>'actionId'
                AND other.value->>'state' IN ('claimed', 'dispatched')
              )
            )
        )
      )
    )
    OR (
      p_transition_type = 'release_foreground_lease'
      AND (
        v_next_state <> v_root.state
        OR v_root.root_snapshot#>>'{foregroundLease,status}'
          IS DISTINCT FROM 'active'
        OR p_root_snapshot#>>'{foregroundLease,status}'
          IS DISTINCT FROM 'released'
        OR p_root_snapshot#>>'{foregroundLease,releasedAt}'
          <> p_root_snapshot->>'updatedAt'
        OR ((p_root_snapshot->'foregroundLease') - ARRAY['status', 'releasedAt'])
          IS DISTINCT FROM
          ((v_root.root_snapshot->'foregroundLease') - ARRAY['status', 'releasedAt'])
      )
    )
    OR (
      p_transition_type = 'set_waiting'
      AND (
        v_next_state NOT IN ('waiting_approval', 'waiting_input', 'paused')
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR (
          v_next_state = 'paused'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_root.root_snapshot->'attempts') AS attempt(value)
            WHERE attempt.value->>'state' = 'active'
          )
        )
      )
    )
    OR (
      p_transition_type = 'stop_requested'
      AND (
        v_next_state <> 'cancelled'
        OR v_next_replay_policy <> 'terminal'
        OR p_root_snapshot->>'terminalAt' <> p_root_snapshot->>'updatedAt'
        OR p_root_snapshot->'completionProofFingerprint' <> 'null'::jsonb
        OR p_root_snapshot#>>'{interruptLatch,kind}' <> 'stop_requested'
        OR p_root_snapshot#>>'{interruptLatch,latchedAt}'
          <> p_root_snapshot->>'updatedAt'
        OR (p_root_snapshot#>>'{interruptLatch,revision}')::integer
          <> v_next_revision
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(
              v_root.root_snapshot#>'{acceptance,actions}',
              '[]'::jsonb
            )
          ) AS action(value)
          WHERE action.value->>'state' IN (
            'claimed', 'dispatched', 'outcome_unknown'
          )
        )
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE next.value IS DISTINCT FROM (
            CASE
              WHEN prior.value->>'state' = 'active'
              THEN jsonb_set(
                jsonb_set(prior.value, '{state}', '"cancelled"'::jsonb),
                '{finishedAt}',
                to_jsonb(p_root_snapshot->>'updatedAt')
              )
              ELSE prior.value
            END
          )
        )
        OR p_root_snapshot->'foregroundLease' IS DISTINCT FROM (
          CASE
            WHEN v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
            THEN jsonb_set(
              jsonb_set(
                COALESCE(
                  NULLIF(
                    v_root.root_snapshot->'foregroundLease',
                    'null'::jsonb
                  ),
                  '{}'::jsonb
                ),
                '{status}',
                '"revoked"'::jsonb
              ),
              '{releasedAt}',
              to_jsonb(p_root_snapshot->>'updatedAt')
            )
            ELSE v_root.root_snapshot->'foregroundLease'
          END
        )
      )
    )
    OR (
      p_transition_type = 'human_foreground_override'
      AND (
        v_next_state <> 'verification_only'
        OR v_next_replay_policy <> 'verification_only'
        OR v_root.root_snapshot->'interruptLatch' <> 'null'::jsonb
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(
              v_root.root_snapshot#>'{acceptance,actions}',
              '[]'::jsonb
            )
          ) AS action(value)
          WHERE action.value->>'state' = 'claimed'
        )
        OR p_root_snapshot#>>'{interruptLatch,kind}' <>
          'human_foreground_override'
        OR p_root_snapshot#>>'{interruptLatch,latchedAt}'
          <> p_root_snapshot->>'updatedAt'
        OR (p_root_snapshot#>>'{interruptLatch,revision}')::integer
          <> v_next_revision
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE next.value IS DISTINCT FROM (
            CASE
              WHEN prior.value->>'state' = 'active'
              THEN jsonb_set(
                jsonb_set(prior.value, '{state}', '"cancelled"'::jsonb),
                '{finishedAt}',
                to_jsonb(p_root_snapshot->>'updatedAt')
              )
              ELSE prior.value
            END
          )
        )
        OR p_root_snapshot->'foregroundLease' IS DISTINCT FROM (
          CASE
            WHEN v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
            THEN jsonb_set(
              jsonb_set(
                COALESCE(
                  NULLIF(
                    v_root.root_snapshot->'foregroundLease',
                    'null'::jsonb
                  ),
                  '{}'::jsonb
                ),
                '{status}',
                '"revoked"'::jsonb
              ),
              '{releasedAt}',
              to_jsonb(p_root_snapshot->>'updatedAt')
            )
            ELSE v_root.root_snapshot->'foregroundLease'
          END
        )
      )
    )
    OR (
      p_transition_type = 'complete'
      AND (
        v_next_state <> 'completed'
        OR v_next_replay_policy <> 'terminal'
        OR p_root_snapshot->>'terminalAt' <> p_root_snapshot->>'updatedAt'
        OR p_root_snapshot->'completionProofFingerprint' = 'null'::jsonb
        OR v_root.root_snapshot->'acceptance' = 'null'::jsonb
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            v_root.root_snapshot#>'{acceptance,actions}'
          ) AS action(value)
          WHERE action.value->>'state' <> 'verified'
        )
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE next.value IS DISTINCT FROM (
            CASE
              WHEN prior.value->>'state' = 'active'
              THEN jsonb_set(
                jsonb_set(prior.value, '{state}', '"completed"'::jsonb),
                '{finishedAt}',
                to_jsonb(p_root_snapshot->>'updatedAt')
              )
              ELSE prior.value
            END
          )
        )
      )
    )
    OR (
      p_transition_type = 'fail'
      AND (
        v_next_state <> 'failed'
        OR v_next_replay_policy <> 'terminal'
        OR p_root_snapshot->>'terminalAt' <> p_root_snapshot->>'updatedAt'
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(v_root.root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
          ) AS action(value)
          WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
        )
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE next.value IS DISTINCT FROM (
            CASE
              WHEN prior.value->>'state' = 'active'
              THEN jsonb_set(
                jsonb_set(prior.value, '{state}', '"cancelled"'::jsonb),
                '{finishedAt}',
                to_jsonb(p_root_snapshot->>'updatedAt')
              )
              ELSE prior.value
            END
          )
        )
      )
    )
    OR (
      p_transition_type NOT IN ('append_checkpoint', 'stop_requested', 'human_foreground_override')
      AND p_root_snapshot->'checkpoints' IS DISTINCT FROM v_root.root_snapshot->'checkpoints'
    )
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_transition',
      'message', 'The computer-task root transition violated immutable identity, CAS, replay, interrupt, acceptance, or terminal-state rules.'
    );
  END IF;

  IF v_next_state IN ('completed', 'failed', 'cancelled') THEN
    IF p_root_snapshot->'terminalAt' = 'null'::jsonb THEN
      RETURN jsonb_build_object(
        'schemaVersion', 1,
        'ok', false,
        'code', 'invalid_transition',
        'message', 'A terminal computer-task transition requires a terminal timestamp.'
      );
    END IF;
    v_next_terminal_at := (p_root_snapshot->>'terminalAt')::timestamptz;
  ELSE
    IF p_root_snapshot->'terminalAt' <> 'null'::jsonb THEN
      RETURN jsonb_build_object(
        'schemaVersion', 1,
        'ok', false,
        'code', 'invalid_transition',
        'message', 'A non-terminal computer-task transition cannot carry a terminal timestamp.'
      );
    END IF;
    v_next_terminal_at := NULL;
  END IF;

  UPDATE public.computer_task_roots
  SET state = v_next_state,
      replay_policy = v_next_replay_policy,
      revision = v_next_revision,
      root_snapshot = p_root_snapshot,
      updated_at = (p_root_snapshot->>'updatedAt')::timestamptz,
      terminal_at = v_next_terminal_at
  WHERE id = v_root.id;

  v_run_status := CASE v_next_state
    WHEN 'admitted' THEN 'planning'
    WHEN 'running' THEN 'running'
    WHEN 'waiting_approval' THEN 'waiting_approval'
    WHEN 'waiting_input' THEN 'paused'
    WHEN 'paused' THEN 'paused'
    WHEN 'verification_only' THEN 'paused'
    -- Root completion is coordination state, not task proof. A separate
    -- request-acceptance publisher must promote the wrapper run to completed.
    WHEN 'completed' THEN 'paused'
    WHEN 'failed' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'failed'
  END;

  UPDATE public.agent_runs
  SET status = v_run_status,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'computerTaskRootState', v_next_state,
        'computerTaskRootRevision', v_next_revision,
        'taskCompletionVerified', false,
        'rootCoordinationOnly', true
      ),
      updated_at = now(),
      completed_at = CASE
        WHEN v_run_status IN ('failed', 'cancelled')
          THEN COALESCE(v_next_terminal_at, now())
        ELSE NULL
      END
  WHERE id = v_root.run_id
    AND user_id = v_root.user_id
    AND circle_id = v_root.circle_id;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', 'transitioned',
    'rootRowId', v_root.id,
    'runId', v_root.run_id,
    'revision', v_next_revision,
    'state', v_next_state,
    'rootSnapshot', p_root_snapshot
  );
END;
$function$;

-- Root-bound action calls are deliberately separate from the generic section
-- 26 RPCs.  The generic ledger remains the authority for existing callers,
-- while these wrappers close the root/action split-brain window for the
-- feature-off universal-task canary.  Every wrapper locks the canonical root
-- first, derives the complete action-call identity from that locked row, then
-- locks or creates the matching action row.  The wrapper-run projection is
-- updated last by transition_computer_task_root_v1.

CREATE OR REPLACE FUNCTION public._computer_task_root_action_error_v1(
  p_code text,
  p_message text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'ok', false,
    'code', left(
      regexp_replace(
        COALESCE(p_code, 'invalid_input'),
        '[[:cntrl:]]+',
        ' ',
        'g'
      ),
      80
    ),
    'message', left(
      regexp_replace(
        COALESCE(
          p_message,
          'The root-bound durable action transition was refused.'
        ),
        '[[:cntrl:]]+',
        ' ',
        'g'
      ),
      240
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public._computer_task_root_action_identity_matches_v1(
  p_root public.computer_task_roots,
  p_action jsonb,
  p_call public.agent_action_calls
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE(
    p_call.schema_version = 1
    AND p_call.user_id = p_root.user_id
    AND p_call.circle_id = p_root.circle_id
    AND p_call.run_id = p_root.run_id
    AND p_call.tool_name = p_action->>'tool'
    -- The deterministic root action is the call identity.  A provider-backed
    -- gateway may introduce a separately attested provider-call identity in a
    -- later schema; callers cannot supply one to this V1 canary.
    AND p_call.tool_use_id = p_action->>'actionId'
    AND p_call.action_id = p_action->>'actionId'
    AND p_call.tool_args_fingerprint = p_action->>'toolArgsFingerprint'
    -- The per-action acceptance binding covers the canonical root,
    -- acceptance manifest, ordered action identity, and idempotency key.
    AND p_call.contract_fingerprint =
      p_action->>'acceptanceBindingFingerprint'
    AND p_call.idempotency_key = p_action->>'idempotencyKey',
    false
  )
$function$;

CREATE OR REPLACE FUNCTION public._computer_task_root_action_payload_v1(
  p_root_result jsonb,
  p_call public.agent_action_calls,
  p_disposition text,
  p_include_claim_token boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', p_disposition,
    'rootRowId', p_root_result->'rootRowId',
    'runId', p_root_result->'runId',
    'revision', p_root_result->'revision',
    'state', p_root_result->'state',
    'rootSnapshot', p_root_result->'rootSnapshot',
    'actionCall', public._agent_action_call_payload(
      p_call,
      CASE
        WHEN p_disposition IN (
          'settled', 'completed', 'failed', 'reconciled'
        ) THEN 'finished'
        ELSE p_disposition
      END,
      p_include_claim_token
    )
  )
$function$;

REVOKE ALL ON FUNCTION public._computer_task_root_action_error_v1(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._computer_task_root_action_identity_matches_v1(
  public.computer_task_roots, jsonb, public.agent_action_calls
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._computer_task_root_action_payload_v1(
  jsonb, public.agent_action_calls, text, boolean
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_computer_task_root_action_v1(
  p_root_row_id uuid,
  p_expected_revision integer,
  p_action_id text,
  p_root_snapshot jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_ttl_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
  v_action jsonb;
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz;
  v_ttl_seconds integer := LEAST(
    GREATEST(COALESCE(p_ttl_seconds, 120), 15),
    900
  );
  v_metadata jsonb := public._sanitize_agent_action_call_metadata(p_metadata);
  v_root_result jsonb;
  v_failure jsonb := NULL;
  v_disposition text := 'claimed';
BEGIN
  IF v_actor IS NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_authenticated',
      'Authenticated root-bound action claim is required.'
    );
  END IF;
  IF p_root_row_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR COALESCE(p_action_id, '') !~ '^computer_action_[0-9a-f]{64}$'
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_input',
      'The root-bound action claim identity or revision was invalid.'
    );
  END IF;

  -- Global lock order: computer_task_roots -> agent_action_calls ->
  -- agent_runs (the latter is updated by the nested root transition).
  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_found',
      'The authenticated computer-task root was not found.'
    );
  END IF;
  IF v_root.revision <> p_expected_revision THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The computer-task root revision changed before the action claim.'
    ) || jsonb_build_object(
      'currentRevision', v_root.revision,
      'rootSnapshot', v_root.root_snapshot
    );
  END IF;
  IF v_root.state IN ('completed', 'failed', 'cancelled') THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'A terminal computer-task root cannot claim or recover an action lease.'
    );
  END IF;

  SELECT entry.value
  INTO v_action
  FROM jsonb_array_elements(
    COALESCE(v_root.root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
  ) AS entry(value)
  WHERE entry.value->>'actionId' = p_action_id
  LIMIT 1;

  IF NOT FOUND
    OR jsonb_typeof(v_action) <> 'object'
    OR v_action->>'actionId' <> p_action_id
    OR (v_action->>'mutatesState')::boolean IS DISTINCT FROM true
    OR v_action#>>'{dispatchBinding,mutationAuthority}'
      IS DISTINCT FROM 'action_ledger'
    OR v_action#>>'{dispatchBinding,authorizationCategory}' IN (
      'read_only', 'proposal_only', 'unsupported'
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'Only an exact bound mutating root action may enter the action ledger.'
    );
  END IF;

  -- Resolve every unique identity under the already-held root lock.  Honest
  -- V1 roots derive all three keys from the root fingerprint, so a row found
  -- by a different key is necessarily an identity conflict.
  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE (
      action_call.run_id = v_root.run_id
      AND action_call.action_id = p_action_id
    )
    OR (
      action_call.user_id = v_root.user_id
      AND action_call.circle_id = v_root.circle_id
      AND action_call.idempotency_key = v_action->>'idempotencyKey'
    )
    OR (
      action_call.run_id = v_root.run_id
      AND action_call.tool_use_id = p_action_id
    )
  ORDER BY
    CASE
      WHEN action_call.run_id = v_root.run_id
        AND action_call.action_id = p_action_id
      THEN 0
      ELSE 1
    END,
    action_call.claimed_at
  LIMIT 1
  FOR UPDATE;

  -- Lock waits must never consume a lease while time stands still.  All
  -- claim and renewal timestamps are derived only after the root/action lock
  -- boundary has been acquired.
  v_now := clock_timestamp();

  IF FOUND THEN
    IF NOT public._computer_task_root_action_identity_matches_v1(
      v_root,
      v_action,
      v_call
    ) THEN
      RETURN public._computer_task_root_action_error_v1(
        'identity_conflict',
        'The root action identity is already bound to a different durable call.'
      );
    END IF;
    IF v_action->>'state' IS DISTINCT FROM v_call.state THEN
      RETURN public._computer_task_root_action_error_v1(
        'state_conflict',
        'The root action and durable action ledger disagree; no claim was issued.'
      );
    END IF;
    IF v_call.state = 'claimed' THEN
      IF p_root_snapshot IS DISTINCT FROM v_root.root_snapshot
        OR v_root.state <> 'running'
        OR v_root.replay_policy <> 'normal'
        OR v_root.root_snapshot->'interruptLatch' <> 'null'::jsonb
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            v_root.root_snapshot->'attempts'
          ) AS owner(value)
          WHERE owner.value->>'attemptId' = v_action->>'attemptId'
            AND owner.value->>'state' = 'active'
        )
      THEN
        RETURN public._computer_task_root_action_error_v1(
          'invalid_transition',
          'The claimed action lease cannot be recovered from a non-executable root.'
        );
      END IF;
      IF v_call.expires_at <= v_now THEN
        UPDATE public.agent_action_calls
        SET claim_token = gen_random_uuid(),
            metadata = metadata || v_metadata,
            state_version = state_version + 1,
            attempt_count = attempt_count + 1,
            claimed_at = v_now,
            expires_at = v_now + make_interval(secs => v_ttl_seconds),
            updated_at = v_now
        WHERE id = v_call.id
          AND state = 'claimed'
          AND state_version = v_call.state_version
        RETURNING * INTO v_call;
        IF NOT FOUND THEN
          RETURN public._computer_task_root_action_error_v1(
            'state_conflict',
            'Another worker changed the expired action claim.'
          );
        END IF;
        v_disposition := 'claimed';
      ELSE
        v_disposition := 'already_claimed';
      END IF;
      v_root_result := jsonb_build_object(
        'rootRowId', v_root.id,
        'runId', v_root.run_id,
        'revision', v_root.revision,
        'state', v_root.state,
        'rootSnapshot', v_root.root_snapshot
      );
      RETURN public._computer_task_root_action_payload_v1(
        v_root_result,
        v_call,
        v_disposition,
        true
      );
    END IF;

    v_root_result := jsonb_build_object(
      'rootRowId', v_root.id,
      'runId', v_root.run_id,
      'revision', v_root.revision,
      'state', v_root.state,
      'rootSnapshot', v_root.root_snapshot
    );
    RETURN public._computer_task_root_action_payload_v1(
      v_root_result,
      v_call,
      'duplicate',
      false
    );
  END IF;

  IF v_action->>'state' <> 'planned' OR p_root_snapshot IS NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'A missing ledger row can be created only for the exact planned root action.'
    );
  END IF;

  -- An exception block is a PostgreSQL subtransaction.  Any returned JSON
  -- error from the existing root transition is promoted to an exception so
  -- the action insert cannot survive without its matching root transition.
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
    ) VALUES (
      v_root.user_id,
      v_root.circle_id,
      v_root.run_id,
      v_action->>'tool',
      p_action_id,
      p_action_id,
      v_action->>'toolArgsFingerprint',
      v_action->>'acceptanceBindingFingerprint',
      v_action->>'idempotencyKey',
      v_metadata,
      v_now,
      v_now + make_interval(secs => v_ttl_seconds),
      v_now
    )
    RETURNING * INTO v_call;

    v_root_result := public.transition_computer_task_root_v1(
      v_root.id,
      p_expected_revision,
      'record_action_state',
      p_root_snapshot
    );
    IF COALESCE((v_root_result->>'ok')::boolean, false) IS DISTINCT FROM true THEN
      v_failure := v_root_result;
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_claim_rollback';
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      v_failure := public._computer_task_root_action_error_v1(
        'identity_conflict',
        'A competing root-bound action identity already owns this durable call.'
      );
    WHEN SQLSTATE 'P0001' THEN
      NULL;
    WHEN OTHERS THEN
      v_failure := public._computer_task_root_action_error_v1(
        'rpc_error',
        'Root-bound action storage failed closed before claim completion.'
      );
  END;

  IF v_failure IS NOT NULL THEN
    RETURN v_failure;
  END IF;
  RETURN public._computer_task_root_action_payload_v1(
    v_root_result,
    v_call,
    'claimed',
    true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_computer_task_root_action_v1(
  p_root_row_id uuid,
  p_expected_revision integer,
  p_action_id text,
  p_claim_token uuid,
  p_root_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
  v_action jsonb;
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz;
  v_root_result jsonb;
  v_failure jsonb := NULL;
BEGIN
  IF v_actor IS NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_authenticated',
      'Authenticated root-bound action start is required.'
    );
  END IF;
  IF p_root_row_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR COALESCE(p_action_id, '') !~ '^computer_action_[0-9a-f]{64}$'
    OR p_claim_token IS NULL
    OR p_root_snapshot IS NULL
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_input',
      'The root-bound action start identity, token, revision, or snapshot was invalid.'
    );
  END IF;

  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_found',
      'The authenticated computer-task root was not found.'
    );
  END IF;
  IF v_root.revision <> p_expected_revision THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The computer-task root revision changed before handler entry.'
    ) || jsonb_build_object(
      'currentRevision', v_root.revision,
      'rootSnapshot', v_root.root_snapshot
    );
  END IF;
  IF v_root.state IN ('completed', 'failed', 'cancelled') THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'A terminal computer-task root cannot authorize handler entry.'
    );
  END IF;

  SELECT entry.value
  INTO v_action
  FROM jsonb_array_elements(
    COALESCE(v_root.root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
  ) AS entry(value)
  WHERE entry.value->>'actionId' = p_action_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_not_found',
      'The root action was not found at handler entry.'
    );
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE action_call.run_id = v_root.run_id
    AND action_call.action_id = p_action_id
  FOR UPDATE;

  -- Refresh after both row locks.  A queued start cannot inherit the time at
  -- function entry and thereby outlive its durable claim or foreground lease.
  v_now := clock_timestamp();

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_not_found',
      'No durable call exists for this exact root action.'
    );
  END IF;
  IF NOT public._computer_task_root_action_identity_matches_v1(
    v_root,
    v_action,
    v_call
  ) THEN
    RETURN public._computer_task_root_action_error_v1(
      'identity_conflict',
      'The durable call no longer matches its locked root action.'
    );
  END IF;
  IF v_action->>'state' IS DISTINCT FROM v_call.state THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The root action and durable action ledger disagree at handler entry.'
    );
  END IF;
  IF v_call.state <> 'claimed' THEN
    v_root_result := jsonb_build_object(
      'rootRowId', v_root.id,
      'runId', v_root.run_id,
      'revision', v_root.revision,
      'state', v_root.state,
      'rootSnapshot', v_root.root_snapshot
    );
    RETURN public._computer_task_root_action_payload_v1(
      v_root_result,
      v_call,
      'duplicate',
      false
    );
  END IF;
  IF v_call.claim_token <> p_claim_token THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_token_mismatch',
      'The durable root-action claim token does not match.'
    );
  END IF;
  IF v_call.expires_at <= v_now THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_expired',
      'The durable root-action claim expired before handler entry.'
    );
  END IF;
  IF COALESCE((v_action->>'requiresForegroundLease')::boolean, false)
    AND (
      v_root.root_snapshot#>>'{foregroundLease,status}'
        IS DISTINCT FROM 'active'
      OR v_root.root_snapshot#>>'{foregroundLease,actionId}'
        IS DISTINCT FROM p_action_id
      OR v_root.root_snapshot#>>'{foregroundLease,expiresAt}' IS NULL
      OR (v_root.root_snapshot#>>'{foregroundLease,expiresAt}')::timestamptz
        <= v_now
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'The required foreground lease expired or changed while handler entry was queued.'
    );
  END IF;

  BEGIN
    UPDATE public.agent_action_calls
    SET state = 'dispatched',
        state_version = state_version + 1,
        dispatched_at = v_now,
        expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
        updated_at = v_now
    WHERE id = v_call.id
      AND state = 'claimed'
      AND state_version = v_call.state_version
      AND claim_token = p_claim_token
    RETURNING * INTO v_call;
    IF NOT FOUND THEN
      v_failure := public._computer_task_root_action_error_v1(
        'state_conflict',
        'Another worker changed the durable action before handler entry.'
      );
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_start_rollback';
    END IF;

    v_root_result := public.transition_computer_task_root_v1(
      v_root.id,
      p_expected_revision,
      'record_action_state',
      p_root_snapshot
    );
    IF COALESCE((v_root_result->>'ok')::boolean, false) IS DISTINCT FROM true THEN
      v_failure := v_root_result;
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_start_rollback';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
    WHEN OTHERS THEN
      v_failure := public._computer_task_root_action_error_v1(
        'rpc_error',
        'Root-bound action storage failed closed before handler entry.'
      );
  END;

  IF v_failure IS NOT NULL THEN
    RETURN v_failure;
  END IF;
  RETURN public._computer_task_root_action_payload_v1(
    v_root_result,
    v_call,
    'started',
    false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_computer_task_root_action_v1(
  p_root_row_id uuid,
  p_expected_revision integer,
  p_action_id text,
  p_claim_token uuid,
  p_final_state text,
  p_proof_fingerprint text,
  p_root_snapshot jsonb,
  p_terminal_transition text DEFAULT NULL,
  p_terminal_root_snapshot jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
  v_action jsonb;
  v_next_action jsonb;
  v_call public.agent_action_calls%ROWTYPE;
  v_prior_state text;
  v_now timestamptz;
  v_metadata jsonb := public._sanitize_agent_action_call_metadata(p_metadata);
  v_root_result jsonb;
  v_failure jsonb := NULL;
BEGIN
  IF v_actor IS NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_authenticated',
      'Authenticated root-bound action settlement is required.'
    );
  END IF;
  IF p_root_row_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR COALESCE(p_action_id, '') !~ '^computer_action_[0-9a-f]{64}$'
    OR p_final_state NOT IN ('verified', 'failed', 'outcome_unknown')
    OR p_root_snapshot IS NULL
    OR (
      p_proof_fingerprint IS NOT NULL
      AND p_proof_fingerprint !~ '^args-v2:sha256:[0-9a-f]{64}$'
    )
    OR (
      p_terminal_transition IS NULL
      AND p_terminal_root_snapshot IS NOT NULL
    )
    OR (
      p_terminal_transition IS NOT NULL
      AND p_terminal_root_snapshot IS NULL
    )
    OR p_terminal_transition IS NOT NULL
      AND p_terminal_transition NOT IN ('complete', 'fail')
    OR p_final_state = 'outcome_unknown'
      AND p_terminal_transition IS NOT NULL
    OR p_final_state = 'verified'
      AND p_terminal_transition IS NOT NULL
      AND p_terminal_transition <> 'complete'
    OR p_final_state = 'failed'
      AND p_terminal_transition IS NOT NULL
      AND p_terminal_transition <> 'fail'
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_input',
      'The root-bound settlement state, proof, or terminal snapshot was invalid.'
    );
  END IF;

  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_found',
      'The authenticated computer-task root was not found.'
    );
  END IF;
  IF v_root.revision <> p_expected_revision THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The computer-task root revision changed before action settlement.'
    ) || jsonb_build_object(
      'currentRevision', v_root.revision,
      'rootSnapshot', v_root.root_snapshot
    );
  END IF;
  IF v_root.state IN ('completed', 'failed', 'cancelled') THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'A terminal computer-task root cannot mutate its action settlement.'
    );
  END IF;

  SELECT entry.value
  INTO v_action
  FROM jsonb_array_elements(
    COALESCE(v_root.root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
  ) AS entry(value)
  WHERE entry.value->>'actionId' = p_action_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_not_found',
      'The root action was not found during settlement.'
    );
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE action_call.run_id = v_root.run_id
    AND action_call.action_id = p_action_id
  FOR UPDATE;

  -- Settlement chronology is database-owned after lock acquisition, never
  -- the stale timestamp from a request that waited behind another worker.
  v_now := clock_timestamp();

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_not_found',
      'No durable call exists for this exact root action.'
    );
  END IF;
  IF NOT public._computer_task_root_action_identity_matches_v1(
    v_root,
    v_action,
    v_call
  ) THEN
    RETURN public._computer_task_root_action_error_v1(
      'identity_conflict',
      'The durable call no longer matches its locked root action.'
    );
  END IF;
  IF v_action->>'state' IS DISTINCT FROM v_call.state THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The root action and durable action ledger disagree during settlement.'
    );
  END IF;

  -- Reconciliation intentionally carries no claim token.  Every other
  -- settlement must present the exact token, including idempotent terminal
  -- reads, so a mismatched lease is never disguised as a state transition.
  IF v_call.state = 'outcome_unknown' AND p_final_state = 'verified' THEN
    IF p_claim_token IS NOT NULL THEN
      RETURN public._computer_task_root_action_error_v1(
        'claim_token_mismatch',
        'Outcome-unknown reconciliation must not replay a mutation claim token.'
      );
    END IF;
  ELSIF p_claim_token IS NULL OR v_call.claim_token <> p_claim_token THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_token_mismatch',
      'The durable root-action settlement claim token does not match.'
    );
  END IF;

  IF v_call.state IN ('verified', 'failed', 'outcome_unknown')
    AND v_call.state = p_final_state
  THEN
    v_root_result := jsonb_build_object(
      'rootRowId', v_root.id,
      'runId', v_root.run_id,
      'revision', v_root.revision,
      'state', v_root.state,
      'rootSnapshot', v_root.root_snapshot
    );
    RETURN public._computer_task_root_action_payload_v1(
      v_root_result,
      v_call,
      'already_finished',
      false
    );
  END IF;

  v_prior_state := v_call.state;
  IF NOT (
      v_prior_state = 'claimed'
        AND p_final_state = 'failed'
        AND p_claim_token IS NOT NULL
        AND v_call.claim_token = p_claim_token
      OR v_prior_state = 'dispatched'
        AND p_final_state IN ('verified', 'outcome_unknown')
        AND p_claim_token IS NOT NULL
        AND v_call.claim_token = p_claim_token
      OR v_prior_state = 'outcome_unknown'
        AND p_final_state = 'verified'
        AND p_claim_token IS NULL
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'The root-bound action cannot enter the requested terminal state.'
    );
  END IF;

  IF p_final_state = 'verified' AND (
      p_proof_fingerprint IS NULL
      OR COALESCE((v_metadata->>'evidenceCount')::integer, 0) < 1
      OR COALESCE((v_metadata->>'blockerCount')::integer, 0) <> 0
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'proof_required',
      'Verified settlement requires a proof fingerprint and positive blocker-free evidence.'
    );
  END IF;
  IF p_final_state = 'failed' AND p_proof_fingerprint IS NOT NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'A known pre-dispatch failure cannot carry post-dispatch proof.'
    );
  END IF;

  SELECT entry.value
  INTO v_next_action
  FROM jsonb_array_elements(
    COALESCE(p_root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
  ) AS entry(value)
  WHERE entry.value->>'actionId' = p_action_id
  LIMIT 1;
  IF NOT FOUND
    OR v_next_action->>'state' IS DISTINCT FROM p_final_state
    OR (
      p_proof_fingerprint IS NULL
      AND v_next_action->'proofFingerprint' <> 'null'::jsonb
    )
    OR (
      p_proof_fingerprint IS NOT NULL
      AND v_next_action->>'proofFingerprint'
        IS DISTINCT FROM p_proof_fingerprint
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'proof_mismatch',
      'The settlement proof did not match the exact next root action snapshot.'
    );
  END IF;

  v_metadata := v_metadata || jsonb_build_object(
    'completionVerified', p_final_state = 'verified',
    'outcomeUnknown', p_final_state = 'outcome_unknown'
  );

  BEGIN
    IF v_prior_state = 'outcome_unknown' THEN
      -- This is the only section-26 terminal reconciliation path.  It is
      -- intentionally unavailable through generic finish_agent_action_call
      -- and requires the exact locked root, exact ledger version, and a fresh
      -- proof fingerprint reflected in the next root snapshot.  The feature
      -- remains off until the trusted gateway attests that proof leaf.
      UPDATE public.agent_action_calls
      SET state = 'verified',
          metadata = metadata || v_metadata,
          state_version = state_version + 1,
          expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
          updated_at = v_now
      WHERE id = v_call.id
        AND state = 'outcome_unknown'
        AND state_version = v_call.state_version
      RETURNING * INTO v_call;
    ELSE
      UPDATE public.agent_action_calls
      SET state = p_final_state,
          metadata = metadata || v_metadata,
          state_version = state_version + 1,
          finished_at = v_now,
          expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
          updated_at = v_now
      WHERE id = v_call.id
        AND state = v_prior_state
        AND state_version = v_call.state_version
        AND claim_token = p_claim_token
      RETURNING * INTO v_call;
    END IF;
    IF NOT FOUND THEN
      v_failure := public._computer_task_root_action_error_v1(
        'state_conflict',
        'Another worker changed the durable action before settlement.'
      );
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_settle_rollback';
    END IF;

    v_root_result := public.transition_computer_task_root_v1(
      v_root.id,
      p_expected_revision,
      'record_action_state',
      p_root_snapshot
    );
    IF COALESCE((v_root_result->>'ok')::boolean, false) IS DISTINCT FROM true THEN
      v_failure := v_root_result;
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_settle_rollback';
    END IF;

    IF p_terminal_transition IS NOT NULL THEN
      v_root_result := public.transition_computer_task_root_v1(
        v_root.id,
        p_expected_revision + 1,
        p_terminal_transition,
        p_terminal_root_snapshot
      );
      IF COALESCE((v_root_result->>'ok')::boolean, false) IS DISTINCT FROM true THEN
        v_failure := v_root_result;
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'root_bound_action_terminal_rollback';
      END IF;
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
    WHEN OTHERS THEN
      v_failure := public._computer_task_root_action_error_v1(
        'rpc_error',
        'Root-bound action storage failed closed during settlement.'
      );
  END;

  IF v_failure IS NOT NULL THEN
    RETURN v_failure;
  END IF;
  RETURN public._computer_task_root_action_payload_v1(
    v_root_result,
    v_call,
    CASE
      WHEN v_prior_state = 'outcome_unknown' THEN 'reconciled'
      WHEN p_terminal_transition = 'complete' THEN 'completed'
      WHEN p_terminal_transition = 'fail' THEN 'failed'
      ELSE 'settled'
    END,
    false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admit_computer_task_root_v1(
  uuid, uuid, text, text, text, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.read_computer_task_root_v1(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_computer_task_root_v1(
  uuid, integer, text, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_computer_task_root_action_v1(
  uuid, integer, text, jsonb, jsonb, integer
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_computer_task_root_action_v1(
  uuid, integer, text, uuid, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_computer_task_root_action_v1(
  uuid, integer, text, uuid, text, text, jsonb, text, jsonb, jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admit_computer_task_root_v1(
  uuid, uuid, text, text, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_computer_task_root_v1(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_computer_task_root_v1(
  uuid, integer, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_computer_task_root_action_v1(
  uuid, integer, text, jsonb, jsonb, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_computer_task_root_action_v1(
  uuid, integer, text, uuid, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_computer_task_root_action_v1(
  uuid, integer, text, uuid, text, text, jsonb, text, jsonb, jsonb
) TO authenticated;

COMMENT ON TABLE public.computer_task_roots IS
  'Authenticated request-bound coordination roots. Rows and snapshots are inert until revalidated by the runtime; mutation authority remains in exact tool policy and agent_action_calls.';

COMMENT ON FUNCTION public.admit_computer_task_root_v1(
  uuid, uuid, text, text, text, jsonb
) IS
  'Atomically create or recover one exact computer-task root and wrapper agent run for the authenticated Chat request.';

COMMENT ON FUNCTION public.read_computer_task_root_v1(uuid) IS
  'Rehydrate one authenticated root pointer after refresh; returned JSON remains inert until strict client hydration.';

COMMENT ON FUNCTION public.transition_computer_task_root_v1(
  uuid, integer, text, jsonb
) IS
  'Apply one exact revision-CAS computer-task transition while preserving immutable request, replay, interrupt, acceptance, and terminal boundaries.';

COMMENT ON FUNCTION public.claim_computer_task_root_action_v1(
  uuid, integer, text, jsonb, jsonb, integer
) IS
  'Root-row-first atomic planned-to-claimed transition or claimed-lease recovery. Derives one exact section-26 call from the locked root action and reuses the canonical root run.';

COMMENT ON FUNCTION public.start_computer_task_root_action_v1(
  uuid, integer, text, uuid, jsonb
) IS
  'Root-row-first atomic claimed-to-dispatched transition. Only a started disposition authorizes one handler entry.';

COMMENT ON FUNCTION public.settle_computer_task_root_action_v1(
  uuid, integer, text, uuid, text, text, jsonb, text, jsonb, jsonb
) IS
  'Root-row-first atomic action settlement, including narrow proof-bound outcome_unknown-to-verified reconciliation and optional same-transaction root completion or failure.';

COMMIT;

NOTIFY pgrst, 'reload schema';
