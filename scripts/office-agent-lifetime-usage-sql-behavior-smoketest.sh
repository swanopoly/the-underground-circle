#!/bin/sh
# Disposable PostgreSQL behavior proof for owner-private Office lifetime usage.
set -eu

for required_command in psql createdb dropdb; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "Office lifetime usage SQL smoke requires $required_command" >&2
    exit 1
  }
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
migration="$repo_root/supabase/migrations/20260821150000_office_agent_lifetime_usage.sql"
smoke_db="uc_office_lifetime_usage_sql_smoke_$$"
case "$smoke_db" in
  uc_office_lifetime_usage_sql_smoke_[0-9]*) ;;
  *) echo "refusing unsafe disposable database name: $smoke_db" >&2; exit 1 ;;
esac

smoke_root=$(mktemp -d /tmp/uc-office-lifetime-usage-sql-smoke.XXXXXX)
case "$smoke_root" in
  /tmp/uc-office-lifetime-usage-sql-smoke.*) ;;
  *) echo "refusing unsafe disposable path: $smoke_root" >&2; exit 1 ;;
esac

started_temp_cluster=0
smoke_pg_user="${OFFICE_LIFETIME_USAGE_SQL_SMOKE_PGUSER:-${PGUSER:-$(id -un)}}"
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
      echo "Office lifetime usage SQL smoke needs a local server or $required_command" >&2
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
    psql -X -U "$smoke_pg_user" -d postgres -c 'DROP ROLE IF EXISTS service_role' >/dev/null 2>&1 || true
  fi
  if [ "$made_authenticated" -eq 1 ]; then
    psql -X -U "$smoke_pg_user" -d postgres -c 'DROP ROLE IF EXISTS authenticated' >/dev/null 2>&1 || true
  fi
  if [ "$made_anon" -eq 1 ]; then
    psql -X -U "$smoke_pg_user" -d postgres -c 'DROP ROLE IF EXISTS anon' >/dev/null 2>&1 || true
  fi
  if [ "$started_temp_cluster" -eq 1 ]; then
    pg_ctl -D "$smoke_pg_data" -m fast -w stop >/dev/null 2>&1 || true
  fi
  case "$smoke_root" in
    /tmp/uc-office-lifetime-usage-sql-smoke.*) rm -rf "$smoke_root" ;;
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
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.circles(id uuid PRIMARY KEY);
CREATE TABLE public.circle_members(
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY(circle_id, user_id)
);
CREATE TABLE public.circle_office_agents(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_usage_today bigint NOT NULL DEFAULT 0,
  token_usage_total bigint NOT NULL DEFAULT 0,
  message_count_today integer NOT NULL DEFAULT 0,
  message_count_total integer NOT NULL DEFAULT 0,
  input_tokens_today bigint NOT NULL DEFAULT 0,
  output_tokens_today bigint NOT NULL DEFAULT 0,
  cached_tokens_today bigint NOT NULL DEFAULT 0,
  input_tokens_total bigint NOT NULL DEFAULT 0,
  output_tokens_total bigint NOT NULL DEFAULT 0,
  cached_tokens_total bigint NOT NULL DEFAULT 0,
  estimated_cost_today numeric(12,6) NOT NULL DEFAULT 0,
  estimated_cost_total numeric(12,6) NOT NULL DEFAULT 0,
  model_name text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.agent_identities(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  total_messages integer NOT NULL DEFAULT 0,
  total_cost_all_time numeric(12,4) NOT NULL DEFAULT 0,
  total_tokens_all_time bigint NOT NULL DEFAULT 0,
  total_sessions_all_time integer NOT NULL DEFAULT 0,
  most_used_model text,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE public.circle_office_agent_usage_snapshots(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  snapshot_key text NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cached_tokens bigint NOT NULL DEFAULT 0,
  message_count integer NOT NULL DEFAULT 0,
  estimated_cost numeric(12,6) NOT NULL DEFAULT 0,
  model_name text,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT SELECT ON TABLE public.circle_office_agents TO authenticated;

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.circles(id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.circle_members(circle_id, user_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');

INSERT INTO public.circle_office_agents(
  id, circle_id, owner_id, name,
  token_usage_today, token_usage_total,
  message_count_today, message_count_total,
  input_tokens_today, output_tokens_today, cached_tokens_today,
  input_tokens_total, output_tokens_total, cached_tokens_total,
  estimated_cost_today, estimated_cost_total, model_name
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Codex Agent',
  150, 150,
  5, 5,
  100, 50, 20,
  100, 50, 20,
  1.25, 1.25, 'openai/gpt-5.6-sol'
);
INSERT INTO public.circle_office_agents(id, circle_id, owner_id, name) VALUES
  (
    '10000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'Ambiguous Agent'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'Ambiguous Agent'
  );

INSERT INTO public.agent_identities(
  id, user_id, session_key, total_messages, total_cost_all_time,
  total_tokens_all_time, total_sessions_all_time, most_used_model,
  first_seen, last_seen, updated_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'session-a', 4, 1.20, 140, 2, 'openai/gpt-5.6-sol',
    '2026-08-01T00:00:00Z', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'session-b', 2, 0.50, 50, 1, 'anthropic/claude-haiku-4-5',
    '2026-08-02T00:00:00Z', '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z'
  );

INSERT INTO public.circle_office_agent_usage_snapshots(
  id, circle_id, owner_id, agent_name, snapshot_key,
  input_tokens, output_tokens, cached_tokens, message_count,
  estimated_cost, model_name, created_at, last_seen_at
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Codex Agent', 'session-a',
  100, 50, 20, 5, 1.25, 'openai/gpt-5.6-sol',
  '2026-08-10T00:00:00Z', '2026-08-20T00:00:00Z'
);
SQL

psql_smoke -f "$migration" >/dev/null
# SQL Editor/consolidated replay must remain safe and preserve accumulated rows.
psql_smoke -f "$migration" >/dev/null

psql_smoke >/dev/null <<'SQL'
DO $catalog$
DECLARE
  function_config text[];
  policy_count integer;
BEGIN
  SELECT procedure_row.proconfig INTO function_config
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid =
    'public.sync_agent_profile_usage_v1(uuid,text,text,bigint,bigint,bigint,integer,numeric,text,text,timestamptz)'::regprocedure
    AND procedure_row.prosecdef;
  IF function_config IS NULL OR NOT ('search_path=""' = ANY(function_config)) THEN
    RAISE EXCEPTION 'lifetime RPC is not SECURITY DEFINER with an empty search path: %', function_config;
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.sync_agent_profile_usage_v1(uuid,text,text,bigint,bigint,bigint,integer,numeric,text,text,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.sync_agent_profile_usage_v1(uuid,text,text,bigint,bigint,bigint,integer,numeric,text,text,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.sync_agent_profile_usage_v1(uuid,text,text,bigint,bigint,bigint,integer,numeric,text,text,timestamptz)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'lifetime RPC grants are not authenticated-only';
  END IF;
  IF has_table_privilege('authenticated', 'public.office_agent_usage_profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.office_agent_usage_profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.office_agent_usage_profiles', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.office_agent_usage_profiles', 'SELECT') THEN
    RAISE EXCEPTION 'owner-private lifetime table grants are not SELECT-only';
  END IF;
  SELECT count(*) INTO policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'office_agent_usage_profiles';
  IF policy_count <> 1 THEN
    RAISE EXCEPTION 'unexpected lifetime policy inventory: %', policy_count;
  END IF;
  IF NOT (
    SELECT target.relrowsecurity AND target.relforcerowsecurity
    FROM pg_catalog.pg_class AS target
    WHERE target.oid = 'public.office_agent_usage_profiles'::regclass
  ) THEN
    RAISE EXCEPTION 'lifetime table is not FORCE RLS';
  END IF;
END;
$catalog$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

DO $behavior$
DECLARE
  receipt jsonb;
  profile_row public.office_agent_usage_profiles%ROWTYPE;
  public_row public.circle_office_agents%ROWTYPE;
BEGIN
  SELECT * INTO profile_row
  FROM public.office_agent_usage_profiles
  WHERE owner_id = auth.uid() AND session_key = 'session-a';
  IF profile_row.lifetime_tokens <> 150
     OR profile_row.lifetime_cost <> 1.25
     OR profile_row.lifetime_messages <> 5
     OR profile_row.session_count <> 2
     OR NOT profile_row.baseline_observed THEN
    RAISE EXCEPTION 'legacy snapshot baseline mismatch: %', row_to_json(profile_row);
  END IF;

  SELECT public.sync_agent_profile_usage_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Codex Agent', 'codex',
    120, 60, 25, 6, 1.50, 'openai/gpt-5.6-sol', 'session-a',
    '2026-08-21T12:01:00Z'
  ) INTO receipt;
  IF receipt ->> 'sessionKey' <> 'session-a'
     OR receipt ->> 'userId' <> auth.uid()::text
     OR (receipt ->> 'officeAgentRowCount')::integer <> 1
     OR (receipt ->> 'deltaTokens')::bigint <> 30
     OR (receipt ->> 'deltaCost')::numeric <> 0.25
     OR (receipt #>> '{profile,lifetime_tokens}')::bigint <> 180
     OR (receipt #>> '{profile,lifetime_cost}')::numeric <> 1.50 THEN
    RAISE EXCEPTION 'increment receipt mismatch: %', receipt;
  END IF;

  SELECT public.sync_agent_profile_usage_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Codex Agent', 'codex',
    120, 60, 25, 6, 1.50, 'openai/gpt-5.6-sol', 'session-a',
    '2026-08-21T12:01:00Z'
  ) INTO receipt;
  IF (receipt ->> 'deltaTokens')::bigint <> 0
     OR (receipt ->> 'deltaCost')::numeric <> 0
     OR receipt ->> 'observationDisposition' <> 'unchanged'
     OR (receipt #>> '{profile,lifetime_tokens}')::bigint <> 180 THEN
    RAISE EXCEPTION 'exact replay was not idempotent: %', receipt;
  END IF;

  -- A delayed lower meter is stale, not a reset. It must not add a whole old
  -- cumulative session after a newer tab already committed its observation.
  SELECT public.sync_agent_profile_usage_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Codex Agent', 'codex',
    10, 5, 2, 1, 0.10, 'openai/gpt-5.6-sol', 'session-a',
    '2026-08-21T12:00:30Z'
  ) INTO receipt;
  IF receipt ->> 'observationDisposition' <> 'stale'
     OR (receipt ->> 'deltaTokens')::bigint <> 0
     OR (receipt ->> 'deltaCost')::numeric <> 0
     OR (receipt #>> '{profile,lifetime_tokens}')::bigint <> 180
     OR (receipt #>> '{profile,session_count}')::integer <> 2
     OR (receipt ->> 'publicProjectionApplied')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'delayed lower observation was counted as a reset: %', receipt;
  END IF;

  SELECT public.sync_agent_profile_usage_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Codex Agent', 'codex',
    10, 5, 2, 1, 0.10, 'openai/gpt-5.6-sol', 'session-a',
    '2026-08-21T12:02:00Z'
  ) INTO receipt;
  IF (receipt ->> 'deltaTokens')::bigint <> 15
     OR (receipt ->> 'deltaCost')::numeric <> 0.10
     OR (receipt #>> '{profile,lifetime_tokens}')::bigint <> 195
     OR (receipt #>> '{profile,lifetime_cost}')::numeric <> 1.60
     OR (receipt #>> '{profile,session_count}')::integer <> 3 THEN
    RAISE EXCEPTION 'session reset was not accumulated exactly: %', receipt;
  END IF;

  SELECT * INTO public_row
  FROM public.circle_office_agents
  WHERE id = '10000000-0000-4000-8000-000000000001';
  IF public_row.token_usage_total <> 195
     OR public_row.estimated_cost_total <> 1.60
     OR public_row.message_count_total <> 7 THEN
    RAISE EXCEPTION 'published projection did not receive exact deltas: %', row_to_json(public_row);
  END IF;

  SELECT public.sync_agent_profile_usage_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Private Cursor', 'cursor',
    7, 3, 1, 1, 0.02, 'cursor/auto', 'private-session',
    '2026-08-21T12:03:00Z'
  ) INTO receipt;
  IF (receipt ->> 'officeAgentRowCount')::integer <> 0
     OR receipt ->> 'publicProjectionDisposition' <> 'not_found'
     OR (receipt #>> '{profile,lifetime_tokens}')::bigint <> 10
     OR (receipt #>> '{profile,lifetime_cost}')::numeric <> 0.02 THEN
    RAISE EXCEPTION 'unpublished agent did not persist privately: %', receipt;
  END IF;

  SELECT public.sync_agent_profile_usage_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Ambiguous Agent', 'codex',
    4, 1, 0, 1, 0.01, 'openai/gpt-5.6-sol', 'ambiguous-session',
    '2026-08-21T12:03:30Z'
  ) INTO receipt;
  IF (receipt ->> 'officeAgentRowCount')::integer <> 2
     OR receipt ->> 'publicProjectionDisposition' <> 'ambiguous'
     OR (receipt ->> 'publicProjectionApplied')::boolean IS NOT FALSE
     OR (receipt #>> '{profile,lifetime_tokens}')::bigint <> 5
     OR EXISTS (
       SELECT 1
       FROM public.circle_office_agents
       WHERE name = 'Ambiguous Agent' AND token_usage_total <> 0
     ) THEN
    RAISE EXCEPTION 'ambiguous public projection did not preserve private lifetime truth: %', receipt;
  END IF;

  SELECT public.sync_agent_profile_usage_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Identity Only', 'claude-code',
    20, 10, 3, 2, 0.30, 'anthropic/claude-haiku-4-5', 'session-b',
    '2026-08-21T12:01:00Z'
  ) INTO receipt;
  IF (receipt #>> '{profile,lifetime_tokens}')::bigint <> 50
     OR (receipt #>> '{profile,lifetime_cost}')::numeric <> 0.50
     OR (receipt #>> '{profile,baseline_observed}')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'identity-only first observation double-counted history: %', receipt;
  END IF;

  SELECT public.sync_agent_profile_usage_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Identity Only', 'claude-code',
    25, 15, 4, 3, 0.40, 'anthropic/claude-haiku-4-5', 'session-b',
    '2026-08-21T12:02:00Z'
  ) INTO receipt;
  IF (receipt ->> 'deltaTokens')::bigint <> 10
     OR (receipt #>> '{profile,lifetime_tokens}')::bigint <> 60
     OR (receipt #>> '{profile,lifetime_cost}')::numeric <> 0.60 THEN
    RAISE EXCEPTION 'identity-only second observation did not add the exact delta: %', receipt;
  END IF;

  BEGIN
    UPDATE public.office_agent_usage_profiles
    SET lifetime_tokens = 999
    WHERE owner_id = auth.uid();
    RAISE EXCEPTION 'authenticated direct lifetime mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM public.sync_agent_profile_usage_v1(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Not A Member', 'codex',
      1, 1, 0, 1, 0.01, NULL, 'forbidden-session',
      '2026-08-21T12:04:00Z'
    );
    RAISE EXCEPTION 'nonmember lifetime sync unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM public.office_agent_usage_profiles
    WHERE owner_id = auth.uid() AND session_key = 'forbidden-session'
  ) THEN
    RAISE EXCEPTION 'nonmember failure left a durable row';
  END IF;
END;
$behavior$;

RESET ROLE;
RESET request.jwt.claim.sub;
SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

DO $owner_isolation$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count
  FROM public.office_agent_usage_profiles;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'owner-private lifetime rows leaked across users: %', visible_count;
  END IF;
END;
$owner_isolation$;
SQL

echo 'office agent lifetime usage SQL behavior smoke passed'
