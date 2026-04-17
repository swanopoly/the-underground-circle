-- Invoke the research-daily-runner edge function three times per day.
-- Uses a Vault-backed service-role secret dedicated to the research runner.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function research_daily_runner_url()
returns text language sql immutable as $$
  select 'https://rjkniqiqdtroeholxacg.supabase.co/functions/v1/research-daily-runner';
$$;

create or replace function tick_research_daily_runner(profile_key text)
returns void
language plpgsql
security definer
as $$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name in ('research_daily_runner_service_key', 'scheduled_actions_service_key')
  order by case when name = 'research_daily_runner_service_key' then 0 else 1 end
  limit 1;

  if service_key is null then
    raise notice 'research_daily_runner_service_key not in vault; skipping research tick';
    return;
  end if;

  perform net.http_post(
    url := research_daily_runner_url(),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'source', 'pg_cron',
      'profiles', jsonb_build_array(profile_key)
    )
  );
end;
$$;

do $$
begin
  perform cron.unschedule('research_deep_learning_daily');
  exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('research_agent_systems_daily');
  exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('research_robotics_daily');
  exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('research_biotech_medical_daily');
  exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('research_open_model_infra_daily');
  exception when others then null;
end $$;

select cron.schedule(
  'research_deep_learning_daily',
  '15 8 * * *',
  $$select tick_research_daily_runner('deep_learning_frontier');$$
);

select cron.schedule(
  'research_agent_systems_daily',
  '15 13 * * *',
  $$select tick_research_daily_runner('agent_systems_and_evals');$$
);

select cron.schedule(
  'research_robotics_daily',
  '15 18 * * *',
  $$select tick_research_daily_runner('physical_ai_and_robotics');$$
);

select cron.schedule(
  'research_biotech_medical_daily',
  '45 9 * * *',
  $$select tick_research_daily_runner('biotech_and_medical_ai');$$
);

select cron.schedule(
  'research_open_model_infra_daily',
  '45 15 * * *',
  $$select tick_research_daily_runner('open_model_serving_and_infra');$$
);
