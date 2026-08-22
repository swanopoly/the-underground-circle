#!/bin/sh
# Disposable PostgreSQL behavior proof for atomic published-agent Spirit projection.
set -eu

for required_command in psql createdb dropdb; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "agent Spirit assignment RPC SQL smoke requires $required_command" >&2
    exit 1
  }
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
migration="$repo_root/supabase/migrations/20260817140000_agent_spirit_assignment_rpc.sql"
smoke_db="uc_agent_spirit_assignment_sql_smoke_$$"
case "$smoke_db" in
  uc_agent_spirit_assignment_sql_smoke_[0-9]*) ;;
  *) echo "refusing unsafe disposable database name: $smoke_db" >&2; exit 1 ;;
esac

smoke_root=$(mktemp -d /tmp/uc-agent-spirit-assignment-sql-smoke.XXXXXX)
case "$smoke_root" in
  /tmp/uc-agent-spirit-assignment-sql-smoke.*) ;;
  *) echo "refusing unsafe disposable path: $smoke_root" >&2; exit 1 ;;
esac

started_temp_cluster=0
smoke_pg_user="${AGENT_SPIRIT_SQL_SMOKE_PGUSER:-${PGUSER:-$(id -un)}}"
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
      echo "agent Spirit assignment RPC SQL smoke needs a local server or $required_command" >&2
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
    /tmp/uc-agent-spirit-assignment-sql-smoke.*) rm -rf "$smoke_root" ;;
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
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.custom_agent_profiles(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  emoji text,
  UNIQUE(user_id, name)
);
CREATE TABLE public.agent_identities(
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
  UNIQUE(user_id, session_key)
);

CREATE FUNCTION public.touch_smoke_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER office_updated_at BEFORE UPDATE ON public.circle_office_agents
  FOR EACH ROW EXECUTE FUNCTION public.touch_smoke_updated_at();
CREATE TRIGGER identity_updated_at BEFORE UPDATE ON public.agent_identities
  FOR EACH ROW EXECUTE FUNCTION public.touch_smoke_updated_at();

ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_office_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_self ON public.circle_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY office_member_read ON public.circle_office_agents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.circle_members m WHERE m.circle_id = circle_id AND m.user_id = auth.uid()));
CREATE POLICY office_owner_write ON public.circle_office_agents FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY profile_owner ON public.custom_agent_profiles FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY identity_owner ON public.agent_identities FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT SELECT ON public.circle_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.circle_office_agents, public.custom_agent_profiles, public.agent_identities TO authenticated;

