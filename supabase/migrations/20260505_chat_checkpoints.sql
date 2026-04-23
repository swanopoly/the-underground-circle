-- chat_checkpoints — Phase CA-7 of CHAT_AUTOMATION_AUDIT_PLAN.
--
-- Captures a before/after snapshot of a destructive chat tool call
-- (memory.write, skill.write, automation.create to start) so a user
-- can click Restore in the chat UI and we can invert the write via a
-- per-kind handler in `src/lib/chatCheckpoints.ts`.
--
-- Design notes:
-- - Scope is per-circle; RLS mirrors `agent_runs` (circle members can
--   read; service role writes; restore happens through the edge path).
-- - `before_json` / `after_json` are opaque JSONB — the per-kind
--   restore handler knows the shape. Keeping them opaque avoids
--   coupling the table to any one table's schema.
-- - `tool_kind` is the stable identifier the handler registry keys on.
--   Adding a new reversible tool = add a row handler in chatCheckpoints.
-- - `plan_id` is the `agent_approvals` idempotency key (so chains of
--   checkpoints from one chat turn group cleanly in the UI).
-- - `restored_at` is null until a restore runs; restoring writes a
--   timestamp but preserves the row so the ledger stays honest.

create extension if not exists pgcrypto;

create table if not exists chat_checkpoints (
  id              uuid primary key default gen_random_uuid(),
  circle_id       uuid not null references circles(id) on delete cascade,
  session_key     text,
  plan_id         text,
  tool_kind       text not null,
  target_kind     text,                       -- e.g. 'circle_memory', 'circle_skills', 'circle_automations'
  target_id       text,                       -- the row id that was mutated (string so it fits uuid + int)
  before_json     jsonb not null default '{}'::jsonb,
  after_json      jsonb not null default '{}'::jsonb,
  diff_summary    text,                       -- human-readable one-liner for the chat UI
  hash_before     text,                       -- sha256 of before_json for tamper detection
  hash_after      text,                       -- sha256 of after_json at commit time
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  restored_at     timestamptz,
  restored_by     uuid references auth.users(id) on delete set null,
  restore_error   text
);

create index if not exists idx_chat_checkpoints_circle_created
  on chat_checkpoints (circle_id, created_at desc);
create index if not exists idx_chat_checkpoints_plan
  on chat_checkpoints (circle_id, plan_id) where plan_id is not null;
create index if not exists idx_chat_checkpoints_tool_kind
  on chat_checkpoints (circle_id, tool_kind, created_at desc);

alter table chat_checkpoints enable row level security;

drop policy if exists "chat_checkpoints_read" on chat_checkpoints;
create policy "chat_checkpoints_read"
  on chat_checkpoints for select
  using (
    exists (
      select 1 from circle_members cm
      where cm.circle_id = chat_checkpoints.circle_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "chat_checkpoints_insert" on chat_checkpoints;
create policy "chat_checkpoints_insert"
  on chat_checkpoints for insert
  with check (
    exists (
      select 1 from circle_members cm
      where cm.circle_id = chat_checkpoints.circle_id
        and cm.user_id = auth.uid()
    )
  );

-- Only allow updates to `restored_at`, `restored_by`, `restore_error` —
-- the snapshot itself is immutable. Enforced via a column-grant trigger
-- so clients can't tamper with before/after after commit.
drop policy if exists "chat_checkpoints_restore_update" on chat_checkpoints;
create policy "chat_checkpoints_restore_update"
  on chat_checkpoints for update
  using (
    exists (
      select 1 from circle_members cm
      where cm.circle_id = chat_checkpoints.circle_id
        and cm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from circle_members cm
      where cm.circle_id = chat_checkpoints.circle_id
        and cm.user_id = auth.uid()
    )
  );

create or replace function chat_checkpoints_enforce_immutable()
returns trigger language plpgsql as $$
begin
  -- allow flipping restore fields + restore_error; refuse anything else.
  if (
    new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.session_key is distinct from old.session_key
    or new.plan_id is distinct from old.plan_id
    or new.tool_kind is distinct from old.tool_kind
    or new.target_kind is distinct from old.target_kind
    or new.target_id is distinct from old.target_id
    or new.before_json is distinct from old.before_json
    or new.after_json is distinct from old.after_json
    or new.diff_summary is distinct from old.diff_summary
    or new.hash_before is distinct from old.hash_before
    or new.hash_after is distinct from old.hash_after
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'chat_checkpoints snapshot is immutable after commit';
  end if;
  return new;
end
$$;

drop trigger if exists chat_checkpoints_immutable_trg on chat_checkpoints;
create trigger chat_checkpoints_immutable_trg
  before update on chat_checkpoints
  for each row execute function chat_checkpoints_enforce_immutable();

grant select, insert, update on chat_checkpoints to authenticated;

-- Schema reload for PostgREST.
notify pgrst, 'reload schema';
