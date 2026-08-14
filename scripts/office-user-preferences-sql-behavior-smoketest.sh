#!/bin/sh
# Disposable PostgreSQL behavior proof for owner-private Office preferences.
set -eu

for required_command in psql createdb dropdb; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "office-user-preferences SQL behavior smoke requires $required_command" >&2
    exit 1
  }
done

smoke_pg_user="${OFFICE_PREFERENCES_SQL_SMOKE_PGUSER:-${PGUSER:-$(id -un)}}"
if ! psql -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  for candidate_user in "$(id -un)" cswanson postgres; do
    if psql -U "$candidate_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
      smoke_pg_user="$candidate_user"
      break
    fi
  done
fi
if ! psql -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  echo 'office-user-preferences SQL smoke could not find a local PostgreSQL owner' >&2
  exit 1
fi

smoke_db="uc_office_preferences_sql_smoke_$$"
case "$smoke_db" in
  uc_office_preferences_sql_smoke_[0-9]*) ;;
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
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.circles(id uuid PRIMARY KEY);
CREATE TABLE public.circle_members(
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY(circle_id, user_id)
);
CREATE TABLE public.profiles(
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  office_preferences jsonb DEFAULT '{}'::jsonb,
  agent_appearance jsonb DEFAULT '{}'::jsonb
);

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.circle_members, public.profiles TO authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
INSERT INTO public.circles(id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.circle_members(circle_id, user_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111');
INSERT INTO public.profiles(id, display_name, office_preferences, agent_appearance) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Owner Before Migration',
  '{
    "telegramConfig":{"botToken":"never-echo-this","chatId":"private"},
    "agentNames":{"agent":"Private Name"},
    "whiteboardNotes":["Private note"],
    "budgetConfig":{"enabled":true},
    "idleConfig":{"masterEnabled":true},
    "agentFilterMode":"mine",
    "appearances":{"agent":{"skinTone":"#000000"}},
    "autoApprove":{"file":"ask"},
    "adaptiveWorkspace":{"circle":{"enabled":true}},
    "costCounterSinceIsoByCircle":{"circle":"2026-01-01T00:00:00Z"}
  }'::jsonb,
  '{"agent":{"hairStyle":"flat","aura":"galaxy"}}'::jsonb
);
SQL

migration='supabase/migrations/20260813220000_office_user_preferences.sql'
psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null

psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DO $catalog$
DECLARE
  profile_preferences jsonb;
  legacy_appearance jsonb;
  profile_name text;
