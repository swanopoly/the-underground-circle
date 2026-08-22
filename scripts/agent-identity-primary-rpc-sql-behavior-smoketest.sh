#!/bin/sh
# Disposable PostgreSQL behavior proof for transactional primary-agent identity selection.
set -eu

for required_command in psql createdb dropdb; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "agent identity primary RPC SQL smoke requires $required_command" >&2
    exit 1
  }
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
migration="$repo_root/supabase/migrations/20260817130000_agent_identity_primary_rpc.sql"

smoke_db="uc_agent_identity_primary_sql_smoke_$$"
case "$smoke_db" in
  uc_agent_identity_primary_sql_smoke_[0-9]*) ;;
  *) echo "refusing unsafe disposable database name: $smoke_db" >&2; exit 1 ;;
esac

smoke_root=$(mktemp -d /tmp/uc-agent-identity-primary-sql-smoke.XXXXXX)
case "$smoke_root" in
  /tmp/uc-agent-identity-primary-sql-smoke.*) ;;
  *) echo "refusing unsafe disposable path: $smoke_root" >&2; exit 1 ;;
esac

started_temp_cluster=0
smoke_pg_user="${AGENT_IDENTITY_PRIMARY_SQL_SMOKE_PGUSER:-${PGUSER:-$(id -un)}}"
if ! psql -X -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  for candidate_user in "$(id -un)" cswanson postgres; do
    if psql -X -U "$candidate_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
      smoke_pg_user="$candidate_user"
      break
    fi
  done
fi
if ! psql -X -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  for required_command in initdb pg_ctl; do
    command -v "$required_command" >/dev/null 2>&1 || {
      echo "agent identity primary RPC SQL smoke needs a local server or $required_command" >&2
      exit 1
    }
  done
  smoke_pg_user=$(id -un)
  smoke_pg_data="$smoke_root/pgdata"
  smoke_pg_socket="$smoke_root/socket"
  mkdir "$smoke_pg_socket"
  initdb -D "$smoke_pg_data" -A trust -U "$smoke_pg_user" \
    --no-locale --encoding=UTF8 >/dev/null
  PGHOST="$smoke_pg_socket"
  PGPORT=5432
  export PGHOST PGPORT
  pg_ctl -D "$smoke_pg_data" \
    -o "-F -k '$smoke_pg_socket' -c listen_addresses='' -p $PGPORT" \
    -w start >/dev/null
  started_temp_cluster=1
fi

made_anon=0
made_authenticated=0
made_service_role=0
cleanup() {
  dropdb -U "$smoke_pg_user" --if-exists "$smoke_db" >/dev/null 2>&1 || true
  if [ "$made_service_role" -eq 1 ]; then
    psql -X -U "$smoke_pg_user" -d postgres -v ON_ERROR_STOP=1 \
      -c 'DROP ROLE IF EXISTS service_role' >/dev/null 2>&1 || true
  fi
  if [ "$made_authenticated" -eq 1 ]; then
    psql -X -U "$smoke_pg_user" -d postgres -v ON_ERROR_STOP=1 \
      -c 'DROP ROLE IF EXISTS authenticated' >/dev/null 2>&1 || true
  fi
  if [ "$made_anon" -eq 1 ]; then
    psql -X -U "$smoke_pg_user" -d postgres -v ON_ERROR_STOP=1 \
      -c 'DROP ROLE IF EXISTS anon' >/dev/null 2>&1 || true
  fi
  if [ "$started_temp_cluster" -eq 1 ]; then
    pg_ctl -D "$smoke_pg_data" -m fast -w stop >/dev/null 2>&1 || true
  fi
  case "$smoke_root" in
    /tmp/uc-agent-identity-primary-sql-smoke.*) rm -rf "$smoke_root" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

ensure_role() {
  role_name="$1"
  marker_name="$2"
  if ! psql -X -U "$smoke_pg_user" -d postgres -Atc \
    "SELECT 1 FROM pg_roles WHERE rolname = '$role_name'" | grep -q '^1$'; then
    psql -X -U "$smoke_pg_user" -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE ROLE $role_name NOLOGIN" >/dev/null
    eval "$marker_name=1"
  fi
}
ensure_role anon made_anon
ensure_role authenticated made_authenticated
ensure_role service_role made_service_role

createdb -U "$smoke_pg_user" "$smoke_db"

