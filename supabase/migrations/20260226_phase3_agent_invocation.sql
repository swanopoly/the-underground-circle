-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3: Real Agent Invocation & Streaming Responses
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Refactor terminal messages (remove response fields) ────────────────────

-- Add invocation fields to track execution
alter table office_terminal_messages
  add column if not exists invoked_at       timestamptz,
  add column if not exists invocation_id    uuid,
  add column if not exists status           text not null default 'pending'
    check (status in ('pending', 'invoked', 'streaming', 'done', 'error')),
  drop column if exists response_text,
  drop column if exists response_agent_id,
  drop column if exists response_agent_name,
  drop column if exists token_cost,
  drop column if exists latency_ms;

-- ─── New: office_terminal_responses (one per agent per command) ─────────────

create table if not exists office_terminal_responses (
  id                 uuid        default gen_random_uuid() primary key,
  message_id         uuid        not null references office_terminal_messages(id) on delete cascade,
  agent_id           uuid        not null references circle_office_agents(id) on delete cascade,
  agent_name         text        not null,
  
  -- Response content (streamed or final)
  response_text      text        not null default '',
  status             text        not null default 'pending'
    check (status in ('pending', 'streaming', 'done', 'error')),
  
  -- Metrics
  token_count        bigint      not null default 0,
  latency_ms         int,
  error_message      text,
  
  -- Tracking
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Indexes for fast lookups
create index if not exists idx_terminal_responses_message
  on office_terminal_responses (message_id);
create index if not exists idx_terminal_responses_agent
  on office_terminal_responses (agent_id);
create index if not exists idx_terminal_responses_status
  on office_terminal_responses (status)
  where status != 'done';

-- Auto-update updated_at
create or replace function update_office_terminal_responses_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists office_terminal_responses_updated_at on office_terminal_responses;

create trigger office_terminal_responses_updated_at
  before update on office_terminal_responses
  for each row execute function update_office_terminal_responses_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table office_terminal_responses enable row level security;

-- Circle members can read
create policy "circle members can view terminal responses"
  on office_terminal_responses for select
  using (
    exists (
      select 1 from office_terminal_messages otm
        join circle_members cm on cm.circle_id = otm.circle_id
      where otm.id = office_terminal_responses.message_id
        and cm.user_id = auth.uid()
    )
  );

-- Agent owner (or command sender) can insert/update responses
create policy "agent owner can update responses"
  on office_terminal_responses for all
  using (
    exists (
      select 1 from circle_office_agents
      where id = office_terminal_responses.agent_id
        and owner_id = auth.uid()
    )
    or exists (
      select 1 from office_terminal_messages otm
      where otm.id = office_terminal_responses.message_id
        and otm.sender_id = auth.uid()
    )
  );

-- ─── Enable Realtime ─────────────────────────────────────────────────────────

alter publication supabase_realtime add table office_terminal_responses;

-- ─── Agent Invocation RPC ────────────────────────────────────────────────────
-- Atomically creates a response row + marks message as invoked

create or replace function invoke_agent(
  p_message_id   uuid,
  p_agent_id     uuid,
  p_agent_name   text
) returns uuid language plpgsql security definer as $$
declare
  v_response_id uuid;
begin
  -- Create response row (starts in 'pending' state)
  insert into office_terminal_responses (message_id, agent_id, agent_name)
  values (p_message_id, p_agent_id, p_agent_name)
  returning id into v_response_id;
  
  -- Mark message as invoked
  update office_terminal_messages
  set status = 'invoked', invoked_at = now()
  where id = p_message_id
    and status in ('pending', 'invoked');
  
  return v_response_id;
end; $$;

grant execute on function invoke_agent(uuid, uuid, text) to authenticated;

-- ─── Update Response Stream RPC (for streaming updates) ──────────────────────

create or replace function stream_response(
  p_response_id  uuid,
  p_text         text,
  p_status       text,
  p_tokens       bigint,
  p_latency_ms   int
) returns void language plpgsql security definer as $$
begin
  update office_terminal_responses
  set response_text = p_text,
      status = p_status,
      token_count = p_tokens,
      latency_ms = p_latency_ms,
      updated_at = now()
  where id = p_response_id;
end; $$;

grant execute on function stream_response(uuid, text, text, bigint, int) to authenticated;

-- ─── Mark Message as Complete (all agents responded or timed out) ────────────

create or replace function mark_message_done(p_message_id uuid)
returns void language plpgsql security definer as $$
begin
  update office_terminal_messages
  set status = 'done', updated_at = now()
  where id = p_message_id;
end; $$;

grant execute on function mark_message_done(uuid) to authenticated;
