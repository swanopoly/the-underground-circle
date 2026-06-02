-- Pause the autonomous heartbeat-agent cron.
--
-- Cost guard: heartbeat-agent can call Anthropic every 30 minutes across
-- active circles. Keep it unscheduled unless explicitly re-enabled.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('heartbeat-agent');
    exception
      when others then
        raise notice 'heartbeat-agent cron was not scheduled or could not be unscheduled: %', sqlerrm;
    end;
  end if;
end $$;
