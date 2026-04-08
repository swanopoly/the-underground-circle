-- Agent Progression: Bond + Mastery XP system with evolution unlocks

-- Progression events — ledger of all XP-awarding actions
create table if not exists progression_events (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  event_kind text not null check (event_kind in (
    'session_started','message_sent','meaningful_reply','task_completed',
    'user_feedback_positive','long_session','customization_saved','name_given',
    'daily_interaction','streak_day','trust_escalation','milestone_reached',
    'successful_turn','successful_task','user_accepted_output','user_reused_artifact',
    'high_quality_rating','streak_same_spirit_day','challenge_completed','role_promotion'
  )),
  xp_type text not null check (xp_type in ('bond','mastery')),
  base_amount int not null,
  effective_amount int not null,
  quality_multiplier real not null default 1.0,
  combo_bonus int not null default 0,
  combo_kind text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Agent mastery — per-agent per-spirit mastery progress
create table if not exists agent_mastery (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  spirit text not null default 'general',
  mastery_xp int not null default 0,
  mastery_level int not null default 1,
  mastery_title text not null default 'Novice',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, agent_id, spirit)
);

-- Agent evolution unlocks — track what's been unlocked at each bond level
create table if not exists agent_evolution_unlocks (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  bond_level int not null,
  unlock_kind text not null check (unlock_kind in (
    'greeting_pack','memory_basic','aura_tier1','trait_reveal','cosmetic_choice',
    'memory_contextual','pet_upgrade','initiative_suggestive','workflow_pack','signature_role'
  )),
  unlock_data jsonb not null default '{}'::jsonb,
  unlocked_at timestamptz not null default now(),
  unique(user_id, agent_id, unlock_kind)
);

-- Agent progression snapshots — periodic summary for dashboard
create table if not exists agent_progression_snapshots (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  bond_xp int not null default 0,
  bond_level int not null default 1,
  bond_title text not null default 'Acquaintance',
  mastery_summary jsonb not null default '{}'::jsonb,
  unlocks jsonb not null default '[]'::jsonb,
  snapshot_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_progression_events_agent on progression_events(user_id, agent_id, created_at desc);
create index if not exists idx_agent_mastery_agent on agent_mastery(user_id, agent_id);
create index if not exists idx_agent_evolution_unlocks_agent on agent_evolution_unlocks(user_id, agent_id);
create index if not exists idx_agent_progression_snapshots_agent on agent_progression_snapshots(user_id, agent_id);

-- RLS
alter table progression_events enable row level security;
alter table agent_mastery enable row level security;
alter table agent_evolution_unlocks enable row level security;
alter table agent_progression_snapshots enable row level security;

create policy "users_own_events" on progression_events for all using (user_id = auth.uid());
create policy "users_own_mastery" on agent_mastery for all using (user_id = auth.uid());
create policy "users_own_unlocks" on agent_evolution_unlocks for all using (user_id = auth.uid());
create policy "users_own_snapshots" on agent_progression_snapshots for all using (user_id = auth.uid());

-- Realtime for live updates
alter publication supabase_realtime add table progression_events;
alter publication supabase_realtime add table agent_mastery;
alter publication supabase_realtime add table agent_evolution_unlocks;