BEGIN
  IF has_table_privilege('authenticated', 'public.office_user_preferences', 'INSERT')
     OR has_table_privilege('authenticated', 'public.office_user_preferences', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.office_user_preferences', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated retained raw Office preference mutation';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.office_user_preferences', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost the owner-RLS read surface';
  END IF;
  IF has_function_privilege('anon', 'public.read_my_office_preferences_v1(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.patch_my_office_preferences_v1(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute an Office preference RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.read_my_office_preferences_v1(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.patch_my_office_preferences_v1(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lacks exact Office preference RPCs';
  END IF;

  SELECT office_preferences INTO profile_preferences
  FROM public.profiles
  WHERE id = '11111111-1111-4111-8111-111111111111';
  IF profile_preferences ?| ARRAY[
       'telegramConfig', 'agentNames', 'whiteboardNotes', 'budgetConfig',
       'idleConfig', 'agentFilterMode', 'appearances'
     ] THEN
    RAISE EXCEPTION 'legacy private Office keys survived migration scrub';
  END IF;
  IF NOT profile_preferences ?& ARRAY[
       'autoApprove', 'adaptiveWorkspace', 'costCounterSinceIsoByCircle'
     ] THEN
    RAISE EXCEPTION 'legacy scrub removed unrelated global preferences: %', profile_preferences;
  END IF;
  SELECT agent_appearance INTO legacy_appearance
  FROM public.profiles
  WHERE id = '11111111-1111-4111-8111-111111111111';
  IF legacy_appearance <> '{}'::jsonb THEN
    RAISE EXCEPTION 'legacy profile agent appearance survived migration scrub';
  END IF;

  UPDATE public.profiles
  SET display_name = 'Owner After Guard',
      agent_appearance = '{"agent":{"hairStyle":"wave","aura":"sparkles"}}'::jsonb,
      office_preferences = office_preferences || '{
    "telegramConfig":{"botToken":"cannot-return"},
    "agentNames":{"agent":"Cannot return"},
    "whiteboardNotes":["Cannot return"],
    "budgetConfig":{"enabled":true},
    "idleConfig":{"masterEnabled":true},
    "agentFilterMode":"active",
    "appearances":{"agent":{}},
    "autoApprove":{"file":"auto"}
  }'::jsonb
  WHERE id = '11111111-1111-4111-8111-111111111111';
  SELECT office_preferences INTO profile_preferences
  FROM public.profiles
  WHERE id = '11111111-1111-4111-8111-111111111111';
  IF profile_preferences ?| ARRAY[
       'telegramConfig', 'agentNames', 'whiteboardNotes', 'budgetConfig',
       'idleConfig', 'agentFilterMode', 'appearances'
     ] THEN
    RAISE EXCEPTION 'future profile write reintroduced private Office keys';
  END IF;
  IF profile_preferences #>> '{autoApprove,file}' <> 'auto' THEN
    RAISE EXCEPTION 'future-write trigger failed to preserve unrelated keys';
  END IF;
  SELECT agent_appearance, display_name
  INTO legacy_appearance, profile_name
  FROM public.profiles
  WHERE id = '11111111-1111-4111-8111-111111111111';
  IF legacy_appearance <> '{}'::jsonb THEN
    RAISE EXCEPTION 'future profile write persisted a legacy agent appearance';
  END IF;
  IF profile_name <> 'Owner After Guard' THEN
    RAISE EXCEPTION 'legacy appearance guard changed an unrelated profile field';
  END IF;

  INSERT INTO public.profiles(id, display_name, office_preferences, agent_appearance)
  VALUES (
    '22222222-2222-4222-8222-222222222222',
    'Peer Insert Preserved',
    '{"autoApprove":{"file":"ask"}}'::jsonb,
    '{"agent":{"hairStyle":"spiky","aura":"fire"}}'::jsonb
  );
  SELECT agent_appearance, display_name, office_preferences
  INTO legacy_appearance, profile_name, profile_preferences
  FROM public.profiles
  WHERE id = '22222222-2222-4222-8222-222222222222';
  IF legacy_appearance <> '{}'::jsonb THEN
    RAISE EXCEPTION 'future profile insert persisted a legacy agent appearance';
  END IF;
  IF profile_name <> 'Peer Insert Preserved'
     OR profile_preferences #>> '{autoApprove,file}' <> 'ask' THEN
    RAISE EXCEPTION 'legacy appearance insert guard changed unrelated profile fields';
  END IF;
END;
$catalog$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

DO $owner_behavior$
DECLARE
  response jsonb;
  receipt jsonb;
  appearance jsonb := '{
    "skinTone":"#f5d0a9","hairStyle":"flat","hairColor":"#000000",
    "shirtColor":"#6366f1","pantsColor":"#2d2d3d","shoeColor":"#000000",
    "accessory":"none","hat":"none","expression":"neutral","backItem":"none",
    "eyeColor":"#000000","facialHair":"none","pet":"swan","aura":"galaxy",
    "handItem":"coffee"
  }'::jsonb;
BEGIN
  response := public.read_my_office_preferences_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  IF response <> jsonb_build_object('preferences', '{}'::jsonb, 'revision', 0, 'updatedAt', NULL) THEN
    RAISE EXCEPTION 'empty read contract mismatch: %', response;
  END IF;

  receipt := public.patch_my_office_preferences_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    jsonb_build_object(
      'agentNames', '{"agent":"Swan"}'::jsonb,
      'appearances', jsonb_build_object('agent', appearance),
      'whiteboardNotes', '["Ship it"]'::jsonb,
      'budgetConfig', '{"enabled":true,"daily":25,"hardLimit":false}'::jsonb,
      'idleConfig', '{"masterEnabled":true,"behaviors":{"streak_guardian":{"enabled":true,"cooldownMinutes":240,"lastRanAt":null}}}'::jsonb,
      'agentFilterMode', '"mine"'::jsonb,
      'telegramMetadata', '{"chatId":"-1001234567890","botName":"openswan_bot"}'::jsonb
    )
  );
  IF receipt - ARRAY['schemaVersion', 'accepted', 'revision', 'updatedAt'] <> '{}'::jsonb
     OR receipt ->> 'schemaVersion' <> '1'
     OR receipt ->> 'accepted' <> 'true'
     OR receipt ->> 'revision' <> '1'
     OR receipt::text ~ '(Swan|Ship it|openswan_bot|1001234567890)' THEN
    RAISE EXCEPTION 'patch receipt is not exact and value-free: %', receipt;
  END IF;

  receipt := public.patch_my_office_preferences_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"agentFilterMode":null}'::jsonb
  );
  IF receipt ->> 'revision' <> '2' THEN
    RAISE EXCEPTION 'revision did not advance monotonically: %', receipt;
  END IF;
  response := public.read_my_office_preferences_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  IF response -> 'preferences' ? 'agentFilterMode'
     OR response #>> '{preferences,agentNames,agent}' <> 'Swan'
     OR response #>> '{preferences,telegramMetadata,botName}' <> 'openswan_bot'
     OR response #>> '{preferences,telegramMetadata,chatId}' <> '-1001234567890'
     OR response ->> 'revision' <> '2'
     OR response ? 'userId'
     OR response ? 'user_id' THEN
    RAISE EXCEPTION 'read/reset contract mismatch: %', response;
  END IF;

  BEGIN
    PERFORM public.patch_my_office_preferences_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '{"telegramConfig":{"botToken":"blocked"}}'::jsonb
    );
    RAISE EXCEPTION 'legacy Telegram credential object was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.patch_my_office_preferences_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '{"agentNames":{"agent":{"api_key":"blocked"}}}'::jsonb
    );
    RAISE EXCEPTION 'secret-like nested key was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.patch_my_office_preferences_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '{"telegramMetadata":{"chatId":"not-a-telegram-target"}}'::jsonb
    );
    RAISE EXCEPTION 'invalid Telegram chat target was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.patch_my_office_preferences_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jsonb_build_object('whiteboardNotes', to_jsonb(ARRAY[
        '1','2','3','4','5','6','7','8','9'
      ]))
    );
    RAISE EXCEPTION 'too many whiteboard notes were accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.patch_my_office_preferences_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jsonb_build_object('agentNames', jsonb_build_object('agent', repeat('x', 81)))
    );
    RAISE EXCEPTION 'oversized agent name was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.patch_my_office_preferences_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jsonb_build_object('agentNames', jsonb_build_object('agent', repeat('x', 131073)))
    );
    RAISE EXCEPTION 'oversized patch was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_my_office_preferences_v1('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    RAISE EXCEPTION 'unknown circle read was accepted';
  EXCEPTION WHEN foreign_key_violation OR insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.patch_my_office_preferences_v1(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{"agentFilterMode":"all"}'::jsonb
    );
    RAISE EXCEPTION 'unknown circle patch was accepted';
  EXCEPTION WHEN foreign_key_violation OR insufficient_privilege THEN NULL;
  END;
