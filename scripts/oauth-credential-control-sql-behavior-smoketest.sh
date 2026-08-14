#!/bin/sh
# Disposable PostgreSQL behavior proof for the Office OAuth credential control plane.
set -eu

for required_command in psql createdb dropdb; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "OAuth credential SQL behavior smoke requires $required_command" >&2
    exit 1
  }
done

smoke_pg_user="${OAUTH_SQL_SMOKE_PGUSER:-${PGUSER:-$(id -un)}}"
if ! psql -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  for candidate_user in "$(id -un)" cswanson postgres; do
    if psql -U "$candidate_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
      smoke_pg_user="$candidate_user"
      break
    fi
  done
fi
if ! psql -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  echo 'OAuth credential SQL behavior smoke could not find a local PostgreSQL owner; set OAUTH_SQL_SMOKE_PGUSER' >&2
  exit 1
fi

smoke_db="uc_oauth_sql_smoke_$$"
case "$smoke_db" in
  uc_oauth_sql_smoke_[0-9]*) ;;
  *) echo "refusing unsafe disposable database name: $smoke_db" >&2; exit 1 ;;
esac

made_anon=0
made_authenticated=0
made_service_role=0
cleanup() {
  dropdb -U "$smoke_pg_user" --if-exists "$smoke_db" >/dev/null 2>&1 || true
  if [ "$made_service_role" -eq 1 ]; then psql -U "$smoke_pg_user" -d postgres -v ON_ERROR_STOP=1 -c 'DROP ROLE IF EXISTS service_role' >/dev/null 2>&1 || true; fi
  if [ "$made_authenticated" -eq 1 ]; then psql -U "$smoke_pg_user" -d postgres -v ON_ERROR_STOP=1 -c 'DROP ROLE IF EXISTS authenticated' >/dev/null 2>&1 || true; fi
  if [ "$made_anon" -eq 1 ]; then psql -U "$smoke_pg_user" -d postgres -v ON_ERROR_STOP=1 -c 'DROP ROLE IF EXISTS anon' >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT HUP INT TERM

ensure_role() {
  role_name="$1"
  marker_name="$2"
  if ! psql -U "$smoke_pg_user" -d postgres -Atc "SELECT 1 FROM pg_roles WHERE rolname = '$role_name'" | grep -q '^1$'; then
    psql -U "$smoke_pg_user" -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $role_name NOLOGIN" >/dev/null
    eval "$marker_name=1"
  fi
}
ensure_role anon made_anon
ensure_role authenticated made_authenticated
ensure_role service_role made_service_role
createdb -U "$smoke_pg_user" "$smoke_db"

psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA auth;
CREATE SCHEMA vault;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('ENCRYPTION_KEY', 'disposable-source-smoke-only');
CREATE FUNCTION public.app_encryption_key() RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, vault
AS $$ SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ENCRYPTION_KEY' LIMIT 1 $$;
CREATE TABLE public.user_api_keys(
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL,
  api_key_enc bytea NOT NULL,
  label text DEFAULT 'default',
  endpoint text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, label)
);
CREATE TABLE public.email_calendar_oauth_states(
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  state text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL,
  scopes text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.user_api_keys(user_id, provider, api_key_enc, label, endpoint)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'google',
  extensions.pgp_sym_encrypt('legacy-access', 'disposable-source-smoke-only'),
  'oauth',
  jsonb_build_object(
    'refresh_token', 'legacy-refresh',
    'expires_at', clock_timestamp() + interval '1 hour',
    'email', 'legacy@example.com',
    'scopes', 'calendar'
  )::text
);
GRANT USAGE ON SCHEMA public, auth, extensions TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated, service_role;
GRANT ALL ON public.user_api_keys, public.email_calendar_oauth_states TO authenticated, service_role;
SQL

psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260813190000_atomic_oauth_credential_store.sql >/dev/null
# Re-applying must be safe for the SQL Editor/consolidated workflow.
psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260813190000_atomic_oauth_credential_store.sql >/dev/null

psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DO $catalog$
BEGIN
  IF has_table_privilege('authenticated', 'public.oauth_provider_credentials', 'SELECT')
     OR has_table_privilege('authenticated', 'public.oauth_provider_credentials', 'INSERT')
     OR has_table_privilege('authenticated', 'public.oauth_provider_credentials', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.oauth_provider_credentials', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated retained OAuth credential table access';
  END IF;
  IF has_function_privilege('authenticated', 'public.claim_office_oauth_refresh_v1(uuid,text,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.commit_office_oauth_authorization_v1(uuid,text,bigint,bigint,uuid,text,text,timestamptz,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated retained OAuth control RPC execution';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_api_keys
    WHERE user_id = '22222222-2222-4222-8222-222222222222'
      AND provider = 'google' AND label = 'oauth'
  ) THEN
    RAISE EXCEPTION 'legacy plaintext OAuth metadata was not removed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.oauth_provider_credentials
    WHERE user_id = '22222222-2222-4222-8222-222222222222'
      AND provider = 'google' AND status = 'connected'
      AND access_token_enc IS NOT NULL AND refresh_token_enc IS NOT NULL
      AND granted_scopes = ARRAY['calendar']::text[]
  ) THEN
    RAISE EXCEPTION 'valid legacy OAuth credential was not encrypted and migrated';
  END IF;
