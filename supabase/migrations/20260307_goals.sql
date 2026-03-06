-- ─── Goal Alignment ─────────────────────────────────────────────────────────
-- Hierarchical goal system: North Star → OKR Objectives → Key Results → Circle Goals

CREATE TABLE org_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES org_goals(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('north_star', 'okr_objective', 'key_result', 'circle_goal')),
  title TEXT NOT NULL,
  description TEXT,
  circle_id UUID REFERENCES circles(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES profiles(id),
  target_value NUMERIC,
  current_value NUMERIC DEFAULT 0,
  unit TEXT, -- e.g. '%', 'count', '$'
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'abandoned')),
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_org_goals_org ON org_goals(org_id);
CREATE INDEX idx_org_goals_parent ON org_goals(parent_id);
CREATE INDEX idx_org_goals_circle ON org_goals(circle_id) WHERE circle_id IS NOT NULL;
ALTER TABLE org_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view goals" ON org_goals FOR SELECT USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
);

CREATE POLICY "Org admins can manage goals" ON org_goals FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
);

CREATE POLICY "Org admins can update goals" ON org_goals FOR UPDATE USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  OR owner_id = auth.uid()
);

CREATE POLICY "Org admins can delete goals" ON org_goals FOR DELETE USING (
  org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
);

-- Link check-ins to goals for progress tracking
CREATE TABLE goal_check_in_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES org_goals(id) ON DELETE CASCADE,
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  contributed_value NUMERIC DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(goal_id, check_in_id)
);

ALTER TABLE goal_check_in_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view goal links" ON goal_check_in_links FOR SELECT USING (
  goal_id IN (SELECT id FROM org_goals WHERE org_id IN (
    SELECT org_id FROM org_members WHERE user_id = auth.uid()
  ))
);

CREATE POLICY "Members can link check-ins" ON goal_check_in_links FOR INSERT WITH CHECK (
  check_in_id IN (SELECT id FROM check_ins WHERE user_id = auth.uid())
);

-- Auto-update parent goal progress when children change
CREATE OR REPLACE FUNCTION update_parent_goal_progress()
RETURNS TRIGGER AS $$
DECLARE
  parent RECORD;
  child_avg NUMERIC;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT AVG(
      CASE WHEN target_value > 0
        THEN LEAST(current_value / target_value * 100, 100)
        ELSE 0
      END
    ) INTO child_avg
    FROM org_goals
    WHERE parent_id = NEW.parent_id AND status != 'abandoned';

    UPDATE org_goals
    SET current_value = ROUND(child_avg, 1),
        target_value = 100,
        unit = '%',
        updated_at = NOW()
    WHERE id = NEW.parent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_parent_goal
  AFTER INSERT OR UPDATE OF current_value, status ON org_goals
  FOR EACH ROW
  EXECUTE FUNCTION update_parent_goal_progress();
