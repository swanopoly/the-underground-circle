-- Daily research-agent run audit log for automated wiki / SOUL knowledge updates.
-- The actual knowledge lands in `research_documents`; this table tracks the
-- daily agent-style ingestion runs so we can inspect failures and output volume.

create table if not exists research_agent_runs (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null,
  source text not null default 'daily_cron',
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  run_date date not null default current_date,
  query text,
  target_spirits text[] not null default '{}'::text[],
  documents_created int not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_agent_runs_profile_date
  on research_agent_runs(profile_key, run_date desc, created_at desc);

create index if not exists idx_research_agent_runs_status
  on research_agent_runs(status, created_at desc);

alter table research_agent_runs enable row level security;

drop policy if exists research_agent_runs_select on research_agent_runs;
create policy research_agent_runs_select
  on research_agent_runs
  for select
  to authenticated
  using (true);

notify pgrst, 'reload schema';