INSERT INTO auth.users(id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333');
INSERT INTO public.circles(id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.circle_members(circle_id,user_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222');
INSERT INTO public.circle_office_agents(id,circle_id,owner_id,name,is_published) VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','zero',true),
 ('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','existing',true),
 ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','custom',true),
 ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','rollback',true),
 ('10000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','race',true),
 ('10000000-0000-4000-8000-000000000007','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','assign-delete-race',true),
 ('10000000-0000-4000-8000-000000000008','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','delete-assign-race',true),
 ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','foreign',true),
 ('30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','nonmember',true),
 ('10000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','unpublished',false);
INSERT INTO public.custom_agent_profiles(id,user_id,name,emoji) VALUES
 ('c0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Owner compass','🧭'),
 ('c0000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','Foreign mask','🎭'),
 ('c0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','Delete me','🗑️'),
 ('c0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','Assign wins','A'),
 ('c0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','Delete wins','D'),
 ('c0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','Private delete race','P');
INSERT INTO public.agent_identities(user_id,session_key,custom_name,total_messages,spirit_id,spirit_emoji,is_customized) VALUES
 ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000002','keep-me',7,'old','🕰️',true),
 ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000004','rollback-keep',9,'old-safe','🛟',true);
SQL

psql_smoke -f "$migration" >/dev/null
# Consolidated SQL replay must remain safe.
psql_smoke -f "$migration" >/dev/null

psql_smoke >/dev/null <<'SQL'
DO $catalog$
DECLARE function_config text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.circle_office_agents'::regclass
      AND attname = 'spirit' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.circle_office_agents'::regclass
      AND attname = 'spirit_emoji' AND NOT attisdropped
  ) THEN RAISE EXCEPTION 'Spirit projection columns are missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.circle_members'::regclass),
      ('public.circle_office_agents'::regclass),
      ('public.custom_agent_profiles'::regclass),
      ('public.agent_identities'::regclass)
    ) AS expected(table_oid)
    JOIN pg_catalog.pg_class c ON c.oid = expected.table_oid
    WHERE NOT c.relrowsecurity
  ) THEN RAISE EXCEPTION 'required RLS was disabled'; END IF;
  SELECT p.proconfig INTO function_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)'::regprocedure
    AND p.prosecdef;
  IF function_config IS NULL OR NOT ('search_path=""' = ANY(function_config)) THEN
    RAISE EXCEPTION 'Spirit RPC is not SECURITY DEFINER with an empty search_path: %', function_config;
  END IF;
  IF NOT has_function_privilege('authenticated','public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Spirit RPC grants are not authenticated-only';
  END IF;
  IF NOT has_function_privilege('authenticated','public.delete_unreferenced_custom_agent_profile_v1(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.delete_unreferenced_custom_agent_profile_v1(uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.delete_unreferenced_custom_agent_profile_v1(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'profile delete RPC grants are not authenticated-only';
  END IF;
  IF has_table_privilege('anon','public.circle_office_agents','UPDATE')
     OR has_table_privilege('service_role','public.agent_identities','UPDATE')
     OR has_table_privilege('authenticated','public.custom_agent_profiles','DELETE') THEN
    RAISE EXCEPTION 'migration widened direct table privileges';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.circle_office_agents'::regclass
      AND trigger_row.tgname = 'circle_office_agent_spirit_columns_guard'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.agent_identities'::regclass
      AND trigger_row.tgname = 'published_agent_identity_spirit_columns_guard'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'published Spirit direct-write guards are missing';
  END IF;
  IF has_function_privilege('authenticated','public.guard_circle_office_agent_spirit_columns_v1()','EXECUTE')
     OR has_function_privilege('authenticated','public.guard_published_agent_identity_spirit_columns_v1()','EXECUTE') THEN
    RAISE EXCEPTION 'published Spirit guard helpers are directly executable';
  END IF;
END;
$catalog$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);

DO $zero_identity$
DECLARE receipt jsonb;
BEGIN
  receipt := public.set_published_agent_spirit_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','builder','🔧',NULL
  );
  IF receipt ->> 'userId' <> '11111111-1111-4111-8111-111111111111'
     OR receipt ->> 'circleId' <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     OR receipt ->> 'officeAgentId' <> '10000000-0000-4000-8000-000000000001'
     OR receipt ->> 'sessionKey' <> '10000000-0000-4000-8000-000000000001'
     OR receipt ->> 'spiritId' <> 'builder'
     OR receipt ->> 'officeRowCount' <> '1'
     OR receipt ->> 'identityRowCount' <> '1'
     OR receipt #>> '{officeAgent,spirit}' <> 'builder'
     OR receipt #>> '{identity,spirit_id}' <> 'builder'
     OR receipt #>> '{identity,is_customized}' <> 'true' THEN
    RAISE EXCEPTION 'zero identity receipt is not exact: %', receipt;
  END IF;
END;
$zero_identity$;

DO $existing_identity$
DECLARE receipt jsonb; preserved_name text; preserved_messages integer;
BEGIN
  receipt := public.set_published_agent_spirit_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000002','analyst','📊',NULL
  );
  SELECT custom_name,total_messages INTO preserved_name,preserved_messages
  FROM public.agent_identities
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='10000000-0000-4000-8000-000000000002';
  IF receipt #>> '{officeAgent,spirit}' <> 'analyst'
     OR receipt #>> '{identity,spirit_id}' <> 'analyst'
     OR preserved_name <> 'keep-me' OR preserved_messages <> 7 THEN
    RAISE EXCEPTION 'existing identity update replaced unrelated fields: %, %, %', receipt,preserved_name,preserved_messages;
  END IF;
END;
$existing_identity$;

