#!/bin/sh
# Disposable PostgreSQL behavior proof for circle-global idle-behavior claims.
set -eu

for required_command in psql createdb dropdb; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "circle idle-behavior claims SQL smoke requires $required_command" >&2
    exit 1
  }
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
migration="$repo_root/supabase/migrations/20260817120000_circle_idle_behavior_claims.sql"

smoke_pg_user="${IDLE_BEHAVIOR_CLAIMS_SQL_SMOKE_PGUSER:-${PGUSER:-$(id -un)}}"
if ! psql -X -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  for candidate_user in "$(id -un)" cswanson postgres; do
    if psql -X -U "$candidate_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
      smoke_pg_user="$candidate_user"
      break
    fi
  done
fi
if ! psql -X -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  echo 'circle idle-behavior claims SQL smoke could not find a local PostgreSQL owner; set IDLE_BEHAVIOR_CLAIMS_SQL_SMOKE_PGUSER' >&2
  exit 1
fi

smoke_db="uc_idle_behavior_claims_sql_smoke_$$"
case "$smoke_db" in
  uc_idle_behavior_claims_sql_smoke_[0-9]*) ;;
  *) echo "refusing unsafe disposable database name: $smoke_db" >&2; exit 1 ;;
esac

smoke_root=$(mktemp -d /tmp/uc-idle-behavior-claims-sql-smoke.XXXXXX)
case "$smoke_root" in
  /tmp/uc-idle-behavior-claims-sql-smoke.*) ;;
  *) echo "refusing unsafe disposable path: $smoke_root" >&2; exit 1 ;;
esac

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
  case "$smoke_root" in
    /tmp/uc-idle-behavior-claims-sql-smoke.*) rm -rf "$smoke_root" ;;
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

-- Simulate a database that applied the original §45 validator before
-- sharedChatOptIn existed. The table constraint and RPC are deliberately
-- created before §46 so CREATE OR REPLACE must repair their live dependency.
CREATE FUNCTION public.office_preferences_contains_secret_key_v1(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $$ SELECT false $$;

CREATE FUNCTION public.validate_office_user_preferences_v1(p_preferences jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_typeof(p_preferences) = 'object'
    AND NOT coalesce((p_preferences -> 'idleConfig') ? 'sharedChatOptIn', false)
$$;

REVOKE ALL ON FUNCTION public.office_preferences_contains_secret_key_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_office_user_preferences_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.office_user_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, circle_id),
  CONSTRAINT office_user_preferences_document_valid
    CHECK (public.validate_office_user_preferences_v1(preferences))
);

