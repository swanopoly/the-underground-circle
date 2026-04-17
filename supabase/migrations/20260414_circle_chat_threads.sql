-- ─────────────────────────────────────────────────────────────────────────────
-- Circle Chat Threads
-- ─────────────────────────────────────────────────────────────────────────────
-- Sub-conversations within the per-circle chat. Three visibility modes:
--   circle  — the one default room for the whole circle (every member sees it,
--             auto-created by the backfill below)
--   private — created by a single user; only the owner sees it (until invited)
--   shared  — promoted from `private` automatically when the first non-owner
--             member is added (DB trigger handles this)
--
-- A `thread_id` column is added to `messages` so the existing chat history
-- (one big stream per circle) keeps working — each circle's NULL-thread
-- messages are migrated to its `circle`-visibility default thread by step 5.
--
-- Naming note: this is intentionally `circle_chat_threads`, NOT `chat_sessions`
-- — the latter belongs to an unrelated agent-CLI feature in
-- supabase/migrations/20260403_chat_agent_cli_pr1.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Threads table
create table if not exists circle_chat_threads (
  id              uuid primary key default gen_random_uuid(),
  circle_id       uuid not null references circles(id) on delete cascade,
  created_by      uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'New chat',
  visibility      text not null default 'private'
                  check (visibility in ('circle','private','shared')),
  default_model   text default 'auto',
  last_message_at timestamptz default now(),
  last_message_preview text,
  archived        boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_cct_circle_recent
  on circle_chat_threads(circle_id, last_message_at desc)
  where archived = false;

create index if not exists idx_cct_creator
  on circle_chat_threads(created_by, last_message_at desc);

-- Exactly one circle-wide default thread per circle
create unique index if not exists idx_cct_circle_default
  on circle_chat_threads(circle_id) where visibility = 'circle';

-- 2. Per-thread membership (used for private/shared visibility)
create table if not exists circle_chat_thread_members (
  thread_id  uuid not null references circle_chat_threads(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','member')),
  added_by   uuid references auth.users(id) on delete set null,
  added_at   timestamptz default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_cct_members_user
  on circle_chat_thread_members(user_id, thread_id);

-- 3. Tag every existing/new message with its thread
alter table messages
  add column if not exists thread_id uuid references circle_chat_threads(id) on delete cascade;

create index if not exists idx_messages_thread_recent
  on messages(thread_id, created_at desc)
  where thread_id is not null;

-- 4. Helper: can current user see this thread?
create or replace function user_can_see_chat_thread(p_thread_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists(
    select 1
    from circle_chat_threads t
    where t.id = p_thread_id
      and (
        (t.visibility = 'circle' and exists(
            select 1 from circle_members cm
            where cm.circle_id = t.circle_id and cm.user_id = auth.uid()))
        or t.created_by = auth.uid()
        or exists(
            select 1 from circle_chat_thread_members tm
            where tm.thread_id = t.id and tm.user_id = auth.uid())
      )
  );
$$;

-- 5. Backfill: every circle gets its single default `circle` thread, then
-- migrate all NULL-thread messages to that thread.
do $$
declare c record;
declare new_thread_id uuid;
declare seed_owner uuid;
begin
  for c in select id from circles loop
    select id into new_thread_id from circle_chat_threads
      where circle_id = c.id and visibility = 'circle' limit 1;
    if new_thread_id is null then
      select user_id into seed_owner from circle_members
        where circle_id = c.id order by joined_at asc nulls last limit 1;
      if seed_owner is null then
        select created_by into seed_owner from circles where id = c.id;
      end if;
      if seed_owner is not null then
        insert into circle_chat_threads (circle_id, created_by, title, visibility)
        values (c.id, seed_owner, 'Circle Chat', 'circle')
        returning id into new_thread_id;
      end if;
    end if;
    if new_thread_id is not null then
      update messages set thread_id = new_thread_id
      where circle_id = c.id and thread_id is null;
    end if;
  end loop;
end $$;

-- 6. Trigger: keep last_message_at + preview fresh whenever a message lands
create or replace function circle_chat_threads_touch_on_message()
returns trigger
language plpgsql
as $$
begin
  if new.thread_id is not null then
    update circle_chat_threads
    set last_message_at = new.created_at,
        last_message_preview = left(coalesce(new.content, ''), 140),
        updated_at = now()
    where id = new.thread_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cct_touch on messages;
create trigger trg_cct_touch
after insert on messages
for each row execute procedure circle_chat_threads_touch_on_message();

-- 7. RLS
alter table circle_chat_threads enable row level security;
alter table circle_chat_thread_members enable row level security;

drop policy if exists cct_read on circle_chat_threads;
create policy cct_read on circle_chat_threads for select
  using (user_can_see_chat_thread(id));

drop policy if exists cct_insert on circle_chat_threads;
create policy cct_insert on circle_chat_threads for insert
  with check (
    auth.uid() = created_by
    and exists(
      select 1 from circle_members cm
      where cm.circle_id = circle_chat_threads.circle_id
        and cm.user_id = auth.uid()
    )
    -- Only client-side `private`/`shared` threads. The single `circle` thread
    -- is owned by the backfill above.
    and visibility in ('private','shared')
  );

drop policy if exists cct_update on circle_chat_threads;
create policy cct_update on circle_chat_threads for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists cct_delete on circle_chat_threads;
create policy cct_delete on circle_chat_threads for delete
  using (created_by = auth.uid() and visibility != 'circle');

drop policy if exists cct_members_read on circle_chat_thread_members;
create policy cct_members_read on circle_chat_thread_members for select
  using (user_can_see_chat_thread(thread_id));

drop policy if exists cct_members_insert on circle_chat_thread_members;
create policy cct_members_insert on circle_chat_thread_members for insert
  with check (
    exists(
      select 1 from circle_chat_threads t
      where t.id = circle_chat_thread_members.thread_id
        and t.created_by = auth.uid()
    )
  );

drop policy if exists cct_members_delete on circle_chat_thread_members;
create policy cct_members_delete on circle_chat_thread_members for delete
  using (
    user_id = auth.uid()
    or exists(
      select 1 from circle_chat_threads t
      where t.id = circle_chat_thread_members.thread_id
        and t.created_by = auth.uid()
    )
  );

-- 8. Auto-promote `private` → `shared` when first non-owner is added.
-- Demote when last non-owner leaves.
create or replace function cct_visibility_sync()
returns trigger
language plpgsql
as $$
declare other_count int;
declare target_thread uuid;
begin
  if (tg_op = 'INSERT') then target_thread := new.thread_id;
  else                       target_thread := old.thread_id;
  end if;
  select count(*) into other_count
    from circle_chat_thread_members tm
    join circle_chat_threads t on t.id = tm.thread_id
    where tm.thread_id = target_thread and tm.user_id != t.created_by;
  if (tg_op = 'INSERT' and other_count > 0) then
    update circle_chat_threads set visibility = 'shared', updated_at = now()
      where id = target_thread and visibility = 'private';
  elsif (tg_op = 'DELETE' and other_count = 0) then
    update circle_chat_threads set visibility = 'private', updated_at = now()
      where id = target_thread and visibility = 'shared';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_cct_vis_sync_ins on circle_chat_thread_members;
create trigger trg_cct_vis_sync_ins
after insert on circle_chat_thread_members
for each row execute procedure cct_visibility_sync();

drop trigger if exists trg_cct_vis_sync_del on circle_chat_thread_members;
create trigger trg_cct_vis_sync_del
after delete on circle_chat_thread_members
for each row execute procedure cct_visibility_sync();

-- 9. Refresh PostgREST schema cache
notify pgrst, 'reload schema';
