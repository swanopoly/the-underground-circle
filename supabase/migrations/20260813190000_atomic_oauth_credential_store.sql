-- OAuth provider credential control plane for the Office Calendar and Email
-- integrations.
--
-- A provider network request cannot participate in a PostgreSQL transaction.
-- This migration therefore uses durable intent epochs, credential revisions,
-- and bounded refresh claims so a stale callback/refresh cannot overwrite a
-- disconnect, a newer authorization, or another worker's rotating token.
-- Google/Microsoft OAuth secrets leave the generic user_api_keys surface and
-- both access and refresh tokens are encrypted at rest.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.oauth_provider_credentials (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected',
  revision bigint NOT NULL DEFAULT 0,
  intent_epoch bigint NOT NULL DEFAULT 0,
  authorization_operation_id uuid,
  authorization_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  access_token_enc bytea,
  refresh_token_enc bytea,
  expires_at timestamptz,
  account_email text NOT NULL DEFAULT '',
  provider_subject text,
  granted_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  refresh_claim_id uuid,
  refresh_claim_expires_at timestamptz,
  last_operation_id uuid,
  last_operation_kind text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, provider),
  CONSTRAINT oauth_provider_credentials_provider_check
    CHECK (provider IN ('google', 'microsoft')),
  CONSTRAINT oauth_provider_credentials_status_check
    CHECK (status IN ('connected', 'disconnected')),
  CONSTRAINT oauth_provider_credentials_revision_check
    CHECK (revision >= 0 AND intent_epoch >= 0),
  CONSTRAINT oauth_provider_credentials_scope_check
    CHECK (
      authorization_scopes <@ ARRAY['calendar', 'email']::text[]
      AND granted_scopes <@ ARRAY['calendar', 'email']::text[]
    ),
  CONSTRAINT oauth_provider_credentials_secret_shape_check
    CHECK (
      (status = 'connected'
        AND access_token_enc IS NOT NULL
        AND refresh_token_enc IS NOT NULL
        AND expires_at IS NOT NULL
        AND cardinality(granted_scopes) > 0)
      OR
      (status = 'disconnected'
        AND access_token_enc IS NULL
        AND refresh_token_enc IS NULL
        AND expires_at IS NULL
        AND cardinality(granted_scopes) = 0)
    ),
  CONSTRAINT oauth_provider_credentials_refresh_claim_check
    CHECK (
      (refresh_claim_id IS NULL AND refresh_claim_expires_at IS NULL)
      OR
      (status = 'connected'
        AND refresh_claim_id IS NOT NULL
        AND refresh_claim_expires_at IS NOT NULL)
    )
);

ALTER TABLE public.oauth_provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_provider_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oauth_provider_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_provider_credentials TO service_role;

COMMENT ON TABLE public.oauth_provider_credentials IS
  'Service-only encrypted Google/Microsoft OAuth credentials with revision, intent, and refresh-lease fencing.';

ALTER TABLE public.email_calendar_oauth_states
  ADD COLUMN IF NOT EXISTS credential_revision bigint,
  ADD COLUMN IF NOT EXISTS intent_epoch bigint,
  ADD COLUMN IF NOT EXISTS operation_id uuid;

