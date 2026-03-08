-- Goals table
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references circles(id) on delete cascade not null,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active','paused','completed')),
  assigned_agent_ids jsonb default '[]'::jsonb,
  target_count int default 0,
  created_by uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add goal_id to tasks
alter table tasks add column if not exists goal_id uuid references goals(id) on delete set null;

-- RLS
alter table goals enable row level security;

create policy "circle members can manage goals"
  on goals for all
  using (
    exists (
      select 1 from circle_members
      where circle_members.circle_id = goals.circle_id
      and circle_members.user_id = auth.uid()
    )
  );

-- Indexes
create index if not exists tasks_goal_id_idx on tasks(goal_id);
create index if not exists goals_circle_id_idx on goals(circle_id);

-- Peer review tracking
alter table tasks add column if not exists peer_approvals jsonb default '[]'::jsonb;

-- Goal-based task generation tracking
alter table goals add column if not exists auto_task_count int default 0;
alter table goals add column if not exists auto_task_frequency text default 'day' check (auto_task_frequency in ('day', 'week'));
alter table goals add column if not exists last_auto_task_at timestamptz;
