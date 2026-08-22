-- Preserve deliberately nonterminal Office connected-agent handoffs.
-- A `streaming` response now means the provider owns an open handoff, so the
-- parent message must remain invokable for a later typed final-result adopter.

BEGIN;

CREATE OR REPLACE FUNCTION public.sweep_stale_terminal_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.office_terminal_messages AS message_row
  SET status = 'error',
      updated_at = clock_timestamp()
  WHERE message_row.status IN ('pending', 'invoked')
    AND message_row.created_at < clock_timestamp() - interval '2 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.office_terminal_responses AS response_row
      WHERE response_row.message_id = message_row.id
        AND response_row.status = 'streaming'
    );

  UPDATE public.office_terminal_responses AS response_row
  SET status = 'error',
      error_message = 'Agent did not respond within 2 minutes',
      updated_at = clock_timestamp()
  WHERE response_row.status = 'pending'
    AND response_row.created_at < clock_timestamp() - interval '2 minutes';
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_stale_terminal_messages()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_terminal_messages()
  TO postgres, service_role;

COMMENT ON FUNCTION public.sweep_stale_terminal_messages() IS
  'Expires unclaimed Office terminal work while preserving parent messages that have a deliberately nonterminal streaming handoff response.';

COMMIT;

NOTIFY pgrst, 'reload schema';
