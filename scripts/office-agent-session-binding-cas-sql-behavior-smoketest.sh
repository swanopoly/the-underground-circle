#!/bin/sh
# Disposable PostgreSQL behavior proof for exact Office/OpenSwan binding CAS.
set -eu

for required_command in psql createdb dropdb; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "Office binding CAS SQL smoke requires $required_command" >&2
    exit 1
  }
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
base_migration="$repo_root/supabase/migrations/20260807170000_office_agent_session_bindings.sql"
cas_migration="$repo_root/supabase/migrations/20260818120000_office_agent_session_binding_cas.sql"
smoke_db="uc_office_binding_cas_sql_smoke_$$"
case "$smoke_db" in
  uc_office_binding_cas_sql_smoke_[0-9]*) ;;
  *) echo "refusing unsafe disposable database name: $smoke_db" >&2; exit 1 ;;
esac

smoke_root=$(mktemp -d /tmp/uc-office-binding-cas-sql-smoke.XXXXXX)
case "$smoke_root" in
  /tmp/uc-office-binding-cas-sql-smoke.*) ;;
  *) echo "refusing unsafe disposable path: $smoke_root" >&2; exit 1 ;;
esac

started_temp_cluster=0
smoke_pg_user="${OFFICE_BINDING_CAS_SQL_SMOKE_PGUSER:-${PGUSER:-$(id -un)}}"
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
      echo "Office binding CAS SQL smoke needs a local server or $required_command" >&2
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
    /tmp/uc-office-binding-cas-sql-smoke.*) rm -rf "$smoke_root" ;;
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

CREATE TABLE public.circles(id uuid PRIMARY KEY);
CREATE TABLE public.circle_office_agents(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  is_published boolean NOT NULL DEFAULT true
);
CREATE TABLE public.agents_bots(
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION public.invoke_agent(uuid, uuid, text, uuid)
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
  canonical_agent_name text
)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid,
    NULL::text, NULL::uuid, NULL::uuid[], NULL::text, NULL::text,
    NULL::uuid, NULL::text, NULL::text
  WHERE false
