#!/bin/sh
# Disposable PostgreSQL behavior proof for the Figma OAuth control plane.
set -eu

for required_command in initdb pg_ctl psql; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "Figma OAuth SQL behavior smoke requires $required_command" >&2
    exit 1
  }
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
migration_base="$repo_root/supabase/migrations/20260813190000_atomic_oauth_credential_store.sql"
migration_figma="$repo_root/supabase/migrations/20260813200000_figma_oauth_credential_control.sql"

smoke_root=$(mktemp -d /tmp/uc-figma-oauth-sql-smoke.XXXXXX)
case "$smoke_root" in
  /tmp/uc-figma-oauth-sql-smoke.*) ;;
  *) echo "refusing unsafe disposable path: $smoke_root" >&2; exit 1 ;;
esac
smoke_data="$smoke_root/data"
smoke_socket="$smoke_root/socket"
smoke_log="$smoke_root/postgres.log"
smoke_port=$((55000 + ($$ % 900)))
mkdir -p "$smoke_socket"

smoke_owner=$(id -un)
if [ "$(id -u)" -eq 0 ]; then
  smoke_owner="${FIGMA_OAUTH_SQL_SMOKE_OWNER:-cswanson}"
  id "$smoke_owner" >/dev/null 2>&1 || {
    echo "Figma OAuth SQL behavior smoke needs a non-root owner; set FIGMA_OAUTH_SQL_SMOKE_OWNER" >&2
    exit 1
  }
  chown -R "$smoke_owner" "$smoke_root"
fi

run_owner() {
  if [ "$(id -u)" -eq 0 ]; then
    sudo -u "$smoke_owner" env PATH="$PATH" "$@"
  else
    "$@"
  fi
}

pg_started=0
cleanup() {
  if [ "$pg_started" -eq 1 ]; then
    run_owner pg_ctl -D "$smoke_data" -m fast -w stop >/dev/null 2>&1 || true
  fi
  case "$smoke_root" in
    /tmp/uc-figma-oauth-sql-smoke.*) rm -rf "$smoke_root" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

run_owner initdb -A trust -U postgres -D "$smoke_data" >/dev/null
run_owner pg_ctl -D "$smoke_data" -l "$smoke_log" \
  -o "-k $smoke_socket -p $smoke_port -F" -w start >/dev/null
pg_started=1

psql_owner() {
  run_owner env PGHOST="$smoke_socket" PGPORT="$smoke_port" PGUSER=postgres \
    psql -X -v ON_ERROR_STOP=1 "$@"
}

