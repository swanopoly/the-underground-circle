#!/usr/bin/env bash
# Disposable PostgreSQL proof for tenant-isolation RLS, column grants, and
# membership/thread revocation. This intentionally starts from broad legacy
# policies so the migration must close real authorization paths.
set -euo pipefail

for required_command in psql initdb pg_ctl; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "tenant-isolation SQL behavior smoke requires $required_command" >&2
    exit 1
  }
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration="$repo_root/supabase/migrations/20260821120000_tenant_isolation_convergence.sql"
smoke_root="$(mktemp -d "${TMPDIR:-/tmp}/uc-tenant-isolation-sql-smoke.XXXXXX")"
case "$smoke_root" in
  "${TMPDIR:-/tmp}"/uc-tenant-isolation-sql-smoke.*) ;;
  *) echo "refusing unsafe disposable path: $smoke_root" >&2; exit 1 ;;
esac

smoke_data="$smoke_root/data"
smoke_socket="$smoke_root/socket"
smoke_port="${TENANT_ISOLATION_SQL_SMOKE_PORT:-55451}"
mkdir "$smoke_socket"

cluster_command_prefix=()
if [ "$(id -u)" -eq 0 ]; then
  command -v sudo >/dev/null 2>&1 || {
    echo "tenant-isolation SQL behavior smoke cannot run initdb as root without sudo" >&2
    exit 1
  }
  cluster_user="${TENANT_ISOLATION_SQL_SMOKE_OS_USER:-}"
  if [ -z "$cluster_user" ]; then
    cluster_user="$(
      stat -f '%Su' "$repo_root" 2>/dev/null \
        || stat -c '%U' "$repo_root" 2>/dev/null \
        || true
    )"
  fi
  if [ -z "$cluster_user" ] || [ "$cluster_user" = root ] \
     || ! id "$cluster_user" >/dev/null 2>&1 \
     || ! sudo -n -u "$cluster_user" id -u >/dev/null 2>&1; then
    echo "tenant-isolation SQL behavior smoke needs an unprivileged PostgreSQL OS user; set TENANT_ISOLATION_SQL_SMOKE_OS_USER" >&2
    exit 1
  fi
  chown -R "$cluster_user" "$smoke_root"
  cluster_command_prefix=(sudo -n -u "$cluster_user")
fi

run_cluster_command() {
  if [ "${#cluster_command_prefix[@]}" -gt 0 ]; then
    "${cluster_command_prefix[@]}" "$@"
  else
    "$@"
  fi
}

cleanup() {
  run_cluster_command pg_ctl -D "$smoke_data" -m immediate stop >/dev/null 2>&1 || true
  case "$smoke_root" in
    "${TMPDIR:-/tmp}"/uc-tenant-isolation-sql-smoke.*) rm -rf "$smoke_root" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

run_cluster_command initdb -D "$smoke_data" -A trust -U postgres \
  --no-locale --encoding=UTF8 >/dev/null
run_cluster_command pg_ctl -D "$smoke_data" \
  -o "-F -k '$smoke_socket' -c listen_addresses='' -p $smoke_port" \
  -w start >/dev/null

psql_smoke() {
  psql -X -q -v ON_ERROR_STOP=1 \
    -h "$smoke_socket" -p "$smoke_port" -U postgres -d postgres "$@"
}

psql_smoke >/dev/null <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA realtime;
CREATE SCHEMA private_integrations;

CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;
CREATE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );
$function$;
CREATE FUNCTION realtime.topic()
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT nullif(current_setting('realtime.topic', true), '');
$function$;