CREATE FUNCTION public.patch_my_office_preferences_v1(
  p_circle_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  next_preferences jsonb;
BEGIN
  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.office_user_preferences(user_id, circle_id)
  VALUES (actor_id, p_circle_id)
  ON CONFLICT (user_id, circle_id) DO NOTHING;

  SELECT preferences || p_patch
    INTO next_preferences
  FROM public.office_user_preferences
  WHERE user_id = actor_id
    AND circle_id = p_circle_id
  FOR UPDATE;

  IF NOT public.validate_office_user_preferences_v1(next_preferences) THEN
    RAISE EXCEPTION 'office_preferences_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.office_user_preferences
  SET preferences = next_preferences,
      revision = revision + 1,
      updated_at = clock_timestamp()
  WHERE user_id = actor_id
    AND circle_id = p_circle_id;

  RETURN jsonb_build_object('accepted', true, 'preferences', next_preferences);
END;
$function$;

REVOKE ALL ON FUNCTION public.patch_my_office_preferences_v1(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.patch_my_office_preferences_v1(uuid, jsonb)
  TO authenticated;

GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
INSERT INTO public.circles(id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.circle_members(circle_id, user_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222');

DO $legacy_validator$
BEGIN
  IF public.validate_office_user_preferences_v1(
    '{"idleConfig":{"masterEnabled":true,"behaviors":{},"sharedChatOptIn":true}}'::jsonb
  ) THEN
    RAISE EXCEPTION 'pre-change validator unexpectedly accepted sharedChatOptIn';
  END IF;
END;
$legacy_validator$;
SQL

psql_smoke -f "$migration" >/dev/null
# Re-applying must be safe for the SQL Editor/consolidated workflow.
psql_smoke -f "$migration" >/dev/null

psql_smoke >/dev/null <<'SQL'
DO $catalog$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'public.circle_idle_behavior_claims'::regclass
      AND relrowsecurity
      AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'claim table did not retain enabled and forced RLS';
  END IF;
  IF has_table_privilege('authenticated', 'public.circle_idle_behavior_claims', 'SELECT')
     OR has_table_privilege('authenticated', 'public.circle_idle_behavior_claims', 'INSERT')
     OR has_table_privilege('authenticated', 'public.circle_idle_behavior_claims', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.circle_idle_behavior_claims', 'DELETE')
     OR has_table_privilege('anon', 'public.circle_idle_behavior_claims', 'SELECT')
     OR has_table_privilege('anon', 'public.circle_idle_behavior_claims', 'INSERT')
     OR has_table_privilege('service_role', 'public.circle_idle_behavior_claims', 'SELECT')
     OR has_table_privilege('service_role', 'public.circle_idle_behavior_claims', 'INSERT') THEN
    RAISE EXCEPTION 'a client role retained direct claim-table access';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.claim_idle_behavior_run_v1(uuid,text,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.claim_idle_behavior_run_v1(uuid,text,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.claim_idle_behavior_run_v1(uuid,text,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'claim RPC grants are not authenticated-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.claim_idle_behavior_run_v1(uuid,text,integer)'::regprocedure
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'claim RPC is not SECURITY DEFINER';
  END IF;
END;
$catalog$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $forward_preference_repair$
DECLARE
  receipt jsonb;
BEGIN
  receipt := public.patch_my_office_preferences_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"idleConfig":{"masterEnabled":true,"behaviors":{},"sharedChatOptIn":true}}'::jsonb
  );
  IF receipt ->> 'accepted' <> 'true'
     OR receipt #>> '{preferences,idleConfig,sharedChatOptIn}' <> 'true' THEN
    RAISE EXCEPTION '§46 forward validator repair was not used by the existing RPC: %',
      receipt;
  END IF;
END;
$forward_preference_repair$;
RESET ROLE;

DO $forward_preference_persisted$
DECLARE
  stored_preferences jsonb;
BEGIN
  SELECT preferences INTO stored_preferences
  FROM public.office_user_preferences
  WHERE user_id = '11111111-1111-4111-8111-111111111111'
    AND circle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  IF stored_preferences #>> '{idleConfig,sharedChatOptIn}' <> 'true' THEN
    RAISE EXCEPTION 'existing preference constraint did not persist sharedChatOptIn: %',
      stored_preferences;
  END IF;
END;
$forward_preference_persisted$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

DO $member_claims$
DECLARE
  first_claim jsonb;
  immediate_retry jsonb;
  floor_claim jsonb;
  ordinary_claim jsonb;
  behavior_id text;
  requested_cooldown integer;
  expected_cooldown integer;
BEGIN
  first_claim := public.claim_idle_behavior_run_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'streak_guardian',
    240
  );
  immediate_retry := public.claim_idle_behavior_run_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'streak_guardian',
    10080
  );

  IF first_claim - ARRAY[
       'schemaVersion', 'claimed', 'behaviorId', 'effectiveCooldownMinutes',
       'claimedAt', 'nextEligibleAt'
     ] <> '{}'::jsonb
     OR first_claim ->> 'schemaVersion' <> '1'
     OR first_claim ->> 'claimed' <> 'true'
     OR first_claim ->> 'behaviorId' <> 'streak_guardian'
     OR first_claim ->> 'effectiveCooldownMinutes' <> '1440'
     OR first_claim ->> 'claimedAt' IS NULL
     OR first_claim ->> 'nextEligibleAt' IS NULL THEN
    RAISE EXCEPTION 'first member claim receipt mismatch: %', first_claim;
  END IF;
  IF immediate_retry ->> 'claimed' <> 'false'
     OR immediate_retry ->> 'claimedAt' <> first_claim ->> 'claimedAt'
     OR immediate_retry ->> 'nextEligibleAt' <> first_claim ->> 'nextEligibleAt'
     OR immediate_retry ->> 'effectiveCooldownMinutes' <> '1440' THEN
    RAISE EXCEPTION 'immediate retry did not return the same denied reservation: %',
      immediate_retry;
  END IF;

  FOR behavior_id, requested_cooldown, expected_cooldown IN
    VALUES
      ('circle_pulse_monitor', 480, 1440),
      ('morning_briefing', 60, 1440),
      ('weekly_retro', 10080, 10080),
      ('goal_pace_tracker', 60, 1440)
  LOOP
    floor_claim := public.claim_idle_behavior_run_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      behavior_id,
      requested_cooldown
    );
    IF floor_claim ->> 'claimed' <> 'true'
       OR floor_claim ->> 'behaviorId' <> behavior_id
       OR (floor_claim ->> 'effectiveCooldownMinutes')::integer <> expected_cooldown THEN
      RAISE EXCEPTION 'shared-Chat cooldown floor mismatch for %: %',
        behavior_id, floor_claim;
    END IF;
  END LOOP;

  ordinary_claim := public.claim_idle_behavior_run_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'knowledge_curator',
    60
  );
  IF ordinary_claim ->> 'claimed' <> 'true'
     OR ordinary_claim ->> 'effectiveCooldownMinutes' <> '60' THEN
    RAISE EXCEPTION 'ordinary cooldown was not preserved: %', ordinary_claim;
  END IF;

  ordinary_claim := public.claim_idle_behavior_run_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cost_efficiency_report',
    720
  );
  IF ordinary_claim ->> 'claimed' <> 'true'
     OR ordinary_claim ->> 'effectiveCooldownMinutes' <> '720' THEN
    RAISE EXCEPTION 'non-Chat cost analytics cooldown was not preserved: %',
      ordinary_claim;
  END IF;
END;
$member_claims$;

DO $raw_authenticated_dml_denied$
BEGIN
  BEGIN
    INSERT INTO public.circle_idle_behavior_claims(
      circle_id, behavior_id, claimed_by, claimed_at, next_eligible_at
    ) VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'stale_task_detector',
      '11111111-1111-4111-8111-111111111111',
      clock_timestamp(),
      clock_timestamp() + interval '1 hour'
    );
    RAISE EXCEPTION 'raw authenticated insert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.circle_idle_behavior_claims
    SET next_eligible_at = next_eligible_at;
    RAISE EXCEPTION 'raw authenticated update was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.circle_idle_behavior_claims;
    RAISE EXCEPTION 'raw authenticated delete was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$raw_authenticated_dml_denied$;

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
DO $nonmember_denied$
BEGIN
  BEGIN
    PERFORM public.claim_idle_behavior_run_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dependency_health',
      1440
    );
    RAISE EXCEPTION 'nonmember claim was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$nonmember_denied$;
