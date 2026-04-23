-- circle_skill_files — Phase CA-8c of `PHASE_CA-8_HERMES_DELTA_PLAN`.
--
-- Backs 3-level skill retrieval (Hermes `skill_view(name, path)`):
--   Level 0 — `listLibrarySkills`       → metadata table
--   Level 1 — `viewLibrarySkill(name)`  → primary SKILL.md body
--   Level 2 — `viewLibrarySkillFile(name, path)` → sub-file (references/, templates/, scripts/)
--
-- The primary SKILL.md body stays on `circle_skills.content` for
-- backward-compat; sub-files land in this new table keyed by relpath.
-- When a multi-file skill is imported, the importer writes the SKILL.md
-- body to `circle_skills.content` AND creates rows here for each
-- sibling file (references/api.md, templates/pr.md, scripts/run.sh,
-- etc.). RLS inherits via `skill_id` → `circle_skills.circle_id` lookup.

create extension if not exists pgcrypto;

create table if not exists circle_skill_files (
  id          uuid primary key default gen_random_uuid(),
  skill_id    uuid not null references circle_skills(id) on delete cascade,
  relpath     text not null,                 -- e.g. 'references/api.md', 'scripts/run.sh'
  content     text not null default '',
  is_primary  boolean not null default false, -- true for the SKILL.md mirror row (optional; content also lives on circle_skills)
  mime_type   text,                          -- optional hint for non-md assets
  size_bytes  int not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (skill_id, relpath)
);

create index if not exists idx_circle_skill_files_skill
  on circle_skill_files (skill_id);
create index if not exists idx_circle_skill_files_primary
  on circle_skill_files (skill_id) where is_primary = true;

alter table circle_skill_files enable row level security;

-- Read: any circle member can read any file on any skill in their circle.
drop policy if exists "circle_skill_files_read" on circle_skill_files;
create policy "circle_skill_files_read"
  on circle_skill_files for select
  using (
    exists (
      select 1
        from circle_skills cs
        join circle_members cm on cm.circle_id = cs.circle_id
       where cs.id = circle_skill_files.skill_id
         and cm.user_id = auth.uid()
    )
  );

-- Insert / update / delete: members of the owning circle. Agent writes
-- go through HITL approvals + the approval-apply worker (server-side),
-- but human-authored edits via the skill editor hit these policies
-- directly, same as `circle_skills`.
drop policy if exists "circle_skill_files_insert" on circle_skill_files;
create policy "circle_skill_files_insert"
  on circle_skill_files for insert
  with check (
    exists (
      select 1
        from circle_skills cs
        join circle_members cm on cm.circle_id = cs.circle_id
       where cs.id = circle_skill_files.skill_id
         and cm.user_id = auth.uid()
    )
  );

drop policy if exists "circle_skill_files_update" on circle_skill_files;
create policy "circle_skill_files_update"
  on circle_skill_files for update
  using (
    exists (
      select 1
        from circle_skills cs
        join circle_members cm on cm.circle_id = cs.circle_id
       where cs.id = circle_skill_files.skill_id
         and cm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
        from circle_skills cs
        join circle_members cm on cm.circle_id = cs.circle_id
       where cs.id = circle_skill_files.skill_id
         and cm.user_id = auth.uid()
    )
  );

drop policy if exists "circle_skill_files_delete" on circle_skill_files;
create policy "circle_skill_files_delete"
  on circle_skill_files for delete
  using (
    exists (
      select 1
        from circle_skills cs
        join circle_members cm on cm.circle_id = cs.circle_id
       where cs.id = circle_skill_files.skill_id
         and cm.user_id = auth.uid()
    )
  );

-- Auto-bump updated_at on UPDATE (matches `circle_skills` convention).
create or replace function circle_skill_files_bump_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists circle_skill_files_updated_at_trg on circle_skill_files;
create trigger circle_skill_files_updated_at_trg
  before update on circle_skill_files
  for each row execute function circle_skill_files_bump_updated_at();

grant select, insert, update, delete on circle_skill_files to authenticated;

notify pgrst, 'reload schema';
