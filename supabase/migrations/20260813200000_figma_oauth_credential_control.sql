-- Figma OAuth credential and callback control plane.
--
-- OAuth provider calls cannot share a PostgreSQL transaction with local state.
-- Durable intent epochs, credential revisions, and bounded refresh leases fence
-- stale callbacks, concurrent token rotation, and disconnect races. The Figma
-- callback state is consumed atomically before the provider token exchange.
-- Access tokens, refresh tokens, and PKCE verifiers are encrypted at rest and
-- are available only to service-role RPCs.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Extend the canonical provider table without creating another secret store.
ALTER TABLE public.oauth_provider_credentials
  DROP CONSTRAINT IF EXISTS oauth_provider_credentials_provider_check,
  DROP CONSTRAINT IF EXISTS oauth_provider_credentials_scope_check;

ALTER TABLE public.oauth_provider_credentials
  ADD CONSTRAINT oauth_provider_credentials_provider_check
    CHECK (provider IN ('google', 'microsoft', 'figma')),
  ADD CONSTRAINT oauth_provider_credentials_scope_check
    CHECK (
      (
        provider IN ('google', 'microsoft')
        AND authorization_scopes <@ ARRAY['calendar', 'email']::text[]
        AND granted_scopes <@ ARRAY['calendar', 'email']::text[]
      )
      OR
      (
        provider = 'figma'
        AND authorization_scopes <@ ARRAY['file_content:read']::text[]
        AND granted_scopes <@ ARRAY['file_content:read']::text[]
      )
    );

ALTER TABLE public.oauth_provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_provider_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oauth_provider_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_provider_credentials TO service_role;

COMMENT ON TABLE public.oauth_provider_credentials IS
  'Service-only encrypted OAuth credentials with revision, intent, and refresh-lease fencing.';

-- Upgrade the legacy nonce table in place. Rows from the old shape cannot be
-- proved to carry PKCE or a credential fence, so only those rows are retired.
ALTER TABLE public.figma_oauth_states
  ADD COLUMN IF NOT EXISTS code_verifier_enc bytea,
  ADD COLUMN IF NOT EXISTS client_nonce text,
  ADD COLUMN IF NOT EXISTS operation_id uuid,
  ADD COLUMN IF NOT EXISTS intent_epoch bigint,
  ADD COLUMN IF NOT EXISTS credential_revision bigint,
  ADD COLUMN IF NOT EXISTS requested_scopes text[],
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

DELETE FROM public.figma_oauth_states
WHERE code_verifier_enc IS NULL
   OR client_nonce IS NULL
   OR client_nonce !~ '^[a-f0-9]{48}$'
   OR operation_id IS NULL
   OR intent_epoch IS NULL
   OR credential_revision IS NULL
   OR requested_scopes IS NULL;

UPDATE public.figma_oauth_states
SET claim_expires_at = claimed_at + interval '1 minute'
WHERE claimed_at IS NOT NULL AND claim_expires_at IS NULL;
UPDATE public.figma_oauth_states
SET claim_expires_at = NULL
WHERE claimed_at IS NULL AND claim_expires_at IS NOT NULL;

ALTER TABLE public.figma_oauth_states
  ALTER COLUMN code_verifier_enc SET NOT NULL,
  ALTER COLUMN client_nonce SET NOT NULL,
  ALTER COLUMN operation_id SET NOT NULL,
  ALTER COLUMN intent_epoch SET NOT NULL,
  ALTER COLUMN credential_revision SET NOT NULL,
  ALTER COLUMN requested_scopes SET NOT NULL;

ALTER TABLE public.figma_oauth_states
  DROP CONSTRAINT IF EXISTS figma_oauth_states_fence_check,
  DROP CONSTRAINT IF EXISTS figma_oauth_states_client_nonce_check,
  DROP CONSTRAINT IF EXISTS figma_oauth_states_scope_check,
  DROP CONSTRAINT IF EXISTS figma_oauth_states_claim_lease_check;

