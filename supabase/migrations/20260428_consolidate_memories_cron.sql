-- pg_cron: run `consolidate-memories` daily to scan recent captures for
-- contradictions and auto-quarantine the loser. Mirrors the soul-wisdom
-- pattern — same Vault secret, same logging.
--
-- Schedule: every day at 03:23 UTC (quiet time, no overlap with other
-- scheduled jobs). The edge fn itself caps the scan at 200 new memories
-- per circle per run, so the work stays bounded even on high-volume
-- circles.
--
-- Spec: docs/superpowers/specs/2026-04-28-memory-inspect-control-design.md

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function consolidate_memories_runner_url()
returns text language sql immutable as $$
  select 'https://rjkniqiqdtroeholxacg.supabase.co/functions/v1/consolidate-memories';
$$;

create or replace function tick_consolidate_memories()
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
    raise notice 'scheduled_actions_service_key not in vault; skipping consolidate memories tick';
    return;
  end if;

  perform net.http_post(
    url := consolidate_memories_runner_url(),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object('lookbackHours', 24)
  );
end;
$$;

do $$
begin
  perform cron.unschedule('tick_consolidate_memories');
  exception when others then null;
end $$;

select cron.schedule(
  'tick_consolidate_memories',
  '23 3 * * *',                                  -- daily 03:23 UTC
  $cron$select tick_consolidate_memories();$cron$
);

-- Manual kick (run from SQL editor any time):
--   select tick_consolidate_memories();
--
-- Recent HTTP calls:
--   select id, status_code, created, content
--   from net._http_response
--   where url like '%consolidate-memories%'
--   order by created desc
--   limit 10;
--
-- Per-circle one-shot from edge fn directly (skip the cron):
--   curl -X POST https://<project>.supabase.co/functions/v1/consolidate-memories \
--     -H "Authorization: Bearer <service-role-key>" \
--     -H "Content-Type: application/json" \
--     -d '{"circleId":"<uuid>","lookbackHours":48}'
