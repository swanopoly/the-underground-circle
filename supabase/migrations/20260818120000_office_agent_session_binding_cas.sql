-- Exact compare-and-set mutation contract for owner-private Office-agent to
-- OpenSwan session bindings. The original §36 set/clear RPCs accepted no
-- expected row and therefore allowed a stale client to overwrite or clear a
-- route changed by another tab. This forward migration retires their execute
-- authority and exposes one receipt-bearing CAS RPC instead.

BEGIN;

CREATE OR REPLACE FUNCTION public.compare_and_set_office_agent_session_binding_v1(
  p_office_agent_id uuid,
  p_circle_id uuid,
  p_expected_binding_id uuid,
  p_expected_agent_bot_id uuid,
  p_expected_session_key text,
  p_expected_updated_at timestamptz,
  p_next_agent_bot_id uuid,
  p_next_session_key text
)
RETURNS TABLE (
  mutation_contract_version integer,
  mutation_disposition text,
  mutation_operation text,
  office_agent_id uuid,
  observed_binding_id uuid,
  observed_agent_bot_id uuid,
  observed_session_key text,
  observed_updated_at timestamptz,
  result_binding_id uuid,
  result_agent_bot_id uuid,
  result_session_key text,
  result_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_office_provider text;
  v_office_is_published boolean;
  v_bot_provider text;
  v_observed_owner_id uuid;
  v_observed_binding_id uuid;
  v_observed_agent_bot_id uuid;
  v_observed_session_key text;
  v_observed_updated_at timestamptz;
  v_has_observed boolean := false;
  v_expected_missing boolean;
  v_next_missing boolean;
  v_expected_matches boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_auth_required';
  END IF;
  IF p_office_agent_id IS NULL OR p_circle_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_invalid_identity';
  END IF;

  v_expected_missing := p_expected_binding_id IS NULL
    AND p_expected_agent_bot_id IS NULL
    AND p_expected_session_key IS NULL
    AND p_expected_updated_at IS NULL;
  IF NOT v_expected_missing AND (
    p_expected_binding_id IS NULL
    OR p_expected_agent_bot_id IS NULL
    OR p_expected_session_key IS NULL
    OR p_expected_updated_at IS NULL
    OR pg_catalog.char_length(p_expected_session_key) NOT BETWEEN 1 AND 160
    OR p_expected_session_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_invalid_expected_identity';
  END IF;

  v_next_missing := p_next_agent_bot_id IS NULL AND p_next_session_key IS NULL;
  IF NOT v_next_missing AND (
    p_next_agent_bot_id IS NULL
    OR p_next_session_key IS NULL
    OR pg_catalog.char_length(p_next_session_key) NOT BETWEEN 1 AND 160
    OR p_next_session_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_invalid_next_identity';
  END IF;

  -- Every mutation for one Office agent serializes through its public owner
  -- row, including the expected-null first-bind case where no private row yet
  -- exists to lock.
  SELECT office_agent.provider, office_agent.is_published
  INTO v_office_provider, v_office_is_published
  FROM public.circle_office_agents AS office_agent
  WHERE office_agent.id = p_office_agent_id
    AND office_agent.circle_id = p_circle_id
    AND office_agent.owner_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_agent_scope_required';
  END IF;

  IF NOT v_next_missing THEN
    IF v_office_is_published IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'office_agent_session_binding_published_agent_required';
    END IF;
    IF v_office_provider IS DISTINCT FROM 'openswan' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'office_agent_session_binding_office_provider_required';
    END IF;

    SELECT agent_bot.metadata ->> 'provider'
    INTO v_bot_provider
    FROM public.agents_bots AS agent_bot
    WHERE agent_bot.id = p_next_agent_bot_id
      AND agent_bot.owner_id = v_uid
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'office_agent_session_binding_bot_ownership_required';
    END IF;
    IF v_bot_provider IS DISTINCT FROM 'openswan' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'office_agent_session_binding_bot_provider_required';
    END IF;
  END IF;

  SELECT
    binding.id,
    binding.owner_id,
    binding.agent_bot_id,
    binding.session_key,
    binding.updated_at
  INTO
    v_observed_binding_id,
    v_observed_owner_id,
    v_observed_agent_bot_id,
    v_observed_session_key,
    v_observed_updated_at
  FROM public.office_agent_session_bindings AS binding
  WHERE binding.office_agent_id = p_office_agent_id
  FOR UPDATE;
  v_has_observed := FOUND;

  IF v_has_observed AND v_observed_owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_ownership_conflict';
  END IF;

  mutation_contract_version := 1;
  office_agent_id := p_office_agent_id;
  mutation_operation := CASE
    WHEN v_next_missing THEN 'clear'
    WHEN v_expected_missing THEN 'bind'
    ELSE 'move'
  END;
  observed_binding_id := CASE WHEN v_has_observed THEN v_observed_binding_id ELSE NULL END;
  observed_agent_bot_id := CASE WHEN v_has_observed THEN v_observed_agent_bot_id ELSE NULL END;
  observed_session_key := CASE WHEN v_has_observed THEN v_observed_session_key ELSE NULL END;
  observed_updated_at := CASE WHEN v_has_observed THEN v_observed_updated_at ELSE NULL END;

  v_expected_matches := CASE
    WHEN v_expected_missing THEN NOT v_has_observed
    ELSE v_has_observed
      AND v_observed_binding_id = p_expected_binding_id
      AND v_observed_agent_bot_id = p_expected_agent_bot_id
      AND v_observed_session_key = p_expected_session_key
      AND v_observed_updated_at = p_expected_updated_at
  END;

  IF NOT v_expected_matches THEN
    mutation_disposition := 'conflict';
    result_binding_id := observed_binding_id;
    result_agent_bot_id := observed_agent_bot_id;
    result_session_key := observed_session_key;
    result_updated_at := observed_updated_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_next_missing AND NOT v_has_observed THEN
    mutation_disposition := 'unchanged';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_has_observed
     AND NOT v_next_missing
     AND v_observed_agent_bot_id = p_next_agent_bot_id
     AND v_observed_session_key = p_next_session_key THEN
    mutation_disposition := 'unchanged';
    result_binding_id := observed_binding_id;
    result_agent_bot_id := observed_agent_bot_id;
    result_session_key := observed_session_key;
    result_updated_at := observed_updated_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_next_missing THEN
    DELETE FROM public.office_agent_session_bindings AS binding
    WHERE binding.id = v_observed_binding_id
      AND binding.office_agent_id = p_office_agent_id
      AND binding.owner_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '40001',
        MESSAGE = 'office_agent_session_binding_locked_clear_failed';
    END IF;
    mutation_disposition := 'applied';
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT v_has_observed THEN
    INSERT INTO public.office_agent_session_bindings (
      office_agent_id,
      owner_id,
      agent_bot_id,
      session_key
    ) VALUES (
      p_office_agent_id,
      v_uid,
      p_next_agent_bot_id,
      p_next_session_key
    )
    ON CONFLICT DO NOTHING
    RETURNING id, agent_bot_id, session_key, updated_at
    INTO result_binding_id, result_agent_bot_id, result_session_key, result_updated_at;

    IF result_binding_id IS NULL THEN
      mutation_disposition := 'target_conflict';
    ELSE
      mutation_disposition := 'applied';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    UPDATE public.office_agent_session_bindings AS binding
    SET agent_bot_id = p_next_agent_bot_id,
        session_key = p_next_session_key,
        updated_at = GREATEST(
          pg_catalog.clock_timestamp(),
          binding.updated_at + INTERVAL '1 microsecond'
        )
    WHERE binding.id = v_observed_binding_id
      AND binding.office_agent_id = p_office_agent_id
      AND binding.owner_id = v_uid
    RETURNING binding.id, binding.agent_bot_id, binding.session_key, binding.updated_at
    INTO result_binding_id, result_agent_bot_id, result_session_key, result_updated_at;
  EXCEPTION WHEN unique_violation THEN
    mutation_disposition := 'target_conflict';
    result_binding_id := observed_binding_id;
    result_agent_bot_id := observed_agent_bot_id;
    result_session_key := observed_session_key;
    result_updated_at := observed_updated_at;
    RETURN NEXT;
    RETURN;
  END;

  IF result_binding_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'office_agent_session_binding_locked_move_failed';
  END IF;
  mutation_disposition := 'applied';
  RETURN NEXT;
END;
$function$;

-- The old APIs cannot express an expected row. Keep their definitions only so
-- stale clients fail with denied execution rather than silently overwriting a
-- newer route.
REVOKE ALL ON FUNCTION public.set_office_agent_session_binding(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_office_agent_session_binding(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.compare_and_set_office_agent_session_binding_v1(
  uuid, uuid, uuid, uuid, text, timestamptz, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compare_and_set_office_agent_session_binding_v1(
  uuid, uuid, uuid, uuid, text, timestamptz, uuid, text
) TO authenticated;

COMMENT ON FUNCTION public.set_office_agent_session_binding(uuid, uuid, text) IS
  'Deprecated non-CAS Office session binding API; execution is revoked. Use compare_and_set_office_agent_session_binding_v1.';
COMMENT ON FUNCTION public.clear_office_agent_session_binding(uuid) IS
  'Deprecated non-CAS Office session clear API; execution is revoked. Use compare_and_set_office_agent_session_binding_v1.';
COMMENT ON FUNCTION public.compare_and_set_office_agent_session_binding_v1(
  uuid, uuid, uuid, uuid, text, timestamptz, uuid, text
) IS
  'Owner/circle-bound exact compare-and-set for one private Office-agent OpenSwan route. Returns the locked precondition and exact postcondition without replay.';

COMMIT;

NOTIFY pgrst, 'reload schema';