psql_owner -d postgres >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
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
INSERT INTO vault.decrypted_secrets VALUES ('ENCRYPTION_KEY', 'disposable-figma-smoke-only');
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
ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.email_calendar_oauth_states(
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  state text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL,
  scopes text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.figma_oauth_states(
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  state text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.figma_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_only_figma_oauth_states ON public.figma_oauth_states
  FOR ALL USING (false) WITH CHECK (false);

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');

-- One old callback state proves that an unfenced, non-PKCE flow is retired.
INSERT INTO public.figma_oauth_states(state, user_id)
VALUES ('legacy-unfenced-state-must-be-removed', '22222222-2222-4222-8222-222222222222');

-- Valid legacy Figma OAuth has every field needed to preserve authority.
INSERT INTO public.user_api_keys(user_id, provider, api_key_enc, label, endpoint)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'figma',
  extensions.pgp_sym_encrypt('legacy-figma-access', 'disposable-figma-smoke-only'),
  'oauth',
  jsonb_build_object(
    'refresh_token', 'legacy-figma-refresh',
    'expires_at', clock_timestamp() + interval '1 hour',
    'provider_subject', 'figma-user-2',
    'scopes', 'file_content:read,file_metadata:read'
  )::text
), (
  '33333333-3333-4333-8333-333333333333',
  'figma',
  extensions.pgp_sym_encrypt('incomplete-figma-access', 'disposable-figma-smoke-only'),
  'oauth',
  jsonb_build_object(
    'refresh_token', 'incomplete-figma-refresh',
    'expires_at', clock_timestamp() + interval '1 hour'
  )::text
), (
  '22222222-2222-4222-8222-222222222222',
  'figma',
  extensions.pgp_sym_encrypt('figma-pat', 'disposable-figma-smoke-only'),
  'default',
  NULL
), (
  '22222222-2222-4222-8222-222222222222',
  'anthropic',
  extensions.pgp_sym_encrypt('anthropic-byok', 'disposable-figma-smoke-only'),
  'default',
  NULL
);

GRANT USAGE ON SCHEMA public, auth, extensions TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated, service_role;
GRANT ALL ON public.user_api_keys, public.email_calendar_oauth_states,
  public.figma_oauth_states TO authenticated, service_role;
SQL

psql_owner -d postgres -f "$migration_base" >/dev/null
psql_owner -d postgres -f "$migration_figma" >/dev/null
# SQL-editor/consolidated workflows can safely reapply the migration.
psql_owner -d postgres -f "$migration_figma" >/dev/null

psql_owner -d postgres >/dev/null <<'SQL'
DO $catalog$
BEGIN
  IF has_table_privilege('authenticated', 'public.oauth_provider_credentials', 'SELECT')
     OR has_table_privilege('authenticated', 'public.figma_oauth_states', 'SELECT')
     OR has_table_privilege('authenticated', 'public.figma_oauth_states', 'INSERT')
     OR has_table_privilege('authenticated', 'public.figma_oauth_states', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.figma_oauth_states', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated retained a Figma OAuth control-table privilege';
  END IF;
  IF has_function_privilege('authenticated', 'public.reserve_figma_oauth_authorization_v1(uuid,text,text,text,text,uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_figma_oauth_state_v1(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_figma_oauth_refresh_v1(uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.invalidate_figma_oauth_credential_v1(uuid,bigint,bigint,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_figma_oauth_status_v1(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated retained Figma OAuth control RPC execution';
  END IF;
  IF has_function_privilege('anon', 'public.invalidate_figma_oauth_credential_v1(uuid,bigint,bigint,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.invalidate_figma_oauth_credential_v1(uuid,bigint,bigint,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'provider rejection invalidation grants are not service-role-only';
  END IF;
  IF to_regprocedure('public.reserve_figma_oauth_authorization_v1(uuid,text,text,text,uuid,timestamptz)') IS NOT NULL
     OR to_regprocedure('public.claim_figma_oauth_state_v1(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'partial-state Figma OAuth RPC overload survived reapply';
  END IF;
  IF to_regprocedure('public.reserve_figma_oauth_authorization_v1(uuid,text,text,text,text,uuid,timestamptz)') IS NULL
     OR to_regprocedure('public.claim_figma_oauth_state_v1(text,text)') IS NULL
     OR to_regprocedure('public.invalidate_figma_oauth_credential_v1(uuid,bigint,bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'full-state Figma OAuth RPC contract is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.figma_oauth_states WHERE state = 'legacy-unfenced-state-must-be-removed') THEN
    RAISE EXCEPTION 'legacy unfenced Figma state survived the upgrade';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.oauth_provider_credentials
    WHERE user_id = '22222222-2222-4222-8222-222222222222'
      AND provider = 'figma' AND status = 'connected'
      AND provider_subject = 'figma-user-2'
      AND granted_scopes = ARRAY['file_content:read']::text[]
      AND access_token_enc IS NOT NULL AND refresh_token_enc IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'valid legacy Figma OAuth was not encrypted and migrated';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.oauth_provider_credentials
    WHERE user_id = '33333333-3333-4333-8333-333333333333' AND provider = 'figma'
  ) THEN
    RAISE EXCEPTION 'incomplete legacy Figma OAuth was guessed into a connection';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_api_keys
    WHERE provider = 'figma' AND lower(coalesce(label, 'default')) = 'oauth'
  ) THEN
    RAISE EXCEPTION 'legacy Figma OAuth remained on the generic key surface';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_api_keys
    WHERE user_id = '22222222-2222-4222-8222-222222222222'
      AND provider = 'figma' AND label = 'default'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_api_keys
    WHERE user_id = '22222222-2222-4222-8222-222222222222'
      AND provider = 'anthropic' AND label = 'default'
  ) THEN
    RAISE EXCEPTION 'ordinary Figma PAT or other BYOK was harmed';
  END IF;
END;
$catalog$;

SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $authorization_and_refresh$
DECLARE
  reservation record;
  reservation_retry record;
  claim record;
  replay record;
  committed record;
  competing record;
  second_reservation record;
  third_reservation record;
  released boolean;
  status_row record;
  disconnected_row record;
BEGIN
  BEGIN
    PERFORM public.reserve_figma_oauth_authorization_v1(
      '11111111-1111-4111-8111-111111111111',
      '999999999999999999999999999999999999999999999999',
      'INVALID-UPPERCASE-CLIENT-NONCE-000000000000000000',
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
      'file_content:read',
      '99999999-9999-4999-8999-999999999999',
      clock_timestamp() + interval '10 minutes'
    );
    RAISE EXCEPTION 'malformed client nonce unexpectedly reserved';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  SELECT * INTO reservation
  FROM public.reserve_figma_oauth_authorization_v1(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '111111111111111111111111111111111111111111111111',
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
    'file_content:read',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    clock_timestamp() + interval '10 minutes'
  );
  IF reservation.required_scopes <> 'file_content:read' THEN
    RAISE EXCEPTION 'Figma scope normalization failed: %', reservation;
  END IF;
  SELECT * INTO reservation_retry
  FROM public.reserve_figma_oauth_authorization_v1(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '111111111111111111111111111111111111111111111111',
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
    'file_content:read',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    clock_timestamp() + interval '10 minutes'
  );
  IF reservation_retry.state_id <> reservation.state_id
     OR reservation_retry.intent_epoch <> reservation.intent_epoch
     OR reservation_retry.credential_revision <> reservation.credential_revision THEN
    RAISE EXCEPTION 'exact authorization reservation replay was not idempotent: %, %',
      reservation, reservation_retry;
  END IF;
  BEGIN
    PERFORM public.reserve_figma_oauth_authorization_v1(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '999999999999999999999999999999999999999999999999',
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
      'file_content:read',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clock_timestamp() + interval '10 minutes'
    );
    RAISE EXCEPTION 'same operation id rebound to a different client nonce';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.figma_oauth_states
    WHERE id = reservation.state_id
      AND client_nonce = '111111111111111111111111111111111111111111111111'
  ) THEN
    RAISE EXCEPTION 'exact client nonce was not persisted with the authorization state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.figma_oauth_states
    WHERE id = reservation.state_id
      AND code_verifier_enc = convert_to(
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~', 'UTF8'
      )
  ) THEN
    RAISE EXCEPTION 'PKCE verifier was stored as plaintext';
  END IF;

  SELECT * INTO replay
  FROM public.claim_figma_oauth_state_v1(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '999999999999999999999999999999999999999999999999'
  );
  IF FOUND THEN RAISE EXCEPTION 'mismatched client nonce claimed a Figma state'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.figma_oauth_states WHERE id = reservation.state_id
  ) THEN
    RAISE EXCEPTION 'mismatched client nonce consumed the valid Figma state';
  END IF;

  SELECT * INTO claim
  FROM public.claim_figma_oauth_state_v1(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '111111111111111111111111111111111111111111111111'
  );
  IF claim.client_nonce <> '111111111111111111111111111111111111111111111111'
     OR claim.code_verifier <> 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
     OR claim.intent_epoch <> reservation.intent_epoch
     OR claim.credential_revision <> reservation.credential_revision THEN
    RAISE EXCEPTION 'single-use callback claim returned the wrong fence or verifier: %', claim;
  END IF;
  SELECT * INTO replay
  FROM public.claim_figma_oauth_state_v1(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '111111111111111111111111111111111111111111111111'
  );
  IF FOUND THEN RAISE EXCEPTION 'Figma callback state replay succeeded'; END IF;

  SELECT * INTO committed
  FROM public.commit_figma_oauth_authorization_v1(
    '11111111-1111-4111-8111-111111111111',
    claim.intent_epoch, claim.credential_revision, claim.operation_id,
    'figma-access-1', 'figma-refresh-1', clock_timestamp() + interval '1 minute',
    'figma-user-1', 'file_content:read'
  );
  IF NOT committed.applied THEN RAISE EXCEPTION 'Figma authorization did not commit'; END IF;

  -- A newer authorization removes its predecessor and advances the intent.
  SELECT * INTO second_reservation
  FROM public.reserve_figma_oauth_authorization_v1(
    '11111111-1111-4111-8111-111111111111',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '222222222222222222222222222222222222222222222222',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~',
    'file_content:read',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    clock_timestamp() + interval '10 minutes'
  );
  SELECT * INTO third_reservation
  FROM public.reserve_figma_oauth_authorization_v1(
    '11111111-1111-4111-8111-111111111111',
    'cccccccccccccccccccccccccccccccccccccccccccccccc',
    '333333333333333333333333333333333333333333333333',
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-._~',
    'file_content:read',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    clock_timestamp() + interval '10 minutes'
  );
  IF third_reservation.intent_epoch <= second_reservation.intent_epoch
     OR third_reservation.required_scopes <> 'file_content:read' THEN
    RAISE EXCEPTION 'authorization intent/scope union did not advance: %, %',
      second_reservation, third_reservation;
  END IF;
  SELECT * INTO replay
  FROM public.claim_figma_oauth_state_v1(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '222222222222222222222222222222222222222222222222'
  );
  IF FOUND THEN RAISE EXCEPTION 'superseded Figma callback state was claimable'; END IF;
  SELECT * INTO claim
  FROM public.claim_figma_oauth_state_v1(
    'cccccccccccccccccccccccccccccccccccccccccccccccc',
    '333333333333333333333333333333333333333333333333'
  );
  SELECT * INTO committed
  FROM public.commit_figma_oauth_authorization_v1(
    '11111111-1111-4111-8111-111111111111',
    claim.intent_epoch, claim.credential_revision, claim.operation_id,
    'figma-access-2', '', clock_timestamp() + interval '1 minute',
    'figma-user-1', 'file_content:read'
  );
  IF NOT committed.applied THEN RAISE EXCEPTION 'same-subject refresh token preservation failed'; END IF;

  SELECT * INTO claim
  FROM public.claim_figma_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 45
  );
  IF claim.outcome <> 'claimed' OR claim.refresh_token <> 'figma-refresh-1' THEN
    RAISE EXCEPTION 'refresh claim did not return the encrypted credential: %', claim;
  END IF;
  SELECT * INTO competing
  FROM public.claim_figma_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 45
  );
  IF competing.outcome <> 'busy' THEN RAISE EXCEPTION 'competing refresh was not fenced'; END IF;
  SELECT public.release_figma_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111',
    claim.intent_epoch, claim.credential_revision,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ) INTO released;
  IF NOT released THEN RAISE EXCEPTION 'refresh lease release failed'; END IF;

  SELECT * INTO claim
  FROM public.claim_figma_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 45
  );
  BEGIN
    PERFORM public.commit_figma_oauth_refresh_v1(
      '11111111-1111-4111-8111-111111111111',
      claim.intent_epoch, claim.credential_revision,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'account-switch-access', 'account-switch-refresh', clock_timestamp() + interval '1 hour',
      'different-figma-user', 'file_content:read'
    );
    RAISE EXCEPTION 'account-switch refresh unexpectedly committed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  SELECT * INTO committed
  FROM public.commit_figma_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111',
    claim.intent_epoch, claim.credential_revision,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '12121212-1212-4212-8212-121212121212',
    'figma-access-3', 'figma-refresh-3', clock_timestamp() + interval '2 hours',
    'figma-user-1', 'file_content:read'
  );
  IF NOT committed.applied OR committed.credential_revision <= claim.credential_revision THEN
    RAISE EXCEPTION 'rotating refresh commit failed: %', committed;
  END IF;

  SELECT * INTO status_row
  FROM public.get_figma_oauth_status_v1('11111111-1111-4111-8111-111111111111');
  IF status_row.status <> 'connected' OR status_row.provider_subject <> 'figma-user-1' THEN
    RAISE EXCEPTION 'secret-free status is incorrect: %', status_row;
  END IF;

  -- Force a stale-token path inside the disposable test, claim it, then prove
  -- disconnect wins over that in-flight provider request.
  UPDATE public.oauth_provider_credentials
  SET expires_at = clock_timestamp() + interval '1 minute'
  WHERE user_id = '11111111-1111-4111-8111-111111111111' AND provider = 'figma';
  SELECT * INTO claim
  FROM public.claim_figma_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111',
    '13131313-1313-4313-8313-131313131313', 45
  );
  UPDATE public.oauth_provider_credentials
  SET refresh_claim_expires_at = clock_timestamp() - interval '1 second'
  WHERE user_id = '11111111-1111-4111-8111-111111111111' AND provider = 'figma';
  BEGIN
    PERFORM public.commit_figma_oauth_refresh_v1(
      '11111111-1111-4111-8111-111111111111',
      claim.intent_epoch, claim.credential_revision,
      '13131313-1313-4313-8313-131313131313',
      '18181818-1818-4818-8818-181818181818',
      'expired-lease-access', 'expired-lease-refresh', clock_timestamp() + interval '1 hour',
      'figma-user-1', 'file_content:read'
    );
    RAISE EXCEPTION 'expired refresh lease unexpectedly committed';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  SELECT * INTO claim
  FROM public.claim_figma_oauth_refresh_v1(
    '11111111-1111-4111-8111-111111111111',
    '19191919-1919-4919-8919-191919191919', 45
  );
  SELECT * INTO disconnected_row
  FROM public.disconnect_figma_oauth_provider_v1(
    '11111111-1111-4111-8111-111111111111',
    '14141414-1414-4414-8414-141414141414'
  );
  IF NOT disconnected_row.disconnected THEN RAISE EXCEPTION 'disconnect failed'; END IF;
  BEGIN
    PERFORM public.commit_figma_oauth_refresh_v1(
      '11111111-1111-4111-8111-111111111111',
      claim.intent_epoch, claim.credential_revision,
      '19191919-1919-4919-8919-191919191919',
      '15151515-1515-4515-8515-151515151515',
      'resurrected', 'resurrected', clock_timestamp() + interval '1 hour',
      'figma-user-1', 'file_content:read'
    );
    RAISE EXCEPTION 'disconnect-losing refresh resurrected a credential';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM public.oauth_provider_credentials
    WHERE user_id = '11111111-1111-4111-8111-111111111111' AND provider = 'figma'
      AND (status <> 'disconnected' OR access_token_enc IS NOT NULL OR refresh_token_enc IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'disconnect tombstone retained a secret';
  END IF;
END;
$authorization_and_refresh$;

DO $provider_auth_rejection_invalidation$
DECLARE
  reservation record;
  pending_read record;
  claim record;
  committed record;
  before_rejection record;
  rejected record;
  rejection_replay record;
  reconnected_fence record;
  stale_rejection record;
  refresh_claim record;
  refreshed record;
  exact_fence record;
  final_rejection record;
  missing_rejection record;
BEGIN
  -- Start a reconnect, then take a file-read credential snapshot from the
  -- still-connected old token. If Figma rejects that exact snapshot, its
  -- secrets must be removed without destroying the already-open callback.
  UPDATE public.oauth_provider_credentials
  SET expires_at = clock_timestamp() + interval '1 minute'
  WHERE user_id = '22222222-2222-4222-8222-222222222222' AND provider = 'figma';
  SELECT * INTO reservation
  FROM public.reserve_figma_oauth_authorization_v1(
    '22222222-2222-4222-8222-222222222222',
    'abababababababababababababababababababababababab',
    '121212121212121212121212121212121212121212121212',
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
    'file_content:read',
    '21212121-2121-4121-8121-212121212121',
    clock_timestamp() + interval '10 minutes'
  );
  SELECT * INTO pending_read
  FROM public.claim_figma_oauth_refresh_v1(
    '22222222-2222-4222-8222-222222222222',
    '20202020-2020-4020-8020-202020202020', 45
  );
  SELECT status, revision, intent_epoch INTO before_rejection
  FROM public.oauth_provider_credentials
  WHERE user_id = '22222222-2222-4222-8222-222222222222' AND provider = 'figma';
  IF pending_read.outcome <> 'fresh'
     OR pending_read.access_token <> 'legacy-figma-access'
     OR before_rejection.status <> 'connected'
     OR before_rejection.revision <> reservation.credential_revision
     OR before_rejection.intent_epoch <> reservation.intent_epoch
     OR pending_read.credential_revision <> before_rejection.revision
     OR pending_read.intent_epoch <> before_rejection.intent_epoch THEN
    RAISE EXCEPTION 'pending reconnect read has the wrong credential fence: %, %, %',
      pending_read, before_rejection, reservation;
  END IF;
  BEGIN
    PERFORM public.commit_figma_oauth_refresh_v1(
      '22222222-2222-4222-8222-222222222222',
      pending_read.intent_epoch, pending_read.credential_revision,
      '20202020-2020-4020-8020-202020202020',
      '30303030-3030-4030-8030-303030303030',
      'must-not-rotate', 'must-not-rotate', clock_timestamp() + interval '2 hours',
      'figma-user-2', 'file_content:read'
    );
    RAISE EXCEPTION 'pending reconnect allowed a background refresh commit';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;

  SELECT * INTO rejected
  FROM public.invalidate_figma_oauth_credential_v1(
    '22222222-2222-4222-8222-222222222222',
    before_rejection.intent_epoch,
    before_rejection.revision,
    '22222222-2222-4222-8222-222222222223'
  );
  IF NOT rejected.applied
     OR rejected.credential_revision <> before_rejection.revision
     OR rejected.intent_epoch <> before_rejection.intent_epoch THEN
    RAISE EXCEPTION 'pending reconnect rejection did not preserve the callback fence: %, %',
      before_rejection, rejected;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.oauth_provider_credentials
    WHERE user_id = '22222222-2222-4222-8222-222222222222' AND provider = 'figma'
      AND (status <> 'disconnected'
        OR access_token_enc IS NOT NULL OR refresh_token_enc IS NOT NULL
        OR expires_at IS NOT NULL OR provider_subject IS NOT NULL
        OR cardinality(granted_scopes) <> 0
        OR refresh_claim_id IS NOT NULL OR refresh_claim_expires_at IS NOT NULL)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.oauth_provider_credentials
    WHERE user_id = '22222222-2222-4222-8222-222222222222' AND provider = 'figma'
      AND authorization_operation_id = '21212121-2121-4121-8121-212121212121'
      AND authorization_scopes = ARRAY['file_content:read']::text[]
  ) OR NOT EXISTS (
    SELECT 1 FROM public.figma_oauth_states
    WHERE user_id = '22222222-2222-4222-8222-222222222222'
      AND state = 'abababababababababababababababababababababababab'
  ) THEN
    RAISE EXCEPTION 'pending reconnect rejection did not remove secrets and preserve callback authority';
  END IF;

  SELECT * INTO rejection_replay
  FROM public.invalidate_figma_oauth_credential_v1(
    '22222222-2222-4222-8222-222222222222',
    before_rejection.intent_epoch,
    before_rejection.revision,
    '22222222-2222-4222-8222-222222222223'
  );
  IF NOT rejection_replay.applied
     OR rejection_replay.credential_revision <> rejected.credential_revision
     OR rejection_replay.intent_epoch <> rejected.intent_epoch THEN
    RAISE EXCEPTION 'exact provider rejection replay was not idempotent: %, %',
      rejected, rejection_replay;
  END IF;

  -- The original pending callback remains claimable and can establish the
  -- replacement credential after the old token's rejection.
  SELECT * INTO claim
  FROM public.claim_figma_oauth_state_v1(
    'abababababababababababababababababababababababab',
    '121212121212121212121212121212121212121212121212'
  );
  IF claim.intent_epoch <> rejected.intent_epoch
     OR claim.credential_revision <> rejected.credential_revision
     OR claim.operation_id <> '21212121-2121-4121-8121-212121212121' THEN
    RAISE EXCEPTION 'pending callback was not preserved behind the rejection fence: %, %',
      claim, rejected;
  END IF;
  SELECT * INTO committed
  FROM public.commit_figma_oauth_authorization_v1(
    '22222222-2222-4222-8222-222222222222',
    claim.intent_epoch, claim.credential_revision, claim.operation_id,
    'reconnected-access', 'reconnected-refresh', clock_timestamp() + interval '1 minute',
    'figma-user-2', 'file_content:read'
  );
  IF NOT committed.applied THEN
    RAISE EXCEPTION 'pending callback could not replace the rejected credential: %', committed;
  END IF;
  SELECT revision, intent_epoch INTO reconnected_fence
  FROM public.oauth_provider_credentials
  WHERE user_id = '22222222-2222-4222-8222-222222222222' AND provider = 'figma';

  -- Neither a replay of the rejection id nor a fresh rejection operation
  -- carrying the old snapshot may erase the callback's newer credential.
  SELECT * INTO stale_rejection
  FROM public.invalidate_figma_oauth_credential_v1(
    '22222222-2222-4222-8222-222222222222',
    before_rejection.intent_epoch,
    before_rejection.revision,
    '22222222-2222-4222-8222-222222222223'
  );
  IF stale_rejection.applied
     OR stale_rejection.credential_revision <> reconnected_fence.revision
     OR stale_rejection.intent_epoch <> reconnected_fence.intent_epoch THEN
    RAISE EXCEPTION 'old idempotency key erased or hid the reconnected fence: %', stale_rejection;
  END IF;
  SELECT * INTO stale_rejection
  FROM public.invalidate_figma_oauth_credential_v1(
    '22222222-2222-4222-8222-222222222222',
    before_rejection.intent_epoch,
    before_rejection.revision,
    '24242424-2424-4424-8424-242424242424'
  );
  IF stale_rejection.applied THEN
    RAISE EXCEPTION 'stale provider rejection deleted a newer reconnect';
  END IF;

  -- A rotating refresh advances revision without changing intent; the old
  -- response fence still cannot invalidate the freshly rotated token.
  SELECT * INTO refresh_claim
  FROM public.claim_figma_oauth_refresh_v1(
    '22222222-2222-4222-8222-222222222222',
    '25252525-2525-4525-8525-252525252525', 45
  );
  IF refresh_claim.outcome <> 'claimed' THEN
    RAISE EXCEPTION 'provider rejection refresh fixture was not claimable: %', refresh_claim;
  END IF;
  SELECT * INTO refreshed
  FROM public.commit_figma_oauth_refresh_v1(
    '22222222-2222-4222-8222-222222222222',
    refresh_claim.intent_epoch, refresh_claim.credential_revision,
    '25252525-2525-4525-8525-252525252525',
    '26262626-2626-4626-8626-262626262626',
    'post-refresh-access', 'post-refresh-token', clock_timestamp() + interval '2 hours',
    'figma-user-2', 'file_content:read'
  );
  SELECT * INTO stale_rejection
  FROM public.invalidate_figma_oauth_credential_v1(
    '22222222-2222-4222-8222-222222222222',
    reconnected_fence.intent_epoch,
    reconnected_fence.revision,
    '27272727-2727-4727-8727-272727272727'
  );
  IF stale_rejection.applied
     OR stale_rejection.credential_revision <> refreshed.credential_revision
     OR NOT EXISTS (
       SELECT 1 FROM public.oauth_provider_credentials
       WHERE user_id = '22222222-2222-4222-8222-222222222222' AND provider = 'figma'
         AND status = 'connected'
         AND extensions.pgp_sym_decrypt(access_token_enc, public.app_encryption_key())::text = 'post-refresh-access'
     ) THEN
    RAISE EXCEPTION 'stale provider rejection deleted a newer refresh: %, %',
      stale_rejection, refreshed;
  END IF;

  SELECT revision, intent_epoch INTO exact_fence
  FROM public.oauth_provider_credentials
  WHERE user_id = '22222222-2222-4222-8222-222222222222' AND provider = 'figma';
  SELECT * INTO final_rejection
  FROM public.invalidate_figma_oauth_credential_v1(
    '22222222-2222-4222-8222-222222222222',
    exact_fence.intent_epoch,
    exact_fence.revision,
    '28282828-2828-4828-8828-282828282828'
  );
  IF NOT final_rejection.applied
     OR final_rejection.credential_revision <> exact_fence.revision + 1
     OR final_rejection.intent_epoch <> exact_fence.intent_epoch + 1
     OR EXISTS (
       SELECT 1 FROM public.oauth_provider_credentials
       WHERE user_id = '22222222-2222-4222-8222-222222222222' AND provider = 'figma'
         AND (status <> 'disconnected' OR access_token_enc IS NOT NULL OR refresh_token_enc IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'exact post-refresh rejection did not disconnect: %, %',
      exact_fence, final_rejection;
  END IF;

  SELECT * INTO missing_rejection
  FROM public.invalidate_figma_oauth_credential_v1(
    '33333333-3333-4333-8333-333333333333', 0, 0,
    '29292929-2929-4929-8929-292929292929'
  );
  IF missing_rejection.applied
     OR missing_rejection.credential_revision <> 0
     OR missing_rejection.intent_epoch <> 0 THEN
    RAISE EXCEPTION 'missing provider rejection did not return the empty current fence: %',
      missing_rejection;
  END IF;
END;
$provider_auth_rejection_invalidation$;
SQL

# Two independent callback transactions race for one state; exactly one gets it.
psql_owner -d postgres -Atq <<'SQL' >/dev/null
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT * FROM public.reserve_figma_oauth_authorization_v1(
  '44444444-4444-4444-8444-444444444444',
  'dddddddddddddddddddddddddddddddddddddddddddddddd',
  '444444444444444444444444444444444444444444444444',
  'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-._~',
  'file_content:read',
  '16161616-1616-4616-8616-161616161616',
  clock_timestamp() + interval '10 minutes'
);
SQL

claim_a="$smoke_root/claim-a"
claim_b="$smoke_root/claim-b"
(
  psql_owner -d postgres -Atq >"$claim_a" <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT count(*) FROM public.claim_figma_oauth_state_v1(
  'dddddddddddddddddddddddddddddddddddddddddddddddd',
  '444444444444444444444444444444444444444444444444'
);
COMMIT;
SQL
) &
claim_pid_a=$!
(
  psql_owner -d postgres -Atq >"$claim_b" <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT count(*) FROM public.claim_figma_oauth_state_v1(
  'dddddddddddddddddddddddddddddddddddddddddddddddd',
  '444444444444444444444444444444444444444444444444'
);
COMMIT;
SQL
) &
claim_pid_b=$!
wait "$claim_pid_a"
wait "$claim_pid_b"
claim_count_a=$(grep -E '^[01]$' "$claim_a" | tail -n 1)
claim_count_b=$(grep -E '^[01]$' "$claim_b" | tail -n 1)
if [ $((claim_count_a + claim_count_b)) -ne 1 ]; then
  echo "concurrent Figma state claim was not exactly-once: $claim_count_a + $claim_count_b" >&2
  exit 1
fi

psql_owner -d postgres >/dev/null <<'SQL'
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $abandoned_authorization_recovery$
DECLARE
  reservation record;
  callback_claim record;
  committed record;
  refresh_claim record;
  deleted_count integer;
BEGIN
  -- Establish a connected credential, then start and abandon another popup.
  SELECT * INTO reservation FROM public.reserve_figma_oauth_authorization_v1(
    '44444444-4444-4444-8444-444444444444',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '555555555555555555555555555555555555555555555555',
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
    'file_content:read',
    '31313131-3131-4131-8131-313131313131',
    clock_timestamp() + interval '10 minutes'
  );
  SELECT * INTO callback_claim FROM public.claim_figma_oauth_state_v1(
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '555555555555555555555555555555555555555555555555'
  );
  SELECT * INTO committed FROM public.commit_figma_oauth_authorization_v1(
    '44444444-4444-4444-8444-444444444444',
    callback_claim.intent_epoch, callback_claim.credential_revision,
    callback_claim.operation_id,
    'cleanup-access', 'cleanup-refresh', clock_timestamp() + interval '1 minute',
    'figma-user-4', 'file_content:read'
  );
  IF NOT committed.applied THEN RAISE EXCEPTION 'cleanup fixture did not connect'; END IF;

  -- A callback claim keeps a durable claimed marker until commit. Concurrent
  -- status/file refresh must not interpret that in-flight exchange as an
  -- abandoned popup or rotate the callback's revision.
  SELECT * INTO reservation FROM public.reserve_figma_oauth_authorization_v1(
    '44444444-4444-4444-8444-444444444444',
    'acacacacacacacacacacacacacacacacacacacacacacacac',
    '575757575757575757575757575757575757575757575757',
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-._~',
    'file_content:read',
    '34343434-3434-4434-8434-343434343434',
    clock_timestamp() + interval '10 minutes'
  );
  SELECT * INTO callback_claim FROM public.claim_figma_oauth_state_v1(
    'acacacacacacacacacacacacacacacacacacacacacacacac',
    '575757575757575757575757575757575757575757575757'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.figma_oauth_states
    WHERE id = reservation.state_id
      AND claimed_at IS NOT NULL
      AND claim_expires_at > claimed_at
  ) THEN
    RAISE EXCEPTION 'callback did not retain an exact bounded claim lease';
  END IF;
  UPDATE public.figma_oauth_states
  SET expires_at = clock_timestamp() - interval '1 second'
  WHERE id = reservation.state_id;
  SELECT public.cleanup_figma_oauth_states_v1(10) INTO deleted_count;
  IF deleted_count <> 0 OR NOT EXISTS (
    SELECT 1 FROM public.figma_oauth_states
    WHERE id = reservation.state_id AND claimed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'original state expiry deleted an active callback claim lease';
  END IF;
  UPDATE public.oauth_provider_credentials
  SET expires_at = clock_timestamp() - interval '1 second'
  WHERE user_id = '44444444-4444-4444-8444-444444444444' AND provider = 'figma';
  SELECT * INTO refresh_claim FROM public.claim_figma_oauth_refresh_v1(
    '44444444-4444-4444-8444-444444444444',
    '35353535-3535-4535-8535-353535353535', 45
  );
  IF refresh_claim.outcome <> 'busy'
     OR NOT EXISTS (
       SELECT 1 FROM public.oauth_provider_credentials
       WHERE user_id = '44444444-4444-4444-8444-444444444444' AND provider = 'figma'
         AND authorization_operation_id = callback_claim.operation_id
         AND revision = callback_claim.credential_revision
         AND intent_epoch = callback_claim.intent_epoch
     ) THEN
    RAISE EXCEPTION 'in-flight callback was cleared or rotated by refresh: %', refresh_claim;
  END IF;
  SELECT * INTO committed FROM public.commit_figma_oauth_authorization_v1(
    '44444444-4444-4444-8444-444444444444',
    callback_claim.intent_epoch, callback_claim.credential_revision,
    callback_claim.operation_id,
    'inflight-access', 'inflight-refresh', clock_timestamp() + interval '1 minute',
    'figma-user-4', 'file_content:read'
  );
  IF NOT committed.applied OR EXISTS (
    SELECT 1 FROM public.figma_oauth_states WHERE id = reservation.state_id
  ) THEN
    RAISE EXCEPTION 'in-flight callback did not commit and retire its claimed state: %', committed;
  END IF;

  -- Start a second reconnect and abandon it until its state expires.
  SELECT * INTO reservation FROM public.reserve_figma_oauth_authorization_v1(
    '44444444-4444-4444-8444-444444444444',
    'fefefefefefefefefefefefefefefefefefefefefefefefe',
    '565656565656565656565656565656565656565656565656',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~',
    'file_content:read',
    '32323232-3232-4232-8232-323232323232',
    clock_timestamp() + interval '10 minutes'
  );
  SELECT * INTO callback_claim FROM public.claim_figma_oauth_state_v1(
    'fefefefefefefefefefefefefefefefefefefefefefefefe',
    '565656565656565656565656565656565656565656565656'
  );
  UPDATE public.figma_oauth_states
  SET claimed_at = clock_timestamp() - interval '2 minutes',
      claim_expires_at = clock_timestamp() - interval '1 minute'
  WHERE id = reservation.state_id;

  -- A crashed callback is self-healed only after its bounded claim lease
  -- expires; this uses the real status/file credential path, not direct cleanup.
  SELECT * INTO refresh_claim FROM public.claim_figma_oauth_refresh_v1(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333334', 45
  );
  IF refresh_claim.outcome <> 'claimed'
     OR refresh_claim.refresh_token <> 'inflight-refresh'
     OR EXISTS (
       SELECT 1 FROM public.oauth_provider_credentials
       WHERE user_id = '44444444-4444-4444-8444-444444444444' AND provider = 'figma'
         AND (authorization_operation_id IS NOT NULL OR cardinality(authorization_scopes) <> 0)
     )
     OR EXISTS (
       SELECT 1 FROM public.figma_oauth_states
       WHERE id = reservation.state_id
     ) THEN
    RAISE EXCEPTION 'refresh claim did not self-heal abandoned authorization: %', refresh_claim;
  END IF;
  PERFORM public.release_figma_oauth_refresh_v1(
    '44444444-4444-4444-8444-444444444444',
    refresh_claim.intent_epoch, refresh_claim.credential_revision,
    '33333333-3333-4333-8333-333333333334'
  );

  -- The bulk cleanup RPC remains idempotent after the hot path already
  -- removed the exact expired state.
  SELECT public.cleanup_figma_oauth_states_v1(10) INTO deleted_count;
  IF deleted_count <> 0 THEN RAISE EXCEPTION 'self-healed state was deleted twice: %', deleted_count; END IF;

  -- A callback that reaches PostgreSQL after the original state expiry deletes
  -- that unusable state without crossing the provider boundary. Because every
  -- live callback now retains a leased claim row, the exact missing state is
  -- unambiguously abandoned and the next credential claim may recover it.
  SELECT * INTO reservation FROM public.reserve_figma_oauth_authorization_v1(
    '44444444-4444-4444-8444-444444444444',
    'abababababababababababababababababababababababab',
    '585858585858585858585858585858585858585858585858',
    'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-._~',
    'file_content:read',
    '36363636-3636-4636-8636-363636363636',
    clock_timestamp() + interval '10 minutes'
  );
  UPDATE public.figma_oauth_states
  SET expires_at = clock_timestamp() - interval '1 second'
  WHERE id = reservation.state_id;
  PERFORM public.claim_figma_oauth_state_v1(
    'abababababababababababababababababababababababab',
    '585858585858585858585858585858585858585858585858'
  );
  IF FOUND OR EXISTS (
    SELECT 1 FROM public.figma_oauth_states WHERE id = reservation.state_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.oauth_provider_credentials
    WHERE user_id = '44444444-4444-4444-8444-444444444444'
      AND provider = 'figma'
      AND authorization_operation_id = '36363636-3636-4636-8636-363636363636'
  ) THEN
    RAISE EXCEPTION 'expired callback state was not retired behind its pending authorization fence';
  END IF;
  UPDATE public.oauth_provider_credentials
  SET expires_at = clock_timestamp() - interval '1 second'
  WHERE user_id = '44444444-4444-4444-8444-444444444444' AND provider = 'figma';
  SELECT * INTO refresh_claim FROM public.claim_figma_oauth_refresh_v1(
    '44444444-4444-4444-8444-444444444444',
    '37373737-3737-4737-8737-373737373737', 45
  );
  IF refresh_claim.outcome <> 'claimed'
     OR refresh_claim.refresh_token <> 'inflight-refresh'
     OR EXISTS (
       SELECT 1 FROM public.oauth_provider_credentials
       WHERE user_id = '44444444-4444-4444-8444-444444444444' AND provider = 'figma'
         AND (authorization_operation_id IS NOT NULL OR cardinality(authorization_scopes) <> 0)
     ) THEN
    RAISE EXCEPTION 'missing-state authorization did not self-heal on the credential path: %', refresh_claim;
  END IF;
  PERFORM public.release_figma_oauth_refresh_v1(
    '44444444-4444-4444-8444-444444444444',
    refresh_claim.intent_epoch, refresh_claim.credential_revision,
    '37373737-3737-4737-8737-373737373737'
  );

  PERFORM public.disconnect_figma_oauth_provider_v1(
    '44444444-4444-4444-8444-444444444444',
    '17171717-1717-4717-8717-171717171717'
  );
END;
$abandoned_authorization_recovery$;

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $generic_boundary$
DECLARE
  figma_pat_id uuid;
  anthropic_id uuid;
  visible_count integer;
  pat_value text;
BEGIN
  figma_pat_id := public.store_user_api_key('figma', 'new-figma-pat', 'default', NULL);
  anthropic_id := public.store_user_api_key('anthropic', 'new-anthropic-key', 'team', NULL);
  IF figma_pat_id IS NULL OR anthropic_id IS NULL THEN
    RAISE EXCEPTION 'ordinary Figma PAT or other BYOK storage broke';
  END IF;
  BEGIN
    PERFORM public.store_user_api_key(
      'figma', 'forbidden-oauth', 'OAuth', '{"refresh_token":"forbidden"}'
    );
    RAISE EXCEPTION 'generic client recreated reserved Figma OAuth';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO visible_count
  FROM public.list_user_api_keys()
  WHERE provider = 'figma' AND lower(coalesce(label, 'default')) = 'oauth';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'generic list exposed Figma OAuth'; END IF;
  SELECT api_key INTO pat_value
  FROM public.get_user_api_key(
    '11111111-1111-4111-8111-111111111111', 'figma', 'default'
  );
  IF pat_value <> 'new-figma-pat' THEN RAISE EXCEPTION 'Figma PAT read was harmed'; END IF;
  SELECT api_key INTO pat_value
  FROM public.get_user_api_key(
    '11111111-1111-4111-8111-111111111111', 'figma', 'oauth'
  );
  IF FOUND THEN RAISE EXCEPTION 'generic getter exposed Figma OAuth'; END IF;
END;
$generic_boundary$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $service_generic_boundary$
BEGIN
  BEGIN
    PERFORM public.store_user_api_key_for_user(
      '11111111-1111-4111-8111-111111111111',
      'figma', 'forbidden-service-oauth', 'oauth', NULL
    );
    RAISE EXCEPTION 'generic service RPC recreated reserved Figma OAuth';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$service_generic_boundary$;
SQL

echo 'Figma OAuth credential control disposable PostgreSQL behavior smoke passed.'