psql_smoke() {
  psql -X -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 "$@"
}

psql_smoke >/dev/null <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.agent_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  custom_name text,
  custom_color text,
  spirit_id text,
  spirit_emoji text,
  soul_prompt text,
  custom_profile_id text,
  custom_profile_name text,
  appearance jsonb DEFAULT '{}'::jsonb,
  assigned_floor_id text,
  desk_index integer,
  bond_id uuid,
  bond_level integer,
  bond_xp integer,
  is_primary boolean DEFAULT false,
  is_customized boolean DEFAULT false,
  bound_ai_provider text,
  bound_model text,
  terminal_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_messages integer NOT NULL DEFAULT 0,
  total_turns integer NOT NULL DEFAULT 0,
  total_cost_all_time numeric(12,4) NOT NULL DEFAULT 0,
  total_tokens_all_time bigint NOT NULL DEFAULT 0,
  total_sessions_all_time integer NOT NULL DEFAULT 0,
  most_used_model text,
  tags text[] DEFAULT '{}'::text[],
  first_seen timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, session_key)
);

CREATE FUNCTION public.touch_agent_identities_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_identities_touch_updated_at
  BEFORE UPDATE ON public.agent_identities
  FOR EACH ROW EXECUTE FUNCTION public.touch_agent_identities_updated_at();

ALTER TABLE public.agent_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_identity_owner_select
  ON public.agent_identities FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY agent_identity_owner_insert
  ON public.agent_identities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY agent_identity_owner_update
  ON public.agent_identities FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY agent_identity_owner_delete
  ON public.agent_identities FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_identities TO authenticated;

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

-- Deliberately seed a pre-invariant duplicate. The newest last_seen row must
-- survive as the sole legacy primary when the migration is first applied.
INSERT INTO public.agent_identities(
  user_id, session_key, bound_ai_provider, is_primary, last_seen
) VALUES
  ('11111111-1111-4111-8111-111111111111', 'legacy-old', 'legacy', true, '2026-08-16T00:00:00Z'),
  ('11111111-1111-4111-8111-111111111111', 'legacy-new', 'legacy', true, '2026-08-17T00:00:00Z');
SQL

psql_smoke -f "$migration" >/dev/null
# SQL Editor/consolidated replay must remain safe.
psql_smoke -f "$migration" >/dev/null

