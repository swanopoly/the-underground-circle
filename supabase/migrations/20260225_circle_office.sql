-- ─────────────────────────────────────────────────────────────────────────────
-- Circle Office: Shared agent registry per circle
-- Everyone in the circle can see each other's bots and what they're working on.
-- No secrets stored here — tokens/endpoints stay in agents_bots (private).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists circle_office_agents (
  id                  uuid default gen_random_uuid() primary key,
  circle_id           uuid not null references circles(id) on delete cascade,
  owner_id            uuid not null references auth.users(id) on delete cascade,

  -- Public agent profile (no tokens or endpoints)
  provider            text not null default 'openclaw',
  name                text not null,
  color               text not null default '#6366f1',
  tool_icon           text not null default '🤖',

  -- Owner display info (denormalized for performance)
  owner_display_name  text,
  owner_username      text,

  -- Live status (updated in real-time)
  status              text not null default 'offline'
                        check (status in ('idle', 'building', 'offline', 'error')),
  current_task        text,
  current_goal        text,
  session_url         text,
  return_time         text,

  -- Publishing
  is_published        boolean not null default true,

  -- Timestamps
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  last_active_at      timestamptz,

  -- One agent per user per circle (upsert on this)
  unique (circle_id, owner_id, name)
);

-- Index for fast circle lookups
create index if not exists idx_circle_office_agents_circle
  on circle_office_agents (circle_id, is_published);

-- RLS: circle members can read all agents in their circles
alter table circle_office_agents enable row level security;

-- Read: any authenticated user can see published agents in circles they belong to
create policy "circle members can view office agents"
  on circle_office_agents for select
  using (
    is_published = true
    and exists (
      select 1 from circle_members
      where circle_members.circle_id = circle_office_agents.circle_id
        and circle_members.user_id = auth.uid()
    )
  );

-- Insert/Update/Delete: only the owner
create policy "owners can manage their office agents"
  on circle_office_agents for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Auto-update updated_at
create or replace function update_circle_office_agents_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger circle_office_agents_updated_at
  before update on circle_office_agents
  for each row execute function update_circle_office_agents_updated_at();

-- Enable realtime for live updates
alter publication supabase_realtime add table circle_office_agents;
