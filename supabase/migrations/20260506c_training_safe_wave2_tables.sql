-- ─────────────────────────────────────────────────────────────────────────
-- Training-safe views for the BlackSwan Wave 2 tables.
--
-- The training data export pipeline (scripts/blackswan-llm/export_training_data.py)
-- reads through `training_safe_*` views so opted-out users are excluded.
-- The original 20260312_training_privacy.sql migration only covered
-- messages / check_ins / terminal / tasks / goals — but the missions
-- system, proof-of-work, GitHub events, and automations have all
-- shipped since then, and they're the highest-leverage app-specific
-- data BlackSwan should learn from.
--
-- Every view filters out rows where the originating user (or, for
-- circle-scoped tables, every member of the circle who created the row)
-- has set `profiles.training_opt_out = true` or listed the relevant
-- field in `training_opt_out_fields`.
-- ─────────────────────────────────────────────────────────────────────────

-- Missions live at circle scope but are created by a specific user;
-- opt-out follows the creator. Per-user opt-out from the missions
-- field uses the existing `training_opt_out_fields` array — we add
-- 'missions' as a recognised value.
CREATE OR REPLACE VIEW training_safe_missions AS
  SELECT m.*
  FROM circle_missions m
  LEFT JOIN profiles p ON p.id = m.created_by
  WHERE p.id IS NULL  -- missions with no creator (system-seeded) are safe
     OR (
       p.training_opt_out = false
       AND NOT ('missions' = ANY(COALESCE(p.training_opt_out_fields, '{}')))
     );

-- Mission tasks inherit the creator's opt-out from the parent mission.
CREATE OR REPLACE VIEW training_safe_mission_tasks AS
  SELECT mt.*
  FROM mission_tasks mt
  JOIN training_safe_missions m ON m.id = mt.mission_id;

-- Mission agent assignments are circle-scoped and follow the
-- assigner's opt-out.
CREATE OR REPLACE VIEW training_safe_mission_agents AS
  SELECT ma.*
  FROM mission_agents ma
  LEFT JOIN profiles p ON p.id = ma.assigned_by
  WHERE p.id IS NULL
     OR (
       p.training_opt_out = false
       AND NOT ('missions' = ANY(COALESCE(p.training_opt_out_fields, '{}')))
     );

-- Proof of work is the user's authored description of what they
-- shipped — opt-out follows the user directly.
CREATE OR REPLACE VIEW training_safe_proof_of_work AS
  SELECT pw.*
  FROM proof_of_work pw
  JOIN profiles p ON p.id = pw.user_id
  WHERE p.training_opt_out = false
    AND NOT ('proof_of_work' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

-- GitHub events come from the connected repo — the actor_login is the
-- GitHub handle of whoever triggered the event. We can't directly
-- match GitHub handles to profiles without a mapping table, so we
-- filter at circle scope: if any owner of the connected repo has
-- opted out, skip the events for that circle. This is the
-- conservative default; widen later if a github_login → profile
-- mapping table lands.
CREATE OR REPLACE VIEW training_safe_github_events AS
  SELECT gh.*
  FROM circle_github_events gh
  WHERE NOT EXISTS (
    SELECT 1
    FROM circle_members cm
    JOIN profiles p ON p.id = cm.user_id
    WHERE cm.circle_id = gh.circle_id
      AND cm.role IN ('creator', 'owner', 'admin')
      AND (
        p.training_opt_out = true
        OR 'github' = ANY(COALESCE(p.training_opt_out_fields, '{}'))
      )
  );

-- Automations are circle-scoped and not user-authored; opt-out
-- follows the circle's creator. Names + summaries occasionally
-- contain user-specific text so we still respect the opt-out.
CREATE OR REPLACE VIEW training_safe_automations AS
  SELECT a.*
  FROM automations a
  WHERE NOT EXISTS (
    SELECT 1
    FROM circle_members cm
    JOIN profiles p ON p.id = cm.user_id
    WHERE cm.circle_id = a.circle_id
      AND cm.role = 'creator'
      AND (
        p.training_opt_out = true
        OR 'automations' = ANY(COALESCE(p.training_opt_out_fields, '{}'))
      )
  );

GRANT SELECT ON training_safe_missions TO authenticated, service_role;
GRANT SELECT ON training_safe_mission_tasks TO authenticated, service_role;
GRANT SELECT ON training_safe_mission_agents TO authenticated, service_role;
GRANT SELECT ON training_safe_proof_of_work TO authenticated, service_role;
GRANT SELECT ON training_safe_github_events TO authenticated, service_role;
GRANT SELECT ON training_safe_automations TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
