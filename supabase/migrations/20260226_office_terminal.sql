-- ─────────────────────────────────────────────────────────────────────────────
-- Office Terminal: Extend circle_office_agents + add shared terminal messages
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Extend circle_office_agents with analytics + position ───────────────────

alter table circle_office_agents
  add column if not exists position_x      float   not null default 0.5,
  add column if not exists position_y      float   not null default 0.5,
  add column if not exists pixel_character text    not null default 'robot',
  add column if not exists token_usage_today   bigint  not null default 0,
  add column if not exists token_usage_total   bigint  not null default 0,
  add column if not exists message_count_today int     not null default 0,
  add column if not exists message_count_total int     not null default 0,
  add column if not exists last_response_ms    int,
  add column if not exists uptime_score        float   not null default 1.0,
  add column if not exists last_command        text,
  add column if not exists last_command_at     timestamptz;

-- ─── Shared terminal message history ─────────────────────────────────────────

create table if not exists office_terminal_messages (
  id                 uuid        default gen_random_uuid() primary key,
  circle_id          uuid        not null references circles(id) on delete cascade,
  sender_id          uuid        not null references auth.users(id),
  sender_name        text        not null,

  -- null target_agent_id means @all
  target_agent_id    uuid        references circle_office_agents(id) on delete set null,
  target_agent_name  text        not null default '@all',

  command_text       text        not null,

  response_text      text,
  response_agent_id  uuid        references circle_office_agents(id) on delete set null,
  response_agent_name text,

  token_cost         bigint      not null default 0,
  latency_ms         int,
  status             text        not null default 'pending'
                       check (status in ('pending', 'streaming', 'done', 'error')),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Fast lookups by circle
create index if not exists idx_terminal_messages_circle
  on office_terminal_messages (circle_id, created_at desc);

-- Auto-update updated_at
create or replace function update_office_terminal_messages_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger office_terminal_messages_updated_at
  before update on office_terminal_messages
  for each row execute function update_office_terminal_messages_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table office_terminal_messages enable row level security;

-- Circle members can read
create policy "circle members can view terminal messages"
  on office_terminal_messages for select
  using (
    exists (
      select 1 from circle_members
      where circle_members.circle_id = office_terminal_messages.circle_id
        and circle_members.user_id = auth.uid()
    )
  );

-- Circle members can insert (sender_id must be themselves)
create policy "circle members can send terminal commands"
  on office_terminal_messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from circle_members
      where circle_members.circle_id = office_terminal_messages.circle_id
        and circle_members.user_id = auth.uid()
    )
  );

-- Agent owner (or sender) can update the response fields
create policy "agent owner can update terminal response"
  on office_terminal_messages for update
  using (
    auth.uid() = sender_id
    or exists (
      select 1 from circle_office_agents
      where circle_office_agents.id = office_terminal_messages.target_agent_id
        and circle_office_agents.owner_id = auth.uid()
    )
    or exists (
      select 1 from circle_office_agents
      where circle_office_agents.id = office_terminal_messages.response_agent_id
        and circle_office_agents.owner_id = auth.uid()
    )
  );

-- ─── Enable Realtime ─────────────────────────────────────────────────────────

alter publication supabase_realtime add table office_terminal_messages;

-- ─── Daily reset cron (midnight UTC) ─────────────────────────────────────────

create extension if not exists pg_cron;

create or replace function reset_daily_agent_stats() returns void
language plpgsql security definer as $$
begin
  update circle_office_agents
  set token_usage_today  = 0,
      message_count_today = 0,
      updated_at          = now();
end; $$;

select cron.schedule(
  'reset-daily-agent-stats',
  '0 0 * * *',
  'select reset_daily_agent_stats()'
);

grant execute on function reset_daily_agent_stats() to postgres;

-- ─── Atomic increment RPC for analytics (avoids race conditions) ─────────────

create or replace function increment_agent_analytics(
  p_agent_id   uuid,
  p_tokens     bigint,
  p_latency_ms int
) returns void language plpgsql security definer as $$
begin
  update circle_office_agents set
    token_usage_today   = token_usage_today   + p_tokens,
    token_usage_total   = token_usage_total   + p_tokens,
    message_count_today = message_count_today + 1,
    message_count_total = message_count_total + 1,
    last_response_ms    = p_latency_ms,
    updated_at          = now()
  where id = p_agent_id;
end; $$;

grant execute on function increment_agent_analytics(uuid, bigint, int) to authenticated;
