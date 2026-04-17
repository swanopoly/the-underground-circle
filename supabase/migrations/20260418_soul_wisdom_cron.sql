-- pg_cron: run `distil-soul-wisdom` weekly to refresh all stale (circle, SOUL)
-- wisdom blocks. Uses the same Vault secret as `scheduled-action-runner`:
--   scheduled_actions_service_key  (set via vault.create_secret once)
--
-- Schedule: every Sunday at 04:17 UTC (quiet time, off-peak). The edge fn
-- itself filters to entries with freshness in (never, stale, aged) so the
-- weekly sweep only hits rows that actually need work.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function soul_wisdom_runner_url()
returns text language sql immutable as $$
  select 'https://rjkniqiqdtroeholxacg.supabase.co/functions/v1/distil-soul-wisdom';
$$;

create or replace function tick_soul_wisdom()
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
    raise notice 'scheduled_actions_service_key not in vault; skipping soul wisdom tick';
    return;
  end if;

  perform net.http_post(
    url := soul_wisdom_runner_url(),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object('refreshAll', true)
  );
end;
$$;

do $$
begin
  perform cron.unschedule('tick_soul_wisdom');
  exception when others then null;
end $$;

select cron.schedule(
  'tick_soul_wisdom',
  '17 4 * * 0',                                -- Sunday 04:17 UTC
  $cron$select tick_soul_wisdom();$cron$
);

-- Manual kick (run from SQL editor any time):
--   select tick_soul_wisdom();
--
-- Recent HTTP calls:
--   select id, status_code, created, content
--   from net._http_response
--   where url like '%distil-soul-wisdom%'
--   order by created desc
--   limit 10;
