-- Agent Plan Mode
--
-- First-class persisted plans for Chat/SwanBot/OpenSwan. These plans sit
-- above execution: a chat request can become a durable, reviewable plan
-- before browser, desktop, terminal, vault, or code tools are allowed to act.

create extension if not exists pgcrypto;

create table if not exists public.agent_plans (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null,
  thread_id text,
  source_message_id text,
  created_by uuid,
  title text not null,
  task text not null,
  mode text not null default 'plan'
    check (mode in ('plan', 'ask', 'agent', 'manual')),
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'approved', 'building', 'completed', 'archived', 'blocked')),
  risk text not null default 'safe'
    check (risk in ('safe', 'review', 'external_side_effect', 'destructive')),
  summary text,
  confidence numeric(4,3) not null default 0,
  selected_model text,
  build_ready boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.agent_plans(id) on delete cascade,
  circle_id uuid not null,
  step_order int not null,
  kind text not null
    check (kind in (
      'clarify', 'research', 'context', 'design', 'implement', 'browser',
      'desktop', 'terminal', 'mcp', 'review', 'verify', 'checkpoint', 'approval'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'running', 'completed', 'blocked', 'skipped')),
  title text not null,
  detail text,
  tool_names text[] not null default '{}'::text[],
  target_refs text[] not null default '{}'::text[],
  requires_approval boolean not null default false,
  checkpoint_policy text not null default 'before_write',
  estimated_effort text,
  acceptance text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, step_order)
);

create table if not exists public.agent_plan_questions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.agent_plans(id) on delete cascade,
  circle_id uuid not null,
  question_order int not null,
  question text not null,
  why text,
  status text not null default 'open'
    check (status in ('open', 'answered', 'skipped')),
  answer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, question_order)
);

create table if not exists public.agent_plan_artifacts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.agent_plans(id) on delete cascade,
  circle_id uuid not null,
  kind text not null
    check (kind in ('summary', 'decision', 'research', 'diff', 'checkpoint', 'receipt', 'note')),
  title text not null,
  content text,
  url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_plans_circle_status
  on public.agent_plans(circle_id, status, updated_at desc);
create index if not exists idx_agent_plans_thread
  on public.agent_plans(circle_id, thread_id, updated_at desc)
  where thread_id is not null;
create index if not exists idx_agent_plan_steps_plan
  on public.agent_plan_steps(plan_id, step_order);
create index if not exists idx_agent_plan_questions_plan
  on public.agent_plan_questions(plan_id, question_order);
create index if not exists idx_agent_plan_artifacts_plan
  on public.agent_plan_artifacts(plan_id, created_at desc);

create or replace function public.agent_plan_mode_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists agent_plans_touch_updated_at on public.agent_plans;
create trigger agent_plans_touch_updated_at
  before update on public.agent_plans
  for each row execute function public.agent_plan_mode_touch_updated_at();

drop trigger if exists agent_plan_steps_touch_updated_at on public.agent_plan_steps;
create trigger agent_plan_steps_touch_updated_at
  before update on public.agent_plan_steps
  for each row execute function public.agent_plan_mode_touch_updated_at();

drop trigger if exists agent_plan_questions_touch_updated_at on public.agent_plan_questions;
create trigger agent_plan_questions_touch_updated_at
  before update on public.agent_plan_questions
  for each row execute function public.agent_plan_mode_touch_updated_at();

alter table public.agent_plans enable row level security;
alter table public.agent_plan_steps enable row level security;
alter table public.agent_plan_questions enable row level security;
alter table public.agent_plan_artifacts enable row level security;

drop policy if exists "agent_plans_member_read" on public.agent_plans;
create policy "agent_plans_member_read"
  on public.agent_plans for select to authenticated
  using (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plans.circle_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "agent_plans_member_insert" on public.agent_plans;
create policy "agent_plans_member_insert"
  on public.agent_plans for insert to authenticated
  with check (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plans.circle_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "agent_plans_member_update" on public.agent_plans;
create policy "agent_plans_member_update"
  on public.agent_plans for update to authenticated
  using (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plans.circle_id
        and cm.user_id = auth.uid()
    )
  )
  with check (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plans.circle_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "agent_plan_steps_member_all" on public.agent_plan_steps;
create policy "agent_plan_steps_member_all"
  on public.agent_plan_steps for all to authenticated
  using (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plan_steps.circle_id
        and cm.user_id = auth.uid()
    )
  )
  with check (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plan_steps.circle_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "agent_plan_questions_member_all" on public.agent_plan_questions;
create policy "agent_plan_questions_member_all"
  on public.agent_plan_questions for all to authenticated
  using (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plan_questions.circle_id
        and cm.user_id = auth.uid()
    )
  )
  with check (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plan_questions.circle_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "agent_plan_artifacts_member_all" on public.agent_plan_artifacts;
create policy "agent_plan_artifacts_member_all"
  on public.agent_plan_artifacts for all to authenticated
  using (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plan_artifacts.circle_id
        and cm.user_id = auth.uid()
    )
  )
  with check (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.circle_members cm
      where cm.circle_id = agent_plan_artifacts.circle_id
        and cm.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.agent_plans to authenticated;
grant select, insert, update, delete on public.agent_plan_steps to authenticated;
grant select, insert, update, delete on public.agent_plan_questions to authenticated;
grant select, insert, update, delete on public.agent_plan_artifacts to authenticated;

notify pgrst, 'reload schema';
