-- Rooms: collaborative workspaces per circle
create table if not exists circle_rooms (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  name text not null,
  description text,
  file_path text,
  language text default 'typescript',
  content text default '',
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_active boolean default true
);

-- Messages/activity inside a room
create table if not exists room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references circle_rooms(id) on delete cascade,
  user_id uuid references auth.users(id),
  agent_name text,
  content text not null,
  message_type text default 'chat', -- 'chat' | 'agent_output' | 'edit_event' | 'system'
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Enable RLS
alter table circle_rooms enable row level security;
alter table room_messages enable row level security;

-- Policies: circle members can read/write rooms
create policy "circle_rooms_select" on circle_rooms for select using (
  exists (select 1 from circle_members where circle_id = circle_rooms.circle_id and user_id = auth.uid())
);
create policy "circle_rooms_insert" on circle_rooms for insert with check (
  exists (select 1 from circle_members where circle_id = circle_rooms.circle_id and user_id = auth.uid())
);
create policy "circle_rooms_update" on circle_rooms for update using (
  exists (select 1 from circle_members where circle_id = circle_rooms.circle_id and user_id = auth.uid())
);

-- Policies: circle members can read/write room messages
create policy "room_messages_select" on room_messages for select using (
  exists (
    select 1 from circle_rooms r
    join circle_members m on m.circle_id = r.circle_id
    where r.id = room_messages.room_id and m.user_id = auth.uid()
  )
);
create policy "room_messages_insert" on room_messages for insert with check (
  exists (
    select 1 from circle_rooms r
    join circle_members m on m.circle_id = r.circle_id
    where r.id = room_messages.room_id and m.user_id = auth.uid()
  )
);

-- Realtime
alter publication supabase_realtime add table circle_rooms;
alter publication supabase_realtime add table room_messages;

-- Indexes
create index if not exists idx_circle_rooms_circle_id on circle_rooms(circle_id);
create index if not exists idx_circle_rooms_active on circle_rooms(circle_id) where is_active = true;
create index if not exists idx_room_messages_room_id on room_messages(room_id);
create index if not exists idx_room_messages_created_at on room_messages(created_at);
