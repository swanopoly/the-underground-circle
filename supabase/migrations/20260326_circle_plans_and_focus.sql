-- ─────────────────────────────────────────────────────────────────────────
-- Circle Plans (Deep Planning System) + Focus Chain + Task Cost Tracking
--
-- Plans persist all investigation, Q&A, and step data.
-- Focus chains are checklist items stored per task.
-- Cost tracking accumulates per task across agent runs.
-- ─────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Circle Plans table
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS circle_plans (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id          uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  title              text        NOT NULL,
  description        text,
  status             text        NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft','investigating','qa','ready','active','completed','archived')),
  -- steps: [{ id, title, description, status: 'pending'|'in_progress'|'done', order, task_id? }]
  steps              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- context: { investigation: string, qa_pairs: [{q,a}], references: [], findings: [] }
  context            jsonb       DEFAULT '{}'::jsonb,
  created_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_agent_ids jsonb       DEFAULT '[]'::jsonb,
  goal_id            uuid,
  tags               text[]      DEFAULT '{}',
  estimated_cost     numeric     DEFAULT 0,
  actual_cost        numeric     DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_circle_plans_circle_id ON circle_plans(circle_id);
CREATE INDEX IF NOT EXISTS idx_circle_plans_status ON circle_plans(status);

ALTER TABLE circle_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "circle_plans_select" ON circle_plans FOR SELECT TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "circle_plans_insert" ON circle_plans FOR INSERT TO authenticated
  WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "circle_plans_update" ON circle_plans FOR UPDATE TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY "circle_plans_delete" ON circle_plans FOR DELETE TO authenticated
  USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_circle_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = 'public';

DROP TRIGGER IF EXISTS trg_circle_plans_updated_at ON circle_plans;
CREATE TRIGGER trg_circle_plans_updated_at
  BEFORE UPDATE ON circle_plans
  FOR EACH ROW EXECUTE FUNCTION update_circle_plans_updated_at();


-- ══════════════════════════════════════════════════════════════════════════
-- 2. Add plan linkage, focus chain, mode, and cost tracking to tasks
-- ══════════════════════════════════════════════════════════════════════════

-- Link tasks to plans
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES circle_plans(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS plan_step_id text;

-- Focus chain: [{ id, text, done, auto_generated, order }]
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS focus_chain jsonb DEFAULT '[]'::jsonb;

-- Plan/Act mode per task
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'execute';

-- Cost tracking per task
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS total_cost numeric DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS total_tokens integer DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS total_duration_ms integer DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS agent_runs integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tasks_plan_id ON tasks(plan_id);
