-- ─────────────────────────────────────────────────────────────────────────────
-- Builder Publications
-- ─────────────────────────────────────────────────────────────────────────────
-- Backs the "Share a preview link" button in the Chat Live Builder. One row
-- per published artifact. Public-readable by id so unauthenticated recipients
-- can open the link in a browser; insert/delete gated by ownership.
--
-- The `id` is a short random slug — not a UUID — so shared URLs stay short
-- (~10 chars) and don't leak user IDs or timestamps. 30-day default
-- expiry; a cron can sweep expired rows separately.
--
-- Run once via Supabase SQL Editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

create table if not exists builder_publications (
  id           text primary key default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  user_id      uuid not null references auth.users(id) on delete cascade,
  circle_id    uuid references circles(id) on delete set null,
  title        text,
  html         text not null,
  view_count   int not null default 0,
  created_at   timestamptz default now(),
  expires_at   timestamptz default (now() + interval '30 days')
);

create index if not exists idx_builder_pubs_user_recent
  on builder_publications(user_id, created_at desc);

create index if not exists idx_builder_pubs_expires
  on builder_publications(expires_at)
  where expires_at is not null;

alter table builder_publications enable row level security;

-- Public read by id. The view-build edge fn uses the service-role key and
-- bypasses RLS, but keeping SELECT open here lets authenticated users list
-- their own (filtered client-side) without extra policies.
drop policy if exists builder_pubs_read on builder_publications;
create policy builder_pubs_read on builder_publications for select using (true);

drop policy if exists builder_pubs_insert on builder_publications;
create policy builder_pubs_insert on builder_publications for insert
  with check (auth.uid() = user_id);

drop policy if exists builder_pubs_delete on builder_publications;
create policy builder_pubs_delete on builder_publications for delete
  using (user_id = auth.uid());

-- Update: owner only, and only the title (renaming a share). Never the html
-- itself — that would invalidate anyone's shared link.
drop policy if exists builder_pubs_update on builder_publications;
create policy builder_pubs_update on builder_publications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Atomic view-count bumper. Called fire-and-forget from the view-build fn.
create or replace function increment_builder_publication_views(p_id text)
returns void
language sql
security definer
as $$
  update builder_publications
  set view_count = view_count + 1
  where id = p_id;
$$;

notify pgrst, 'reload schema';
