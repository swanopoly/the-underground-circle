-- Memory Versions — Phase 2 of the memory wiki design.
--
-- Tracks the body of each memory before every edit so users can see
-- history and revert. The application writes a version row BEFORE
-- updating memory_entries.content; a trigger isn't used because we
-- want the edit reason to be supplied by the editor.
--
-- Spec: docs/superpowers/specs/2026-04-28-memory-wiki-design.md

create table if not exists memory_versions (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references memory_entries(id) on delete cascade,
  body text not null,
  title text,                              -- snapshot in case the title was also edited
  edited_by uuid references auth.users(id),
  edited_at timestamptz not null default now(),
  edit_reason text,
  -- Useful for "show me what this memory used to say" — most-recent-first.
  created_at timestamptz not null default now()
);

create index if not exists idx_memory_versions_memory
  on memory_versions(memory_id, edited_at desc);

create index if not exists idx_memory_versions_editor
  on memory_versions(edited_by) where edited_by is not null;

-- RLS — same visibility as memory_entries: a user can read versions of
-- memories they could read directly. Insert is allowed if they could
-- edit the memory (i.e. own it via user-scope or are a circle member
-- for circle-scope).

alter table memory_versions enable row level security;

create policy memory_versions_select on memory_versions
  for select to authenticated
  using (
    memory_id in (
      select id from memory_entries m
      where m.user_id = auth.uid()
         or m.circle_id in (select circle_id from circle_members where user_id = auth.uid())
    )
  );

create policy memory_versions_insert on memory_versions
  for insert to authenticated
  with check (
    memory_id in (
      select id from memory_entries m
      where m.user_id = auth.uid()
         or m.circle_id in (select circle_id from circle_members where user_id = auth.uid())
    )
  );

-- Versions are immutable history — no update or delete policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: record_memory_edit — atomic version-then-update so a partial
-- write can't leave the version row orphaned or the memory un-versioned.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function record_memory_edit(
  p_memory_id uuid,
  p_new_content text,
  p_new_title text default null,
  p_edit_reason text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_version_id uuid;
  v_old_body text;
  v_old_title text;
  v_user_id uuid := auth.uid();
begin
  -- Snapshot the current row.
  select content, title into v_old_body, v_old_title
  from memory_entries
  where id = p_memory_id
  for update;

  if v_old_body is null then
    raise exception 'memory % not found or not visible', p_memory_id;
  end if;

  -- Write the version (before-state).
  insert into memory_versions (memory_id, body, title, edited_by, edit_reason)
  values (p_memory_id, v_old_body, v_old_title, v_user_id, p_edit_reason)
  returning id into v_version_id;

  -- Update memory_entries with the new content.
  update memory_entries
  set
    content = p_new_content,
    title = coalesce(p_new_title, title),
    updated_at = now()
  where id = p_memory_id;

  return v_version_id;
end;
$$;

grant execute on function record_memory_edit(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