DO $custom_profile$
DECLARE receipt jsonb;
BEGIN
  receipt := public.set_published_agent_spirit_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003',
    'custom::c0000000-0000-4000-8000-000000000001','caller-value','c0000000-0000-4000-8000-000000000001'
  );
  IF receipt ->> 'customProfileId' <> 'c0000000-0000-4000-8000-000000000001'
     OR receipt ->> 'customProfileName' <> 'Owner compass'
     OR receipt ->> 'spiritEmoji' <> '🧭'
     OR receipt #>> '{officeAgent,spirit_emoji}' <> '🧭'
     OR receipt #>> '{identity,custom_profile_name}' <> 'Owner compass' THEN
    RAISE EXCEPTION 'custom profile was not server-derived: %', receipt;
  END IF;
END;
$custom_profile$;

DO $clear_assignment$
DECLARE receipt jsonb;
BEGIN
  receipt := public.set_published_agent_spirit_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003',NULL,NULL,NULL
  );
  IF receipt -> 'spiritId' <> 'null'::jsonb
     OR receipt #> '{officeAgent,spirit}' <> 'null'::jsonb
     OR receipt #> '{identity,spirit_id}' <> 'null'::jsonb
     OR receipt #> '{identity,custom_profile_id}' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'clear receipt is not exact: %', receipt;
  END IF;
END;
$clear_assignment$;

