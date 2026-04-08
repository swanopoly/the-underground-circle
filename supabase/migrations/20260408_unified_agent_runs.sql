-- Unified Agent Run System
-- Shared primitives for runs, steps, artifacts, approvals, memory across ALL surfaces
-- Replaces surface-specific tables with one shared system

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Agent Runs — the core execution record
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(circle_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),

  -- What surface initiated this run
  surface text NOT NULL CHECK (surface IN ('main_chat','room_chat','feed_task','office_terminal','floating_chat','scheduled','api')),

  -- Optional bindings to existing objects
  room_id uuid REFERENCES project_rooms(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  chat_session_id uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,

  -- Run identity
  title text NOT NULL DEFAULT '',
  goal text,  -- Cowork-style: what the user wants to accomplish
  mode text DEFAULT 'talk',  -- talk, plan, execute, review, research, support, design
  model text,
  provider text,  -- claude, openai, gemini, openclaw, bridge, huggingface

  -- State machine
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','planning','running','waiting_approval','paused','completed','failed','cancelled')),

  -- Execution metadata
  plan_summary text,
  current_step_index int DEFAULT 0,
  total_steps int DEFAULT 0,

  -- Token/cost tracking
  input_tokens bigint DEFAULT 0,
  output_tokens bigint DEFAULT 0,
  cached_tokens bigint DEFAULT 0,
  estimated_cost numeric(10,6) DEFAULT 0,

  -- Timing
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Subagent delegation
  parent_run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  delegated_to text,  -- subagent role: researcher, writer, coder, reviewer, etc.

  -- Context
  context_snapshot jsonb DEFAULT '{}'::jsonb,  -- frozen context at run start
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_agent_runs_circle ON agent_runs(circle_id, created_at DESC);
CREATE INDEX idx_agent_runs_user ON agent_runs(user_id, created_at DESC);
CREATE INDEX idx_agent_runs_status ON agent_runs(circle_id, status) WHERE status NOT IN ('completed','cancelled','failed');
CREATE INDEX idx_agent_runs_room ON agent_runs(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_agent_runs_parent ON agent_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_runs_circle_member" ON agent_runs FOR ALL
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Agent Run Steps — every action the agent takes
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL,

  step_index int NOT NULL DEFAULT 0,
  step_kind text NOT NULL CHECK (step_kind IN (
    'plan','thinking','tool_call','tool_result','message','artifact_create',
    'approval_request','approval_result','delegation','error','finalize','context_edit'
  )),

  title text NOT NULL DEFAULT '',
  body text,  -- the actual content/output

  -- Tool call details
  tool_name text,
  tool_input jsonb,
  tool_output text,

  -- Delegation details
  delegated_to text,  -- subagent role
  child_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,

  -- State
  status text DEFAULT 'completed' CHECK (status IN ('pending','running','completed','failed','skipped','blocked')),

  duration_ms int,
  tokens_used int DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_agent_run_steps_run ON agent_run_steps(run_id, step_index);

ALTER TABLE agent_run_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "run_steps_via_run" ON agent_run_steps FOR ALL
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Agent Run Artifacts — deliverables produced by runs
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_run_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES agent_run_steps(id) ON DELETE SET NULL,
  circle_id uuid NOT NULL,

  artifact_kind text NOT NULL CHECK (artifact_kind IN (
    'text','code_patch','image','screenshot','report','webpage','table',
    'research_brief','design_spec','social_post','email_draft','spec_doc',
    'checklist','link_bundle','audio','video','file','diff','translation',
    'classification','test_result'
  )),

  title text NOT NULL DEFAULT '',
  content text,  -- text/html/markdown content
  url text,  -- external URL or storage URL
  file_path text,

  -- Version tracking
  version int DEFAULT 1,
  parent_artifact_id uuid REFERENCES agent_run_artifacts(id),

  -- Publishing
  is_published boolean DEFAULT false,
  published_at timestamptz,

  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_agent_run_artifacts_run ON agent_run_artifacts(run_id);
CREATE INDEX idx_agent_run_artifacts_kind ON agent_run_artifacts(circle_id, artifact_kind);

ALTER TABLE agent_run_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "artifacts_via_circle" ON agent_run_artifacts FOR ALL
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Agent Run Approvals — HITL gates within runs
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_run_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES agent_run_steps(id) ON DELETE SET NULL,
  circle_id uuid NOT NULL,

  approval_kind text NOT NULL CHECK (approval_kind IN (
    'tool_use','publish','external_send','file_write','browser_action',
    'cost_threshold','privileged_action','plan_approval','deliverable_review'
  )),

  title text NOT NULL DEFAULT '',
  description text,
  payload jsonb DEFAULT '{}'::jsonb,

  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','auto_approved')),

  requested_by text,  -- agent name
  resolved_by uuid REFERENCES auth.users(id),

  timeout_seconds int DEFAULT 300,
  requested_at timestamptz DEFAULT now(),
  resolved_at timestamptz,

  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_agent_run_approvals_run ON agent_run_approvals(run_id);
CREATE INDEX idx_agent_run_approvals_pending ON agent_run_approvals(circle_id, status) WHERE status = 'pending';

ALTER TABLE agent_run_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approvals_via_circle" ON agent_run_approvals FOR ALL
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Memory Entries — four-level memory hierarchy
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: determines who sees this memory
  scope text NOT NULL CHECK (scope IN ('org','circle','room','user','session')),

  -- Scope bindings (at least one required per scope level)
  circle_id uuid REFERENCES circles(circle_id) ON DELETE CASCADE,
  room_id uuid REFERENCES project_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid,  -- generic session reference

  -- Content
  memory_kind text NOT NULL DEFAULT 'fact' CHECK (memory_kind IN ('fact','instruction','preference','decision','finding','policy','context')),
  title text NOT NULL DEFAULT '',
  content text NOT NULL,

  -- Source tracking
  source_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  source_surface text,
  promoted_from uuid REFERENCES memory_entries(id),  -- if promoted from session → room → circle

  -- Lifecycle
  is_active boolean DEFAULT true,
  expires_at timestamptz,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_memory_circle ON memory_entries(circle_id, scope, is_active) WHERE is_active = true;
CREATE INDEX idx_memory_room ON memory_entries(room_id, is_active) WHERE room_id IS NOT NULL AND is_active = true;
CREATE INDEX idx_memory_user ON memory_entries(user_id, is_active) WHERE is_active = true;

ALTER TABLE memory_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "memory_via_circle" ON memory_entries FOR ALL
  USING (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
    OR user_id = auth.uid()
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Subagent Profiles — registered specialist agents
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subagent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(circle_id) ON DELETE CASCADE,

  role text NOT NULL,  -- planner, researcher, writer, coder, reviewer, designer, support
  display_name text NOT NULL,
  description text,
  system_prompt text,

  -- Capabilities
  allowed_tools text[] DEFAULT '{}',
  allowed_surfaces text[] DEFAULT '{}',
  permission_mode text DEFAULT 'workspace_safe',
  model_preference text,

  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,

  UNIQUE(circle_id, role)
);

ALTER TABLE subagent_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subagents_via_circle" ON subagent_profiles FOR ALL
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. Run Evaluations — quality checks on outputs
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS run_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES agent_run_artifacts(id) ON DELETE SET NULL,
  circle_id uuid NOT NULL,

  eval_kind text NOT NULL CHECK (eval_kind IN ('quality','security','accuracy','completeness','style','custom')),
  evaluator text NOT NULL DEFAULT 'auto',  -- auto, human, subagent

  score numeric(3,2),  -- 0.00 to 1.00
  passed boolean,
  feedback text,

  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE run_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evals_via_circle" ON run_evaluations FOR ALL
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