RESET ROLE;
SQL

# Two independent authenticated sessions race for one fresh behavior row.
# The short equal sleep lets both sessions enter their transactions before the
# conditional UPSERT; PostgreSQL then serializes the unique-key conflict.
claim_a="$smoke_root/claim-a"
claim_b="$smoke_root/claim-b"
(
  psql_smoke -Atq >"$claim_a" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT pg_sleep(0.25);
SELECT public.claim_idle_behavior_run_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'memory_digest',
  1440
) ->> 'claimed';
COMMIT;
SQL
) &
claim_pid_a=$!
(
  psql_smoke -Atq >"$claim_b" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SELECT pg_sleep(0.25);
SELECT public.claim_idle_behavior_run_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'memory_digest',
  1440
) ->> 'claimed';
COMMIT;
SQL
) &
claim_pid_b=$!
wait "$claim_pid_a"
wait "$claim_pid_b"

claim_result_a=$(grep -E '^(true|false)$' "$claim_a" | tail -n 1)
claim_result_b=$(grep -E '^(true|false)$' "$claim_b" | tail -n 1)
claim_true_count=0
if [ "$claim_result_a" = 'true' ]; then claim_true_count=$((claim_true_count + 1)); fi
if [ "$claim_result_b" = 'true' ]; then claim_true_count=$((claim_true_count + 1)); fi
if [ "$claim_true_count" -ne 1 ]; then
  echo "simultaneous idle-behavior claim was not exactly-once: $claim_result_a + $claim_result_b" >&2
  exit 1
fi

# The forward validator repair itself must not require the §45 table. Dropping
# that disposable table and reapplying §46 proves the absent-table path while
# retaining the already-created claim rows and RPC.
psql_smoke -c 'DROP TABLE public.office_user_preferences' >/dev/null
psql_smoke -f "$migration" >/dev/null

echo 'Circle idle-behavior claims disposable PostgreSQL behavior smoke passed.'
