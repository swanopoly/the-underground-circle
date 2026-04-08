-- Chat Agent CLI PR1: Session/Run backbone for agent-native ChatTab
-- Tables: chat_sessions, chat_entries, chat_runs, chat_run_steps, chat_run_artifacts, chat_run_approvals, chat_session_context_sources

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'active'
    check (status in ('active', 'running', 'paused', 'completed', 'failed', 'archived')),
  mode text not null default 'talk'
    check (mode in ('talk', 'plan', 'execute', 'review')),
  target_kind text not null default 'blackswan'
    check (target_kind in ('blackswan', 'office-agent', 'shared-agent')),
  target_agent_id uuid references circle_office_agents(id) on delete set null,
  model text,
  is_pinned boolean not null default false,
  last_entry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system')),
  entry_type text not null default 'message'
    check (entry_type in ('message', 'summary', 'notice', 'run-link', 'approval-link')),
  content text not null default '',
  reply_to_entry_id uuid references chat_entries(id) on delete set null,
  parent_entry_id uuid references chat_entries(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  triggering_entry_id uuid references chat_entries(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  target_kind text not null check (target_kind in ('blackswan', 'office-agent', 'shared-agent')),
  target_agent_id uuid references circle_office_agents(id) on delete set null,
  target_label text not null,
  mode text not null check (mode in ('talk', 'plan', 'execute', 'review')),
  model text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  summary text,
  error_text text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references chat_runs(id) on delete cascade,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  step_kind text not null check (step_kind in ('thought', 'tool', 'output', 'status', 'approval', 'error')),
  title text not null,
  body text,
  status text not null default 'completed' check (status in ('pending', 'running', 'completed', 'failed')),
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_run_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references chat_runs(id) on delete cascade,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  artifact_kind text not null check (artifact_kind in ('text', 'link', 'file', 'diff', 'summary')),
  title text not null,
  content text,
  url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_run_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references chat_runs(id) on delete cascade,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  approval_kind text not null check (approval_kind in ('execute', 'external-write', 'message-send', 'sensitive-access')),
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_session_context_sources (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  source_kind text not null check (source_kind in ('tasks', 'goals', 'room', 'github', 'members', 'files', 'activity', 'custom')),
  source_ref text,
  is_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_chat_sessions_circle_last_entry on chat_sessions (circle_id, last_entry_at desc);
create index if not exists idx_chat_entries_session_created on chat_entries (session_id, created_at asc);
create index if not exists idx_chat_runs_session_created on chat_runs (session_id, created_at desc);
create index if not exists idx_chat_run_steps_run_sort on chat_run_steps (run_id, sort_order asc, created_at asc);
create index if not exists idx_chat_run_artifacts_run_created on chat_run_artifacts (run_id, created_at asc);
create index if not exists idx_chat_run_approvals_run_created on chat_run_approvals (run_id, created_at asc);
create index if not exists idx_chat_session_context_sources_session_created on chat_session_context_sources (session_id, created_at asc);

-- RLS
alter table chat_sessions enable row level security;
alter table chat_entries enable row level security;
alter table chat_runs enable row level security;
alter table chat_run_steps enable row level security;
alter table chat_run_artifacts enable row level security;
alter table chat_run_approvals enable row level security;
alter table chat_session_context_sources enable row level security;

-- Circle members can read all tables
create policy "circle_members_read_sessions" on chat_sessions for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "circle_members_read_entries" on chat_entries for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "circle_members_read_runs" on chat_runs for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "circle_members_read_steps" on chat_run_steps for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "circle_members_read_artifacts" on chat_run_artifacts for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "circle_members_read_approvals" on chat_run_approvals for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "circle_members_read_context" on chat_session_context_sources for select using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));

-- Owner can insert sessions, entries, runs
create policy "owner_insert_sessions" on chat_sessions for insert with check (created_by = auth.uid());
create policy "owner_insert_entries" on chat_entries for insert with check (author_user_id = auth.uid() or author_user_id is null);
create policy "owner_insert_runs" on chat_runs for insert with check (created_by = auth.uid());

-- Owner can insert steps, artifacts, approvals, context sources
create policy "owner_insert_steps" on chat_run_steps for insert with check (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "owner_insert_artifacts" on chat_run_artifacts for insert with check (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "owner_insert_approvals" on chat_run_approvals for insert with check (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "owner_insert_context" on chat_session_context_sources for insert with check (circle_id in (select circle_id from circle_members where user_id = auth.uid()));

-- Members can update their own sessions and runs
create policy "owner_update_sessions" on chat_sessions for update using (created_by = auth.uid());
create policy "owner_update_runs" on chat_runs for update using (created_by = auth.uid());
create policy "member_update_approvals" on chat_run_approvals for update using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));
create policy "member_update_context" on chat_session_context_sources for update using (circle_id in (select circle_id from circle_members where user_id = auth.uid()));

-- Enable realtime
alter publication supabase_realtime add table chat_sessions;
alter publication supabase_realtime add table chat_entries;
alter publication supabase_realtime add table chat_runs;
alter publication supabase_realtime add table chat_run_steps;
alter publication supabase_realtime add table chat_run_artifacts;
alter publication supabase_realtime add table chat_run_approvals;
alter publication supabase_realtime add table chat_session_context_sources;
