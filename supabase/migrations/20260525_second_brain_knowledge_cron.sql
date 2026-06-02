-- Digital Brain + Wiki knowledge intake cron
-- Simple first stage:
-- 1. Reuses research-daily-runner instead of adding another Edge Function.
-- 2. Runs one low-cost daily intake that stores source-backed research_documents
--    for Wiki and private/circle notes for the .web Digital Brain.
-- 3. Uses Supabase Vault for the service key and optional target user/circle.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function second_brain_knowledge_runner_url()
returns text language sql immutable as $$
  select 'https://rjkniqiqdtroeholxacg.supabase.co/functions/v1/research-daily-runner';
$$;

create or replace function tick_second_brain_knowledge_runner()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  service_key text;
  target_circle_id text;
  target_user_id text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name in ('second_brain_knowledge_service_key', 'research_daily_runner_service_key', 'scheduled_actions_service_key')
  order by case
    when name = 'second_brain_knowledge_service_key' then 0
    when name = 'research_daily_runner_service_key' then 1
    else 2
  end
  limit 1;

  if service_key is null then
    raise notice 'second_brain_knowledge_service_key not in vault; skipping second brain knowledge tick';
    return;
  end if;

  select decrypted_secret into target_circle_id
  from vault.decrypted_secrets
  where name = 'second_brain_knowledge_circle_id'
  limit 1;

  select decrypted_secret into target_user_id
  from vault.decrypted_secrets
  where name = 'second_brain_knowledge_user_id'
  limit 1;

  perform net.http_post(
    url := second_brain_knowledge_runner_url(),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_strip_nulls(jsonb_build_object(
      'action', 'seed_second_brain',
      'source', 'pg_cron_second_brain',
      'profiles', jsonb_build_array('ai_technology_watch', 'universe_science_watch', 'future_city_design'),
      'circleId', nullif(target_circle_id, ''),
      'userId', nullif(target_user_id, ''),
      'visibility', 'private'
    ))
  );
end;
$$;

create index if not exists idx_research_documents_knowledge_profile
  on research_documents((metadata->>'profile_key'), source_type, updated_at desc)
  where is_active = true;

create index if not exists idx_second_brain_notes_knowledge_key
  on circle_second_brain_notes(circle_id, created_by, (metadata->>'knowledgeKey'))
  where status <> 'archived'
    and metadata ? 'knowledgeKey';

do $$
begin
  perform cron.unschedule('second_brain_knowledge_daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'second_brain_knowledge_daily',
  '35 7 * * *',
  $$select tick_second_brain_knowledge_runner();$$
);

notify pgrst, 'reload schema';