DO $direct_projection_guards$
DECLARE public_before text; public_emoji_before text; private_before text; private_emoji_before text;
BEGIN
  SELECT spirit,spirit_emoji INTO public_before,public_emoji_before
  FROM public.circle_office_agents
  WHERE id='10000000-0000-4000-8000-000000000001';
  SELECT spirit_id,spirit_emoji INTO private_before,private_emoji_before
  FROM public.agent_identities
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='10000000-0000-4000-8000-000000000001';

  BEGIN
    INSERT INTO public.circle_office_agents(id,circle_id,owner_id,name,is_published,spirit,spirit_emoji)
    VALUES (
      '10000000-0000-4000-8000-000000000009',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'forged-public-insert',
      true,
      'forged',
      'x'
    );
    RAISE EXCEPTION 'direct public Spirit projection insert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO public.agent_identities(user_id,session_key,spirit_id,spirit_emoji)
  VALUES (
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000011',
    'private-preseed',
    'p'
  );
  BEGIN
    INSERT INTO public.circle_office_agents(id,circle_id,owner_id,name,is_published)
    VALUES (
      '10000000-0000-4000-8000-000000000011',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'preseed-bypass',
      true
    );
    RAISE EXCEPTION 'private-Spirit preseed followed by public insert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO public.circle_office_agents(id,circle_id,owner_id,name,is_published)
  VALUES (
    '10000000-0000-4000-8000-000000000010',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'ordinary-null-publish',
    true
  );
  INSERT INTO public.agent_identities(user_id,session_key,spirit_id,spirit_emoji)
  VALUES (
    '11111111-1111-4111-8111-111111111111',
    'private-key-transition',
    'qa-engineer',
    'q'
  );
  BEGIN
    UPDATE public.agent_identities
    SET session_key='10000000-0000-4000-8000-000000000005'
    WHERE user_id='11111111-1111-4111-8111-111111111111'
      AND session_key='private-key-transition';
    RAISE EXCEPTION 'private identity key was retargeted into a published projection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO public.agent_identities(user_id,session_key,spirit_id,spirit_emoji)
  VALUES (
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000012',
    'sr-engineer',
    's'
  );
  BEGIN
    UPDATE public.circle_office_agents
    SET id='10000000-0000-4000-8000-000000000012'
    WHERE id='10000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'published Office key was retargeted onto a private identity';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.circle_office_agents
  SET spirit='unpublished-draft', spirit_emoji='d'
  WHERE id='10000000-0000-4000-8000-000000000006';
  BEGIN
    UPDATE public.circle_office_agents
    SET is_published=true
    WHERE id='10000000-0000-4000-8000-000000000006';
    RAISE EXCEPTION 'direct publication of a prefilled Spirit projection was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.circle_office_agents
    SET spirit='forged-public', spirit_emoji='x'
    WHERE id='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'direct public Spirit projection update was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.agent_identities
    SET spirit_id='forged-private', spirit_emoji='y'
    WHERE user_id='11111111-1111-4111-8111-111111111111'
      AND session_key='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'direct published identity Spirit update was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.agent_identities(user_id,session_key,spirit_id,spirit_emoji)
    VALUES (
      '11111111-1111-4111-8111-111111111111',
      '10000000-0000-4000-8000-000000000005',
      'forged-insert',
      'z'
    );
    RAISE EXCEPTION 'direct published identity Spirit insert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.agent_identities
    WHERE user_id='11111111-1111-4111-8111-111111111111'
      AND session_key='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'direct published identity projection delete was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  IF (SELECT spirit FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000001') IS DISTINCT FROM public_before
     OR (SELECT spirit_emoji FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000001') IS DISTINCT FROM public_emoji_before
     OR (SELECT spirit_id FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000001') IS DISTINCT FROM private_before
     OR (SELECT spirit_emoji FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000001') IS DISTINCT FROM private_emoji_before
     OR EXISTS (SELECT 1 FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000005')
     OR EXISTS (SELECT 1 FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000009')
     OR EXISTS (SELECT 1 FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000011')
     OR EXISTS (SELECT 1 FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000012')
     OR NOT EXISTS (SELECT 1 FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000010' AND spirit IS NULL AND spirit_emoji IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='private-key-transition' AND spirit_id='qa-engineer')
     OR NOT EXISTS (SELECT 1 FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000012' AND spirit_id='sr-engineer')
     OR NOT EXISTS (SELECT 1 FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000006' AND is_published IS FALSE AND spirit='unpublished-draft' AND spirit_emoji='d') THEN
    RAISE EXCEPTION 'rejected direct Spirit projection write changed durable truth';
  END IF;

  UPDATE public.circle_office_agents
  SET name='zero-renamed'
  WHERE id='10000000-0000-4000-8000-000000000001';
  UPDATE public.agent_identities
  SET custom_name='published-name-only'
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='10000000-0000-4000-8000-000000000001';
  INSERT INTO public.agent_identities(user_id,session_key,spirit_id,spirit_emoji)
  VALUES ('11111111-1111-4111-8111-111111111111','live-session','private-one','1');
  UPDATE public.agent_identities
  SET spirit_id='private-two', spirit_emoji='2'
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='live-session';
  INSERT INTO public.agent_identities(user_id,session_key,spirit_id,spirit_emoji)
  VALUES ('11111111-1111-4111-8111-111111111111','private-delete-allowed','private-delete','d');
  DELETE FROM public.agent_identities
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='private-delete-allowed';

  INSERT INTO public.agent_identities(
    user_id,session_key,spirit_id,spirit_emoji,custom_profile_id,custom_profile_name
  ) VALUES (
    '11111111-1111-4111-8111-111111111111',
    'private-custom-session',
    'custom::c0000000-0000-4000-8000-000000000001',
    '🧭',
    'c0000000-0000-4000-8000-000000000001',
    'Owner compass'
  );
  BEGIN
    INSERT INTO public.agent_identities(
      user_id,session_key,spirit_id,spirit_emoji,custom_profile_id,custom_profile_name
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      'private-custom-mismatch',
      'custom::c0000000-0000-4000-8000-000000000001',
      'wrong',
      'c0000000-0000-4000-8000-000000000001',
      'Wrong name'
    );
    RAISE EXCEPTION 'incoherent private custom Spirit assignment was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.agent_identities(
      user_id,session_key,spirit_id,spirit_emoji,custom_profile_id,custom_profile_name
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      'private-custom-foreign',
      'custom::c0000000-0000-4000-8000-000000000002',
      '🎭',
      'c0000000-0000-4000-8000-000000000002',
      'Foreign mask'
    );
    RAISE EXCEPTION 'foreign-owner private custom Spirit assignment was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.agent_identities(
      user_id,session_key,spirit_id,spirit_emoji,custom_profile_id,custom_profile_name
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      'private-custom-missing-id',
      'custom::c0000000-0000-4000-8000-000000000001',
      '🧭',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'private custom Spirit without a profile id was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE public.agent_identities
  SET spirit_id='private-built-in',
      spirit_emoji='b',
      custom_profile_id=NULL,
      custom_profile_name=NULL
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='private-custom-session';
  IF (SELECT name FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000001') <> 'zero-renamed'
     OR (SELECT custom_name FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000001') <> 'published-name-only'
     OR (SELECT spirit_id FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='live-session') <> 'private-two'
     OR (SELECT spirit_id FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='private-custom-session') <> 'private-built-in'
     OR EXISTS (SELECT 1 FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='private-delete-allowed')
     OR EXISTS (SELECT 1 FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key IN ('private-custom-mismatch','private-custom-foreign','private-custom-missing-id')) THEN
    RAISE EXCEPTION 'nonsensitive or private live-session writes were blocked';
  END IF;
END;
$direct_projection_guards$;

DO $referenced_profile_delete$
BEGIN
  PERFORM public.set_published_agent_spirit_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003',
    'custom::c0000000-0000-4000-8000-000000000001','ignored','c0000000-0000-4000-8000-000000000001'
  );
  BEGIN
    PERFORM public.delete_unreferenced_custom_agent_profile_v1('c0000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'referenced profile was deleted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.custom_agent_profiles WHERE id='c0000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'referenced profile rejection removed the row';
  END IF;
END;
$referenced_profile_delete$;

DO $unreferenced_profile_delete$
DECLARE receipt jsonb;
BEGIN
  receipt := public.delete_unreferenced_custom_agent_profile_v1('c0000000-0000-4000-8000-000000000003');
  IF receipt ->> 'schemaVersion' <> '1'
     OR receipt ->> 'userId' <> '11111111-1111-4111-8111-111111111111'
     OR receipt ->> 'profileId' <> 'c0000000-0000-4000-8000-000000000003'
     OR receipt ->> 'deletedRowCount' <> '1'
     OR receipt #>> '{profile,id}' <> 'c0000000-0000-4000-8000-000000000003'
     OR receipt #>> '{profile,user_id}' <> '11111111-1111-4111-8111-111111111111'
     OR EXISTS (SELECT 1 FROM public.custom_agent_profiles WHERE id='c0000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'unreferenced delete receipt is not exact: %', receipt;
  END IF;
END;
$unreferenced_profile_delete$;

DO $non_owner$
DECLARE before_value text;
BEGIN
  SELECT spirit INTO before_value FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.set_published_agent_spirit_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','forged','x',NULL
    );
    RAISE EXCEPTION 'foreign owner row was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT spirit FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000001') IS DISTINCT FROM before_value THEN
    RAISE EXCEPTION 'failed non-owner call changed prior truth';
  END IF;
END;
$non_owner$;

DO $foreign_profile_delete$
BEGIN
  BEGIN
    PERFORM public.delete_unreferenced_custom_agent_profile_v1('c0000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'foreign profile delete was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$foreign_profile_delete$;

DO $foreign_profile$
DECLARE public_before text; private_before text;
BEGIN
  SELECT spirit INTO public_before FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000003';
  SELECT spirit_id INTO private_before FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000003';
  BEGIN
    PERFORM public.set_published_agent_spirit_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003',
      'custom::c0000000-0000-4000-8000-000000000002','x','c0000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'foreign custom profile was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT spirit FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000003') IS DISTINCT FROM public_before
     OR (SELECT spirit_id FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000003') IS DISTINCT FROM private_before THEN
    RAISE EXCEPTION 'foreign profile rejection changed assignment truth';
  END IF;
END;
$foreign_profile$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
DO $non_member$
BEGIN
  BEGIN
    PERFORM public.set_published_agent_spirit_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','30000000-0000-4000-8000-000000000001','forged','x',NULL
    );
    RAISE EXCEPTION 'non-member owner was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$non_member$;
RESET ROLE;

SET ROLE anon;
DO $anon_denied$
BEGIN
  BEGIN
    PERFORM public.set_published_agent_spirit_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','anon','x',NULL
    );
    RAISE EXCEPTION 'anon execution was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$anon_denied$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $bounded_inputs$
BEGIN
  BEGIN
    PERFORM public.set_published_agent_spirit_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',' padded ','x',NULL);
    RAISE EXCEPTION 'padded Spirit was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.set_published_agent_spirit_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',repeat('s',201),'x',NULL);
    RAISE EXCEPTION 'oversized Spirit was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.set_published_agent_spirit_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',E'bad\nspirit','x',NULL);
    RAISE EXCEPTION 'control-bearing Spirit was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.set_published_agent_spirit_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',NULL,'x',NULL);
    RAISE EXCEPTION 'malformed clear was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.set_published_agent_spirit_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000006','spirit','x',NULL);
    RAISE EXCEPTION 'unpublished agent was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$bounded_inputs$;
RESET ROLE;

CREATE FUNCTION public.reject_spirit_identity_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_key='10000000-0000-4000-8000-000000000004' AND NEW.spirit_id='will-fail' THEN
    RAISE EXCEPTION 'forced_identity_failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reject_spirit_identity_write BEFORE INSERT OR UPDATE ON public.agent_identities
  FOR EACH ROW EXECUTE FUNCTION public.reject_spirit_identity_write();

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $rollback_after_public_write$
BEGIN
  BEGIN
    PERFORM public.set_published_agent_spirit_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000004','will-fail','💥',NULL
    );
    RAISE EXCEPTION 'forced identity failure was not raised';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forced_identity_failure' THEN RAISE; END IF;
  END;
END;
$rollback_after_public_write$;
RESET ROLE;

DO $rollback_truth$
BEGIN
  IF (SELECT spirit FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000004') IS NOT NULL
     OR (SELECT spirit_id FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000004') <> 'old-safe'
     OR (SELECT custom_name FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000004') <> 'rollback-keep' THEN
    RAISE EXCEPTION 'post-public-write failure did not roll back both projections';
  END IF;
END;
$rollback_truth$;
DROP TRIGGER reject_spirit_identity_write ON public.agent_identities;
DROP FUNCTION public.reject_spirit_identity_write();

CREATE FUNCTION public.try_insert_private_spirit_for_smoke(p_agent_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agent_identities(user_id,session_key,spirit_id,spirit_emoji)
  VALUES (
    '11111111-1111-4111-8111-111111111111',
    p_agent_id::text,
    'racing-private',
    'r'
  );
  RETURN 'inserted';
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 'blocked';
END $$;
CREATE FUNCTION public.try_insert_public_agent_for_smoke(p_agent_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.circle_office_agents(id,circle_id,owner_id,name,is_published)
  VALUES (
    p_agent_id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'racing-public',
    true
  );
  RETURN 'inserted';
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 'blocked';
END $$;
SQL

# Both direct insert orders share the same owner/UUID transaction lock. The
# second writer must see the committed opposite projection and fail closed.
public_wins="$smoke_root/public-wins"
private_loses="$smoke_root/private-loses"
(
  psql_smoke -Atq >"$public_wins" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
INSERT INTO public.circle_office_agents(id,circle_id,owner_id,name,is_published)
VALUES (
  '10000000-0000-4000-8000-000000000013',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'public-race-winner',
  true
);
SELECT 'public-inserted';
SELECT pg_sleep(1);
COMMIT;
SQL
) &
public_wins_pid=$!
psql_smoke -c 'SELECT pg_sleep(0.25)' >/dev/null
(
  psql_smoke -Atq >"$private_loses" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.try_insert_private_spirit_for_smoke('10000000-0000-4000-8000-000000000013');
COMMIT;
SQL
) &
private_loses_pid=$!
wait "$public_wins_pid"
wait "$private_loses_pid"
grep -q '^public-inserted$' "$public_wins" || { echo 'public-first direct projection race did not insert its null projection' >&2; exit 1; }
grep -q '^blocked$' "$private_loses" || { echo 'private Spirit insert bypassed a racing public projection' >&2; exit 1; }

private_wins="$smoke_root/private-wins"
public_loses="$smoke_root/public-loses"
(
  psql_smoke -Atq >"$private_wins" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
INSERT INTO public.agent_identities(user_id,session_key,spirit_id,spirit_emoji)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-000000000014',
  'private-race-winner',
  'r'
);
SELECT 'private-inserted';
SELECT pg_sleep(1);
COMMIT;
SQL
) &
private_wins_pid=$!
psql_smoke -c 'SELECT pg_sleep(0.25)' >/dev/null
(
  psql_smoke -Atq >"$public_loses" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.try_insert_public_agent_for_smoke('10000000-0000-4000-8000-000000000014');
COMMIT;
SQL
) &
public_loses_pid=$!
wait "$private_wins_pid"
wait "$public_loses_pid"
grep -q '^private-inserted$' "$private_wins" || { echo 'private-first direct projection race did not insert its private projection' >&2; exit 1; }
grep -q '^blocked$' "$public_loses" || { echo 'public insert bypassed a racing private Spirit projection' >&2; exit 1; }

psql_smoke >/dev/null <<'SQL'
DO $direct_insert_race_truth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000013')
     OR EXISTS (SELECT 1 FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000013')
     OR NOT EXISTS (SELECT 1 FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000014')
     OR EXISTS (SELECT 1 FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000014') THEN
    RAISE EXCEPTION 'direct insert races committed a split published Spirit projection';
  END IF;
END;
$direct_insert_race_truth$;
SQL

race_a="$smoke_root/race-a"
race_b="$smoke_root/race-b"
(
  psql_smoke -Atq >"$race_a" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.set_published_agent_spirit_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000005','race-a','A',NULL
) ->> 'spiritId';
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
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.set_published_agent_spirit_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000005','race-b','B',NULL
) ->> 'spiritId';
COMMIT;
SQL
) &
race_pid_b=$!
wait "$race_pid_a"
wait "$race_pid_b"
grep -q '^race-a$' "$race_a" || { echo 'first concurrent Spirit receipt was not exact' >&2; exit 1; }
grep -q '^race-b$' "$race_b" || { echo 'second concurrent Spirit receipt was not exact' >&2; exit 1; }

psql_smoke >/dev/null <<'SQL'
DO $concurrent_final_truth$
DECLARE public_spirit text; private_spirit text; public_emoji text; private_emoji text;
BEGIN
  SELECT spirit,spirit_emoji INTO public_spirit,public_emoji
  FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000005';
  SELECT spirit_id,spirit_emoji INTO private_spirit,private_emoji
  FROM public.agent_identities
  WHERE user_id='11111111-1111-4111-8111-111111111111'
    AND session_key='10000000-0000-4000-8000-000000000005';
  IF public_spirit <> 'race-b' OR private_spirit <> 'race-b'
     OR public_emoji <> 'B' OR private_emoji <> 'B' THEN
    RAISE EXCEPTION 'concurrent Spirit RPCs did not converge: %, %, %, %', public_spirit,private_spirit,public_emoji,private_emoji;
  END IF;
END;
$concurrent_final_truth$;

CREATE FUNCTION public.try_delete_profile_for_smoke(p_profile_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.delete_unreferenced_custom_agent_profile_v1(p_profile_id);
  RETURN 'deleted';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
  RETURN 'referenced';
END $$;
CREATE FUNCTION public.try_assign_profile_for_smoke(
  p_agent_id uuid,
  p_profile_id uuid
) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.set_published_agent_spirit_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    p_agent_id,
    'custom::' || p_profile_id::text,
    'ignored',
    p_profile_id
  );
  RETURN 'assigned';
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 'denied';
END $$;
SQL

# Assignment holds a key-share lock on the profile through commit. A racing
# delete waits, observes both committed projections, and returns referenced.
assign_wins="$smoke_root/assign-wins"
delete_loses="$smoke_root/delete-loses"
(
  psql_smoke -Atq >"$assign_wins" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.set_published_agent_spirit_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000007',
  'custom::c0000000-0000-4000-8000-000000000004','ignored','c0000000-0000-4000-8000-000000000004'
) ->> 'spiritId';
SELECT pg_sleep(1);
COMMIT;
SQL
) &
assign_wins_pid=$!
psql_smoke -c 'SELECT pg_sleep(0.25)' >/dev/null
(
  psql_smoke -Atq >"$delete_loses" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.try_delete_profile_for_smoke('c0000000-0000-4000-8000-000000000004');
COMMIT;
SQL
) &
delete_loses_pid=$!
wait "$assign_wins_pid"
wait "$delete_loses_pid"
grep -q '^custom::c0000000-0000-4000-8000-000000000004$' "$assign_wins" || { echo 'assignment-first race receipt was not exact' >&2; exit 1; }
grep -q '^referenced$' "$delete_loses" || { echo 'racing delete did not reject the committed assignment' >&2; exit 1; }

# A delete that locks first removes the profile atomically at commit. A racing
# assignment then rechecks the locked owner profile and fails without writing.
delete_wins="$smoke_root/delete-wins"
assign_loses="$smoke_root/assign-loses"
(
  psql_smoke -Atq >"$delete_wins" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.delete_unreferenced_custom_agent_profile_v1(
  'c0000000-0000-4000-8000-000000000005'
) ->> 'profileId';
SELECT pg_sleep(1);
COMMIT;
SQL
) &
delete_wins_pid=$!
psql_smoke -c 'SELECT pg_sleep(0.25)' >/dev/null
(
  psql_smoke -Atq >"$assign_loses" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.try_assign_profile_for_smoke(
  '10000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-000000000005'
);
COMMIT;
SQL
) &
assign_loses_pid=$!
wait "$delete_wins_pid"
wait "$assign_loses_pid"
grep -q '^c0000000-0000-4000-8000-000000000005$' "$delete_wins" || { echo 'delete-first race receipt was not exact' >&2; exit 1; }
grep -q '^denied$' "$assign_loses" || { echo 'racing assignment did not fail after profile deletion' >&2; exit 1; }

psql_smoke >/dev/null <<'SQL'
CREATE FUNCTION public.pause_private_profile_delete_for_smoke() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id='c0000000-0000-4000-8000-000000000006' THEN
    PERFORM pg_sleep(1);
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER pause_private_profile_delete
  BEFORE DELETE ON public.custom_agent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.pause_private_profile_delete_for_smoke();

CREATE FUNCTION public.try_assign_private_profile_for_smoke(
  p_session_key text,
  p_profile_id uuid
) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agent_identities(
    user_id,session_key,spirit_id,spirit_emoji,custom_profile_id,custom_profile_name
  ) VALUES (
    '11111111-1111-4111-8111-111111111111',
    p_session_key,
    'custom::' || p_profile_id::text,
    'P',
    p_profile_id::text,
    'Private delete race'
  );
  RETURN 'assigned';
EXCEPTION
  WHEN insufficient_privilege OR invalid_parameter_value THEN
    RETURN 'denied';
END $$;
SQL

# The delete RPC owns the exact profile FOR UPDATE and pauses in a BEFORE
# DELETE trigger. A concurrent private live-session assignment must wait on
# its FOR KEY SHARE, then fail after the deletion commits. This reproduces the
# former dangling-reference ordering at the exact lock boundary.
private_delete_wins="$smoke_root/private-delete-wins"
private_assign_loses="$smoke_root/private-assign-loses"
(
  psql_smoke -Atq >"$private_delete_wins" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.delete_unreferenced_custom_agent_profile_v1(
  'c0000000-0000-4000-8000-000000000006'
) ->> 'profileId';
COMMIT;
SQL
) &
private_delete_wins_pid=$!
psql_smoke -c 'SELECT pg_sleep(0.25)' >/dev/null
(
  psql_smoke -Atq >"$private_assign_loses" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT public.try_assign_private_profile_for_smoke(
  'private-delete-race-session',
  'c0000000-0000-4000-8000-000000000006'
);
COMMIT;
SQL
) &
private_assign_loses_pid=$!
wait "$private_delete_wins_pid"
wait "$private_assign_loses_pid"
grep -q '^c0000000-0000-4000-8000-000000000006$' "$private_delete_wins" || { echo 'paused private-profile delete receipt was not exact' >&2; exit 1; }
grep -q '^denied$' "$private_assign_loses" || { echo 'private assignment bypassed a paused profile delete' >&2; exit 1; }

psql_smoke >/dev/null <<'SQL'
DO $assign_delete_concurrent_truth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.custom_agent_profiles WHERE id='c0000000-0000-4000-8000-000000000004')
     OR (SELECT spirit FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000007') <> 'custom::c0000000-0000-4000-8000-000000000004'
     OR (SELECT spirit_id FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000007') <> 'custom::c0000000-0000-4000-8000-000000000004'
     OR EXISTS (SELECT 1 FROM public.custom_agent_profiles WHERE id='c0000000-0000-4000-8000-000000000005')
     OR (SELECT spirit FROM public.circle_office_agents WHERE id='10000000-0000-4000-8000-000000000008') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='10000000-0000-4000-8000-000000000008')
     OR EXISTS (SELECT 1 FROM public.custom_agent_profiles WHERE id='c0000000-0000-4000-8000-000000000006')
     OR EXISTS (SELECT 1 FROM public.agent_identities WHERE user_id='11111111-1111-4111-8111-111111111111' AND session_key='private-delete-race-session') THEN
    RAISE EXCEPTION 'assign/delete races left a missing profile, dangling reference, or split projection';
  END IF;
END;
$assign_delete_concurrent_truth$;
SQL

echo 'Agent Spirit assignment RPC disposable PostgreSQL behavior smoke passed.'
