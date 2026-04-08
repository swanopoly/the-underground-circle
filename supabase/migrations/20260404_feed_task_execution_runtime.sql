-- Task Capability Profiles — reusable capability bundles
create table if not exists task_capability_profiles (
  key text primary key,
  label text not null,
  capabilities jsonb not null default '[]'::jsonb,
  defaults jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Seed 5 profiles
insert into task_capability_profiles (key, label, capabilities, defaults) values
  ('research_basic', 'Research & Analysis', '["search","fetch","comment"]'::jsonb, '{"required_artifacts":["report"],"approval_required":false}'::jsonb),
  ('ui_design', 'UI/UX Design', '["image_generate","figma_inspect","visual_artifact"]'::jsonb, '{"required_artifacts":["image","design_spec"],"approval_required":false,"checks":["design_handoff","human_review"]}'::jsonb),
  ('frontend_build', 'Frontend Build', '["code_read","code_patch","static_analysis","test_run"]'::jsonb, '{"required_artifacts":["code_patch"],"approval_required":false,"checks":["test_pass","human_review"]}'::jsonb),
  ('browser_qa', 'Browser QA', '["browser_open","browser_navigate","screenshot_capture"]'::jsonb, '{"required_artifacts":["screenshot"],"approval_required":false,"checks":["browser_check"]}'::jsonb),
  ('room_curator', 'Room Curator', '["room_file_read","patch_propose"]'::jsonb, '{"required_artifacts":["code_patch"],"approval_required":true,"checks":["room_patch_review"]}'::jsonb)
on conflict (key) do nothing;

-- Task run steps — durable ledger of what happened during execution
create table if not exists task_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  task_id uuid not null,
  circle_id uuid not null references circles(id) on delete cascade,
  step_index int not null default 0,
  step_kind text not null check (step_kind in ('plan','execution','tool_call','artifact_create','check_eval','approval_request','finalize','error')),
  status text not null default 'pending' check (status in ('pending','running','completed','failed','skipped')),
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Task run artifacts — typed outputs from agent execution
create table if not exists task_run_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  task_id uuid not null,
  circle_id uuid not null references circles(id) on delete cascade,
  artifact_kind text not null check (artifact_kind in ('code_patch','file','image','screenshot','design_spec','doc','copy','link','report','test_result')),
  label text not null,
  url text,
  file_path text,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Task acceptance checks — requirements that must pass for completion
create table if not exists task_acceptance_checks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  circle_id uuid not null references circles(id) on delete cascade,
  check_kind text not null check (check_kind in ('artifact_present','test_pass','human_review','design_handoff','browser_check','room_patch_review','custom')),
  label text not null,
  is_required boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Task run check results — pass/fail per check per run
create table if not exists task_run_check_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  check_id uuid not null references task_acceptance_checks(id) on delete cascade,
  task_id uuid not null,
  circle_id uuid not null references circles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','passed','failed','skipped')),
  evidence jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz,
  created_at timestamptz not null default now()
);

-- Task run approvals — gates for risky actions
create table if not exists task_run_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  task_id uuid not null,
  circle_id uuid not null references circles(id) on delete cascade,
  approval_kind text not null check (approval_kind in ('room_patch_apply','repo_write','external_publish','destructive_edit','high_cost_generation')),
  title text not null,
  summary text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  requested_by uuid references auth.users(id),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Add columns to tasks table
alter table tasks add column if not exists task_type text default 'mixed' check (task_type in ('code_change','design_work','ui_qa','research','content','ops','room_update','mixed'));
alter table tasks add column if not exists capability_profile_key text references task_capability_profiles(key);
alter table tasks add column if not exists execution_config jsonb default '{}'::jsonb;
alter table tasks add column if not exists output_target jsonb default '{}'::jsonb;

-- Indexes
create index if not exists idx_task_run_steps_run on task_run_steps(run_id, step_index);
create index if not exists idx_task_run_artifacts_run on task_run_artifacts(run_id);
create index if not exists idx_task_acceptance_checks_task on task_acceptance_checks(task_id);
create index if not exists idx_task_run_check_results_run on task_run_check_results(run_id);
create index if not exists idx_task_run_approvals_run on task_run_approvals(run_id);

-- RLS
alter table task_capability_profiles enable row level security;
alter table task_run_steps enable row level security;
alter table task_run_artifacts enable row level security;
alter table task_acceptance_checks enable row level security;
alter table task_run_check_results enable row level security;
alter table task_run_approvals enable row level security;

-- Everyone can read profiles
create policy "anyone_read_profiles" on task_capability_profiles for select using (true);

-- Circle members read/write steps, artifacts, checks, approvals
create policy "members_read_steps" on task_run_steps for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "members_insert_steps" on task_run_steps for insert with check (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "members_read_artifacts" on task_run_artifacts for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "members_insert_artifacts" on task_run_artifacts for insert with check (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "members_read_checks" on task_acceptance_checks for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "members_manage_checks" on task_acceptance_checks for all using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "members_read_check_results" on task_run_check_results for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "members_insert_check_results" on task_run_check_results for insert with check (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "members_read_approvals" on task_run_approvals for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "members_manage_approvals" on task_run_approvals for all using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));

-- Realtime
alter publication supabase_realtime add table task_run_steps;
alter publication supabase_realtime add table task_run_artifacts;
alter publication supabase_realtime add table task_run_approvals;
alter publication supabase_realtime add table task_run_check_results;
