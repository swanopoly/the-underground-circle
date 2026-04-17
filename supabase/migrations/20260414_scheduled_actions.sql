-- ─────────────────────────────────────────────────────────────────────────────
-- Scheduled Actions
-- ─────────────────────────────────────────────────────────────────────────────
-- Unified queue for any action an agent (or the user directly) wants to fire
-- at a future time or right away. Every concrete connector (Bluesky, X,
-- Gmail send, WordPress non-native scheduling, future social providers) stores
-- its work here and a single edge function is the executor. This gives us:
--
--   * One place to see "what's about to happen" (the Pending Actions Outbox)
--   * One place to cancel / retry / audit
--   * Per-kind executors stay tiny (just a function per `kind`)
--   * HITL approvals can gate any action uniformly (re-use agent_approvals)
--
-- Run once via Supabase SQL Editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists scheduled_actions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  circle_id       uuid references circles(id) on delete set null,
  kind            text not null check (kind in (
    'wp_post','bluesky_post','tweet','linkedin_post',
    'gmail_send','gmail_draft','outlook_send','slack_post',
    'webhook','reminder'
  )),
  status          text not null default 'pending' check (status in (
    'pending','running','succeeded','failed','canceled'
  )),
  payload         jsonb not null default '{}'::jsonb,
  scheduled_for   timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  result          jsonb,
  error           text,
  retry_count     int not null default 0,
  max_retries     int not null default 3,
  requires_approval boolean not null default false,
  approval_id     uuid references agent_approvals(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_scheduled_actions_due
  on scheduled_actions(status, scheduled_for)
  where status = 'pending';

create index if not exists idx_scheduled_actions_user_recent
  on scheduled_actions(user_id, created_at desc);

create index if not exists idx_scheduled_actions_circle_recent
  on scheduled_actions(circle_id, created_at desc)
  where circle_id is not null;

-- Keep updated_at fresh on every mutation
create or replace function scheduled_actions_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_scheduled_actions_touch on scheduled_actions;
create trigger trg_scheduled_actions_touch
before update on scheduled_actions
for each row execute procedure scheduled_actions_touch();

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table scheduled_actions enable row level security;

-- Read: owner sees their own, circle members see circle-scoped (for shared
-- visibility of what's queued). Use the SECURITY DEFINER helper from the
-- chat_threads migration to avoid the recursive circle_members RLS.
drop policy if exists scheduled_actions_read on scheduled_actions;
create policy scheduled_actions_read on scheduled_actions for select
  using (
    user_id = auth.uid()
    or (circle_id is not null and user_is_circle_member(circle_id))
  );

-- Insert: only as yourself, only into a circle you belong to (or no circle)
drop policy if exists scheduled_actions_insert on scheduled_actions;
create policy scheduled_actions_insert on scheduled_actions for insert
  with check (
    user_id = auth.uid()
    and (circle_id is null or user_is_circle_member(circle_id))
  );

-- Update: owner only (cancel, retry-ask). The edge function uses the service
-- role and bypasses RLS, so the runner itself doesn't need a policy.
drop policy if exists scheduled_actions_update on scheduled_actions;
create policy scheduled_actions_update on scheduled_actions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists scheduled_actions_delete on scheduled_actions;
create policy scheduled_actions_delete on scheduled_actions for delete
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
