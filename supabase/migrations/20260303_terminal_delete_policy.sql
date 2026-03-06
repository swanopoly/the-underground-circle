-- ─────────────────────────────────────────────────────────────────────────
-- Terminal message soft-delete support
--
-- 1. Add 'deleted' to the status check constraint
-- 2. Add DELETE RLS policies (for future hard-delete if needed)
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Update status check constraint to include 'deleted'
DO $$ BEGIN
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
  CHECK (status IN ('pending', 'invoked', 'streaming', 'done', 'error', 'deleted'));

-- 2. DELETE RLS policies (for hard-delete support)
create policy "sender can delete own terminal messages"
  on office_terminal_messages
  for delete
  using (
    sender_id = auth.uid()
  );

create policy "sender can delete responses for own messages"
  on office_terminal_responses
  for delete
  using (
    exists (
      select 1 from office_terminal_messages m
      where m.id = office_terminal_responses.message_id
        and m.sender_id = auth.uid()
    )
  );