END;
$owner_behavior$;

DO $raw_dml_denied$
BEGIN
  BEGIN
    INSERT INTO public.office_user_preferences(user_id, circle_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    RAISE EXCEPTION 'raw authenticated insert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.office_user_preferences SET revision = revision + 1;
    RAISE EXCEPTION 'raw authenticated update was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.office_user_preferences;
    RAISE EXCEPTION 'raw authenticated delete was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$raw_dml_denied$;

SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
DO $peer_privacy$
DECLARE
  visible_count integer;
  response jsonb;
BEGIN
  SELECT count(*) INTO visible_count FROM public.office_user_preferences;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'circle peer can directly read owner preferences';
  END IF;
  response := public.read_my_office_preferences_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  IF response -> 'preferences' <> '{}'::jsonb OR response ->> 'revision' <> '0' THEN
    RAISE EXCEPTION 'peer RPC read returned another owner row: %', response;
  END IF;
  PERFORM public.patch_my_office_preferences_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"agentFilterMode":"active"}'::jsonb
  );
  response := public.read_my_office_preferences_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  IF response #>> '{preferences,agentFilterMode}' <> 'active'
     OR response ->> 'revision' <> '1' THEN
    RAISE EXCEPTION 'peer did not receive an independent owner row: %', response;
  END IF;
END;
$peer_privacy$;

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
DO $nonmember$
BEGIN
  BEGIN
    PERFORM public.read_my_office_preferences_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'nonmember read was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.patch_my_office_preferences_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"agentFilterMode":"all"}'::jsonb
    );
    RAISE EXCEPTION 'nonmember patch was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$nonmember$;

RESET ROLE;
DELETE FROM public.circle_members
WHERE circle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $revocation$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM public.office_user_preferences;
  IF visible_count <> 0 THEN RAISE EXCEPTION 'membership-revoked row remains directly visible'; END IF;
  BEGIN
    PERFORM public.read_my_office_preferences_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'membership-revoked read was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.patch_my_office_preferences_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"agentFilterMode":"all"}'::jsonb
    );
    RAISE EXCEPTION 'membership-revoked patch was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$revocation$;
SQL

# Two independent authenticated clients patch disjoint fields on a fresh scope.
# The first transaction deliberately retains its row lock for one second after
# the RPC returns; the second must wait, then merge against the committed row.
psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
BEGIN;
SELECT public.patch_my_office_preferences_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '{"agentFilterMode":"bonded"}'::jsonb
);
SELECT pg_sleep(1);
COMMIT;
SQL
first_patch_pid=$!

psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
SELECT public.patch_my_office_preferences_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '{"whiteboardNotes":["Concurrent note"]}'::jsonb
);
SQL
wait "$first_patch_pid"

psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $concurrent_disjoint_patch$
DECLARE
  response jsonb;
BEGIN
  response := public.read_my_office_preferences_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  IF response #>> '{preferences,agentFilterMode}' <> 'bonded'
     OR response #>> '{preferences,whiteboardNotes,0}' <> 'Concurrent note'
     OR response ->> 'revision' <> '2' THEN
    RAISE EXCEPTION 'concurrent disjoint patches did not converge: %', response;
  END IF;
END;
$concurrent_disjoint_patch$;
SQL

echo 'Office user preferences disposable PostgreSQL behavior smoke passed.'
