-- ─────────────────────────────────────────────────────────────────────────
-- Training data privacy controls
--
-- Allows users to opt out of having their data used for BlackSwan training.
-- Granular field-level opt-out for specific data types.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Add training preferences to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS training_opt_out boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS training_opt_out_fields text[] DEFAULT '{}';

-- training_opt_out = true → exclude ALL their data from training
-- training_opt_out_fields = selective exclusions:
--   'messages', 'check_ins', 'tasks', 'terminal', 'goals'

-- 2. Training-safe views for data export pipeline
CREATE OR REPLACE VIEW training_safe_messages AS
  SELECT m.* FROM messages m
  JOIN profiles p ON p.id = m.user_id
  WHERE p.training_opt_out = false
    AND NOT ('messages' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

CREATE OR REPLACE VIEW training_safe_check_ins AS
  SELECT c.* FROM check_ins c
  JOIN profiles p ON p.id = c.user_id
  WHERE p.training_opt_out = false
    AND NOT ('check_ins' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

CREATE OR REPLACE VIEW training_safe_terminal AS
  SELECT t.* FROM office_terminal_messages t
  JOIN profiles p ON p.id = t.sender_id
  WHERE p.training_opt_out = false
    AND NOT ('terminal' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

CREATE OR REPLACE VIEW training_safe_tasks AS
  SELECT t.* FROM tasks t
  JOIN profiles p ON p.id = t.created_by
  WHERE p.training_opt_out = false
    AND NOT ('tasks' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

CREATE OR REPLACE VIEW training_safe_goals AS
  SELECT n.* FROM north_star_entries n
  JOIN profiles p ON p.id = n.user_id
  WHERE p.training_opt_out = false
    AND NOT ('goals' = ANY(COALESCE(p.training_opt_out_fields, '{}')));
