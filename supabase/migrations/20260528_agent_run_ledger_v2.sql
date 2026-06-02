-- Agent Run Ledger v2
-- Durable execution events, failure taxonomy records, and per-run budgets for
-- chat, OpenSwan, desktop/browser bridges, terminal agents, and marketplace APIs.

CREATE TABLE IF NOT EXISTS public.agent_run_tool_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.agent_run_steps(id) ON DELETE SET NULL,
  circle_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  scenario_id text NOT NULL DEFAULT '',
  event_key text NOT NULL DEFAULT gen_random_uuid()::text,
  surface text NOT NULL DEFAULT 'unknown',
  actor text NOT NULL DEFAULT 'tool' CHECK (actor IN (
    'user',
    'swanbot',
    'openswan',
    'tool',
    'terminal_agent',
    'human'
  )),
  event_type text NOT NULL CHECK (event_type IN (
    'planned',
    'tool_started',
    'tool_finished',
    'approval_requested',
    'approval_resolved',
    'blocked',
    'verified',
    'completed',
    'failed'
  )),
  tool_name text,
  risk text NOT NULL DEFAULT 'safe' CHECK (risk IN (
    'safe',
    'review',
    'external_side_effect',
    'destructive'
  )),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN (
    'pending',
    'running',
    'completed',
    'failed',
    'blocked',
    'skipped'
  )),

  sanitized_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  sanitized_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact_refs text[] NOT NULL DEFAULT '{}',

  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cached_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost numeric(10,6) NOT NULL DEFAULT 0,
  latency_ms int,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_tool_events_run
  ON public.agent_run_tool_events(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_tool_events_circle
  ON public.agent_run_tool_events(circle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_tool_events_scenario
  ON public.agent_run_tool_events(circle_id, scenario_id, created_at DESC)
  WHERE scenario_id <> '';
CREATE INDEX IF NOT EXISTS idx_agent_run_tool_events_status
  ON public.agent_run_tool_events(circle_id, status, created_at DESC)
  WHERE status IN ('pending', 'running', 'blocked', 'failed');
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_tool_events_run_event_key
  ON public.agent_run_tool_events(run_id, event_key);

ALTER TABLE public.agent_run_tool_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_run_tool_events_circle_member" ON public.agent_run_tool_events;
CREATE POLICY "agent_run_tool_events_circle_member"
  ON public.agent_run_tool_events
  FOR ALL
  USING (
    circle_id IN (
      SELECT circle_id FROM public.circle_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.agent_run_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.agent_run_steps(id) ON DELETE SET NULL,
  circle_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  failure_class text NOT NULL,
  failure_key text NOT NULL DEFAULT gen_random_uuid()::text,
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN (
    'info',
    'warning',
    'error',
    'critical'
  )),
  surface text NOT NULL DEFAULT 'unknown',
  retryable boolean NOT NULL DEFAULT true,
  user_action_required boolean NOT NULL DEFAULT false,
  recommended_recovery text,

  raw_error text,
  signals text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_failures_run
  ON public.agent_run_failures(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_failures_circle_open
  ON public.agent_run_failures(circle_id, severity, created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_run_failures_class
  ON public.agent_run_failures(circle_id, failure_class, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_failures_run_failure_key
  ON public.agent_run_failures(run_id, failure_key);

ALTER TABLE public.agent_run_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_run_failures_circle_member" ON public.agent_run_failures;
CREATE POLICY "agent_run_failures_circle_member"
  ON public.agent_run_failures
  FOR ALL
  USING (
    circle_id IN (
      SELECT circle_id FROM public.circle_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.agent_run_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  scenario_id text NOT NULL DEFAULT '',
  max_usd numeric(10,6) NOT NULL DEFAULT 0,
  spent_usd numeric(10,6) NOT NULL DEFAULT 0,
  max_steps int NOT NULL DEFAULT 0,
  used_steps int NOT NULL DEFAULT 0,

  router_model_tier text NOT NULL DEFAULT 'cheap',
  planner_model_tier text NOT NULL DEFAULT 'cheap',
  executor_model_tier text NOT NULL DEFAULT 'balanced',
  prefer_cheap_models boolean NOT NULL DEFAULT true,
  allow_computer_use_model boolean NOT NULL DEFAULT false,

  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active',
    'exceeded',
    'approved_overage',
    'closed'
  )),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_budgets_circle
  ON public.agent_run_budgets(circle_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_budgets_scenario
  ON public.agent_run_budgets(circle_id, scenario_id, created_at DESC)
  WHERE scenario_id <> '';
CREATE INDEX IF NOT EXISTS idx_agent_run_budgets_over_budget
  ON public.agent_run_budgets(circle_id, created_at DESC)
  WHERE spent_usd > max_usd AND max_usd > 0;

ALTER TABLE public.agent_run_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_run_budgets_circle_member" ON public.agent_run_budgets;
CREATE POLICY "agent_run_budgets_circle_member"
  ON public.agent_run_budgets
  FOR ALL
  USING (
    circle_id IN (
      SELECT circle_id FROM public.circle_members WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.update_agent_run_budgets_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_agent_run_budgets_updated_at ON public.agent_run_budgets;
CREATE TRIGGER update_agent_run_budgets_updated_at
  BEFORE UPDATE ON public.agent_run_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_agent_run_budgets_updated_at();
