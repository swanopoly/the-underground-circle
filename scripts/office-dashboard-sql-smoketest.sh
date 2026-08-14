#!/bin/sh
# Disposable PostgreSQL behavior proof for Office §37 and its hardening.
set -eu

for required_command in psql createdb dropdb; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "office-dashboard SQL smoke requires $required_command" >&2
    exit 1
  }
done

smoke_pg_user="${OFFICE_SQL_SMOKE_PGUSER:-${PGUSER:-$(id -un)}}"
if ! psql -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  for candidate_user in "$(id -un)" cswanson postgres; do
    if psql -U "$candidate_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
      smoke_pg_user="$candidate_user"
      break
    fi
  done
fi
if ! psql -U "$smoke_pg_user" -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
  echo 'office-dashboard SQL smoke could not find a local PostgreSQL owner; set OFFICE_SQL_SMOKE_PGUSER' >&2
  exit 1
fi
smoke_db="uc_office_sql_smoke_$$"
case "$smoke_db" in
  uc_office_sql_smoke_[0-9]*) ;;
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
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.circles (id uuid PRIMARY KEY);
CREATE TABLE public.circle_members (
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (circle_id, user_id)
);
CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
GRANT SELECT ON public.circle_members, public.agent_runs TO authenticated;

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.circles(id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.circle_members(circle_id, user_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111');
INSERT INTO public.agent_runs(id, circle_id, user_id) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');
SQL

# Fresh-install apply.
psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260811120000_office_dashboard_state_and_floor_presets.sql >/dev/null

# Recreate two states that could exist under the historical revision: one
# far-future layout and one acknowledgement pointing at a run in another circle.
psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO public.office_layouts(user_id, circle_id, layout, layout_version)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '{"floors":[{"id":"floor","agentIds":[],"furniture":[]}],"currentFloorId":"floor","updatedAt":9007199254740991}'::jsonb,
  9007199254740991
);
ALTER TABLE public.office_attention_acknowledgements
  DROP CONSTRAINT office_attention_acknowledgements_run_circle_fkey;
ALTER TABLE public.office_attention_acknowledgements
  ADD CONSTRAINT office_attention_acknowledgements_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;
DROP TRIGGER office_attention_ack_scope_guard ON public.office_attention_acknowledgements;
INSERT INTO public.office_attention_acknowledgements(
  user_id, circle_id, attention_id, run_id, acknowledged_at, expires_at
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'legacy-expired',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  clock_timestamp() - interval '31 days',
  clock_timestamp() - interval '1 day'
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
INSERT INTO public.office_attention_acknowledgements(
  circle_id, attention_id, run_id, acknowledged_at, expires_at
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'legacy-expired',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  clock_timestamp(),
  clock_timestamp() + interval '30 days'
)
ON CONFLICT (user_id, circle_id, attention_id) DO UPDATE
SET run_id = EXCLUDED.run_id,
    acknowledged_at = EXCLUDED.acknowledged_at,
    expires_at = EXCLUDED.expires_at;
DO $legacy_renewal$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.office_attention_acknowledgements
    WHERE attention_id = 'legacy-expired'
      AND acknowledged_at > clock_timestamp() - interval '1 minute'
      AND expires_at > clock_timestamp() + interval '29 days'
  ) THEN
    RAISE EXCEPTION 'historical acknowledgement upsert did not renew an expired row';
  END IF;
END;
$legacy_renewal$;
DELETE FROM public.office_attention_acknowledgements WHERE attention_id = 'legacy-expired';
INSERT INTO public.office_attention_acknowledgements(user_id, circle_id, attention_id, run_id)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'legacy-cross-circle',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
);
SQL

# Upgrade apply must be idempotent and repair both historical hazards before it
# revokes authenticated raw layout mutation.
psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260813140000_office_layout_exact_save_receipt.sql >/dev/null

psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DO $test$
DECLARE
  repaired_version bigint;
  next_version bigint;
  receipt jsonb;
  acknowledged timestamptz;
  expires timestamptz;
  active_ids text[];