END;
$catalog$;

SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $behavior$
DECLARE
  first_reservation record;
  second_reservation record;
  committed record;
  first_claim record;
  competing_claim record;
  disconnected_row record;
BEGIN
  SELECT * INTO first_reservation
  FROM public.reserve_office_oauth_authorization_v1(
    '11111111-1111-4111-8111-111111111111', 'google', 'calendar',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  SELECT * INTO second_reservation
  FROM public.reserve_office_oauth_authorization_v1(
    '11111111-1111-4111-8111-111111111111', 'google', 'email',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  IF second_reservation.intent_epoch <= first_reservation.intent_epoch
     OR second_reservation.required_scopes <> 'calendar,email' THEN
    RAISE EXCEPTION 'pending authorization union or monotonic intent failed: %, %',
      first_reservation, second_reservation;
  END IF;

  BEGIN
    PERFORM public.commit_office_oauth_authorization_v1(
      '11111111-1111-4111-8111-111111111111', 'google',
      first_reservation.intent_epoch, first_reservation.credential_revision,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'stale-access', 'stale-refresh', clock_timestamp() + interval '1 hour',
      'wrong@example.com', 'subject-1', 'calendar,email', 'calendar'
    );
    RAISE EXCEPTION 'superseded authorization unexpectedly committed';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;

  SELECT * INTO committed
  FROM public.commit_office_oauth_authorization_v1(
    '11111111-1111-4111-8111-111111111111', 'google',
    second_reservation.intent_epoch, second_reservation.credential_revision,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'access-1', 'refresh-1', clock_timestamp() + interval '1 minute',
    'user@example.com', 'subject-1', 'calendar,email', 'calendar,email'
  );
  IF NOT committed.applied OR committed.granted_scopes <> 'calendar,email' THEN
    RAISE EXCEPTION 'authorization commit failed: %', committed;
  END IF;

  SELECT * INTO first_claim
  FROM public.claim_office_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111', 'google',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 45
  );
  IF first_claim.outcome <> 'claimed' OR first_claim.refresh_token <> 'refresh-1' THEN
    RAISE EXCEPTION 'refresh claim did not return the encrypted credential: %', first_claim;
  END IF;
  SELECT * INTO competing_claim
  FROM public.claim_office_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111', 'google',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 45
  );
  IF competing_claim.outcome <> 'busy' THEN
    RAISE EXCEPTION 'concurrent refresh was not fenced: %', competing_claim;
  END IF;

  BEGIN
    PERFORM public.commit_office_oauth_refresh_v1(
      '11111111-1111-4111-8111-111111111111', 'google',
      first_claim.intent_epoch, first_claim.credential_revision,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'account-switch', 'account-switch-refresh', clock_timestamp() + interval '1 hour',
      'subject-2', 'calendar,email'
    );
    RAISE EXCEPTION 'account-switch refresh unexpectedly committed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  SELECT * INTO committed
  FROM public.commit_office_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111', 'google',
    first_claim.intent_epoch, first_claim.credential_revision,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'access-2', 'refresh-2', clock_timestamp() + interval '2 hours',
    'subject-1', 'calendar,email'
  );
  IF NOT committed.applied OR committed.credential_revision <= first_claim.credential_revision THEN
    RAISE EXCEPTION 'rotating refresh commit failed: %', committed;
  END IF;

  SELECT * INTO disconnected_row
  FROM public.disconnect_office_oauth_provider_v1(
    '11111111-1111-4111-8111-111111111111', 'google',
    '99999999-9999-4999-8999-999999999999'
  );
  IF NOT disconnected_row.disconnected THEN RAISE EXCEPTION 'disconnect failed'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.oauth_provider_credentials
    WHERE user_id = '11111111-1111-4111-8111-111111111111'
      AND provider = 'google'
      AND (status <> 'disconnected' OR access_token_enc IS NOT NULL OR refresh_token_enc IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'disconnect did not retain a secret-free tombstone';
  END IF;
  BEGIN
    PERFORM public.commit_office_oauth_refresh_v1(
      '11111111-1111-4111-8111-111111111111', 'google',
      first_claim.intent_epoch, first_claim.credential_revision,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '12121212-1212-4212-8212-121212121212',
      'resurrected', 'resurrected', clock_timestamp() + interval '1 hour',
      'subject-1', 'calendar,email'
    );
    RAISE EXCEPTION 'disconnect-losing refresh unexpectedly resurrected access';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
END;
$behavior$;

RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $generic_boundary$
DECLARE
  key_id uuid;
BEGIN
  key_id := public.store_user_api_key('anthropic', 'byok-value', 'default', NULL);
  IF key_id IS NULL THEN RAISE EXCEPTION 'ordinary BYOK storage was broken'; END IF;
  BEGIN
    PERFORM public.store_user_api_key('google', 'forbidden', 'OAuth', '{"refresh_token":"forbidden"}');
    RAISE EXCEPTION 'generic client recreated a reserved OAuth row';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM public.list_user_api_keys()
    WHERE provider = 'google' AND lower(coalesce(label, 'default')) = 'oauth'
  ) THEN
    RAISE EXCEPTION 'generic list exposed a reserved OAuth row';
  END IF;
END;
$generic_boundary$;
SQL

echo 'OAuth credential control disposable PostgreSQL behavior smoke passed.'
