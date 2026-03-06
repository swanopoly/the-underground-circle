-- ─────────────────────────────────────────────────────────────────────────
-- Fix terminal schema issues
--
-- 1. Add missing unique constraint on office_terminal_responses(message_id, agent_id)
--    Required for the respondToCommand() upsert to work correctly.
-- 2. Update status check constraint to include 'invoked' value.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Unique constraint for upsert on (message_id, agent_id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'office_terminal_responses_message_agent_unique'
  ) THEN
    ALTER TABLE office_terminal_responses
      ADD CONSTRAINT office_terminal_responses_message_agent_unique
      UNIQUE (message_id, agent_id);
  END IF;
END $$;

-- 2. Update status check constraint on office_terminal_messages
-- Drop old constraint and re-add with 'invoked' value
DO $$ BEGIN
  -- Find and drop existing check constraint on status column
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name LIKE '%office_terminal_messages%status%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE office_terminal_messages DROP CONSTRAINT ' || constraint_name
      FROM information_schema.check_constraints
      WHERE constraint_name LIKE '%office_terminal_messages%status%'
      LIMIT 1
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE office_terminal_messages
  ADD CONSTRAINT office_terminal_messages_status_check
  CHECK (status IN ('pending', 'invoked', 'streaming', 'done', 'error'));