ALTER TABLE public.figma_oauth_states
  ADD CONSTRAINT figma_oauth_states_fence_check
    CHECK (intent_epoch >= 0 AND credential_revision >= 0),
  ADD CONSTRAINT figma_oauth_states_client_nonce_check
    CHECK (client_nonce ~ '^[a-f0-9]{48}$'),
  ADD CONSTRAINT figma_oauth_states_scope_check
    CHECK (
      cardinality(requested_scopes) > 0
      AND requested_scopes <@ ARRAY['file_content:read']::text[]
    ),
  ADD CONSTRAINT figma_oauth_states_claim_lease_check
    CHECK (
      (claimed_at IS NULL AND claim_expires_at IS NULL)
      OR
      (claimed_at IS NOT NULL
        AND claim_expires_at > claimed_at
        AND claim_expires_at <= claimed_at + interval '2 minutes')
    );

ALTER TABLE public.figma_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.figma_oauth_states FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.figma_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.figma_oauth_states TO service_role;

COMMENT ON TABLE public.figma_oauth_states IS
  'Service-only, encrypted-PKCE, single-use Figma OAuth callback states.';

CREATE OR REPLACE FUNCTION public.normalize_figma_oauth_scopes_v1(p_scopes text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT ARRAY(
    SELECT allowed.scope
    FROM unnest(ARRAY['file_content:read']::text[]) WITH ORDINALITY AS allowed(scope, ordinal)
    WHERE allowed.scope = ANY (
      regexp_split_to_array(lower(trim(coalesce(p_scopes, ''))), E'[\\s,]+')
    )
    ORDER BY allowed.ordinal
  );
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_figma_oauth_states_v1(
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_deleted integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_candidate record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  FOR v_candidate IN
    SELECT
      state_row.id,
      state_row.user_id,
      state_row.operation_id,
      state_row.intent_epoch,
      state_row.credential_revision
    FROM public.figma_oauth_states AS state_row
    WHERE (state_row.claimed_at IS NULL AND state_row.expires_at <= clock_timestamp())
       OR (state_row.claimed_at IS NOT NULL AND state_row.claim_expires_at <= clock_timestamp())
    ORDER BY coalesce(state_row.claim_expires_at, state_row.expires_at), state_row.id
    LIMIT v_limit
  LOOP
    -- Match reserve/claim/disconnect lock order: advisory user lock, credential
    -- row, then state row. The unlocked candidate is only a hint and grants no
    -- deletion or credential authority.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_candidate.user_id::text || ':figma:oauth', 0));
    PERFORM 1
    FROM public.oauth_provider_credentials AS credential
    WHERE credential.user_id = v_candidate.user_id AND credential.provider = 'figma'
    FOR UPDATE;

    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.id = v_candidate.id
      AND state_row.user_id = v_candidate.user_id
      AND state_row.operation_id = v_candidate.operation_id
      AND state_row.intent_epoch = v_candidate.intent_epoch
      AND state_row.credential_revision = v_candidate.credential_revision
      AND (
        (state_row.claimed_at IS NULL AND state_row.expires_at <= clock_timestamp())
        OR (state_row.claimed_at IS NOT NULL AND state_row.claim_expires_at <= clock_timestamp())
      );
    IF NOT FOUND THEN CONTINUE; END IF;
    v_deleted := v_deleted + 1;

    -- Retire only the exact abandoned pending authorization. Keep any existing
    -- connected credential and its revision intact so ordinary refresh can
    -- resume; a newer/superseding authorization cannot match these fences.
    UPDATE public.oauth_provider_credentials AS credential
    SET authorization_operation_id = NULL,
        authorization_scopes = ARRAY[]::text[],
        updated_at = clock_timestamp()
    WHERE credential.user_id = v_candidate.user_id
      AND credential.provider = 'figma'
      AND credential.authorization_operation_id = v_candidate.operation_id
      AND credential.intent_epoch = v_candidate.intent_epoch
      AND credential.revision = v_candidate.credential_revision;
  END LOOP;
  RETURN v_deleted;
END;
$function$;

-- Remove the unpublished pre-full-state signatures if this transaction is
-- reapplied over an earlier reviewed draft. Leaving either overload callable
-- would allow a service caller to reserve or consume only the server half.
DROP FUNCTION IF EXISTS public.reserve_figma_oauth_authorization_v1(
  uuid, text, text, text, uuid, timestamptz
);
DROP FUNCTION IF EXISTS public.reserve_figma_oauth_authorization_v1(
  uuid, text, text, text, text, uuid, timestamptz
);
DROP FUNCTION IF EXISTS public.claim_figma_oauth_state_v1(text);
DROP FUNCTION IF EXISTS public.claim_figma_oauth_state_v1(text, text);

