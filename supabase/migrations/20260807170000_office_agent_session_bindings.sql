-- Owner-private linkage from one published Office agent to one exact OpenSwan
-- connection/session configuration. This migration intentionally performs no
-- backfill: pre-existing Office agents remain unbound until their owner makes
-- an explicit selection through the manager RPC.

BEGIN;

CREATE TABLE IF NOT EXISTS public.office_agent_session_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_agent_id uuid NOT NULL
    REFERENCES public.circle_office_agents(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_bot_id uuid NOT NULL
    REFERENCES public.agents_bots(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT office_agent_session_bindings_office_agent_key
    UNIQUE (office_agent_id),
  CONSTRAINT office_agent_session_bindings_bot_session_key
    UNIQUE (agent_bot_id, session_key),
  CONSTRAINT office_agent_session_bindings_session_key_length
    CHECK (pg_catalog.char_length(session_key) BETWEEN 1 AND 160),
  CONSTRAINT office_agent_session_bindings_session_key_grammar
    CHECK (session_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
);

COMMENT ON TABLE public.office_agent_session_bindings IS
  'Owner-private, explicit binding from one published Office agent to one exact OpenSwan connection/session configuration. No implicit or name-based fallback.';
COMMENT ON COLUMN public.office_agent_session_bindings.agent_bot_id IS
  'Exact public.agents_bots row for the owner-managed OpenSwan connection configuration.';
COMMENT ON COLUMN public.office_agent_session_bindings.session_key IS
  'Exact 1-160 character OpenSwan session key; never inferred from Office names, URLs, history, or response prose.';

ALTER TABLE public.office_agent_session_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_agent_session_bindings_owner_select
  ON public.office_agent_session_bindings;
CREATE POLICY office_agent_session_bindings_owner_select
  ON public.office_agent_session_bindings
  FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- Browser clients may read only their RLS-filtered bindings. Every mutation is
-- forced through the authenticated owner-checking manager RPCs below.
REVOKE ALL ON TABLE public.office_agent_session_bindings
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.office_agent_session_bindings
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_office_agent_session_binding(
  p_office_agent_id uuid,
  p_agent_bot_id uuid,
  p_session_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_office_provider text;
  v_office_is_published boolean;
  v_bot_provider text;
  v_binding_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_auth_required';
  END IF;

  IF p_office_agent_id IS NULL
    OR p_agent_bot_id IS NULL
    OR p_session_key IS NULL
    OR pg_catalog.char_length(p_session_key) NOT BETWEEN 1 AND 160
    OR p_session_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_invalid_identity';
  END IF;

  SELECT office_agent.provider, office_agent.is_published
  INTO v_office_provider, v_office_is_published
  FROM public.circle_office_agents AS office_agent
  WHERE office_agent.id = p_office_agent_id
    AND office_agent.owner_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_agent_ownership_required';
  END IF;
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
  WHERE agent_bot.id = p_agent_bot_id
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

  INSERT INTO public.office_agent_session_bindings AS binding (
    office_agent_id,
    owner_id,
    agent_bot_id,
    session_key
  )
  VALUES (
    p_office_agent_id,
    v_uid,
    p_agent_bot_id,
    p_session_key
  )
  ON CONFLICT (office_agent_id) DO UPDATE
  SET owner_id = EXCLUDED.owner_id,
      agent_bot_id = EXCLUDED.agent_bot_id,
      session_key = EXCLUDED.session_key,
      updated_at = pg_catalog.clock_timestamp()
  WHERE binding.owner_id = v_uid
  RETURNING binding.id INTO v_binding_id;

  IF v_binding_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_ownership_conflict';
  END IF;

  RETURN v_binding_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_office_agent_session_binding(
  p_office_agent_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_auth_required';
  END IF;
  IF p_office_agent_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_invalid_identity';
  END IF;

  PERFORM 1
  FROM public.circle_office_agents AS office_agent
  WHERE office_agent.id = p_office_agent_id
    AND office_agent.owner_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_agent_ownership_required';
  END IF;
  DELETE FROM public.office_agent_session_bindings AS binding
  WHERE binding.office_agent_id = p_office_agent_id
    AND binding.owner_id = v_uid;

  RETURN FOUND;
END;
$function$;

-- Version 2 composes the current canonical claim exactly once, then adds a
-- snapshot of an exact owner-valid OpenSwan binding. A missing binding does not
-- roll back or erase the claim: the caller receives a durable response_id and
-- can persist the fixed pre-dispatch error against that response.
CREATE OR REPLACE FUNCTION public.invoke_agent_v2(
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
  canonical_agent_name text,
  binding_contract_version integer,
  binding_id uuid,
  binding_agent_bot_id uuid,
  binding_session_key text,
  binding_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH canonical_claim AS MATERIALIZED (
    SELECT claim.*
    FROM public.invoke_agent(
      p_message_id,
      p_circle_id,
      p_expected_command_text,
      p_agent_id
    ) AS claim
  ),
  valid_binding AS MATERIALIZED (
    SELECT
      binding.id,
      binding.office_agent_id,
      binding.agent_bot_id,
      binding.session_key
    FROM public.office_agent_session_bindings AS binding
    JOIN public.circle_office_agents AS office_agent
      ON office_agent.id = binding.office_agent_id
     AND office_agent.owner_id = v_uid
     AND office_agent.provider = 'openswan'
     AND office_agent.is_published = true
    JOIN public.agents_bots AS agent_bot
      ON agent_bot.id = binding.agent_bot_id
     AND agent_bot.owner_id = v_uid
     AND agent_bot.metadata ->> 'provider' = 'openswan'
    WHERE binding.owner_id = v_uid
  )
  SELECT
    claim.response_id,
    claim.claim_disposition,
    claim.canonical_message_id,
    claim.canonical_circle_id,
    claim.canonical_sender_id,
    claim.canonical_command_text,
    claim.canonical_target_agent_id,
    claim.canonical_target_agent_ids,
    claim.canonical_target_agent_name,
    claim.canonical_model,
    claim.canonical_agent_id,
    claim.canonical_agent_subject_key,
    claim.canonical_agent_name,
    1::integer,
    binding.id,
    binding.agent_bot_id,
    binding.session_key,
    CASE WHEN binding.id IS NULL THEN 'missing'::text ELSE 'bound'::text END
  FROM canonical_claim AS claim
  LEFT JOIN valid_binding AS binding
    ON binding.office_agent_id = claim.canonical_agent_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_office_agent_session_binding(uuid, uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_office_agent_session_binding(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoke_agent_v2(uuid, uuid, text, uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_office_agent_session_binding(uuid, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_office_agent_session_binding(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoke_agent_v2(uuid, uuid, text, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.set_office_agent_session_binding(uuid, uuid, text) IS
  'Owner-only upsert of one exact published Office-agent to OpenSwan connection/session binding.';
COMMENT ON FUNCTION public.clear_office_agent_session_binding(uuid) IS
  'Owner-only removal of one exact Office-agent OpenSwan session binding.';
COMMENT ON FUNCTION public.invoke_agent_v2(uuid, uuid, text, uuid) IS
  'Canonical Office invocation claim plus versioned owner-valid OpenSwan binding snapshot; missing bindings still retain the canonical response claim.';

COMMIT;

NOTIFY pgrst, 'reload schema';