BEGIN
  SELECT layout_version INTO repaired_version
  FROM public.office_layouts
  WHERE user_id = '11111111-1111-4111-8111-111111111111'
    AND circle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  IF repaired_version > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint + 300000 THEN
    RAISE EXCEPTION 'legacy future layout version was not repaired';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.office_attention_acknowledgements
    WHERE attention_id = 'legacy-cross-circle'
  ) THEN
    RAISE EXCEPTION 'legacy cross-circle acknowledgement was not removed';
  END IF;
  IF has_table_privilege('authenticated', 'public.office_layouts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.office_layouts', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.office_layouts', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated raw Office layout mutation remains granted';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  next_version := GREATEST(repaired_version + 1, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint);
  receipt := public.save_office_layout_v2(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    jsonb_build_object(
      'floors', jsonb_build_array(jsonb_build_object('id', 'floor', 'agentIds', '[]'::jsonb, 'furniture', '[]'::jsonb)),
      'currentFloorId', 'floor',
      'updatedAt', next_version
    ),
    next_version
  );
  IF receipt <> jsonb_build_object('layoutVersion', next_version, 'accepted', true) THEN
    RAISE EXCEPTION 'exact Office save receipt failed: %', receipt;
  END IF;
  receipt := public.save_office_layout_v2(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    jsonb_build_object(
      'floors', jsonb_build_array(jsonb_build_object('id', 'floor', 'agentIds', '[]'::jsonb, 'furniture', jsonb_build_array(jsonb_build_object('id', 'different')))),
      'currentFloorId', 'floor',
      'updatedAt', next_version
    ),
    next_version
  );
  IF receipt <> jsonb_build_object('layoutVersion', next_version, 'accepted', false) THEN
    RAISE EXCEPTION 'same-version divergent receipt was accepted: %', receipt;
  END IF;
  BEGIN
    PERFORM public.save_office_layout_v2(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jsonb_build_object('floors', '[]'::jsonb, 'currentFloorId', 'floor', 'updatedAt', 9007199254740991::bigint),
      9007199254740991::bigint
    );
    RAISE EXCEPTION 'far-future Office version unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  INSERT INTO public.office_attention_acknowledgements(
    user_id, circle_id, attention_id, run_id, acknowledged_at, expires_at
  ) VALUES (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'valid-run',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '2000-01-01 UTC',
    '2100-01-01 UTC'
  );
  SELECT acknowledged_at, expires_at INTO acknowledged, expires
  FROM public.office_attention_acknowledgements
  WHERE user_id = '11111111-1111-4111-8111-111111111111'
    AND circle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND attention_id = 'valid-run';
  IF acknowledged < clock_timestamp() - interval '1 minute'
     OR expires <> acknowledged + interval '30 days' THEN
    RAISE EXCEPTION 'attention timestamps were not server-owned';
  END IF;
  SELECT array_agg(result.attention_id ORDER BY result.attention_id) INTO active_ids
  FROM public.list_active_office_attention_acknowledgements(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) AS result;
  IF active_ids IS DISTINCT FROM ARRAY['valid-run']::text[] THEN
    RAISE EXCEPTION 'server-clock acknowledgement list mismatch: %', active_ids;
  END IF;
END;
$test$;

DO $test$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  BEGIN
    INSERT INTO public.office_attention_acknowledgements(user_id, circle_id, attention_id, run_id)
    VALUES (
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cross-circle-rejected',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    );
    RAISE EXCEPTION 'cross-circle acknowledgement unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;
END;
$test$;
SQL

# Exercise actual invoker privilege failure, not only catalog introspection.
if psql -U "$smoke_pg_user" -d "$smoke_db" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DELETE FROM public.office_layouts
WHERE user_id = '11111111-1111-4111-8111-111111111111';
SQL
then
  echo 'authenticated raw Office layout DELETE unexpectedly succeeded' >&2
  exit 1
fi

echo 'office-dashboard SQL smoke: fresh apply, upgrade repair, receipts, FK, server clock, and RPC-only DML passed'