psql_smoke >/dev/null <<'SQL'
DO $catalog$
DECLARE
  function_config text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'public.agent_identities'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'agent identities RLS is not enabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS identity_index
    WHERE identity_index.indexrelid =
      'public.agent_identities_one_primary_per_provider_idx'::regclass
      AND identity_index.indisunique
      AND identity_index.indisvalid
      AND identity_index.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'partial unique primary-agent index is not valid';
  END IF;
  SELECT procedure_row.proconfig
  INTO function_config
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid =
    'public.set_main_agent_for_provider_v1(text,text)'::regprocedure
    AND procedure_row.prosecdef;
  IF function_config IS NULL
     OR NOT ('search_path=""' = ANY(function_config)) THEN
    RAISE EXCEPTION 'primary-agent RPC is not SECURITY DEFINER with an empty search_path: %',
      function_config;
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.set_main_agent_for_provider_v1(text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.set_main_agent_for_provider_v1(text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.set_main_agent_for_provider_v1(text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'primary-agent RPC grants are not authenticated-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.agent_identities'::regclass
      AND trigger_row.tgname = 'agent_identity_primary_columns_guard'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'primary/provider direct-write guard trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.agent_identities'::regclass
      AND trigger_row.tgname = 'agent_identity_primary_delete_guard'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'primary-row direct-delete guard trigger is missing';
  END IF;
END;
$catalog$;

DO $legacy_repair$
DECLARE
  primary_sessions text[];
BEGIN
  SELECT array_agg(session_key ORDER BY session_key)
  INTO primary_sessions
  FROM public.agent_identities
  WHERE user_id = '11111111-1111-4111-8111-111111111111'
    AND bound_ai_provider = 'legacy'
    AND is_primary IS TRUE;
  IF primary_sessions <> ARRAY['legacy-new']::text[] THEN
    RAISE EXCEPTION 'legacy duplicate repair retained the wrong primary: %', primary_sessions;
  END IF;
  BEGIN
    UPDATE public.agent_identities
    SET is_primary = true
    WHERE user_id = '11111111-1111-4111-8111-111111111111'
      AND session_key = 'legacy-old';
    RAISE EXCEPTION 'partial unique index accepted a second primary';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$legacy_repair$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

DO $zero_existing$
DECLARE
  receipt jsonb;
BEGIN
  receipt := public.set_main_agent_for_provider_v1('zero-target', 'zero-provider');
  IF receipt ->> 'schemaVersion' <> '1'
     OR receipt ->> 'userId' <> '11111111-1111-4111-8111-111111111111'
     OR receipt ->> 'providerType' <> 'zero-provider'
     OR receipt ->> 'requestedSessionKey' <> 'zero-target'
     OR receipt ->> 'primarySessionKey' <> 'zero-target'
     OR receipt ->> 'inserted' <> 'true'
     OR receipt ->> 'clearedCount' <> '0'
     OR receipt ->> 'targetRowCount' <> '1'
     OR receipt ->> 'rowCount' <> '1'
     OR jsonb_array_length(receipt -> 'rows') <> 1
     OR receipt #>> '{rows,0,session_key}' <> 'zero-target'
     OR receipt #>> '{rows,0,is_primary}' <> 'true' THEN
    RAISE EXCEPTION 'zero-row insertion receipt is not exact: %', receipt;
  END IF;
END;
$zero_existing$;

DO $ordinary_identity_update_preserves_primary$
DECLARE primary_before boolean; provider_before text;
BEGIN
  SELECT is_primary,bound_ai_provider INTO primary_before,provider_before
  FROM public.agent_identities
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='zero-target';
  INSERT INTO public.agent_identities(user_id,session_key,custom_name)
  VALUES ('11111111-1111-4111-8111-111111111111','zero-target','ordinary-update')
  ON CONFLICT (user_id,session_key) DO UPDATE
  SET custom_name=EXCLUDED.custom_name;
  IF (SELECT is_primary FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='zero-target') IS DISTINCT FROM primary_before
     OR (SELECT bound_ai_provider FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='zero-target') IS DISTINCT FROM provider_before
     OR (SELECT custom_name FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='zero-target') <> 'ordinary-update' THEN
    RAISE EXCEPTION 'ordinary identity upsert changed primary/provider truth';
  END IF;
  BEGIN
    UPDATE public.agent_identities
    SET is_primary=false
    WHERE user_id='11111111-1111-4111-8111-111111111111'
      AND session_key='zero-target';
    RAISE EXCEPTION 'direct primary mutation was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.agent_identities(user_id,session_key,bound_ai_provider,is_primary)
    VALUES ('11111111-1111-4111-8111-111111111111','forged-primary','zero-provider',true);
    RAISE EXCEPTION 'direct primary insert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO public.agent_identities(user_id,session_key,bound_ai_provider,is_primary)
  VALUES ('11111111-1111-4111-8111-111111111111','non-primary-binding','provider-a',false);
  UPDATE public.agent_identities
  SET bound_ai_provider='provider-b'
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='non-primary-binding';
  IF (SELECT bound_ai_provider FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='non-primary-binding') <> 'provider-b' THEN
    RAISE EXCEPTION 'non-primary provider metadata mutation was blocked';
  END IF;
  BEGIN
    UPDATE public.agent_identities
    SET bound_ai_provider='moved-provider'
    WHERE user_id='11111111-1111-4111-8111-111111111111'
      AND session_key='zero-target';
    RAISE EXCEPTION 'direct primary provider move was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.agent_identities
    WHERE user_id='11111111-1111-4111-8111-111111111111'
      AND session_key='zero-target';
    RAISE EXCEPTION 'direct primary-row delete was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_identities
    WHERE user_id='11111111-1111-4111-8111-111111111111'
      AND session_key='zero-target'
      AND is_primary IS TRUE
  ) THEN
    RAISE EXCEPTION 'rejected primary-row delete did not preserve the row';
  END IF;
  DELETE FROM public.agent_identities
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='non-primary-binding';
  IF FOUND THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'ordinary non-primary identity delete was blocked';
  END IF;
  BEGIN
    INSERT INTO public.agent_identities(user_id,session_key,custom_name,bound_ai_provider,is_primary)
    VALUES ('11111111-1111-4111-8111-111111111111','zero-target','stale-overwrite',NULL,false)
    ON CONFLICT (user_id,session_key) DO UPDATE
    SET custom_name=EXCLUDED.custom_name,
        bound_ai_provider=EXCLUDED.bound_ai_provider,
        is_primary=EXCLUDED.is_primary;
    RAISE EXCEPTION 'stale full-row compatibility upsert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT custom_name FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='zero-target') <> 'ordinary-update'
     OR (SELECT is_primary FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='zero-target') IS NOT TRUE
     OR (SELECT bound_ai_provider FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='zero-target') <> 'zero-provider' THEN
    RAISE EXCEPTION 'rejected stale compatibility upsert was not atomic';
  END IF;
END;
$ordinary_identity_update_preserves_primary$;

RESET ROLE;
INSERT INTO public.agent_identities(
  user_id, session_key, bound_ai_provider, is_primary
) VALUES
  ('11111111-1111-4111-8111-111111111111', 'one-target', 'one-provider', false),
  ('11111111-1111-4111-8111-111111111111', 'many-old', 'many-provider', true),
  ('11111111-1111-4111-8111-111111111111', 'many-target', 'many-provider', false),
  ('11111111-1111-4111-8111-111111111111', 'many-peer', 'many-provider', false),
  ('11111111-1111-4111-8111-111111111111', 'rollback-old', 'rollback-provider', true),
  ('11111111-1111-4111-8111-111111111111', 'rollback-target', 'rollback-provider', false);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

DO $one_existing$
DECLARE
  receipt jsonb;
BEGIN
  receipt := public.set_main_agent_for_provider_v1('one-target', 'one-provider');
  IF receipt ->> 'inserted' <> 'false'
     OR receipt ->> 'rowCount' <> '1'
     OR receipt ->> 'primarySessionKey' <> 'one-target' THEN
    RAISE EXCEPTION 'one-row promotion receipt is not exact: %', receipt;
  END IF;
END;
$one_existing$;

DO $multiple_existing$
DECLARE
  receipt jsonb;
  primary_sessions text[];
BEGIN
  receipt := public.set_main_agent_for_provider_v1('many-target', 'many-provider');
  SELECT array_agg(provider_row ->> 'session_key' ORDER BY provider_row ->> 'session_key')
  INTO primary_sessions
  FROM jsonb_array_elements(receipt -> 'rows') AS provider_row
  WHERE provider_row ->> 'is_primary' = 'true';
  IF receipt ->> 'inserted' <> 'false'
     OR receipt ->> 'clearedCount' <> '1'
     OR receipt ->> 'rowCount' <> '3'
     OR primary_sessions <> ARRAY['many-target']::text[] THEN
    RAISE EXCEPTION 'multi-row reassignment receipt is not canonical: %', receipt;
  END IF;
END;
$multiple_existing$;

RESET ROLE;

-- Force the target promotion to fail after the peer-clearing UPDATE. The
-- function call must roll the clearing statement back with the rest of its
-- transaction, preserving the prior primary exactly.
CREATE FUNCTION public.reject_rollback_target_promotion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.session_key = 'rollback-target' AND NEW.is_primary IS TRUE THEN
    RAISE EXCEPTION 'forced_post_clear_failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reject_rollback_target_promotion
  BEFORE UPDATE ON public.agent_identities
  FOR EACH ROW EXECUTE FUNCTION public.reject_rollback_target_promotion();

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $rollback_after_clear$
BEGIN
  BEGIN
    PERFORM public.set_main_agent_for_provider_v1('rollback-target', 'rollback-provider');
    RAISE EXCEPTION 'forced post-clear failure was not raised';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forced_post_clear_failure' THEN RAISE; END IF;
  END;
END;
$rollback_after_clear$;
RESET ROLE;

DO $rollback_truth$
DECLARE
  primary_sessions text[];
BEGIN
  SELECT array_agg(session_key ORDER BY session_key)
  INTO primary_sessions
  FROM public.agent_identities
  WHERE user_id = '11111111-1111-4111-8111-111111111111'
    AND bound_ai_provider = 'rollback-provider'
    AND is_primary IS TRUE;
  IF primary_sessions <> ARRAY['rollback-old']::text[] THEN
    RAISE EXCEPTION 'post-clear failure did not roll back the prior primary: %',
      primary_sessions;
  END IF;
END;
$rollback_truth$;
DROP TRIGGER reject_rollback_target_promotion ON public.agent_identities;
DROP FUNCTION public.reject_rollback_target_promotion();

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
DO $non_owner_isolation$
DECLARE
  visible_foreign_rows integer;
  changed_foreign_rows integer;
  receipt jsonb;
BEGIN
  SELECT count(*) INTO visible_foreign_rows
  FROM public.agent_identities
  WHERE user_id = '11111111-1111-4111-8111-111111111111';
  UPDATE public.agent_identities
  SET custom_name = 'forged'
  WHERE user_id = '11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS changed_foreign_rows = ROW_COUNT;
  receipt := public.set_main_agent_for_provider_v1('many-target', 'many-provider');
  IF visible_foreign_rows <> 0
     OR changed_foreign_rows <> 0
     OR receipt ->> 'userId' <> '22222222-2222-4222-8222-222222222222'
     OR receipt #>> '{rows,0,user_id}' <> '22222222-2222-4222-8222-222222222222' THEN
    RAISE EXCEPTION 'non-owner isolation failed: visible %, changed %, receipt %',
      visible_foreign_rows, changed_foreign_rows, receipt;
  END IF;
END;
$non_owner_isolation$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
DO $authentication_required$
BEGIN
  BEGIN
    PERFORM public.set_main_agent_for_provider_v1('no-owner', 'provider');
    RAISE EXCEPTION 'unauthenticated authenticated-role call was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authentication_required$;
RESET ROLE;

SET ROLE anon;
DO $anon_execute_denied$
BEGIN
  BEGIN
    PERFORM public.set_main_agent_for_provider_v1('anon', 'provider');
    RAISE EXCEPTION 'anon RPC execution was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_execute_denied$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $bounded_inputs$
BEGIN
  BEGIN
    PERFORM public.set_main_agent_for_provider_v1(' padded ', 'provider');
    RAISE EXCEPTION 'padded session key was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.set_main_agent_for_provider_v1('session', repeat('p', 201));
    RAISE EXCEPTION 'oversized provider was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.set_main_agent_for_provider_v1(E'bad\nkey', 'provider');
    RAISE EXCEPTION 'control-bearing session key was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END;
$bounded_inputs$;
RESET ROLE;

INSERT INTO public.agent_identities(
  user_id, session_key, bound_ai_provider, is_primary
) VALUES
  ('11111111-1111-4111-8111-111111111111', 'race-a', 'race-provider', false),
  ('11111111-1111-4111-8111-111111111111', 'race-b', 'race-provider', false);
SQL

# Two independent authenticated sessions race for the same owner/provider.
# Session A retains the RPC's owner advisory lock until commit; B must wait and
# then become the sole final primary without a transient durable duplicate.
race_a="$smoke_root/race-a"
race_b="$smoke_root/race-b"
(
  psql_smoke -Atq >"$race_a" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT public.set_main_agent_for_provider_v1('race-a', 'race-provider') ->> 'primarySessionKey';
SELECT pg_sleep(1);
COMMIT;
SQL
) &
race_pid_a=$!

psql_smoke -c 'SELECT pg_sleep(0.25)' >/dev/null
(
  psql_smoke -Atq >"$race_b" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT public.set_main_agent_for_provider_v1('race-b', 'race-provider') ->> 'primarySessionKey';
COMMIT;
SQL
) &
race_pid_b=$!
wait "$race_pid_a"
wait "$race_pid_b"

grep -q '^race-a$' "$race_a" || {
  echo 'first concurrent primary RPC did not return its exact target receipt' >&2
  exit 1
}
grep -q '^race-b$' "$race_b" || {
  echo 'second concurrent primary RPC did not return its exact target receipt' >&2
  exit 1
}

psql_smoke >/dev/null <<'SQL'
DO $concurrent_final_truth$
DECLARE
  primary_sessions text[];
BEGIN
  SELECT array_agg(session_key ORDER BY session_key)
  INTO primary_sessions
  FROM public.agent_identities
  WHERE user_id = '11111111-1111-4111-8111-111111111111'
    AND bound_ai_provider = 'race-provider'
    AND is_primary IS TRUE;
  IF primary_sessions <> ARRAY['race-b']::text[] THEN
    RAISE EXCEPTION 'concurrent primary RPCs did not converge to one final winner: %',
      primary_sessions;
  END IF;
END;
$concurrent_final_truth$;
SQL

echo 'Agent identity primary RPC disposable PostgreSQL behavior smoke passed.'
