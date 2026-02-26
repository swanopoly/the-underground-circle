-- Circle shared memory
CREATE TABLE IF NOT EXISTS circle_memory (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid unique references circles(id) on delete cascade,
  content text default '',
  last_edited_by uuid references auth.users(id),
  last_edited_at timestamptz default now(),
  version int default 0,
  created_at timestamptz default now()
);
CREATE TABLE IF NOT EXISTS circle_memory_history (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references circles(id) on delete cascade,
  content text,
  edited_by uuid references auth.users(id),
  edited_at timestamptz default now(),
  version int
);
-- Agent approvals (human-in-the-loop)
CREATE TABLE IF NOT EXISTS agent_approvals (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references circles(id) on delete cascade,
  session_key text not null,
  agent_name text not null,
  action_type text not null,
  description text not null,
  payload jsonb default '{}',
  status text default 'pending',
  requested_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  timeout_seconds int default 300,
  created_at timestamptz default now()
);
-- Agent controls (pause / spend limits / approval requirements)
CREATE TABLE IF NOT EXISTS agent_controls (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references circles(id) on delete cascade,
  session_key text not null,
  agent_name text not null,
  is_paused boolean default false,
  spending_limit_daily numeric(10,4) default 10.00,
  require_approval_for text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(circle_id, session_key)
);
-- Add api_key column to circles for BYOA
ALTER TABLE circles ADD COLUMN IF NOT EXISTS api_key text unique default encode(gen_random_bytes(32), 'hex');

-- RLS
ALTER TABLE circle_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_memory_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_controls ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='circle_memory' AND policyname='circle_memory_auth') THEN
    CREATE POLICY circle_memory_auth ON circle_memory FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='circle_memory_history' AND policyname='circle_memory_history_auth') THEN
    CREATE POLICY circle_memory_history_auth ON circle_memory_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_approvals' AND policyname='agent_approvals_auth') THEN
    CREATE POLICY agent_approvals_auth ON agent_approvals FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_controls' AND policyname='agent_controls_auth') THEN
    CREATE POLICY agent_controls_auth ON agent_controls FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
