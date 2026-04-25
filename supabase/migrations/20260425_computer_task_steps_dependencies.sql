-- Persist plan-level dependency metadata per step so hybrid runs are
-- resumable after tab close. Without these, we'd have to keep the
-- HybridPlan in client memory or as a separate JSON blob — both fragile.
-- depends_on is the array of step ids that must complete first;
-- consumes is the optional template string referencing prior step output.

ALTER TABLE computer_task_steps
  ADD COLUMN IF NOT EXISTS depends_on text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS consumes text;

NOTIFY pgrst, 'reload schema';
