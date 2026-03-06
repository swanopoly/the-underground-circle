-- ─────────────────────────────────────────────────────────────────────────
-- Add circle_id to terminal responses for Realtime filtering
-- Without this, every terminal instance subscribes to ALL circles' responses
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Add circle_id column (populated from parent message)
ALTER TABLE office_terminal_responses
  ADD COLUMN IF NOT EXISTS circle_id uuid;

-- 2. Backfill from existing messages
UPDATE office_terminal_responses r
SET circle_id = m.circle_id
FROM office_terminal_messages m
WHERE r.message_id = m.id
  AND r.circle_id IS NULL;

-- 3. Create index for Realtime filter
CREATE INDEX IF NOT EXISTS idx_terminal_responses_circle_id
  ON office_terminal_responses (circle_id);

-- 4. Create trigger to auto-populate circle_id on insert
CREATE OR REPLACE FUNCTION set_terminal_response_circle_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.circle_id IS NULL THEN
    SELECT circle_id INTO NEW.circle_id
    FROM office_terminal_messages
    WHERE id = NEW.message_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS terminal_response_set_circle_id ON office_terminal_responses;

CREATE TRIGGER terminal_response_set_circle_id
  BEFORE INSERT ON office_terminal_responses
  FOR EACH ROW EXECUTE FUNCTION set_terminal_response_circle_id();
