-- Memory Links — Phase 3 of the memory wiki design.
--
-- Explicit user-curated relationships between memories (on top of the
-- implicit embedding-similarity neighbors already exposed by
-- findRelatedMemories). Lets a user say "this finding supersedes that
-- old policy" or "this decision contradicts that preference" so future
-- retrieval and consolidation can reason about the relationship.
--
-- Spec: docs/superpowers/specs/2026-04-28-memory-wiki-design.md

create table if not exists memory_links (
  source_id uuid not null references memory_entries(id) on delete cascade,
  target_id uuid not null references memory_entries(id) on delete cascade,
  link_kind text not null check (link_kind in ('relates','contradicts','supersedes','example_of')),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (source_id, target_id, link_kind),
  -- A memory can't link to itself.
  check (source_id <> target_id)
);

create index if not exists idx_memory_links_target
  on memory_links(target_id, link_kind);

create index if not exists idx_memory_links_creator
  on memory_links(created_by) where created_by is not null;

alter table memory_links enable row level security;

-- A user can see / create / delete a link iff they can see BOTH endpoints.
-- That mirrors how users see memory_entries: own user-scope rows or
-- circle rows for circles they're a member of.

create policy memory_links_select on memory_links
  for select to authenticated
  using (
    source_id in (
      select id from memory_entries m
      where m.user_id = auth.uid()
         or m.circle_id in (select circle_id from circle_members where user_id = auth.uid())
    )
    and target_id in (
      select id from memory_entries m
      where m.user_id = auth.uid()
         or m.circle_id in (select circle_id from circle_members where user_id = auth.uid())
    )
  );

create policy memory_links_insert on memory_links
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and source_id in (
      select id from memory_entries m
      where m.user_id = auth.uid()
         or m.circle_id in (select circle_id from circle_members where user_id = auth.uid())
    )
    and target_id in (
      select id from memory_entries m
      where m.user_id = auth.uid()
         or m.circle_id in (select circle_id from circle_members where user_id = auth.uid())
    )
  );

create policy memory_links_delete on memory_links
  for delete to authenticated
  using (
    created_by = auth.uid()
    or source_id in (
      select id from memory_entries m
      where m.user_id = auth.uid()
    )
  );

-- No update policy on purpose — links are atoms, change them by
-- delete + recreate.

notify pgrst, 'reload schema';