CREATE OR REPLACE FUNCTION public.normalize_office_oauth_scopes_v1(p_scopes text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT ARRAY(
    SELECT allowed.scope
    FROM unnest(ARRAY['calendar', 'email']::text[]) WITH ORDINALITY AS allowed(scope, ordinal)
    WHERE allowed.scope = ANY (
      regexp_split_to_array(lower(coalesce(p_scopes, '')), E'\\s*,\\s*')
    )
    ORDER BY allowed.ordinal
  );
$function$;

REVOKE ALL ON FUNCTION public.normalize_office_oauth_scopes_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_office_oauth_scopes_v1(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_office_oauth_authorization_v1(
  p_user_id uuid,
  p_provider text,
  p_requested_scopes text,
  p_operation_id uuid
)
RETURNS TABLE(
  intent_epoch bigint,
  credential_revision bigint,
  required_scopes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_requested text[] := public.normalize_office_oauth_scopes_v1(p_requested_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_required text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft')
     OR p_operation_id IS NULL OR cardinality(v_requested) = 0 THEN
    RAISE EXCEPTION 'invalid_oauth_authorization_reservation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  INSERT INTO public.oauth_provider_credentials(user_id, provider)
  VALUES (p_user_id, v_provider)
  ON CONFLICT (user_id, provider) DO NOTHING;

  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF v_row.authorization_operation_id = p_operation_id THEN
    RETURN QUERY SELECT
      v_row.intent_epoch,
      v_row.revision,
      array_to_string(v_row.authorization_scopes, ',');
    RETURN;
  END IF;

  SELECT ARRAY(
    SELECT allowed.scope
    FROM unnest(ARRAY['calendar', 'email']::text[]) WITH ORDINALITY AS allowed(scope, ordinal)
    WHERE allowed.scope = ANY (
      v_requested
      || v_row.authorization_scopes
      || CASE WHEN v_row.status = 'connected'
        THEN v_row.granted_scopes
        ELSE ARRAY[]::text[]
      END
    )
    ORDER BY allowed.ordinal
  ) INTO v_required;

  UPDATE public.oauth_provider_credentials AS credential
  SET intent_epoch = credential.intent_epoch + 1,
      authorization_operation_id = p_operation_id,
      authorization_scopes = v_required,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  RETURNING credential.intent_epoch, credential.revision
    INTO intent_epoch, credential_revision;

  required_scopes := array_to_string(v_required, ',');
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_office_oauth_authorization_v1(
  p_user_id uuid,
  p_provider text,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_account_email text,
  p_provider_subject text,
  p_granted_scopes text,
  p_required_scopes text
)
RETURNS TABLE(applied boolean, credential_revision bigint, granted_scopes text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_granted text[] := public.normalize_office_oauth_scopes_v1(p_granted_scopes);
  v_required text[] := public.normalize_office_oauth_scopes_v1(p_required_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_refresh_token text;
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft')
     OR p_operation_id IS NULL OR p_expected_intent_epoch IS NULL
     OR p_expected_revision IS NULL
     OR nullif(trim(coalesce(p_access_token, '')), '') IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR nullif(trim(coalesce(p_provider_subject, '')), '') IS NULL
     OR cardinality(v_required) = 0 THEN
    RAISE EXCEPTION 'invalid_oauth_authorization_commit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_authorization_stale' USING ERRCODE = '40001';
  END IF;
  IF v_row.last_operation_kind = 'authorization'
     AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, array_to_string(v_row.granted_scopes, ',');
    RETURN;
  END IF;
  IF v_row.intent_epoch <> p_expected_intent_epoch
     OR v_row.revision <> p_expected_revision
     OR v_row.authorization_operation_id IS DISTINCT FROM p_operation_id
     OR v_row.authorization_scopes IS DISTINCT FROM v_required THEN
    RAISE EXCEPTION 'oauth_authorization_stale' USING ERRCODE = '40001';
  END IF;
  IF NOT (v_required <@ v_granted) THEN
    RAISE EXCEPTION 'oauth_scope_union_not_granted' USING ERRCODE = '22023';
  END IF;

  v_passphrase := public.app_encryption_key();
  v_refresh_token := nullif(trim(coalesce(p_refresh_token, '')), '');
  IF v_refresh_token IS NULL
     AND v_row.status = 'connected'
     AND v_row.provider_subject = trim(p_provider_subject)
     AND v_row.refresh_token_enc IS NOT NULL THEN
    v_refresh_token := extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text;
  END IF;
  IF v_refresh_token IS NULL THEN
    RAISE EXCEPTION 'oauth_refresh_token_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET status = 'connected',
      revision = credential.revision + 1,
      authorization_operation_id = NULL,
      authorization_scopes = ARRAY[]::text[],
      access_token_enc = extensions.pgp_sym_encrypt(trim(p_access_token), v_passphrase),
      refresh_token_enc = extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
      expires_at = p_expires_at,
      account_email = left(trim(coalesce(p_account_email, '')), 320),
      provider_subject = left(trim(p_provider_subject), 512),
      granted_scopes = v_granted,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'authorization',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  RETURNING true, credential.revision, array_to_string(credential.granted_scopes, ',')
    INTO applied, credential_revision, granted_scopes;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_office_oauth_refresh_v1(
  p_user_id uuid,
  p_provider text,
  p_claim_id uuid,
  p_lease_seconds integer DEFAULT 45
)
RETURNS TABLE(
  outcome text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  account_email text,
  provider_subject text,
  granted_scopes text,
  credential_revision bigint,
  intent_epoch bigint,
  refresh_claim_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_passphrase text;
  v_lease_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 45), 120));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft') OR p_claim_id IS NULL THEN
    RAISE EXCEPTION 'invalid_oauth_refresh_claim' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF NOT FOUND OR v_row.status <> 'connected' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::text, NULL::timestamptz,
      ''::text, NULL::text, ''::text, NULL::bigint, NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  v_passphrase := public.app_encryption_key();
  IF v_row.access_token_enc IS NOT NULL
     AND v_row.expires_at > clock_timestamp() + interval '5 minutes' THEN
    RETURN QUERY SELECT
      'fresh'::text,
      extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
      NULL::text,
      v_row.expires_at,
      v_row.account_email,
      v_row.provider_subject,
      array_to_string(v_row.granted_scopes, ','),
      v_row.revision,
      v_row.intent_epoch,
      NULL::uuid;
    RETURN;
  END IF;

  IF v_row.refresh_claim_id IS NOT NULL
     AND v_row.refresh_claim_id <> p_claim_id
     AND v_row.refresh_claim_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT 'busy'::text, NULL::text, NULL::text, v_row.expires_at,
      v_row.account_email, v_row.provider_subject, array_to_string(v_row.granted_scopes, ','),
      v_row.revision, v_row.intent_epoch, v_row.refresh_claim_id;
    RETURN;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET refresh_claim_id = p_claim_id,
      refresh_claim_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider;

  RETURN QUERY SELECT
    'claimed'::text,
    extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
    extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text,
    v_row.expires_at,
    v_row.account_email,
    v_row.provider_subject,
    array_to_string(v_row.granted_scopes, ','),
    v_row.revision,
    v_row.intent_epoch,
    p_claim_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_office_oauth_refresh_v1(
  p_user_id uuid,
  p_provider text,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_claim_id uuid,
  p_operation_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_provider_subject text,
  p_granted_scopes text
)
RETURNS TABLE(applied boolean, credential_revision bigint, granted_scopes text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_granted text[] := public.normalize_office_oauth_scopes_v1(p_granted_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_refresh_token text;
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft')
     OR p_claim_id IS NULL OR p_operation_id IS NULL
     OR p_expected_intent_epoch IS NULL OR p_expected_revision IS NULL
     OR nullif(trim(coalesce(p_access_token, '')), '') IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'invalid_oauth_refresh_commit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_refresh_stale' USING ERRCODE = '40001';
  END IF;
  IF v_row.last_operation_kind = 'refresh' AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, array_to_string(v_row.granted_scopes, ',');
    RETURN;
  END IF;
  IF v_row.status <> 'connected'
     OR v_row.intent_epoch <> p_expected_intent_epoch
     OR v_row.revision <> p_expected_revision
     OR v_row.refresh_claim_id IS DISTINCT FROM p_claim_id
     OR v_row.refresh_claim_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'oauth_refresh_stale' USING ERRCODE = '40001';
  END IF;
  IF NOT (v_row.granted_scopes <@ v_granted) THEN
    RAISE EXCEPTION 'oauth_scope_narrowed' USING ERRCODE = '22023';
  END IF;
  IF v_row.provider_subject IS NOT NULL
     AND v_row.provider_subject IS DISTINCT FROM nullif(trim(coalesce(p_provider_subject, '')), '') THEN
    RAISE EXCEPTION 'oauth_account_mismatch' USING ERRCODE = '22023';
  END IF;

  v_passphrase := public.app_encryption_key();
  v_refresh_token := nullif(trim(coalesce(p_refresh_token, '')), '');
  IF v_refresh_token IS NULL THEN
    v_refresh_token := extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET revision = credential.revision + 1,
      access_token_enc = extensions.pgp_sym_encrypt(trim(p_access_token), v_passphrase),
      refresh_token_enc = extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
      expires_at = p_expires_at,
      provider_subject = coalesce(credential.provider_subject, nullif(trim(coalesce(p_provider_subject, '')), '')),
      granted_scopes = v_granted,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'refresh',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  RETURNING true, credential.revision, array_to_string(credential.granted_scopes, ',')
    INTO applied, credential_revision, granted_scopes;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_office_oauth_refresh_v1(
  p_user_id uuid,
  p_provider text,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_claim_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_released boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.oauth_provider_credentials AS credential
  SET refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id
    AND credential.provider = v_provider
    AND credential.status = 'connected'
    AND credential.intent_epoch = p_expected_intent_epoch
    AND credential.revision = p_expected_revision
    AND credential.refresh_claim_id = p_claim_id;
  v_released := FOUND;
  RETURN v_released;
END;
$function$;

CREATE OR REPLACE FUNCTION public.disconnect_office_oauth_provider_v1(
  p_user_id uuid,
  p_provider text,
  p_operation_id uuid
)
RETURNS TABLE(disconnected boolean, credential_revision bigint, intent_epoch bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_row public.oauth_provider_credentials%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft') OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_oauth_disconnect' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  INSERT INTO public.oauth_provider_credentials(user_id, provider)
  VALUES (p_user_id, v_provider)
  ON CONFLICT (user_id, provider) DO NOTHING;
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF v_row.last_operation_kind = 'disconnect' AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, v_row.intent_epoch;
    RETURN;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET status = 'disconnected',
      revision = credential.revision + 1,
      intent_epoch = credential.intent_epoch + 1,
      authorization_operation_id = NULL,
      authorization_scopes = ARRAY[]::text[],
      access_token_enc = NULL,
      refresh_token_enc = NULL,
      expires_at = NULL,
      account_email = '',
      provider_subject = NULL,
      granted_scopes = ARRAY[]::text[],
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'disconnect',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  RETURNING true, credential.revision, credential.intent_epoch
    INTO disconnected, credential_revision, intent_epoch;

  DELETE FROM public.user_api_keys AS legacy
  WHERE legacy.user_id = p_user_id
    AND lower(legacy.provider) = v_provider
    AND lower(coalesce(legacy.label, 'default')) = 'oauth';
  RETURN NEXT;
END;
$function$;

-- Preserve valid legacy Google/Microsoft OAuth rows, then remove their
-- plaintext refresh-token metadata from the generic credential table. Legacy
-- rows have no stable provider subject, so a later callback may not reuse their
-- refresh token unless the provider issues a fresh one.
DO $legacy_migration$
DECLARE
  v_row record;
  v_meta jsonb;
  v_access_token text;
  v_refresh_token text;
  v_expires_at timestamptz;
  v_scopes text[];
  v_passphrase text := public.app_encryption_key();
BEGIN
  FOR v_row IN
    SELECT key_row.*
    FROM public.user_api_keys AS key_row
    WHERE lower(key_row.provider) IN ('google', 'microsoft')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    FOR UPDATE
  LOOP
    BEGIN
      v_meta := coalesce(v_row.endpoint::jsonb, '{}'::jsonb);
    EXCEPTION WHEN others THEN
      v_meta := '{}'::jsonb;
    END;
    BEGIN
      v_access_token := extensions.pgp_sym_decrypt(v_row.api_key_enc, v_passphrase)::text;
    EXCEPTION WHEN others THEN
      v_access_token := NULL;
    END;
    v_refresh_token := nullif(trim(coalesce(v_meta->>'refresh_token', '')), '');
    BEGIN
      v_expires_at := (v_meta->>'expires_at')::timestamptz;
    EXCEPTION WHEN others THEN
      v_expires_at := NULL;
    END;
    v_scopes := public.normalize_office_oauth_scopes_v1(v_meta->>'scopes');

    IF nullif(trim(coalesce(v_access_token, '')), '') IS NOT NULL
       AND v_refresh_token IS NOT NULL
       AND v_expires_at IS NOT NULL
       AND cardinality(v_scopes) > 0 THEN
      INSERT INTO public.oauth_provider_credentials(
        user_id, provider, status, access_token_enc, refresh_token_enc,
        expires_at, account_email, granted_scopes
      ) VALUES (
        v_row.user_id,
        lower(v_row.provider),
        'connected',
        extensions.pgp_sym_encrypt(trim(v_access_token), v_passphrase),
        extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
        v_expires_at,
        left(trim(coalesce(v_meta->>'email', '')), 320),
        v_scopes
      ) ON CONFLICT (user_id, provider) DO NOTHING;
    ELSE
      INSERT INTO public.oauth_provider_credentials(user_id, provider)
      VALUES (v_row.user_id, lower(v_row.provider))
      ON CONFLICT (user_id, provider) DO NOTHING;
    END IF;
  END LOOP;

  DELETE FROM public.user_api_keys AS key_row
  WHERE lower(key_row.provider) IN ('google', 'microsoft')
    AND lower(coalesce(key_row.label, 'default')) = 'oauth';
END;
$legacy_migration$;

-- Canonical RLS keeps ordinary BYOK rows owner-managed while reserving the
-- Google/Microsoft OAuth namespace for the service-only control plane.
DO $policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_api_keys'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_api_keys', policy_row.policyname);
  END LOOP;
END;
$policies$;

CREATE POLICY user_api_keys_select_own_non_oauth
  ON public.user_api_keys FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_insert_own_non_oauth
  ON public.user_api_keys FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_update_own_non_oauth
  ON public.user_api_keys FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_delete_own_non_oauth
  ON public.user_api_keys FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );

CREATE OR REPLACE FUNCTION public.store_user_api_key(
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_id uuid;
  v_user_id uuid := auth.uid();
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_label text := coalesce(nullif(trim(p_label), ''), 'default');
  v_passphrase text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF v_provider IN ('google', 'microsoft') AND lower(v_label) = 'oauth' THEN
    RAISE EXCEPTION 'reserved_oauth_credential' USING ERRCODE = '42501';
  END IF;
  v_passphrase := public.app_encryption_key();
  INSERT INTO public.user_api_keys(user_id, provider, api_key_enc, label, endpoint)
  VALUES (v_user_id, v_provider, extensions.pgp_sym_encrypt(p_api_key, v_passphrase), v_label, nullif(trim(p_endpoint), ''))
  ON CONFLICT (user_id, provider, label) DO UPDATE
  SET api_key_enc = extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
      endpoint = coalesce(nullif(trim(p_endpoint), ''), public.user_api_keys.endpoint),
      is_active = true,
      updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.store_user_api_key_for_user(
  p_user_id uuid,
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_id uuid;
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_label text := coalesce(nullif(trim(p_label), ''), 'default');
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF v_provider IN ('google', 'microsoft') AND lower(v_label) = 'oauth' THEN
    RAISE EXCEPTION 'reserved_oauth_credential' USING ERRCODE = '42501';
  END IF;
  v_passphrase := public.app_encryption_key();
  INSERT INTO public.user_api_keys(user_id, provider, api_key_enc, label, endpoint)
  VALUES (p_user_id, v_provider, extensions.pgp_sym_encrypt(p_api_key, v_passphrase), v_label, nullif(trim(p_endpoint), ''))
  ON CONFLICT (user_id, provider, label) DO UPDATE
  SET api_key_enc = extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
      endpoint = coalesce(nullif(trim(p_endpoint), ''), public.user_api_keys.endpoint),
      is_active = true,
      updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_api_key(
  p_user_id uuid,
  p_provider text,
  p_label text DEFAULT 'default'
)
RETURNS TABLE(api_key text, endpoint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_passphrase := public.app_encryption_key();
  RETURN QUERY
  SELECT extensions.pgp_sym_decrypt(key_row.api_key_enc, v_passphrase)::text,
         key_row.endpoint
  FROM public.user_api_keys AS key_row
  WHERE key_row.user_id = p_user_id
    AND key_row.provider = lower(trim(p_provider))
    AND (p_label IS NULL OR key_row.label = p_label)
    AND key_row.is_active = true
    AND NOT (
      lower(key_row.provider) IN ('google', 'microsoft')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    )
  ORDER BY key_row.updated_at DESC
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_user_api_key(p_key_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.user_api_keys AS key_row
  WHERE key_row.id = p_key_id
    AND key_row.user_id = auth.uid()
    AND NOT (
      lower(key_row.provider) IN ('google', 'microsoft')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_user_api_keys()
RETURNS TABLE(
  id uuid,
  provider text,
  label text,
  endpoint text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT key_row.id, key_row.provider, key_row.label, key_row.endpoint,
         key_row.is_active, key_row.created_at, key_row.updated_at
  FROM public.user_api_keys AS key_row
  WHERE key_row.user_id = auth.uid()
    AND NOT (
      lower(key_row.provider) IN ('google', 'microsoft')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    )
  ORDER BY key_row.provider, key_row.label;
END;
$function$;

DROP FUNCTION IF EXISTS public.store_oauth_credential_for_user(
  uuid, text, text, text, timestamptz, text, text, text
);

REVOKE ALL ON FUNCTION public.store_user_api_key(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.store_user_api_key_for_user(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_api_key(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_user_api_key(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_user_api_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_user_api_key(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_user_api_key_for_user(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_api_key(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_api_key(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_api_keys() TO authenticated;

REVOKE ALL ON FUNCTION public.reserve_office_oauth_authorization_v1(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_office_oauth_authorization_v1(uuid, text, bigint, bigint, uuid, text, text, timestamptz, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_office_oauth_refresh_v1(uuid, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_office_oauth_refresh_v1(uuid, text, bigint, bigint, uuid, uuid, text, text, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_office_oauth_refresh_v1(uuid, text, bigint, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disconnect_office_oauth_provider_v1(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_office_oauth_authorization_v1(uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_office_oauth_authorization_v1(uuid, text, bigint, bigint, uuid, text, text, timestamptz, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_office_oauth_refresh_v1(uuid, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_office_oauth_refresh_v1(uuid, text, bigint, bigint, uuid, uuid, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_office_oauth_refresh_v1(uuid, text, bigint, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.disconnect_office_oauth_provider_v1(uuid, text, uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
