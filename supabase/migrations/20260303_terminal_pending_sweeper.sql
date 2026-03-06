-- ─────────────────────────────────────────────────────────────────────────
-- Terminal: sweep stale pending/invoked messages to error after 2 minutes
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sweep_stale_terminal_messages()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Mark stale messages as error
  UPDATE office_terminal_messages
  SET status = 'error', updated_at = now()
  WHERE status IN ('pending', 'invoked')
    AND created_at < now() - interval '2 minutes';

  -- Mark stale responses as error
  UPDATE office_terminal_responses
  SET status = 'error',
      error_message = 'Agent did not respond within 2 minutes',
      updated_at = now()
  WHERE status = 'pending'
    AND created_at < now() - interval '2 minutes';
END; $$;

SELECT cron.schedule(
  'sweep-stale-terminal-messages',
  '*/2 * * * *',
  'SELECT sweep_stale_terminal_messages()'
);

GRANT EXECUTE ON FUNCTION sweep_stale_terminal_messages() TO postgres;
