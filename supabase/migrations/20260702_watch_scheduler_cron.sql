-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron: invoke the watch-scheduler edge fn every 15 minutes (Phase 7a of
-- docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md — server-side recurring watches)
-- ─────────────────────────────────────────────────────────────────────────────
-- Requires the pg_cron + pg_net extensions (both enabled by default in
-- Supabase). The cron job POSTs to the edge fn with the service-role key
-- so it bypasses RLS the same way the scheduler itself does. The scheduler
-- claims due `computer_use_schedules` rows (CAS on next_run_at — shared
-- with the client runner), runs them through computer-use-agent, and posts
-- watch updates to chat.
--
-- The service-role key is fetched from Vault instead of being pasted into
-- SQL — that's the supported Supabase pattern. The Vault secret MUST be
-- created manually before this cron can do anything:
--   1. Set the secret in Vault:
--      select vault.create_secret('<SERVICE_ROLE_KEY_VALUE>', 'watch_scheduler_service_key');
--   2. Then run this migration.
-- If Vault isn't available, the `select` version at the bottom is a manual
-- one-shot that can be invoked from an admin terminal.
--
-- PERMISSIONS (learned in production 2026-07-02): `cron.schedule` writes to
-- the cron.job table, and the SQL-editor `postgres` role only has those
-- grants when pg_cron/pg_net were enabled through the DASHBOARD
-- (Database → Extensions) — a raw `create extension` here does not set them
-- up, and you get `42501 permission denied for table job`. Enable both
-- extensions in the dashboard first. If cron.schedule still fails, create
-- the job through Dashboard → Integrations → Cron with the SQL snippet
-- `select tick_watch_scheduler();` — the two functions below are plain
-- public functions and always apply from the editor.
--
-- Idempotent — modern pg_cron upserts by job name, so re-running
-- cron.schedule updates the existing job without duplicating it.
--
-- docs/AGENTS_ROADMAP.md's SQL checklist owns applied-status. This file
-- existing locally is not proof that production has it.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: the Supabase project URL. Update the hostname to match yours.
create or replace function watch_scheduler_url()
returns text language sql immutable as $$
  select 'https://rjkniqiqdtroeholxacg.supabase.co/functions/v1/watch-scheduler';
$$;

-- The actual tick: POST to the edge fn. Uses net.http_post (pg_net).
-- Service-role key is pulled from vault. If the secret isn't set, the cron
-- job will silently no-op — check pg_net's response table for diagnostics.
create or replace function tick_watch_scheduler()
returns void
language plpgsql
security definer
as $$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'watch_scheduler_service_key'
  limit 1;

  if service_key is null then
    raise notice 'watch_scheduler_service_key not in vault; skipping tick';
    return;
  end if;

  perform net.http_post(
    url := watch_scheduler_url(),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
end;
$$;

-- Upserts by job name on modern pg_cron — no unschedule dance needed.
select cron.schedule(
  'watch_scheduler_tick',
  '*/15 * * * *',                              -- every 15 minutes
  $cron$select tick_watch_scheduler();$cron$
);

-- Sanity check you can run manually:
--   select tick_watch_scheduler();
--
-- Confirm the job exists:
--   select jobid, jobname, schedule, active from cron.job
--   where jobname = 'watch_scheduler_tick';
--
-- Inspect recent HTTP calls:
--   select id, status_code, created
--   from net._http_response
--   order by created desc
--   limit 10;
--
-- Remove the job (function call — avoids direct cron.job table writes,
-- which the editor role may not have grants for):
--   select cron.unschedule('watch_scheduler_tick');
