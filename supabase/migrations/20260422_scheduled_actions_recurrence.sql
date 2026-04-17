-- Add recurrence support to scheduled_actions.
-- When `recurrence` is set (cron expression like '0 9 * * 1' = Monday 9AM),
-- the executor creates the next occurrence after a successful run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'scheduled_actions' AND column_name = 'recurrence') THEN
    ALTER TABLE scheduled_actions ADD COLUMN recurrence text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'scheduled_actions' AND column_name = 'recurrence_label') THEN
    ALTER TABLE scheduled_actions ADD COLUMN recurrence_label text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'scheduled_actions' AND column_name = 'parent_action_id') THEN
    ALTER TABLE scheduled_actions ADD COLUMN parent_action_id uuid REFERENCES scheduled_actions(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scheduled_actions_recurrence
  ON scheduled_actions (recurrence) WHERE recurrence IS NOT NULL;

NOTIFY pgrst, 'reload schema';