$$;

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.circles(id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.circle_office_agents(id,circle_id,owner_id,provider,is_published) VALUES
  ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','openswan',true),
  ('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','openswan',true),
  ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','openswan',true),
  ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','openswan',false),
  ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','openswan',true);
INSERT INTO public.agents_bots(id,owner_id,metadata) VALUES
  ('30000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','{"provider":"openswan"}'),
  ('30000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','{"provider":"openswan"}'),
  ('40000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','{"provider":"openswan"}'),
  ('30000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','{"provider":"claude-code"}');
SQL

psql_smoke -f "$base_migration" >/dev/null
psql_smoke -f "$cas_migration" >/dev/null
# SQL Editor/consolidated replay must remain idempotent.
psql_smoke -f "$cas_migration" >/dev/null

psql_smoke >/dev/null <<'SQL'
DO $catalog$
DECLARE function_config text[];
BEGIN
  SELECT procedure_row.proconfig INTO function_config
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid =
    'public.compare_and_set_office_agent_session_binding_v1(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)'::regprocedure
    AND procedure_row.prosecdef;
  IF function_config IS NULL OR NOT ('search_path=""' = ANY(function_config)) THEN
    RAISE EXCEPTION 'CAS RPC is not SECURITY DEFINER with an empty search path: %', function_config;
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.compare_and_set_office_agent_session_binding_v1(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.compare_and_set_office_agent_session_binding_v1(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.compare_and_set_office_agent_session_binding_v1(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'CAS RPC grants are not authenticated-only';
  END IF;
  IF has_function_privilege('authenticated','public.set_office_agent_session_binding(uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.clear_office_agent_session_binding(uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.set_office_agent_session_binding(uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('service_role','public.clear_office_agent_session_binding(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'legacy unconditional mutation RPC retains execute authority';
  END IF;
END;
$catalog$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

DO $behavior$
DECLARE
  receipt record;
  binding_id uuid;
  version_a timestamptz;
  version_b timestamptz;
  version_a2 timestamptz;
BEGIN
  SELECT * INTO receipt
  FROM public.compare_and_set_office_agent_session_binding_v1(
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    NULL, NULL, NULL, NULL,
    '30000000-0000-4000-8000-000000000001', 'route:A'
  );
  IF receipt.mutation_disposition <> 'applied'
     OR receipt.mutation_operation <> 'bind'
     OR receipt.observed_binding_id IS NOT NULL
     OR receipt.result_binding_id IS NULL THEN
    RAISE EXCEPTION 'expected-null first bind receipt mismatch: %', row_to_json(receipt);
  END IF;
  binding_id := receipt.result_binding_id;
  version_a := receipt.result_updated_at;

  SELECT * INTO receipt
  FROM public.compare_and_set_office_agent_session_binding_v1(
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    NULL, NULL, NULL, NULL,
    '30000000-0000-4000-8000-000000000002', 'route:stale-first'
  );
  IF receipt.mutation_disposition <> 'conflict'
     OR receipt.observed_binding_id <> binding_id
     OR receipt.result_binding_id <> binding_id
     OR receipt.result_session_key <> 'route:A' THEN
    RAISE EXCEPTION 'stale expected-null bind did not conflict exactly: %', row_to_json(receipt);
  END IF;

  SELECT * INTO receipt
  FROM public.compare_and_set_office_agent_session_binding_v1(
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    binding_id, '30000000-0000-4000-8000-000000000001', 'route:A', version_a,
    '30000000-0000-4000-8000-000000000002', 'route:B'
  );
  IF receipt.mutation_disposition <> 'applied'
     OR receipt.result_binding_id <> binding_id
     OR receipt.result_session_key <> 'route:B'
     OR receipt.result_updated_at <= version_a THEN
    RAISE EXCEPTION 'exact move A to B failed or did not advance version: %', row_to_json(receipt);
  END IF;
  version_b := receipt.result_updated_at;

  SELECT * INTO receipt
  FROM public.compare_and_set_office_agent_session_binding_v1(
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    binding_id, '30000000-0000-4000-8000-000000000002', 'route:B', version_b,
    '30000000-0000-4000-8000-000000000001', 'route:A'
  );
  IF receipt.mutation_disposition <> 'applied'
     OR receipt.result_binding_id <> binding_id
     OR receipt.result_session_key <> 'route:A'
     OR receipt.result_updated_at <= version_b THEN
    RAISE EXCEPTION 'exact move B to A failed or did not advance version: %', row_to_json(receipt);
  END IF;
  version_a2 := receipt.result_updated_at;

  -- Identity is A again, but the stale original A version must not authorize
  -- clear after the intervening A→B→A route ABA.
  SELECT * INTO receipt
  FROM public.compare_and_set_office_agent_session_binding_v1(
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    binding_id, '30000000-0000-4000-8000-000000000001', 'route:A', version_a,
    NULL, NULL
  );
  IF receipt.mutation_disposition <> 'conflict'
     OR receipt.observed_updated_at <> version_a2
     OR receipt.result_updated_at <> version_a2
     OR receipt.result_session_key <> 'route:A' THEN
    RAISE EXCEPTION 'stale A-B-A version did not conflict: %', row_to_json(receipt);
  END IF;

  SELECT * INTO receipt
  FROM public.compare_and_set_office_agent_session_binding_v1(
    '10000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    NULL, NULL, NULL, NULL,
    '30000000-0000-4000-8000-000000000002', 'route:occupied'
  );
  IF receipt.mutation_disposition <> 'applied' THEN
    RAISE EXCEPTION 'target fixture bind failed: %', row_to_json(receipt);
  END IF;

  SELECT * INTO receipt
  FROM public.compare_and_set_office_agent_session_binding_v1(
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    binding_id, '30000000-0000-4000-8000-000000000001', 'route:A', version_a2,
    '30000000-0000-4000-8000-000000000002', 'route:occupied'
  );
  IF receipt.mutation_disposition <> 'target_conflict'
     OR receipt.result_binding_id <> binding_id
     OR receipt.result_session_key <> 'route:A'
     OR receipt.result_updated_at <> version_a2 THEN
    RAISE EXCEPTION 'occupied target did not preserve the current route: %', row_to_json(receipt);
  END IF;

  SELECT * INTO receipt
  FROM public.compare_and_set_office_agent_session_binding_v1(
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    binding_id, '30000000-0000-4000-8000-000000000001', 'route:A', version_a2,
    NULL, NULL
  );
  IF receipt.mutation_disposition <> 'applied'
     OR receipt.mutation_operation <> 'clear'
     OR receipt.result_binding_id IS NOT NULL THEN
    RAISE EXCEPTION 'exact clear did not prove a missing postcondition: %', row_to_json(receipt);
  END IF;

  SELECT * INTO receipt
  FROM public.compare_and_set_office_agent_session_binding_v1(
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    binding_id, '30000000-0000-4000-8000-000000000001', 'route:A', version_a2,
    NULL, NULL
  );
  IF receipt.mutation_disposition <> 'conflict'
     OR receipt.observed_binding_id IS NOT NULL
     OR receipt.result_binding_id IS NOT NULL THEN
    RAISE EXCEPTION 'stale clear did not conflict with missing current row: %', row_to_json(receipt);
  END IF;

  BEGIN
    PERFORM * FROM public.compare_and_set_office_agent_session_binding_v1(
      '10000000-0000-4000-8000-000000000001',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      NULL, NULL, NULL, NULL,
      '30000000-0000-4000-8000-000000000001', 'wrong:circle'
    );
    RAISE EXCEPTION 'cross-circle mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.compare_and_set_office_agent_session_binding_v1(
      '20000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      NULL, NULL, NULL, NULL,
      '30000000-0000-4000-8000-000000000001', 'foreign:agent'
    );
    RAISE EXCEPTION 'foreign-owner Office agent mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.compare_and_set_office_agent_session_binding_v1(
      '10000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      binding_id, NULL, 'partial:expected', version_a2,
      NULL, NULL
    );
    RAISE EXCEPTION 'partial expected identity unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.compare_and_set_office_agent_session_binding_v1(
      '10000000-0000-4000-8000-000000000004',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      NULL, NULL, NULL, NULL,
      '30000000-0000-4000-8000-000000000001', 'unpublished'
    );
    RAISE EXCEPTION 'unpublished bind unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.compare_and_set_office_agent_session_binding_v1(
      '10000000-0000-4000-8000-000000000003',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      NULL, NULL, NULL, NULL,
      '40000000-0000-4000-8000-000000000001', 'foreign:bot'
    );
    RAISE EXCEPTION 'foreign-owner bot bind unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$behavior$;

RESET ROLE;
SQL

race_one="$smoke_root/race-one.txt"
race_two="$smoke_root/race-two.txt"
(
  psql_smoke -Atq >"$race_one" <<'SQL'
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SELECT mutation_disposition
FROM public.compare_and_set_office_agent_session_binding_v1(
  '10000000-0000-4000-8000-000000000003',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  NULL, NULL, NULL, NULL,
  '30000000-0000-4000-8000-000000000001', 'race:one'
);
SQL
) &
race_one_pid=$!
(
  psql_smoke -Atq >"$race_two" <<'SQL'
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SELECT mutation_disposition
FROM public.compare_and_set_office_agent_session_binding_v1(
  '10000000-0000-4000-8000-000000000003',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  NULL, NULL, NULL, NULL,
  '30000000-0000-4000-8000-000000000002', 'race:two'
);
SQL
) &
race_two_pid=$!
wait "$race_one_pid"
wait "$race_two_pid"

race_results=$(sort "$race_one" "$race_two" | tr '\n' ' ')
if [ "$race_results" != "applied conflict " ]; then
  echo "expected one applied and one conflict first-bind receipt, got: $race_results" >&2
  exit 1
fi

binding_count=$(psql_smoke -Atq -c \
  "SELECT count(*) FROM public.office_agent_session_bindings WHERE office_agent_id = '10000000-0000-4000-8000-000000000003'")
if [ "$binding_count" != "1" ]; then
  echo "expected one durable binding after contention, got: $binding_count" >&2
  exit 1
fi

echo "office-agent-session-binding CAS SQL behavior smoke passed"
