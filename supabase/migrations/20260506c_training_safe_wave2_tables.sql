-- ─────────────────────────────────────────────────────────────────────────
-- Training-safe views for the BlackSwan Wave 2 tables.
--
-- Column / table names match real prod schemas — see migrations
--   20260410_circle_missions.sql       (circle_missions / mission_tasks /
--                                       mission_agents / proof_of_work)
--   20260311_github_integration.sql    (circle_github_events)
--   20260313_circle_automations.sql    (circle_automations)
-- The training data export pipeline (scripts/blackswan-llm/export_training_data.py)
-- reads through `training_safe_*` views so opted-out users are excluded.
-- ─────────────────────────────────────────────────────────────────────────

-- Missions: opt-out follows the mission's owner_id. (No `created_by`
-- column — that was an earlier design that never shipped.)
CREATE OR REPLACE VIEW training_safe_missions AS
  SELECT m.*
  FROM circle_missions m
  LEFT JOIN profiles p ON p.id = m.owner_id
  WHERE p.id IS NULL
     OR (
       p.training_opt_out = false
       AND NOT ('missions' = ANY(COALESCE(p.training_opt_out_fields, '{}')))
     );

-- Mission tasks inherit the owner's opt-out from the parent mission.
CREATE OR REPLACE VIEW training_safe_mission_tasks AS
  SELECT mt.*
  FROM mission_tasks mt
  JOIN training_safe_mission_tasks_parent ON true  -- placeholder; replaced below
  WHERE FALSE;

-- (drop and re-create to use the parent-mission filter cleanly)
DROP VIEW IF EXISTS training_safe_mission_tasks;
CREATE OR REPLACE VIEW training_safe_mission_tasks AS
  SELECT mt.*
  FROM mission_tasks mt
  JOIN training_safe_missions m ON m.id = mt.mission_id;

-- Mission agents have no `assigned_by` column — gate at the parent
-- mission level instead.
CREATE OR REPLACE VIEW training_safe_mission_agents AS
  SELECT ma.*
  FROM mission_agents ma
  JOIN training_safe_missions m ON m.id = ma.mission_id;

-- Proof of work is the user's authored description of what shipped.
-- Agent-authored PoW (user_id null) flows through unblocked since
-- there's no person-level opt-out it could violate.
CREATE OR REPLACE VIEW training_safe_proof_of_work AS
  SELECT pw.*
  FROM proof_of_work pw
  LEFT JOIN profiles p ON p.id = pw.user_id
  WHERE p.id IS NULL
     OR (
       p.training_opt_out = false
       AND NOT ('proof_of_work' = ANY(COALESCE(p.training_opt_out_fields, '{}')))
     );

-- GitHub events come from the connected repo. We can't directly map
-- the GitHub author handle to a profile without a join table, so we
-- gate at circle scope: if any owner-tier member has opted out, hide
-- the events for that circle. Conservative — widen later if a
-- github_login → profile mapping ships.
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

-- Automations follow the row creator's opt-out. Real table is
-- `circle_automations` (not `automations`).
CREATE OR REPLACE VIEW training_safe_automations AS
  SELECT a.*
  FROM circle_automations a
  LEFT JOIN profiles p ON p.id = a.created_by
  WHERE p.id IS NULL
     OR (
       p.training_opt_out = false
       AND NOT ('automations' = ANY(COALESCE(p.training_opt_out_fields, '{}')))
     );

GRANT SELECT ON training_safe_missions       TO authenticated, service_role;
GRANT SELECT ON training_safe_mission_tasks  TO authenticated, service_role;
GRANT SELECT ON training_safe_mission_agents TO authenticated, service_role;
GRANT SELECT ON training_safe_proof_of_work  TO authenticated, service_role;
GRANT SELECT ON training_safe_github_events  TO authenticated, service_role;
GRANT SELECT ON training_safe_automations    TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
