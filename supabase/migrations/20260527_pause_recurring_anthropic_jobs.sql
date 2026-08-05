-- Emergency pause for recurring Anthropic-capable jobs while API spend is
-- being investigated.
--
-- This intentionally targets jobs that can call Anthropic without a user
-- actively pressing Send:
--   - heartbeat-agent: autonomous Claude loop
--   - tick_soul_wisdom: weekly distillation through Anthropic when enabled
--   - run-due-automations: scheduled circle automations through automation-executor
--
-- Non-model maintenance jobs and research-daily-runner are left alone.

do $$
declare
  job_name text;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    foreach job_name in array array[
      'heartbeat-agent',
      'tick_soul_wisdom',
      'run-due-automations'
    ]
    loop
      begin
        perform cron.unschedule(job_name);
        raise notice 'unscheduled Anthropic-capable cron job: %', job_name;
      exception when others then
        raise notice 'cron job not scheduled or could not be unscheduled: % (%)', job_name, sqlerrm;
      end;
    end loop;
  else
    raise notice 'pg_cron not installed; no recurring Anthropic-capable cron jobs unscheduled';
  end if;
end $$;

-- Defense in depth: scheduled circle automations can still be retriggered if a
-- separate scheduler is reintroduced. Disable only schedule-triggered rows;
-- manual/event automations remain available.
do $$
begin
  if to_regclass('public.circle_automations') is not null then
    update public.circle_automations
    set
      enabled = false,
      last_error = coalesce(last_error || E'\n', '') || 'Paused by 20260527_pause_recurring_anthropic_jobs.sql during Anthropic spend investigation.',
      updated_at = now()
    where enabled = true
      and trigger_type = 'schedule';
  end if;
end $$;
