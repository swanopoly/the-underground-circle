-- Atomic published-agent Spirit projection.
--
-- A published Office agent has one peer-visible Spirit projection and one
-- owner-private durable identity. Updating those tables in separate client
-- requests can split truth. This RPC locks the exact published row and updates
-- both projections in one authenticated PostgreSQL transaction.

BEGIN;

DO $prerequisites$
BEGIN
  IF to_regclass('public.circle_office_agents') IS NULL
     OR to_regclass('public.agent_identities') IS NULL
     OR to_regclass('public.circle_members') IS NULL
     OR to_regclass('public.custom_agent_profiles') IS NULL THEN
    RAISE EXCEPTION 'agent_spirit_assignment_prerequisites_required'
      USING ERRCODE = '55000';
  END IF;
END;
$prerequisites$;

ALTER TABLE public.circle_office_agents
  ADD COLUMN IF NOT EXISTS spirit text,
  ADD COLUMN IF NOT EXISTS spirit_emoji text;

ALTER TABLE public.circle_office_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_agent_profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_published_agent_spirit_v1(
  p_circle_id uuid,
  p_office_agent_id uuid,
  p_spirit_id text,
  p_spirit_emoji text,
  p_custom_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_session_key text := p_office_agent_id::text;
  v_spirit_id text := p_spirit_id;
  v_spirit_emoji text := p_spirit_emoji;
  v_custom_profile_id text := NULL;
  v_custom_profile_name text := NULL;
  v_office_row jsonb;
  v_identity_row jsonb;
  v_office_row_count integer := 0;
  v_identity_row_count integer := 0;
  v_receipt jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_circle_id IS NULL OR p_office_agent_id IS NULL THEN
    RAISE EXCEPTION 'agent_spirit_assignment_target_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_spirit_id IS NULL THEN
    IF p_spirit_emoji IS NOT NULL OR p_custom_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'agent_spirit_clear_payload_invalid'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_spirit_id <> pg_catalog.btrim(p_spirit_id)
       OR pg_catalog.char_length(p_spirit_id) NOT BETWEEN 1 AND 200
       OR p_spirit_id OPERATOR(pg_catalog.~) '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'agent_spirit_id_invalid'
        USING ERRCODE = '22023';
    END IF;
    IF p_spirit_emoji IS NOT NULL
       AND (
         p_spirit_emoji <> pg_catalog.btrim(p_spirit_emoji)
         OR pg_catalog.char_length(p_spirit_emoji) NOT BETWEEN 1 AND 64
         OR p_spirit_emoji OPERATOR(pg_catalog.~) '[[:cntrl:]]'
       ) THEN
      RAISE EXCEPTION 'agent_spirit_emoji_invalid'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = v_actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'circle_membership_required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.circle_office_agents AS office_agent
  WHERE office_agent.id = p_office_agent_id
    AND office_agent.circle_id = p_circle_id
    AND office_agent.owner_id = v_actor_id
    AND office_agent.is_published IS TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published_agent_ownership_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_custom_profile_id IS NOT NULL THEN
    IF p_spirit_id IS NULL
       OR p_spirit_id <> 'custom::' || p_custom_profile_id::text THEN
      RAISE EXCEPTION 'agent_spirit_custom_profile_mismatch'
        USING ERRCODE = '22023';
    END IF;
    SELECT
      profile.id::text,
      profile.name,
      profile.emoji
    INTO
      v_custom_profile_id,
      v_custom_profile_name,
      v_spirit_emoji
    FROM public.custom_agent_profiles AS profile
    WHERE profile.id = p_custom_profile_id
      AND profile.user_id = v_actor_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'agent_spirit_custom_profile_ownership_required'
        USING ERRCODE = '42501';
    END IF;
    IF v_custom_profile_name IS NULL
       OR v_custom_profile_name <> pg_catalog.btrim(v_custom_profile_name)
       OR pg_catalog.char_length(v_custom_profile_name) NOT BETWEEN 1 AND 200
       OR v_custom_profile_name OPERATOR(pg_catalog.~) '[[:cntrl:]]'
       OR (
         v_spirit_emoji IS NOT NULL
         AND (
           v_spirit_emoji <> pg_catalog.btrim(v_spirit_emoji)
           OR pg_catalog.char_length(v_spirit_emoji) NOT BETWEEN 1 AND 64
           OR v_spirit_emoji OPERATOR(pg_catalog.~) '[[:cntrl:]]'
         )
       ) THEN
      RAISE EXCEPTION 'agent_spirit_custom_profile_invalid'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_spirit_id IS NOT NULL
        AND pg_catalog.left(p_spirit_id, 8) = 'custom::' THEN
    RAISE EXCEPTION 'agent_spirit_custom_profile_required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.circle_office_agents AS office_agent
  SET spirit = v_spirit_id,
      spirit_emoji = v_spirit_emoji
  WHERE office_agent.id = p_office_agent_id
    AND office_agent.circle_id = p_circle_id
    AND office_agent.owner_id = v_actor_id
    AND office_agent.is_published IS TRUE
  RETURNING pg_catalog.to_jsonb(office_agent)
  INTO v_office_row;
  GET DIAGNOSTICS v_office_row_count = ROW_COUNT;

  IF v_office_row_count <> 1 THEN
    RAISE EXCEPTION 'agent_spirit_office_row_conflict'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.agent_identities AS identity_row (
    user_id,
    session_key,
    spirit_id,
    spirit_emoji,
    custom_profile_id,
    custom_profile_name,
    is_customized,
    last_seen
  ) VALUES (
    v_actor_id,
    v_session_key,
    v_spirit_id,
    v_spirit_emoji,
    v_custom_profile_id,
    v_custom_profile_name,
    true,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (user_id, session_key) DO UPDATE
  SET spirit_id = EXCLUDED.spirit_id,
      spirit_emoji = EXCLUDED.spirit_emoji,
      custom_profile_id = EXCLUDED.custom_profile_id,
      custom_profile_name = EXCLUDED.custom_profile_name,
      is_customized = true,
      last_seen = EXCLUDED.last_seen
  RETURNING pg_catalog.to_jsonb(identity_row)
  INTO v_identity_row;
  GET DIAGNOSTICS v_identity_row_count = ROW_COUNT;

  IF v_identity_row_count <> 1
     OR v_identity_row ->> 'user_id' <> v_actor_id::text
     OR v_identity_row ->> 'session_key' <> v_session_key
     OR v_identity_row ->> 'spirit_id' IS DISTINCT FROM v_spirit_id
     OR v_identity_row ->> 'spirit_emoji' IS DISTINCT FROM v_spirit_emoji
     OR v_identity_row ->> 'custom_profile_id' IS DISTINCT FROM v_custom_profile_id
     OR v_identity_row ->> 'custom_profile_name' IS DISTINCT FROM v_custom_profile_name THEN
    RAISE EXCEPTION 'agent_spirit_identity_row_conflict'
      USING ERRCODE = '40001';
  END IF;

  v_receipt := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'userId', v_actor_id::text,
    'circleId', p_circle_id::text,
    'officeAgentId', p_office_agent_id::text,
    'sessionKey', v_session_key,
    'spiritId', v_spirit_id,
    'spiritEmoji', v_spirit_emoji,
    'customProfileId', v_custom_profile_id,
    'customProfileName', v_custom_profile_name,
    'officeRowCount', v_office_row_count,
    'identityRowCount', v_identity_row_count,
    'officeAgent', v_office_row,
    'identity', v_identity_row
  );

  IF pg_catalog.pg_column_size(v_receipt) > 4194304 THEN
    RAISE EXCEPTION 'agent_spirit_assignment_receipt_too_large'
      USING ERRCODE = '54000';
  END IF;

  RETURN v_receipt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_unreferenced_custom_agent_profile_v1(
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_profile_row jsonb;
  v_deleted_row jsonb;
  v_deleted_row_count integer := 0;
  v_receipt jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'custom_agent_profile_target_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.to_jsonb(profile)
  INTO v_profile_row
  FROM public.custom_agent_profiles AS profile
  WHERE profile.id = p_profile_id
    AND profile.user_id = v_actor_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'custom_agent_profile_ownership_required'
      USING ERRCODE = '42501';
  END IF;

  -- Spirit assignment takes a key-share lock on this exact profile before it
  -- writes either projection. The exclusive profile lock above therefore
  -- serializes assign-versus-delete: a committed assignment is visible here,
  -- while a deletion that wins first makes the later assignment fail closed.
  IF EXISTS (
    SELECT 1
    FROM public.agent_identities AS identity_row
    WHERE identity_row.user_id = v_actor_id
      AND (
        identity_row.custom_profile_id = p_profile_id::text
        OR identity_row.spirit_id = 'custom::' || p_profile_id::text
      )
    LIMIT 1
  ) OR EXISTS (
    SELECT 1
    FROM public.circle_office_agents AS office_agent
    WHERE office_agent.owner_id = v_actor_id
      AND office_agent.spirit = 'custom::' || p_profile_id::text
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'custom_agent_profile_still_referenced'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.custom_agent_profiles AS profile
  WHERE profile.id = p_profile_id
    AND profile.user_id = v_actor_id
  RETURNING pg_catalog.to_jsonb(profile)
  INTO v_deleted_row;
  GET DIAGNOSTICS v_deleted_row_count = ROW_COUNT;

  IF v_deleted_row_count <> 1
     OR v_deleted_row ->> 'id' <> p_profile_id::text
     OR v_deleted_row ->> 'user_id' <> v_actor_id::text THEN
    RAISE EXCEPTION 'custom_agent_profile_delete_conflict'
      USING ERRCODE = '40001';
  END IF;

  v_receipt := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'userId', v_actor_id::text,
    'profileId', p_profile_id::text,
    'deletedRowCount', v_deleted_row_count,
    'profile', v_deleted_row
  );
  IF pg_catalog.pg_column_size(v_receipt) > 1048576 THEN
    RAISE EXCEPTION 'custom_agent_profile_delete_receipt_too_large'
      USING ERRCODE = '54000';
  END IF;
  RETURN v_receipt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_circle_office_agent_spirit_columns_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_spirit_rpc_owner name;
  v_sensitive_change boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_published IS TRUE THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          NEW.owner_id::text || ':' || NEW.id::text,
          714071348::bigint
        )
      );
    END IF;
    v_sensitive_change := NEW.is_published IS TRUE
      AND (NEW.spirit IS NOT NULL OR NEW.spirit_emoji IS NOT NULL);
    IF NEW.is_published IS TRUE AND NOT v_sensitive_change THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.agent_identities AS identity_row
        WHERE identity_row.user_id = NEW.owner_id
          AND identity_row.session_key = NEW.id::text
          AND (
            identity_row.spirit_id IS NOT NULL
            OR identity_row.spirit_emoji IS NOT NULL
            OR identity_row.custom_profile_id IS NOT NULL
            OR identity_row.custom_profile_name IS NOT NULL
          )
      )
      INTO v_sensitive_change;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_published IS TRUE
       AND (
         OLD.is_published IS NOT TRUE
         OR NEW.id IS DISTINCT FROM OLD.id
         OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
         OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
         OR NEW.spirit IS DISTINCT FROM OLD.spirit
         OR NEW.spirit_emoji IS DISTINCT FROM OLD.spirit_emoji
       ) THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          NEW.owner_id::text || ':' || NEW.id::text,
          714071348::bigint
        )
      );
    END IF;
    v_sensitive_change := NEW.is_published IS TRUE
      AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
        OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
        OR NEW.spirit IS DISTINCT FROM OLD.spirit
        OR NEW.spirit_emoji IS DISTINCT FROM OLD.spirit_emoji
      );
    IF NEW.is_published IS TRUE
       AND OLD.is_published IS NOT TRUE
       AND NOT v_sensitive_change THEN
      v_sensitive_change := NEW.spirit IS NOT NULL OR NEW.spirit_emoji IS NOT NULL;
      IF NOT v_sensitive_change THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.agent_identities AS identity_row
          WHERE identity_row.user_id = NEW.owner_id
            AND identity_row.session_key = NEW.id::text
            AND (
              identity_row.spirit_id IS NOT NULL
              OR identity_row.spirit_emoji IS NOT NULL
              OR identity_row.custom_profile_id IS NOT NULL
              OR identity_row.custom_profile_name IS NOT NULL
            )
        )
        INTO v_sensitive_change;
      END IF;
    END IF;
  END IF;

  IF NOT v_sensitive_change THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(procedure_row.proowner)
  INTO v_spirit_rpc_owner
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid =
    'public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)'::pg_catalog.regprocedure;

  IF v_spirit_rpc_owner IS NULL
     OR current_user IS DISTINCT FROM v_spirit_rpc_owner THEN
    RAISE EXCEPTION 'published_agent_spirit_rpc_required'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_published_agent_identity_spirit_columns_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_spirit_rpc_owner name;
  v_sensitive_change boolean := false;
  v_is_published_projection boolean := false;
  v_old_is_published_projection boolean := false;
  v_projection_key_changed boolean := false;
  v_new_projection_lock bigint;
  v_old_projection_lock bigint;
  v_custom_profile_uuid uuid;
  v_expected_profile_name text;
  v_expected_profile_emoji text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(procedure_row.proowner)
  INTO v_spirit_rpc_owner
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid =
    'public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)'::pg_catalog.regprocedure;

  -- The canonical SECURITY DEFINER writer owns both projections. Returning
  -- early also avoids an unnecessary public-row lookup inside that RPC.
  IF v_spirit_rpc_owner IS NOT NULL
     AND current_user IS NOT DISTINCT FROM v_spirit_rpc_owner THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- A published Office Spirit requires its exact private identity projection.
  -- Legacy owner RLS permits ordinary identity deletion, so serialize and
  -- reject only the exact UUID-keyed row that backs a currently published
  -- Office agent. Genuinely private live-session identities remain deletable.
  IF TG_OP = 'DELETE' THEN
    IF pg_catalog.char_length(OLD.session_key) = 36
       AND OLD.session_key OPERATOR(pg_catalog.~)
         '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
      v_old_projection_lock := pg_catalog.hashtextextended(
        OLD.user_id::text || ':' || OLD.session_key,
        714071348::bigint
      );
      PERFORM pg_catalog.pg_advisory_xact_lock(v_old_projection_lock);
      SELECT EXISTS (
        SELECT 1
        FROM public.circle_office_agents AS office_agent
        WHERE office_agent.id = OLD.session_key::uuid
          AND office_agent.owner_id = OLD.user_id
          AND office_agent.is_published IS TRUE
      )
      INTO v_old_is_published_projection;
    END IF;
    IF v_old_is_published_projection THEN
      RAISE EXCEPTION 'published_agent_spirit_rpc_required'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_sensitive_change := NEW.spirit_id IS NOT NULL
      OR NEW.spirit_emoji IS NOT NULL
      OR NEW.custom_profile_id IS NOT NULL
      OR NEW.custom_profile_name IS NOT NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_projection_key_changed := NEW.session_key IS DISTINCT FROM OLD.session_key
      OR NEW.user_id IS DISTINCT FROM OLD.user_id;
    v_sensitive_change := NEW.spirit_id IS DISTINCT FROM OLD.spirit_id
      OR NEW.spirit_emoji IS DISTINCT FROM OLD.spirit_emoji
      OR NEW.custom_profile_id IS DISTINCT FROM OLD.custom_profile_id
      OR NEW.custom_profile_name IS DISTINCT FROM OLD.custom_profile_name
      OR v_projection_key_changed;
  END IF;

  IF NOT v_sensitive_change THEN
    RETURN NEW;
  END IF;

  IF pg_catalog.char_length(NEW.session_key) = 36
     AND NEW.session_key OPERATOR(pg_catalog.~)
       '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
    v_new_projection_lock := pg_catalog.hashtextextended(
      NEW.user_id::text || ':' || NEW.session_key,
      714071348::bigint
    );
  END IF;
  IF v_projection_key_changed
     AND pg_catalog.char_length(OLD.session_key) = 36
     AND OLD.session_key OPERATOR(pg_catalog.~)
       '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
    v_old_projection_lock := pg_catalog.hashtextextended(
      OLD.user_id::text || ':' || OLD.session_key,
      714071348::bigint
    );
  END IF;

  -- Projection keys are mutable under the legacy owner policy, so direct
  -- retargets must serialize with the same advisory lane as the canonical
  -- public/private writer. Acquire two different lanes in numeric order to
  -- keep inverse retarget attempts deadlock-free.
  IF v_new_projection_lock IS NOT NULL
     AND v_old_projection_lock IS NOT NULL
     AND v_new_projection_lock <> v_old_projection_lock THEN
    IF v_new_projection_lock < v_old_projection_lock THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(v_new_projection_lock);
      PERFORM pg_catalog.pg_advisory_xact_lock(v_old_projection_lock);
    ELSE
      PERFORM pg_catalog.pg_advisory_xact_lock(v_old_projection_lock);
      PERFORM pg_catalog.pg_advisory_xact_lock(v_new_projection_lock);
    END IF;
  ELSIF v_new_projection_lock IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(v_new_projection_lock);
  ELSIF v_old_projection_lock IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(v_old_projection_lock);
  END IF;

  IF v_new_projection_lock IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.circle_office_agents AS office_agent
      WHERE office_agent.id = NEW.session_key::uuid
        AND office_agent.owner_id = NEW.user_id
        AND office_agent.is_published IS TRUE
    )
    INTO v_is_published_projection;
  END IF;
  IF v_projection_key_changed AND v_old_projection_lock IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.circle_office_agents AS office_agent
      WHERE office_agent.id = OLD.session_key::uuid
        AND office_agent.owner_id = OLD.user_id
        AND office_agent.is_published IS TRUE
    )
    INTO v_old_is_published_projection;
  END IF;

  IF v_is_published_projection OR v_old_is_published_projection THEN
    RAISE EXCEPTION 'published_agent_spirit_rpc_required'
      USING ERRCODE = '42501';
  END IF;

  -- Private live-session identities remain directly writable, but a custom
  -- Spirit must be one coherent owner profile projection. The key-share lock
  -- conflicts with the profile delete RPC's FOR UPDATE lock, so whichever
  -- operation commits first determines one coherent outcome: referenced and
  -- retained, or deleted and impossible to assign.
  IF NEW.custom_profile_id IS NULL THEN
    IF NEW.custom_profile_name IS NOT NULL
       OR (
         NEW.spirit_id IS NOT NULL
         AND pg_catalog.left(NEW.spirit_id, 8) = 'custom::'
       ) THEN
      RAISE EXCEPTION 'agent_spirit_custom_profile_mismatch'
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF pg_catalog.char_length(NEW.custom_profile_id) <> 36
     OR NOT (
       NEW.custom_profile_id OPERATOR(pg_catalog.~)
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ) THEN
    RAISE EXCEPTION 'agent_spirit_custom_profile_invalid'
      USING ERRCODE = '22023';
  END IF;
  v_custom_profile_uuid := NEW.custom_profile_id::uuid;
  IF NEW.custom_profile_id <> v_custom_profile_uuid::text
     OR NEW.spirit_id IS DISTINCT FROM
       'custom::' || v_custom_profile_uuid::text THEN
    RAISE EXCEPTION 'agent_spirit_custom_profile_mismatch'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.name, profile.emoji
  INTO v_expected_profile_name, v_expected_profile_emoji
  FROM public.custom_agent_profiles AS profile
  WHERE profile.id = v_custom_profile_uuid
    AND profile.user_id = NEW.user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_spirit_custom_profile_ownership_required'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.custom_profile_name IS DISTINCT FROM v_expected_profile_name
     OR NEW.spirit_emoji IS DISTINCT FROM v_expected_profile_emoji THEN
    RAISE EXCEPTION 'agent_spirit_custom_profile_mismatch'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS circle_office_agent_spirit_columns_guard
  ON public.circle_office_agents;
