-- Service-role-only, read-only production contract for OpenSwan release checks.
-- The report gets booleans only: no rows, user identifiers, message contents,
-- tokens, or secret values cross the database boundary.

BEGIN;

CREATE OR REPLACE FUNCTION public.openswan_production_readiness_contract()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH checks(id, ok) AS (
    VALUES
      (
        'database.circle_chat_threads',
        to_regclass('public.circle_chat_threads') IS NOT NULL
      ),
      (
        'database.messages_thread_contract',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.messages')
            AND attribute.attname = 'thread_id'
            AND attribute.atttypid = 'uuid'::regtype
            AND attribute.attnotnull
            AND NOT attribute.attisdropped
        )
      ),
      (
        'database.messages_authority',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS relation
          WHERE relation.oid = to_regclass('public.messages')
            AND relation.relrowsecurity
        )
        AND (
          SELECT count(*) = 4
            AND count(*) FILTER (
              WHERE policy.policyname IN (
                'messages_select_thread_visible',
                'messages_insert_thread_visible',
                'messages_update_thread_visible',
                'messages_delete_creator_thread_visible'
              )
            ) = 4
          FROM pg_catalog.pg_policies AS policy
          WHERE policy.schemaname = 'public'
            AND policy.tablename = 'messages'
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS trigger
          WHERE trigger.tgrelid = to_regclass('public.messages')
            AND trigger.tgname = 'trg_messages_guard_authenticated_mutation'
            AND trigger.tgenabled <> 'D'
            AND NOT trigger.tgisinternal
        )
      ),
      (
        'database.message_reaction_rpc',
        to_regprocedure('public.set_message_reaction(uuid,text,boolean)') IS NOT NULL
        AND has_function_privilege(
          'authenticated',
          'public.set_message_reaction(uuid,text,boolean)',
          'EXECUTE'
        )
        AND NOT has_function_privilege(
          'anon',
          'public.set_message_reaction(uuid,text,boolean)',
          'EXECUTE'
        )
      ),
      (
        'database.thread_realtime',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_publication_tables AS publication
          WHERE publication.pubname = 'supabase_realtime'
            AND publication.schemaname = 'public'
            AND publication.tablename = 'circle_chat_threads'
        )
      ),
      (
        'database.approval_contract',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_approvals')
            AND attribute.attname = 'applied_at'
            AND attribute.atttypid = 'timestamp with time zone'::regtype
            AND NOT attribute.attisdropped
        )
      ),
      (
        'database.agent_run_contract',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'tool_calls'
            AND attribute.atttypid = 'jsonb'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'iteration_count'
            AND attribute.atttypid = 'integer'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'final_stop_reason'
            AND attribute.atttypid = 'text'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'input_tokens'
            AND attribute.atttypid = 'bigint'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'output_tokens'
            AND attribute.atttypid = 'bigint'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'cached_tokens'
            AND attribute.atttypid = 'bigint'::regtype
            AND NOT attribute.attisdropped
        )
      )
  )
  SELECT jsonb_build_object(
    'contractVersion', 1,
    'checks', COALESCE(
      jsonb_agg(
        jsonb_build_object('id', checks.id, 'ok', checks.ok)
        ORDER BY checks.id
      ),
      '[]'::jsonb
    )
  )
  FROM checks;
$function$;

REVOKE ALL ON FUNCTION public.openswan_production_readiness_contract() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.openswan_production_readiness_contract() FROM anon;
REVOKE ALL ON FUNCTION public.openswan_production_readiness_contract() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.openswan_production_readiness_contract() TO service_role;

COMMENT ON FUNCTION public.openswan_production_readiness_contract() IS
  'Return value-free OpenSwan production dependency booleans to service-role release checks.';

COMMIT;

NOTIFY pgrst, 'reload schema';
