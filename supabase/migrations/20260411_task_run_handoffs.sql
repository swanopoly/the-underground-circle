create table if not exists task_run_handoffs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  orchestrator_run_id uuid references task_runs(id) on delete cascade,
  from_task_run_id uuid references task_runs(id) on delete set null,
  from_agent_id text not null,
  from_agent_name text,
  to_agent_id text,
  to_agent_name text,
  handoff_kind text not null default 'collaboration' check (handoff_kind in ('collaboration', 'review', 'resume')),
  objective text,
  summary text,
  blockers text[] default '{}'::text[],
  next_actions text[] default '{}'::text[],
  artifacts jsonb default '[]'::jsonb,
  deliverable_excerpt text,
  status text not null default 'pending' check (status in ('pending', 'consumed', 'superseded')),
  created_at timestamptz default now(),
  consumed_at timestamptz
);

create index if not exists idx_task_run_handoffs_task
  on task_run_handoffs(task_id, created_at desc);

create index if not exists idx_task_run_handoffs_target
  on task_run_handoffs(orchestrator_run_id, to_agent_id, status, created_at desc);

alter table task_run_handoffs enable row level security;

drop policy if exists task_run_handoffs_select on task_run_handoffs;
create policy task_run_handoffs_select
  on task_run_handoffs for select to authenticated
  using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));

drop policy if exists task_run_handoffs_insert on task_run_handoffs;
create policy task_run_handoffs_insert
  on task_run_handoffs for insert to authenticated
  with check (circle_id in (select circle_id from circle_members where user_id = auth.uid()));

drop policy if exists task_run_handoffs_update on task_run_handoffs;
create policy task_run_handoffs_update
  on task_run_handoffs for update to authenticated
  using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));

do $$
begin
  begin
    alter publication supabase_realtime add table task_run_handoffs;
  exception when duplicate_object then null;
  end;
end;
$$;

notify pgrst, 'reload schema';
