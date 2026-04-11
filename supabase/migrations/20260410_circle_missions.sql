-- Circle Missions — the core accountability loop
-- See docs/NEXT_LEVEL_PLAN.md Phase 1.1

-- ─── circle_missions ─────────────────────────────────────────────────────────
create table if not exists circle_missions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  title text not null,
  description text,
  owner_id uuid not null references auth.users(id),
  status text not null default 'active'
    check (status in ('draft', 'active', 'completed', 'archived')),
  deadline timestamptz,
  template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_circle_missions_circle on circle_missions(circle_id);
create index idx_circle_missions_status on circle_missions(circle_id, status);

-- ─── mission_tasks ───────────────────────────────────────────────────────────
create table if not exists mission_tasks (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references circle_missions(id) on delete cascade,
  title text not null,
  description text,
  assignee_id uuid references auth.users(id),
  agent_name text,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'blocked')),
  sort_order int not null default 0,
  evidence jsonb not null default '[]',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_mission_tasks_mission on mission_tasks(mission_id);

-- ─── mission_agents ──────────────────────────────────────────────────────────
create table if not exists mission_agents (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references circle_missions(id) on delete cascade,
  agent_name text not null,
  role text not null default 'executor'
    check (role in ('monitor', 'executor', 'reviewer')),
  assigned_at timestamptz not null default now(),
  unique(mission_id, agent_name)
);

create index idx_mission_agents_mission on mission_agents(mission_id);

-- ─── proof_of_work ───────────────────────────────────────────────────────────
create table if not exists proof_of_work (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  mission_id uuid references circle_missions(id) on delete set null,
  user_id uuid references auth.users(id),
  agent_name text,
  pow_type text not null
    check (pow_type in ('commit', 'pr', 'deploy', 'agent_run', 'checkin', 'manual')),
  title text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_proof_of_work_circle on proof_of_work(circle_id, created_at desc);
create index idx_proof_of_work_mission on proof_of_work(mission_id) where mission_id is not null;

-- ─── RLS policies ────────────────────────────────────────────────────────────
alter table circle_missions enable row level security;
alter table mission_tasks enable row level security;
alter table mission_agents enable row level security;
alter table proof_of_work enable row level security;

-- circle_missions: circle members can read; members can create; owner can update/delete
create policy "cm_select" on circle_missions for select using (
  circle_id in (select circle_id from circle_members where user_id = auth.uid())
);
create policy "cm_insert" on circle_missions for insert with check (
  circle_id in (select circle_id from circle_members where user_id = auth.uid())
  and owner_id = auth.uid()
);
create policy "cm_update" on circle_missions for update using (
  owner_id = auth.uid()
  or circle_id in (
    select circle_id from circle_members where user_id = auth.uid() and role = 'admin'
  )
);
create policy "cm_delete" on circle_missions for delete using (
  owner_id = auth.uid()
);

-- mission_tasks: circle members of the parent mission's circle can CRUD
create policy "mt_select" on mission_tasks for select using (
  mission_id in (
    select id from circle_missions where circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);
create policy "mt_insert" on mission_tasks for insert with check (
  mission_id in (
    select id from circle_missions where circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);
create policy "mt_update" on mission_tasks for update using (
  mission_id in (
    select id from circle_missions where circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);
create policy "mt_delete" on mission_tasks for delete using (
  mission_id in (
    select id from circle_missions where circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);

-- mission_agents: same as tasks
create policy "ma_select" on mission_agents for select using (
  mission_id in (
    select id from circle_missions where circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);
create policy "ma_insert" on mission_agents for insert with check (
  mission_id in (
    select id from circle_missions where circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);
create policy "ma_delete" on mission_agents for delete using (
  mission_id in (
    select id from circle_missions where circle_id in (
      select circle_id from circle_members where user_id = auth.uid()
    )
  )
);

-- proof_of_work: circle members can read and create
create policy "pow_select" on proof_of_work for select using (
  circle_id in (select circle_id from circle_members where user_id = auth.uid())
);
create policy "pow_insert" on proof_of_work for insert with check (
  circle_id in (select circle_id from circle_members where user_id = auth.uid())
);

-- ─── updated_at trigger ──────────────────────────────────────────────────────
create or replace function update_mission_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_mission_updated_at
  before update on circle_missions
  for each row execute function update_mission_updated_at();

-- ─── Notify PostgREST to pick up new tables ──────────────────────────────────
notify pgrst, 'reload schema';