CREATE TABLE public.organizations(
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE public.org_members(
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY(org_id, user_id)
);
CREATE TABLE public.circles(
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text,
  invite_code text,
  max_members integer NOT NULL DEFAULT 8,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  vibe text DEFAULT '',
  tab_visibility jsonb,
  rules text[] DEFAULT '{}'::text[],
  circle_image_url text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT false,
  circle_type text NOT NULL DEFAULT 'accountability',
  icon text,
  accent_color text,
  check_in_format jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  org_id uuid REFERENCES public.organizations(id),
  api_key text,
  discord_guild_id text,
  discord_bot_token text,
  discord_webhook_url text,
  discord_connected_at timestamptz
);
CREATE TABLE public.circle_members(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(circle_id, user_id)
);
CREATE TABLE public.profiles(
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  avatar_url text,
  bio text,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  wallet_address text,
  wallet_chain text,
  office_layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  office_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  training_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.featured_trades(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  symbol text NOT NULL
);
CREATE TABLE public.featured_trade_executions(
  id uuid PRIMARY KEY,
  featured_trade_id uuid NOT NULL REFERENCES public.featured_trades(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending'
);
CREATE TABLE public.spirit_learnings(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  content text NOT NULL
);
CREATE TABLE public.user_points(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  total_points bigint NOT NULL DEFAULT 0
);
CREATE TABLE public.user_badges(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  badge_id text NOT NULL
);
-- Production retains the legacy id PK plus the canonical unique user_id.
CREATE TABLE public.user_xp(
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  total_xp integer NOT NULL DEFAULT 0
);
CREATE TABLE public.research_agent_runs(
  id uuid PRIMARY KEY,
  query text NOT NULL,
  summary text,
  error text
);

CREATE TABLE public.circle_chat_threads(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  title text NOT NULL DEFAULT 'Private thread',
  visibility text NOT NULL DEFAULT 'private',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.circle_chat_thread_members(
  thread_id uuid NOT NULL REFERENCES public.circle_chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  PRIMARY KEY(thread_id, user_id)
);
CREATE TABLE public.messages(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.circle_chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  content text NOT NULL,
  is_bot boolean NOT NULL DEFAULT false
);
CREATE TABLE public.direct_messages(
  id uuid PRIMARY KEY,
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  receiver_id uuid NOT NULL REFERENCES auth.users(id),
  content text NOT NULL
);
CREATE TABLE public.message_attachments(
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.circle_chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id)
);

CREATE FUNCTION public.message_thread_visible_to_current_user(
  p_circle_id uuid,
  p_thread_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL;
$function$;
CREATE FUNCTION public.message_attachment_row_visible_v1(
  p_message_id uuid,
  p_circle_id uuid,
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    p_user_id = auth.uid()
    AND public.message_thread_visible_to_current_user(p_circle_id, p_thread_id);
$function$;

CREATE TABLE public.agent_plans(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  thread_id text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'draft',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.agent_plan_steps(
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE
);
CREATE TABLE public.agent_plan_questions(
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE
);
CREATE TABLE public.agent_plan_artifacts(
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE
);
CREATE TABLE public.chat_checkpoints(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  session_key text,
  plan_id text,
  tool_kind text NOT NULL,
  target_kind text,
  target_id text,
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  diff_summary text,
  hash_before text,
  hash_after text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restored_by uuid REFERENCES auth.users(id),
  restore_error text
);

CREATE TABLE public.computer_use_schedules(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  thread_id uuid REFERENCES public.circle_chat_threads(id),
  task text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.scheduled_actions(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  circle_id uuid REFERENCES public.circles(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dispatched_at timestamptz
);

CREATE TABLE public.integrations(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL,
  token text NOT NULL
);
CREATE TABLE public.user_site_credentials(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  site_url text NOT NULL,
  encrypted_secret text NOT NULL
);
CREATE TABLE public.user_api_keys(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL,
  api_key_enc bytea NOT NULL
);
CREATE TABLE public.oauth_provider_credentials(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL,
  access_token_enc bytea NOT NULL
);
CREATE TABLE public.user_google_credentials(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  access_token text NOT NULL
);
CREATE TABLE public.user_github_tokens(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  access_token text NOT NULL
);
CREATE TABLE public.agent_connect_tokens(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  circle_id uuid REFERENCES public.circles(id),
  token text NOT NULL
);

CREATE TABLE public.circle_integrations(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id),
  provider text NOT NULL
);
CREATE TABLE private_integrations.circle_integration_secrets(
  integration_id uuid PRIMARY KEY REFERENCES public.circle_integrations(id),
  encrypted_value bytea NOT NULL
);
CREATE VIEW public.circle_integration_secrets AS
SELECT integration_id, encrypted_value
FROM private_integrations.circle_integration_secrets;

CREATE TABLE public.circle_github_connections(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  connected_by uuid NOT NULL REFERENCES auth.users(id),
  owner text NOT NULL,
  repo text NOT NULL,
  full_name text NOT NULL,
  default_branch text DEFAULT 'main',
  webhook_id bigint,
  webhook_secret text NOT NULL,
  events_enabled text[] NOT NULL DEFAULT '{}'::text[],
  notify_chat boolean NOT NULL DEFAULT true,
  notify_activity boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  last_event_at timestamptz,
  event_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(circle_id, owner, repo)
);

CREATE TABLE public.tasks(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  title text NOT NULL
);
CREATE TABLE public.circle_missions(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id),
  status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.circle_rooms(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id),
  created_by uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE public.project_rooms(
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id),
  created_by uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE public.room_files(
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.circle_rooms(id),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  file_name text NOT NULL
);
CREATE TABLE public.room_secrets(
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.circle_rooms(id),
  created_by uuid REFERENCES auth.users(id),
  key text NOT NULL,
  value text NOT NULL,
  UNIQUE(room_id, key)
);
CREATE TABLE public.reports(
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending',
  file_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.slack_connections(
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES public.organizations(id),
  circle_id uuid REFERENCES public.circles(id),
  installed_by uuid NOT NULL REFERENCES auth.users(id),
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.teams_connections(
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES public.organizations(id),
  circle_id uuid REFERENCES public.circles(id),
  installed_by uuid NOT NULL REFERENCES auth.users(id),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE storage.buckets(
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  name text NOT NULL,
  owner_id uuid
);
CREATE TABLE realtime.messages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT USAGE ON SCHEMA public, auth, storage, realtime TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION realtime.topic() TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public, storage, realtime TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public, storage, realtime TO anon;

-- Broad legacy policies make policy convergence and restrictive guards
-- observable instead of relying on the absence of an allow policy.
ALTER TABLE public.circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_trade_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spirit_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_xp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_chat_thread_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plan_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plan_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plan_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.computer_use_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_site_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_google_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_github_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_connect_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_github_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY legacy_circles_all ON public.circles FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_circle_members_all ON public.circle_members FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_profiles_all ON public.profiles FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_featured_trades_all ON public.featured_trades FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_featured_trade_executions_all ON public.featured_trade_executions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_spirit_learnings_all ON public.spirit_learnings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_user_points_all ON public.user_points FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_user_badges_all ON public.user_badges FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_user_xp_all ON public.user_xp FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_research_runs_all ON public.research_agent_runs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_threads_all ON public.circle_chat_threads FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_thread_members_all ON public.circle_chat_thread_members FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_messages_all ON public.messages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_direct_messages_all ON public.direct_messages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_attachments_all ON public.message_attachments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_api_keys_all ON public.user_api_keys FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_github_connections_all ON public.circle_github_connections FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY legacy_storage_all ON storage.objects FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.organizations(id, name) VALUES
  ('90000000-0000-4000-8000-000000000001', 'Tenant smoke org');
INSERT INTO public.org_members(org_id, user_id, role) VALUES
  ('90000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner');
INSERT INTO public.circles(
  id, name, description, invite_code, created_by, org_id, is_public,
  api_key, discord_guild_id, discord_bot_token, discord_webhook_url
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Shared exact Circle',
  'Safe Circle metadata',
  'invite-private',
  '11111111-1111-4111-8111-111111111111',
  '90000000-0000-4000-8000-000000000001',
  true,
  'circle-api-secret-u1',
  'safe-guild-id',
  'discord-bot-secret-u1',
  'https://discord.invalid/webhook-secret-u1'
);
INSERT INTO public.circle_members(circle_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'creator'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'member');
INSERT INTO public.profiles(
  id, username, display_name, wallet_address, wallet_chain,
  office_layout, office_preferences, training_data
) VALUES
  (
    '11111111-1111-4111-8111-111111111111', 'owner-one', 'Owner One',
    'wallet-owner-private', 'chain-owner-private',
    '{"private":"office-owner"}', '{"private":"prefs-owner"}',
    '{"private":"training-owner"}'
  ),
  (
    '22222222-2222-4222-8222-222222222222', 'member-two', 'Member Two',
    'wallet-member-private', 'chain-member-private',
    '{"private":"office-member"}', '{"private":"prefs-member"}',
    '{"private":"training-member"}'
  );

INSERT INTO public.featured_trades(id, user_id, symbol) VALUES
  ('71000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'OWNER'),
  ('71000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'MEMBER');
INSERT INTO public.featured_trade_executions(id, featured_trade_id, user_id) VALUES
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222');
INSERT INTO public.spirit_learnings(id, user_id, content) VALUES
  ('73000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner strategy'),
  ('73000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'member strategy');
INSERT INTO public.user_points(user_id, total_points) VALUES
  ('11111111-1111-4111-8111-111111111111', 101),
  ('22222222-2222-4222-8222-222222222222', 202);
INSERT INTO public.user_badges(user_id, badge_id) VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner-badge'),
  ('22222222-2222-4222-8222-222222222222', 'member-badge');
INSERT INTO public.user_xp(id, user_id, total_xp) VALUES
  ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 111),
  ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 222);
INSERT INTO public.research_agent_runs(id, query, summary, error) VALUES
  ('74000000-0000-4000-8000-000000000001', 'private research query', 'private summary', NULL);

INSERT INTO public.circle_chat_threads(id, circle_id, created_by, visibility) VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'private'
);
INSERT INTO public.circle_chat_thread_members(thread_id, user_id, role) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'member');
INSERT INTO public.messages(id, circle_id, thread_id, user_id, content) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  'private thread message'
);

INSERT INTO public.integrations(id, user_id, provider, token) VALUES
  ('61000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner-provider', 'owner-token'),
  ('61000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'member-provider', 'member-token');
INSERT INTO public.user_site_credentials(id, user_id, site_url, encrypted_secret) VALUES
  ('62000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'https://owner.invalid', 'owner-site-secret'),
  ('62000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'https://member.invalid', 'member-site-secret');
INSERT INTO public.user_api_keys(id, user_id, provider, api_key_enc) VALUES
  ('63000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner-api', decode('aaaa', 'hex')),
  ('63000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'member-api', decode('bbbb', 'hex'));
INSERT INTO public.oauth_provider_credentials(id, user_id, provider, access_token_enc) VALUES
  ('64000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'google', decode('cccc', 'hex'));
INSERT INTO public.user_google_credentials(id, user_id, access_token) VALUES
  ('65000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'google-secret');
INSERT INTO public.user_github_tokens(id, user_id, access_token) VALUES
  ('66000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'github-secret');
INSERT INTO public.agent_connect_tokens(id, user_id, circle_id, token) VALUES
  ('67000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'connect-owner'),
  ('67000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'connect-member');

INSERT INTO public.circle_integrations(id, circle_id, provider) VALUES
  ('68000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'slack');
INSERT INTO private_integrations.circle_integration_secrets(integration_id, encrypted_value) VALUES
  ('68000000-0000-4000-8000-000000000001', decode('dddd', 'hex'));
INSERT INTO public.circle_github_connections(
  id, circle_id, connected_by, owner, repo, full_name, webhook_id, webhook_secret,
  events_enabled
) VALUES (
  '69000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'safe-owner', 'safe-repo', 'safe-owner/safe-repo', 12345,
  'github-webhook-secret-u1', ARRAY['push']::text[]
);

INSERT INTO public.tasks(id, circle_id, created_by, title) VALUES (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Shared task'
);
INSERT INTO public.circle_missions(id, circle_id, status) VALUES (
  '75000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'active'
);
INSERT INTO public.circle_rooms(id, circle_id, created_by) VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111'
);
INSERT INTO storage.buckets(id, name, public) VALUES
  ('task-images', 'task-images', true),
  ('room-files', 'room-files', true),
  ('circle-images', 'circle-images', true),
  ('reports', 'reports', true);
INSERT INTO storage.objects(bucket_id, name, owner_id) VALUES
  ('task-images', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd/task.txt', '11111111-1111-4111-8111-111111111111'),
  ('room-files', 'rooms/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/room.txt', '11111111-1111-4111-8111-111111111111'),
  ('circle-images', 'circles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/icon.png', '11111111-1111-4111-8111-111111111111'),
  ('reports', 'reports/90000000-0000-4000-8000-000000000001/76000000-0000-4000-8000-000000000001/report.pdf', '11111111-1111-4111-8111-111111111111');
SQL

PGOPTIONS='-c client_min_messages=warning' psql_smoke -f "$migration" >/dev/null

psql_smoke >/dev/null <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

DO $owner_identity$
DECLARE
  row_count integer;
  safe_name text;
  peer_wallet text;
  circle_api_key text;
  discord_bot_token text;
  discord_webhook_url text;
BEGIN
  SELECT count(*) INTO row_count FROM public.profiles;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '11111111-1111-4111-8111-111111111111'
      AND office_layout ->> 'private' = 'office-owner'
  ) THEN
    RAISE EXCEPTION 'raw profiles are not exact-self-only for identity one';
  END IF;

  SELECT display_name, wallet_address
  INTO safe_name, peer_wallet
  FROM public.safe_profiles
  WHERE id = '22222222-2222-4222-8222-222222222222';
  IF safe_name IS DISTINCT FROM 'Member Two' OR peer_wallet IS NOT NULL THEN
    RAISE EXCEPTION 'shared-Circle safe profile or peer wallet redaction failed for identity one';
  END IF;

  SELECT count(*) INTO row_count FROM public.user_api_keys;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.user_api_keys WHERE provider = 'owner-api'
  ) THEN
    RAISE EXCEPTION 'API keys are not exact-self-only for identity one';
  END IF;

  SELECT count(*) INTO row_count FROM public.featured_trades;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.featured_trades WHERE symbol = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'featured trades are not exact-owner-only for identity one';
  END IF;

  -- Creators and ordinary members use the same safe table projection. Secret
  -- access must never be conferred by an ordinary Circle table SELECT grant.
  BEGIN
    PERFORM circle.api_key, circle.discord_bot_token, circle.discord_webhook_url
    FROM public.circles AS circle
    WHERE circle.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    RAISE EXCEPTION 'creator ordinary Circle SELECT exposed capability secrets';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM webhook_secret
    FROM public.circle_github_connections
    WHERE id = '69000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'creator ordinary GitHub connection SELECT exposed webhook secret';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_github_connections
    WHERE full_name = 'safe-owner/safe-repo'
      AND default_branch = 'main'
      AND is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'creator lost safe GitHub connection metadata';
  END IF;

  SELECT secrets.api_key, secrets.discord_bot_token, secrets.discord_webhook_url
  INTO circle_api_key, discord_bot_token, discord_webhook_url
  FROM public.get_circle_capability_secrets_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) AS secrets;
  IF circle_api_key IS DISTINCT FROM 'circle-api-secret-u1'
     OR discord_bot_token IS DISTINCT FROM 'discord-bot-secret-u1'
     OR discord_webhook_url IS DISTINCT FROM 'https://discord.invalid/webhook-secret-u1' THEN
    RAISE EXCEPTION 'exact current creator could not read the bounded capability-secret RPC';
  END IF;
END
$owner_identity$;

-- Creator status is not permanent authority: the bounded secret RPC must stop
-- returning a row as soon as exact current membership is removed.
RESET ROLE;
DELETE FROM public.circle_members
WHERE circle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND user_id = '11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $departed_creator$
DECLARE row_count integer;
BEGIN
  SELECT count(*) INTO row_count
  FROM public.get_circle_capability_secrets_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'departed creator retained Circle capability-secret authority';
  END IF;
END
$departed_creator$;

RESET ROLE;
INSERT INTO public.circle_members(circle_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'creator');

-- The webhook verifier still needs its retained compatibility secret. Prove
-- that only the service role can read it from the raw connection table.
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $service_webhook_secret$
DECLARE secret_value text;
BEGIN
  SELECT webhook_secret INTO secret_value
  FROM public.circle_github_connections
  WHERE id = '69000000-0000-4000-8000-000000000001';
  IF secret_value IS DISTINCT FROM 'github-webhook-secret-u1' THEN
    RAISE EXCEPTION 'service role lost the retained GitHub webhook secret';
  END IF;
END
$service_webhook_secret$;

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

DO $member_before_revocation$
DECLARE
  row_count integer;
  own_wallet text;
  peer_wallet text;
BEGIN
  SELECT count(*) INTO row_count FROM public.profiles;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '22222222-2222-4222-8222-222222222222'
      AND office_preferences ->> 'private' = 'prefs-member'
  ) THEN
    RAISE EXCEPTION 'raw profiles are not exact-self-only for identity two';
  END IF;

  SELECT count(*) INTO row_count FROM public.safe_profiles;
  IF row_count <> 2 THEN
    RAISE EXCEPTION 'safe_profiles did not expose exactly the two current Circle peers: %', row_count;
  END IF;
  SELECT wallet_address INTO own_wallet FROM public.safe_profiles
  WHERE id = '22222222-2222-4222-8222-222222222222';
  SELECT wallet_address INTO peer_wallet FROM public.safe_profiles
  WHERE id = '11111111-1111-4111-8111-111111111111';
  IF own_wallet IS DISTINCT FROM 'wallet-member-private' OR peer_wallet IS NOT NULL THEN
    RAISE EXCEPTION 'safe_profiles wallet self/peer projection failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.circles
    WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND name = 'Shared exact Circle'
      AND description = 'Safe Circle metadata'
  ) THEN
    RAISE EXCEPTION 'ordinary member lost safe Circle metadata';
  END IF;
  BEGIN
    PERFORM circle.api_key, circle.discord_bot_token, circle.discord_webhook_url
    FROM public.circles AS circle
    WHERE circle.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    RAISE EXCEPTION 'ordinary member Circle SELECT exposed capability secrets';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  IF pg_catalog.pg_get_function_result(
    to_regprocedure('public.get_user_circles(uuid)')
  ) ~ '(api_key|discord_bot_token|discord_webhook_url)' THEN
    RAISE EXCEPTION 'get_user_circles exposes Circle capability-secret columns';
  END IF;
  SELECT count(*) INTO row_count
  FROM public.get_circle_capability_secrets_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'noncreator member received Circle capability secrets';
  END IF;

  BEGIN
    PERFORM webhook_secret
    FROM public.circle_github_connections
    WHERE id = '69000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'ordinary member GitHub connection SELECT exposed webhook secret';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_github_connections
    WHERE owner = 'safe-owner'
      AND repo = 'safe-repo'
      AND full_name = 'safe-owner/safe-repo'
      AND default_branch = 'main'
      AND is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'ordinary member lost required non-secret GitHub metadata';
  END IF;

  SELECT count(*) INTO row_count FROM public.user_api_keys;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.user_api_keys WHERE provider = 'member-api'
  ) THEN
    RAISE EXCEPTION 'API keys are not exact-self-only for identity two';
  END IF;
  SELECT count(*) INTO row_count FROM public.integrations;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.integrations WHERE provider = 'member-provider'
  ) THEN
    RAISE EXCEPTION 'client-managed integrations are not exact-self-only';
  END IF;
  SELECT count(*) INTO row_count FROM public.user_site_credentials;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.user_site_credentials
    WHERE site_url = 'https://member.invalid'
  ) THEN
    RAISE EXCEPTION 'site credentials are not exact-self-only';
  END IF;

  BEGIN
    PERFORM 1 FROM public.oauth_provider_credentials;
    RAISE EXCEPTION 'authenticated browser read service-only OAuth credentials';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.user_github_tokens;
    RAISE EXCEPTION 'authenticated browser read service-only GitHub credentials';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  SELECT count(*) INTO row_count FROM public.featured_trades;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.featured_trades WHERE symbol = 'MEMBER'
  ) THEN
    RAISE EXCEPTION 'featured trades are not exact-owner-only for identity two';
  END IF;

  SELECT count(*) INTO row_count FROM public.user_xp;
  IF row_count <> 2 THEN
    RAISE EXCEPTION 'peer XP is not visible while identities share a Circle: %', row_count;
  END IF;

  BEGIN
    PERFORM 1 FROM public.research_agent_runs;
    RAISE EXCEPTION 'authenticated browser read research_agent_runs';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  SELECT count(*) INTO row_count FROM public.circle_chat_threads
  WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'private thread was not visible to an exact thread member';
  END IF;
  SELECT count(*) INTO row_count FROM public.messages
  WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'private message was not visible to an exact thread member';
  END IF;

  SELECT count(*) INTO row_count FROM storage.objects
  WHERE bucket_id IN ('task-images', 'room-files', 'circle-images');
  IF row_count <> 3 THEN
    RAISE EXCEPTION 'current Circle member could not read all three scoped private objects: %', row_count;
  END IF;
  SELECT count(*) INTO row_count FROM storage.objects WHERE bucket_id = 'reports';
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'authenticated browser read service-only report storage';
  END IF;
END
$member_before_revocation$;

-- Exercise all three protected Office topic shapes through realtime.messages
-- RLS, rather than calling the authorization helper directly.
SELECT set_config('realtime.topic', 'office-terminal-cmd-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
INSERT INTO realtime.messages(payload) VALUES ('{"kind":"command"}'::jsonb);
SELECT set_config('realtime.topic', 'office-terminal-resp-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
INSERT INTO realtime.messages(payload) VALUES ('{"kind":"response"}'::jsonb);
SELECT set_config('realtime.topic', 'circle-presence-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
INSERT INTO realtime.messages(payload) VALUES ('{"kind":"presence"}'::jsonb);
DO $member_realtime$
DECLARE row_count integer;
BEGIN
  SELECT count(*) INTO row_count FROM realtime.messages;
  IF row_count <> 3 THEN
    RAISE EXCEPTION 'current member did not pass exact private Realtime RLS: %', row_count;
  END IF;
END
$member_realtime$;

SELECT set_config('realtime.topic', 'office-terminal-cmd-not-a-circle', false);
DO $malformed_realtime$
BEGIN
  BEGIN
    INSERT INTO realtime.messages(payload) VALUES ('{"kind":"malformed"}'::jsonb);
    RAISE EXCEPTION 'malformed protected Realtime topic was admitted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$malformed_realtime$;

RESET ROLE;
DELETE FROM public.circle_chat_thread_members
WHERE thread_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  AND user_id = '22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

DO $thread_revoked$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.circle_chat_threads
    WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) OR EXISTS (
    SELECT 1 FROM public.messages
    WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ) THEN
    RAISE EXCEPTION 'private Chat remained visible after exact thread removal';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.circles
    WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) THEN
    RAISE EXCEPTION 'thread removal incorrectly revoked the parent Circle';
  END IF;
END
$thread_revoked$;

RESET ROLE;
INSERT INTO public.circle_chat_thread_members(thread_id, user_id, role) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'member');
DELETE FROM public.circle_members
WHERE circle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  AND user_id = '22222222-2222-4222-8222-222222222222';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

DO $circle_revoked$
DECLARE row_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.circles
    WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) OR EXISTS (
    SELECT 1 FROM public.circle_members
    WHERE circle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) THEN
    RAISE EXCEPTION 'Circle row/member visibility survived membership removal';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.circle_chat_threads
    WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) OR EXISTS (
    SELECT 1 FROM public.messages
    WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ) THEN
    RAISE EXCEPTION 'private Chat survived parent Circle membership removal';
  END IF;

  SELECT count(*) INTO row_count FROM public.safe_profiles;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.safe_profiles
    WHERE id = '22222222-2222-4222-8222-222222222222'
  ) THEN
    RAISE EXCEPTION 'safe_profiles retained a departed Circle peer: %', row_count;
  END IF;

  SELECT count(*) INTO row_count FROM public.user_xp;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.user_xp
    WHERE user_id = '22222222-2222-4222-8222-222222222222'
  ) THEN
    RAISE EXCEPTION 'peer XP survived Circle removal or self XP disappeared';
  END IF;

  SELECT count(*) INTO row_count FROM storage.objects
  WHERE bucket_id IN ('task-images', 'room-files', 'circle-images');
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'private Circle storage survived membership removal: %', row_count;
  END IF;

  SELECT count(*) INTO row_count FROM public.user_api_keys;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.user_api_keys WHERE provider = 'member-api'
  ) THEN
    RAISE EXCEPTION 'Circle removal affected or leaked personal API keys';
  END IF;
  SELECT count(*) INTO row_count FROM public.featured_trades;
  IF row_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.featured_trades WHERE symbol = 'MEMBER'
  ) THEN
    RAISE EXCEPTION 'Circle removal affected or leaked owner-only trades';
  END IF;

  SELECT count(*) INTO row_count FROM public.get_user_circles(auth.uid());
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'self-bound get_user_circles retained a departed Circle';
  END IF;
  SELECT count(*) INTO row_count
  FROM public.get_user_circles('11111111-1111-4111-8111-111111111111');
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'get_user_circles accepted a different account id';
  END IF;
END
$circle_revoked$;

SELECT set_config('realtime.topic', 'circle-presence-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
DO $realtime_revoked$
DECLARE row_count integer;
BEGIN
  SELECT count(*) INTO row_count FROM realtime.messages;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'private Realtime messages survived Circle membership removal';
  END IF;
  BEGIN
    INSERT INTO realtime.messages(payload) VALUES ('{"kind":"revoked"}'::jsonb);
    RAISE EXCEPTION 'departed Circle member inserted a private Realtime message';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$realtime_revoked$;

RESET ROLE;
SELECT 'tenant isolation SQL behavior passed' AS result;
SQL

echo "tenant-isolation SQL behavior smoke passed"