CREATE TRIGGER circle_office_agent_spirit_columns_guard
  BEFORE INSERT OR UPDATE OF id, circle_id, owner_id, spirit, spirit_emoji, is_published
  ON public.circle_office_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_circle_office_agent_spirit_columns_v1();

DROP TRIGGER IF EXISTS published_agent_identity_spirit_columns_guard
  ON public.agent_identities;
CREATE TRIGGER published_agent_identity_spirit_columns_guard
  BEFORE INSERT OR DELETE OR UPDATE OF user_id, session_key, spirit_id, spirit_emoji, custom_profile_id, custom_profile_name
  ON public.agent_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_published_agent_identity_spirit_columns_v1();

REVOKE ALL ON FUNCTION public.set_published_agent_spirit_v1(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_published_agent_spirit_v1(uuid, uuid, text, text, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.delete_unreferenced_custom_agent_profile_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_unreferenced_custom_agent_profile_v1(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.guard_circle_office_agent_spirit_columns_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_published_agent_identity_spirit_columns_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- The only shipped direct DELETE caller is migrated to the guarded RPC. Keep
-- profile create/update/select available through the existing owner policy,
-- but prevent a client from bypassing the reference check.
REVOKE DELETE ON TABLE public.custom_agent_profiles FROM authenticated;

COMMENT ON COLUMN public.circle_office_agents.spirit IS
  'Peer-visible Spirit id projected atomically with the owner-private durable identity.';
COMMENT ON COLUMN public.circle_office_agents.spirit_emoji IS
  'Peer-visible Spirit emoji projected atomically with the owner-private durable identity.';
COMMENT ON FUNCTION public.set_published_agent_spirit_v1(uuid, uuid, text, text, uuid) IS
  'Atomically projects one exact published Office agent Spirit into its owner-private identity.';
COMMENT ON FUNCTION public.delete_unreferenced_custom_agent_profile_v1(uuid) IS
  'Deletes one exact owner profile only when no owner public or private Spirit projection references it.';
COMMENT ON FUNCTION public.guard_circle_office_agent_spirit_columns_v1() IS
  'Rejects direct published Office Spirit or projection-key changes outside the canonical atomic RPC.';
COMMENT ON FUNCTION public.guard_published_agent_identity_spirit_columns_v1() IS
  'Rejects direct Spirit, identity-key, or identity-delete changes that enter, leave, or remove a published Office projection and validates plus locks exact owner profiles for private custom Spirit assignments.';

COMMIT;

NOTIFY pgrst, 'reload schema';
