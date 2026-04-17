-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron: invoke the scheduled-action-runner edge fn every minute
-- ─────────────────────────────────────────────────────────────────────────────
-- Requires the pg_cron + pg_net extensions (both enabled by default in
-- Supabase). The cron job POSTs to the edge fn with the service-role key
-- so it bypasses RLS the same way the runner itself does.
--
-- The service-role key is fetched from Vault instead of being pasted into
-- SQL — that's the supported Supabase pattern. Before running this:
--   1. Set the secret in Vault:
--      select vault.create_secret('<SERVICE_ROLE_KEY_VALUE>', 'scheduled_actions_service_key');
--   2. Then run this migration.
-- If Vault isn't available, the `select` version at the bottom is a manual
-- one-shot that can be invoked from an admin terminal.
--
-- Idempotent — re-running updates the schedule without duplicating jobs.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper: the Supabase project URL. Update the hostname to match yours.
create or replace function scheduled_actions_runner_url()
returns text language sql immutable as $$
  select 'https://rjkniqiqdtroeholxacg.supabase.co/functions/v1/scheduled-action-runner';
$$;

-- The actual tick: POST to the edge fn. Uses net.http_post (pg_net).
-- Service-role key is pulled from vault. If the secret isn't set, the cron
-- job will silently no-op — check pg_net's response table for diagnostics.
create or replace function tick_scheduled_actions()
returns void
language plpgsql
security definer
as $$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'scheduled_actions_service_key'
  limit 1;

  if service_key is null then
    raise notice 'scheduled_actions_service_key not in vault; skipping tick';
    return;
  end if;

  perform net.http_post(
    url := scheduled_actions_runner_url(),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
end;
$$;

-- Unschedule old version (in case we're re-running) then schedule fresh.
do $$
begin
  perform cron.unschedule('tick_scheduled_actions');
  exception when others then null;
end $$;

select cron.schedule(
  'tick_scheduled_actions',
  '* * * * *',                                 -- every minute
  $cron$select tick_scheduled_actions();$cron$
);

-- Sanity check you can run manually:
--   select tick_scheduled_actions();
--
-- Inspect recent HTTP calls:
--   select id, status_code, created
--   from net._http_response
--   where url like '%scheduled-action-runner%'
--   order by created desc
--   limit 10;
--
-- Pause the cron without removing:
--   update cron.job set active = false where jobname = 'tick_scheduled_actions';
