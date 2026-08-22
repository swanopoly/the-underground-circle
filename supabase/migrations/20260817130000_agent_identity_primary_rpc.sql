-- Transactional primary-agent selection for durable agent identities.
--
-- The legacy client implementation cleared peer rows and promoted the target
-- through separate requests. Concurrent tabs could therefore leave zero or
-- multiple apparent primaries. This forward migration repairs legacy
-- duplicates, installs a database invariant, and exposes one owner-bound RPC
-- whose function call is one PostgreSQL transaction.

BEGIN;

DO $prerequisite$
BEGIN
  IF to_regclass('public.agent_identities') IS NULL THEN
    RAISE EXCEPTION 'agent_identities_required'
      USING ERRCODE = '55000';
  END IF;
END;
$prerequisite$;

ALTER TABLE public.agent_identities ENABLE ROW LEVEL SECURITY;

-- Keep the newest legacy primary deterministically before installing the
-- partial unique index. Reapplying this repair is a no-op once the invariant
-- is present.
WITH ranked_primaries AS (
  SELECT
    identity_row.ctid,
    row_number() OVER (
      PARTITION BY identity_row.user_id, identity_row.bound_ai_provider
      ORDER BY
        identity_row.last_seen DESC NULLS LAST,
        identity_row.updated_at DESC NULLS LAST,
        identity_row.created_at DESC NULLS LAST,
        identity_row.id DESC
    ) AS primary_rank
  FROM public.agent_identities AS identity_row
  WHERE identity_row.is_primary IS TRUE
    AND identity_row.bound_ai_provider IS NOT NULL
)
UPDATE public.agent_identities AS identity_row
SET is_primary = false
FROM ranked_primaries AS ranked
WHERE identity_row.ctid = ranked.ctid
  AND ranked.primary_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS agent_identities_one_primary_per_provider_idx
  ON public.agent_identities (user_id, bound_ai_provider)
  WHERE is_primary IS TRUE
    AND bound_ai_provider IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_main_agent_for_provider_v1(
  p_session_key text,
  p_provider_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_target_id uuid;
  v_primary_updated_at timestamptz;
  v_inserted_rows integer := 0;
  v_cleared_rows integer := 0;
  v_target_rows integer := 0;
  v_provider_row_count integer := 0;
  v_primary_count integer := 0;
  v_target_primary_count integer := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_session_key IS NULL
     OR p_session_key <> pg_catalog.btrim(p_session_key)
     OR pg_catalog.char_length(p_session_key) NOT BETWEEN 1 AND 200
     OR p_session_key ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'agent_identity_session_key_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_provider_type IS NULL
     OR p_provider_type <> pg_catalog.btrim(p_provider_type)
     OR pg_catalog.char_length(p_provider_type) NOT BETWEEN 1 AND 200
     OR p_provider_type ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'agent_identity_provider_type_invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize every primary reassignment for this owner. User-wide locking
  -- also prevents cross-provider target swaps from deadlocking when the same
  -- two session rows are moved in opposite directions.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text, 714071347::bigint)
  );

  INSERT INTO public.agent_identities (
    user_id,
    session_key,
    bound_ai_provider,
    is_primary
  )
  VALUES (
    v_actor_id,
    p_session_key,
    p_provider_type,
    false
  )
  ON CONFLICT (user_id, session_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;

  SELECT identity_row.id
  INTO STRICT v_target_id
  FROM public.agent_identities AS identity_row
  WHERE identity_row.user_id = v_actor_id
    AND identity_row.session_key = p_session_key
  FOR UPDATE;

  UPDATE public.agent_identities AS identity_row
  SET is_primary = false
  WHERE identity_row.user_id = v_actor_id
    AND identity_row.bound_ai_provider = p_provider_type
    AND identity_row.session_key <> p_session_key
    AND identity_row.is_primary IS TRUE;
  GET DIAGNOSTICS v_cleared_rows = ROW_COUNT;

  UPDATE public.agent_identities AS identity_row
  SET bound_ai_provider = p_provider_type,
      is_primary = true,
      last_seen = pg_catalog.clock_timestamp()
  WHERE identity_row.id = v_target_id
    AND identity_row.user_id = v_actor_id
    AND identity_row.session_key = p_session_key
  RETURNING identity_row.updated_at
  INTO v_primary_updated_at;
  GET DIAGNOSTICS v_target_rows = ROW_COUNT;

  IF v_target_rows <> 1 THEN
    RAISE EXCEPTION 'agent_identity_primary_target_conflict'
      USING ERRCODE = '40001';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE identity_row.is_primary IS TRUE)::integer,
    pg_catalog.count(*) FILTER (
      WHERE identity_row.is_primary IS TRUE
        AND identity_row.session_key = p_session_key
    )::integer
  INTO
    v_provider_row_count,
    v_primary_count,
    v_target_primary_count
  FROM public.agent_identities AS identity_row
  WHERE identity_row.user_id = v_actor_id
    AND identity_row.bound_ai_provider = p_provider_type;

  IF v_provider_row_count NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'agent_identity_provider_row_limit_exceeded'
      USING ERRCODE = '54000';
  END IF;

  IF v_primary_count <> 1 OR v_target_primary_count <> 1 THEN
    RAISE EXCEPTION 'agent_identity_primary_invariant_failed'
      USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(identity_row)
      ORDER BY identity_row.session_key
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.agent_identities AS identity_row
  WHERE identity_row.user_id = v_actor_id
    AND identity_row.bound_ai_provider = p_provider_type;

  IF pg_catalog.pg_column_size(v_rows) > 4194304 THEN
    RAISE EXCEPTION 'agent_identity_primary_receipt_too_large'
      USING ERRCODE = '54000';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'userId', v_actor_id::text,
    'providerType', p_provider_type,
    'requestedSessionKey', p_session_key,
    'primarySessionKey', p_session_key,
    'primaryId', v_target_id::text,
    'primaryUpdatedAt', pg_catalog.to_jsonb(v_primary_updated_at),
    'inserted', v_inserted_rows = 1,
    'clearedCount', v_cleared_rows,
    'targetRowCount', v_target_rows,
    'rowCount', v_provider_row_count,
    'rows', v_rows
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_agent_identity_primary_columns_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_primary_rpc_owner name;
  v_sensitive_change boolean := false;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(procedure_row.proowner)
  INTO v_primary_rpc_owner
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid =
    'public.set_main_agent_for_provider_v1(text,text)'::pg_catalog.regprocedure;

  IF TG_OP = 'INSERT' THEN
    v_sensitive_change := NEW.is_primary IS TRUE;
  ELSIF TG_OP = 'UPDATE' THEN
    v_sensitive_change := (NEW.is_primary IS TRUE) IS DISTINCT FROM (OLD.is_primary IS TRUE)
      OR (
        NEW.bound_ai_provider IS DISTINCT FROM OLD.bound_ai_provider
        AND (NEW.is_primary IS TRUE OR OLD.is_primary IS TRUE)
      );
  ELSIF TG_OP = 'DELETE' THEN
    v_sensitive_change := OLD.is_primary IS TRUE;
  END IF;

  IF v_sensitive_change
     AND (
       v_primary_rpc_owner IS NULL
       OR current_user IS DISTINCT FROM v_primary_rpc_owner
     ) THEN
    RAISE EXCEPTION 'agent_identity_primary_rpc_required'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_identity_primary_columns_guard
  ON public.agent_identities;
CREATE TRIGGER agent_identity_primary_columns_guard
  BEFORE INSERT OR UPDATE OF is_primary, bound_ai_provider
  ON public.agent_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_agent_identity_primary_columns_v1();

DROP TRIGGER IF EXISTS agent_identity_primary_delete_guard
  ON public.agent_identities;
CREATE TRIGGER agent_identity_primary_delete_guard
  BEFORE DELETE
  ON public.agent_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_agent_identity_primary_columns_v1();

REVOKE ALL ON FUNCTION public.set_main_agent_for_provider_v1(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_main_agent_for_provider_v1(text, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.guard_agent_identity_primary_columns_v1()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON INDEX public.agent_identities_one_primary_per_provider_idx IS
  'At most one durable primary identity per exact owner and provider.';
COMMENT ON FUNCTION public.set_main_agent_for_provider_v1(text, text) IS
  'Atomically selects one authenticated owner session as the exact primary for one provider and returns validated provider rows.';
COMMENT ON FUNCTION public.guard_agent_identity_primary_columns_v1() IS
  'Rejects direct primary/provider identity changes and primary-row deletion outside the canonical SECURITY DEFINER RPC.';

COMMIT;

NOTIFY pgrst, 'reload schema';