CREATE OR REPLACE FUNCTION public.reserve_figma_oauth_authorization_v1(
  p_user_id uuid,
  p_state text,
  p_client_nonce text,
  p_code_verifier text,
  p_requested_scopes text,
  p_operation_id uuid,
  p_expires_at timestamptz
)
RETURNS TABLE(
  state_id uuid,
  intent_epoch bigint,
  credential_revision bigint,
  required_scopes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_state text := trim(coalesce(p_state, ''));
  v_client_nonce text := coalesce(p_client_nonce, '');
  v_verifier text := trim(coalesce(p_code_verifier, ''));
  v_requested text[] := public.normalize_figma_oauth_scopes_v1(p_requested_scopes);
  v_required text[];
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_state_row public.figma_oauth_states%ROWTYPE;
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_operation_id IS NULL
     OR v_state !~ '^[a-f0-9]{48}$'
     OR v_client_nonce !~ '^[a-f0-9]{48}$'
     OR v_verifier !~ '^[A-Za-z0-9._~-]{43,128}$'
     OR cardinality(v_requested) = 0
     OR p_expires_at IS NULL
     OR p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION 'invalid_figma_oauth_authorization_reservation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  INSERT INTO public.oauth_provider_credentials(user_id, provider)
  VALUES (p_user_id, 'figma')
  ON CONFLICT (user_id, provider) DO NOTHING;

  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;

  IF v_row.authorization_operation_id = p_operation_id THEN
    SELECT * INTO v_state_row
    FROM public.figma_oauth_states AS state_row
    WHERE state_row.user_id = p_user_id
      AND state_row.state = v_state
      AND state_row.client_nonce = v_client_nonce
      AND state_row.operation_id = p_operation_id;
    IF FOUND THEN
      RETURN QUERY SELECT
        v_state_row.id,
        v_state_row.intent_epoch,
        v_state_row.credential_revision,
        array_to_string(v_state_row.requested_scopes, ',');
      RETURN;
    END IF;
    RAISE EXCEPTION 'figma_oauth_authorization_operation_reused' USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY(
    SELECT allowed.scope
    FROM unnest(ARRAY['file_content:read']::text[]) WITH ORDINALITY AS allowed(scope, ordinal)
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
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING credential.intent_epoch, credential.revision
  INTO intent_epoch, credential_revision;

  -- A user has one live Figma authorization intent. Superseded callback states
  -- are removed in the same transaction as the intent-epoch advance.
  DELETE FROM public.figma_oauth_states AS state_row
  WHERE state_row.user_id = p_user_id;

  v_passphrase := public.app_encryption_key();
  INSERT INTO public.figma_oauth_states(
    state, client_nonce, user_id, expires_at, code_verifier_enc, operation_id,
    intent_epoch, credential_revision, requested_scopes
  ) VALUES (
    v_state, v_client_nonce, p_user_id, p_expires_at,
    extensions.pgp_sym_encrypt(v_verifier, v_passphrase),
    p_operation_id, intent_epoch, credential_revision, v_required
  )
  RETURNING id INTO state_id;

  required_scopes := array_to_string(v_required, ',');
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_figma_oauth_state_v1(
  p_state text,
  p_client_nonce text
)
RETURNS TABLE(
  user_id uuid,
  client_nonce text,
  code_verifier text,
  intent_epoch bigint,
  credential_revision bigint,
  operation_id uuid,
  required_scopes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_state text := trim(coalesce(p_state, ''));
  v_client_nonce text := coalesce(p_client_nonce, '');
  v_user_id uuid;
  v_state_row public.figma_oauth_states%ROWTYPE;
  v_credential public.oauth_provider_credentials%ROWTYPE;
  v_credential_found boolean := false;
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF v_state !~ '^[a-f0-9]{48}$'
     OR v_client_nonce !~ '^[a-f0-9]{48}$' THEN
    RETURN;
  END IF;

  -- Read only the lock key first, then follow the canonical lock order used by
  -- reserve/disconnect: advisory lock -> credential row -> state row. The
  -- state is re-read under lock, so this unlocked hint grants no authority.
  SELECT state_row.user_id INTO v_user_id
  FROM public.figma_oauth_states AS state_row
  WHERE state_row.state = v_state
    AND state_row.client_nonce = v_client_nonce;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_credential
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = v_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  v_credential_found := FOUND;
  SELECT * INTO v_state_row
  FROM public.figma_oauth_states AS state_row
  WHERE state_row.state = v_state
    AND state_row.client_nonce = v_client_nonce
    AND state_row.user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_state_row.claimed_at IS NOT NULL THEN RETURN; END IF;
  IF v_state_row.expires_at <= clock_timestamp() THEN
    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.id = v_state_row.id;
    RETURN;
  END IF;
  IF NOT v_credential_found
     OR v_credential.intent_epoch <> v_state_row.intent_epoch
     OR v_credential.revision <> v_state_row.credential_revision
     OR v_credential.authorization_operation_id IS DISTINCT FROM v_state_row.operation_id
     OR v_credential.authorization_scopes IS DISTINCT FROM v_state_row.requested_scopes THEN
    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.id = v_state_row.id;
    RETURN;
  END IF;

  -- Claim before returning the PKCE verifier: one callback can cross the
  -- provider boundary at most once, including under concurrent requests. Keep
  -- the claimed row until commit or expiry so refresh/status can distinguish a
  -- legitimate in-flight exchange from an abandoned authorization.
  UPDATE public.figma_oauth_states AS state_row
  SET claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp() + interval '1 minute'
  WHERE state_row.id = v_state_row.id
    AND state_row.claimed_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  v_passphrase := public.app_encryption_key();
  RETURN QUERY SELECT
    v_state_row.user_id,
    v_state_row.client_nonce,
    extensions.pgp_sym_decrypt(v_state_row.code_verifier_enc, v_passphrase)::text,
    v_state_row.intent_epoch,
    v_state_row.credential_revision,
    v_state_row.operation_id,
    array_to_string(v_state_row.requested_scopes, ',');
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_figma_oauth_authorization_v1(
  p_user_id uuid,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
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
  v_granted text[] := public.normalize_figma_oauth_scopes_v1(p_granted_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_access_token text := nullif(trim(coalesce(p_access_token, '')), '');
  v_refresh_token text := nullif(trim(coalesce(p_refresh_token, '')), '');
  v_subject text := nullif(trim(coalesce(p_provider_subject, '')), '');
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_operation_id IS NULL
     OR p_expected_intent_epoch IS NULL OR p_expected_revision IS NULL
     OR v_access_token IS NULL OR length(v_access_token) > 16384
     OR (v_refresh_token IS NOT NULL AND length(v_refresh_token) > 16384)
     OR v_subject IS NULL OR length(v_subject) > 512
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR cardinality(v_granted) = 0 THEN
    RAISE EXCEPTION 'invalid_figma_oauth_authorization_commit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'figma_oauth_authorization_stale' USING ERRCODE = '40001';
  END IF;
  IF v_row.last_operation_kind = 'authorization'
     AND v_row.last_operation_id = p_operation_id THEN
    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.user_id = p_user_id
      AND state_row.operation_id = p_operation_id
      AND state_row.intent_epoch = p_expected_intent_epoch
      AND state_row.credential_revision = p_expected_revision
      AND state_row.claimed_at IS NOT NULL;
    RETURN QUERY SELECT true, v_row.revision, array_to_string(v_row.granted_scopes, ',');
    RETURN;
  END IF;
  IF v_row.intent_epoch <> p_expected_intent_epoch
     OR v_row.revision <> p_expected_revision
     OR v_row.authorization_operation_id IS DISTINCT FROM p_operation_id THEN
    RAISE EXCEPTION 'figma_oauth_authorization_stale' USING ERRCODE = '40001';
  END IF;
  IF NOT (v_row.authorization_scopes <@ v_granted) THEN
    RAISE EXCEPTION 'figma_oauth_scope_union_not_granted' USING ERRCODE = '22023';
  END IF;

  v_passphrase := public.app_encryption_key();
  IF v_refresh_token IS NULL
     AND v_row.status = 'connected'
     AND v_row.provider_subject = v_subject
     AND v_row.refresh_token_enc IS NOT NULL THEN
    v_refresh_token := extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text;
  END IF;
  IF v_refresh_token IS NULL THEN
    RAISE EXCEPTION 'figma_oauth_refresh_token_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET status = 'connected',
      revision = credential.revision + 1,
      authorization_operation_id = NULL,
      authorization_scopes = ARRAY[]::text[],
      access_token_enc = extensions.pgp_sym_encrypt(v_access_token, v_passphrase),
      refresh_token_enc = extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
      expires_at = p_expires_at,
      account_email = '',
      provider_subject = v_subject,
      granted_scopes = v_granted,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'authorization',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING true, credential.revision, array_to_string(credential.granted_scopes, ',')
  INTO applied, credential_revision, granted_scopes;
  DELETE FROM public.figma_oauth_states AS state_row
  WHERE state_row.user_id = p_user_id
    AND state_row.operation_id = p_operation_id
    AND state_row.intent_epoch = p_expected_intent_epoch
    AND state_row.credential_revision = p_expected_revision
    AND state_row.claimed_at IS NOT NULL;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_figma_oauth_refresh_v1(
  p_user_id uuid,
  p_claim_id uuid,
  p_lease_seconds integer DEFAULT 45
)
RETURNS TABLE(
  outcome text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
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
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_passphrase text;
  v_lease_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 45), 120));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_claim_id IS NULL THEN
    RAISE EXCEPTION 'invalid_figma_oauth_refresh_claim' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'connected' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::text, NULL::timestamptz,
      NULL::text, ''::text, NULL::bigint, NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  -- Self-heal an abandoned authorization while already holding the canonical
  -- per-user lock. Refresh/status/file callers must not depend on a future
  -- authorize request or scheduled cleanup to retire a missing/expired state.
  IF v_row.authorization_operation_id IS NOT NULL
     AND (
       NOT EXISTS (
         SELECT 1
         FROM public.figma_oauth_states AS state_row
         WHERE state_row.user_id = p_user_id
           AND state_row.operation_id = v_row.authorization_operation_id
           AND state_row.intent_epoch = v_row.intent_epoch
           AND state_row.credential_revision = v_row.revision
       )
       OR EXISTS (
         SELECT 1
         FROM public.figma_oauth_states AS state_row
         WHERE state_row.user_id = p_user_id
           AND state_row.operation_id = v_row.authorization_operation_id
           AND state_row.intent_epoch = v_row.intent_epoch
           AND state_row.credential_revision = v_row.revision
           AND (
             (state_row.claimed_at IS NULL AND state_row.expires_at <= clock_timestamp())
             OR (state_row.claimed_at IS NOT NULL AND state_row.claim_expires_at <= clock_timestamp())
           )
       )
     ) THEN
    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.user_id = p_user_id
      AND state_row.operation_id = v_row.authorization_operation_id
      AND state_row.intent_epoch = v_row.intent_epoch
      AND state_row.credential_revision = v_row.revision;
    UPDATE public.oauth_provider_credentials AS credential
    SET authorization_operation_id = NULL,
        authorization_scopes = ARRAY[]::text[],
        updated_at = clock_timestamp()
    WHERE credential.user_id = p_user_id AND credential.provider = 'figma';
    v_row.authorization_operation_id := NULL;
    v_row.authorization_scopes := ARRAY[]::text[];
  END IF;

  v_passphrase := public.app_encryption_key();
  -- Never rotate the credential revision beneath an already-open
  -- authorization callback. A still-valid old access token may be observed,
  -- but an expired token reports bounded contention until that authorization
  -- commits, is superseded, or expires and is cleaned up.
  IF v_row.authorization_operation_id IS NOT NULL THEN
    IF v_row.expires_at > clock_timestamp()
       AND v_row.access_token_enc IS NOT NULL THEN
      RETURN QUERY SELECT
        'fresh'::text,
        extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
        NULL::text,
        v_row.expires_at,
        v_row.provider_subject,
        array_to_string(v_row.granted_scopes, ','),
        v_row.revision,
        v_row.intent_epoch,
        NULL::uuid;
    ELSE
      RETURN QUERY SELECT
        'busy'::text, NULL::text, NULL::text, v_row.expires_at,
        v_row.provider_subject, array_to_string(v_row.granted_scopes, ','),
        v_row.revision, v_row.intent_epoch, NULL::uuid;
    END IF;
    RETURN;
  END IF;

  IF v_row.expires_at > clock_timestamp() + interval '5 minutes' THEN
    RETURN QUERY SELECT
      'fresh'::text,
      extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
      NULL::text,
      v_row.expires_at,
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
    RETURN QUERY SELECT
      'busy'::text, NULL::text, NULL::text, v_row.expires_at,
      v_row.provider_subject, array_to_string(v_row.granted_scopes, ','),
      v_row.revision, v_row.intent_epoch, v_row.refresh_claim_id;
    RETURN;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET refresh_claim_id = p_claim_id,
      refresh_claim_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma';

  RETURN QUERY SELECT
    'claimed'::text,
    extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
    extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text,
    v_row.expires_at,
    v_row.provider_subject,
    array_to_string(v_row.granted_scopes, ','),
    v_row.revision,
    v_row.intent_epoch,
    p_claim_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_figma_oauth_refresh_v1(
  p_user_id uuid,
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
  v_granted text[] := public.normalize_figma_oauth_scopes_v1(p_granted_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_access_token text := nullif(trim(coalesce(p_access_token, '')), '');
  v_refresh_token text := nullif(trim(coalesce(p_refresh_token, '')), '');
  v_subject text := nullif(trim(coalesce(p_provider_subject, '')), '');
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_claim_id IS NULL OR p_operation_id IS NULL
     OR p_expected_intent_epoch IS NULL OR p_expected_revision IS NULL
     OR v_access_token IS NULL OR length(v_access_token) > 16384
     OR (v_refresh_token IS NOT NULL AND length(v_refresh_token) > 16384)
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR cardinality(v_granted) = 0 THEN
    RAISE EXCEPTION 'invalid_figma_oauth_refresh_commit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'figma_oauth_refresh_stale' USING ERRCODE = '40001';
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
    RAISE EXCEPTION 'figma_oauth_refresh_stale' USING ERRCODE = '40001';
  END IF;
  IF NOT (v_row.granted_scopes <@ v_granted) THEN
    RAISE EXCEPTION 'figma_oauth_scope_narrowed' USING ERRCODE = '22023';
  END IF;
  IF v_subject IS NOT NULL
     AND v_row.provider_subject IS NOT NULL
     AND v_row.provider_subject IS DISTINCT FROM v_subject THEN
    RAISE EXCEPTION 'figma_oauth_account_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_subject IS NULL AND v_row.provider_subject IS NULL THEN
    RAISE EXCEPTION 'figma_oauth_provider_subject_required' USING ERRCODE = '22023';
  END IF;

  v_passphrase := public.app_encryption_key();
  IF v_refresh_token IS NULL THEN
    v_refresh_token := extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET revision = credential.revision + 1,
      access_token_enc = extensions.pgp_sym_encrypt(v_access_token, v_passphrase),
      refresh_token_enc = extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
      expires_at = p_expires_at,
      provider_subject = coalesce(credential.provider_subject, v_subject),
      granted_scopes = v_granted,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'refresh',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING true, credential.revision, array_to_string(credential.granted_scopes, ',')
  INTO applied, credential_revision, granted_scopes;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_figma_oauth_refresh_v1(
  p_user_id uuid,
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
    AND credential.provider = 'figma'
    AND credential.status = 'connected'
    AND credential.intent_epoch = p_expected_intent_epoch
    AND credential.revision = p_expected_revision
    AND credential.refresh_claim_id = p_claim_id;
  v_released := FOUND;
  RETURN v_released;
END;
$function$;

-- A provider can reject a token after it passed the local freshness check.
-- Invalidate only the exact credential revision that produced that provider
-- response. A newer authorization or refresh advances the fence and survives.
CREATE OR REPLACE FUNCTION public.invalidate_figma_oauth_credential_v1(
  p_user_id uuid,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_operation_id uuid
)
RETURNS TABLE(applied boolean, credential_revision bigint, intent_epoch bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row public.oauth_provider_credentials%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_operation_id IS NULL
     OR p_expected_intent_epoch IS NULL OR p_expected_intent_epoch < 0
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_figma_oauth_credential_invalidation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_row.last_operation_kind = 'provider_auth_rejection'
     AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, v_row.intent_epoch;
    RETURN;
  END IF;

  IF v_row.status <> 'connected'
     OR v_row.intent_epoch <> p_expected_intent_epoch
     OR v_row.revision <> p_expected_revision THEN
    RETURN QUERY SELECT false, v_row.revision, v_row.intent_epoch;
    RETURN;
  END IF;

  -- A reconnect can be in progress while an earlier file request is still at
  -- Figma. Remove the exact rejected secrets, but preserve the pending
  -- authorization operation and its intent/revision fence so that the
  -- already-open callback can still commit. Superseding authorization and
  -- disconnect operations remain authoritative through the advisory lock.
  IF v_row.authorization_operation_id IS NOT NULL THEN
    UPDATE public.oauth_provider_credentials AS credential
    SET status = 'disconnected',
        access_token_enc = NULL,
        refresh_token_enc = NULL,
        expires_at = NULL,
        account_email = '',
        provider_subject = NULL,
        granted_scopes = ARRAY[]::text[],
        refresh_claim_id = NULL,
        refresh_claim_expires_at = NULL,
        last_operation_id = p_operation_id,
        last_operation_kind = 'provider_auth_rejection',
        updated_at = clock_timestamp()
    WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
    RETURNING true, credential.revision, credential.intent_epoch
    INTO applied, credential_revision, intent_epoch;
    RETURN NEXT;
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
      last_operation_kind = 'provider_auth_rejection',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING true, credential.revision, credential.intent_epoch
  INTO applied, credential_revision, intent_epoch;

  DELETE FROM public.figma_oauth_states AS state_row
  WHERE state_row.user_id = p_user_id;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.disconnect_figma_oauth_provider_v1(
  p_user_id uuid,
  p_operation_id uuid
)
RETURNS TABLE(disconnected boolean, credential_revision bigint, intent_epoch bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row public.oauth_provider_credentials%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_figma_oauth_disconnect' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  INSERT INTO public.oauth_provider_credentials(user_id, provider)
  VALUES (p_user_id, 'figma')
  ON CONFLICT (user_id, provider) DO NOTHING;
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
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
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING true, credential.revision, credential.intent_epoch
  INTO disconnected, credential_revision, intent_epoch;

  DELETE FROM public.figma_oauth_states AS state_row
  WHERE state_row.user_id = p_user_id;
  DELETE FROM public.user_api_keys AS legacy
  WHERE legacy.user_id = p_user_id
    AND lower(legacy.provider) = 'figma'
    AND lower(coalesce(legacy.label, 'default')) = 'oauth';
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_figma_oauth_status_v1(p_user_id uuid)
RETURNS TABLE(
  status text,
  expires_at timestamptz,
  provider_subject text,
  granted_scopes text,
  credential_revision bigint,
  intent_epoch bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row public.oauth_provider_credentials%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_figma_oauth_status' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'disconnected'::text, NULL::timestamptz, NULL::text,
      ''::text, 0::bigint, 0::bigint;
    RETURN;
  END IF;
  RETURN QUERY SELECT
    v_row.status,
    v_row.expires_at,
    v_row.provider_subject,
    array_to_string(v_row.granted_scopes, ','),
    v_row.revision,
    v_row.intent_epoch;
END;
$function$;

-- Migrate only legacy rows whose full credential shape can be proved valid.
-- Invalid/incomplete legacy OAuth rows are removed rather than exposed through
-- the generic key surface or guessed into a connected state.
DO $legacy_figma_oauth_migration$
DECLARE
  v_row record;
  v_meta jsonb;
  v_access_token text;
  v_refresh_token text;
  v_expires_at timestamptz;
  v_subject text;
  v_scopes text[];
  v_passphrase text := public.app_encryption_key();
BEGIN
  FOR v_row IN
    SELECT key_row.*
    FROM public.user_api_keys AS key_row
    WHERE lower(key_row.provider) = 'figma'
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    FOR UPDATE
  LOOP
    v_meta := NULL;
    v_access_token := NULL;
    v_refresh_token := NULL;
    v_expires_at := NULL;
    v_subject := NULL;
    v_scopes := ARRAY[]::text[];
    BEGIN
      v_meta := v_row.endpoint::jsonb;
      v_access_token := extensions.pgp_sym_decrypt(v_row.api_key_enc, v_passphrase)::text;
      v_refresh_token := nullif(trim(coalesce(v_meta->>'refresh_token', '')), '');
      v_expires_at := (v_meta->>'expires_at')::timestamptz;
      v_subject := nullif(trim(coalesce(v_meta->>'provider_subject', v_meta->>'user_id_string', '')), '');
      v_scopes := public.normalize_figma_oauth_scopes_v1(v_meta->>'scopes');
    EXCEPTION WHEN OTHERS THEN
      v_access_token := NULL;
    END;

    IF nullif(trim(coalesce(v_access_token, '')), '') IS NOT NULL
       AND v_refresh_token IS NOT NULL
       AND v_expires_at > clock_timestamp()
       AND v_subject IS NOT NULL
       AND cardinality(v_scopes) > 0 THEN
      INSERT INTO public.oauth_provider_credentials(
        user_id, provider, status, revision, intent_epoch,
        access_token_enc, refresh_token_enc, expires_at, provider_subject,
        granted_scopes, last_operation_id, last_operation_kind
      ) VALUES (
        v_row.user_id, 'figma', 'connected', 1, 0,
        extensions.pgp_sym_encrypt(trim(v_access_token), v_passphrase),
        extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
        v_expires_at, left(v_subject, 512), v_scopes,
        extensions.gen_random_uuid(), 'legacy_migration'
      )
      ON CONFLICT (user_id, provider) DO NOTHING;
    END IF;
  END LOOP;

  DELETE FROM public.user_api_keys AS key_row
  WHERE lower(key_row.provider) = 'figma'
    AND lower(coalesce(key_row.label, 'default')) = 'oauth';
END;
$legacy_figma_oauth_migration$;

-- Re-establish the generic BYOK boundary. Figma PAT/default rows remain
-- owner-managed, while the figma/oauth label joins Google/Microsoft OAuth as a
-- service-only reserved namespace.
DO $figma_user_api_key_policies$
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
$figma_user_api_key_policies$;

CREATE POLICY user_api_keys_select_own_non_oauth
  ON public.user_api_keys FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_insert_own_non_oauth
  ON public.user_api_keys FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_update_own_non_oauth
  ON public.user_api_keys FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_delete_own_non_oauth
  ON public.user_api_keys FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
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
  IF v_provider IN ('google', 'microsoft', 'figma') AND lower(v_label) = 'oauth' THEN
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
  IF v_provider IN ('google', 'microsoft', 'figma') AND lower(v_label) = 'oauth' THEN
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
      lower(key_row.provider) IN ('google', 'microsoft', 'figma')
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
      lower(key_row.provider) IN ('google', 'microsoft', 'figma')
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
      lower(key_row.provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    )
  ORDER BY key_row.provider, key_row.label;
END;
$function$;

REVOKE ALL ON FUNCTION public.normalize_figma_oauth_scopes_v1(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_figma_oauth_states_v1(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_figma_oauth_authorization_v1(uuid, text, text, text, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_figma_oauth_state_v1(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_figma_oauth_authorization_v1(uuid, bigint, bigint, uuid, text, text, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_figma_oauth_refresh_v1(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_figma_oauth_refresh_v1(uuid, bigint, bigint, uuid, uuid, text, text, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_figma_oauth_refresh_v1(uuid, bigint, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_figma_oauth_credential_v1(uuid, bigint, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disconnect_figma_oauth_provider_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_figma_oauth_status_v1(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.normalize_figma_oauth_scopes_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_figma_oauth_states_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_figma_oauth_authorization_v1(uuid, text, text, text, text, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_figma_oauth_state_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_figma_oauth_authorization_v1(uuid, bigint, bigint, uuid, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_figma_oauth_refresh_v1(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_figma_oauth_refresh_v1(uuid, bigint, bigint, uuid, uuid, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_figma_oauth_refresh_v1(uuid, bigint, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.invalidate_figma_oauth_credential_v1(uuid, bigint, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.disconnect_figma_oauth_provider_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_figma_oauth_status_v1(uuid) TO service_role;

-- Keep the generic BYOK functions usable, while their bodies reserve every
-- provider-specific OAuth namespace.
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

COMMIT;

NOTIFY pgrst, 'reload schema';
