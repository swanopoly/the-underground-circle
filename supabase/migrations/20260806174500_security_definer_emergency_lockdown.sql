-- Emergency SECURITY DEFINER lockdown.
--
-- A live catalog review found owner-privileged functions with PostgreSQL's
-- default PUBLIC EXECUTE grant, secret-returning helpers exposed as RPCs,
-- cross-tenant read paths, and legacy mutations without caller ownership.
-- Treat the complete public-schema SECURITY DEFINER catalog as privileged:
-- revoke browser execution first, then restore only the explicit audited
-- authenticated allowlist at the bottom of this migration.

BEGIN;

-- A hostile object on the search path can turn any owner-privileged function
-- into privilege escalation. Browser roles never need to create objects in the
-- API schema. Existing tables/functions remain usable through USAGE grants.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;

-- The backing blackswan_memory table was intentionally removed in the memory
-- cleanup migration. PL/pgSQL retained this now-unusable helper because table
-- dependencies inside function bodies are not tracked. Nothing in the app
-- calls it; remove the dead privileged surface instead of leaving a function
-- that fails every invocation and keeps schema lint red.
DROP FUNCTION IF EXISTS public.bump_memory_access(uuid, uuid[]);

-- Catalog-wide fail closed. This also catches functions added by historical
-- migrations under names that this emergency migration does not know. The
-- trusted service role remains able to use internal RPCs and maintenance jobs;
-- authenticated access is rebuilt from a reviewed allowlist below.
DO $block$
DECLARE
  function_row record;
BEGIN
  FOR function_row IN
    SELECT pg_catalog.format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    ) AS function_identity
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef IS TRUE
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      function_row.function_identity
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      function_row.function_identity
    );
  END LOOP;
END;
$block$;

-- Organization feature reads must prove current membership and may only read
-- boolean feature flags. The legacy dynamic-column RPC accepted any org id.
CREATE OR REPLACE FUNCTION public.check_org_feature(
  p_org_id uuid,
  p_feature text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  normalized_feature text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_feature, '')));
  result boolean := false;
BEGIN
  IF p_org_id IS NULL
    OR normalized_feature NOT IN (
      'analytics_enabled',
      'slack_enabled',
      'teams_enabled',
      'sso_enabled',
      'export_enabled',
      'whitelabel_enabled',
      'custom_branding',
      'goal_alignment'
    )
    OR (
      auth.role() IS DISTINCT FROM 'service_role'
      AND (
        caller_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.org_members AS membership
          WHERE membership.org_id = p_org_id
            AND membership.user_id = caller_id
        )
      )
    )
  THEN
    RETURN false;
  END IF;

  SELECT CASE normalized_feature
    WHEN 'analytics_enabled' THEN feature.analytics_enabled
    WHEN 'slack_enabled' THEN feature.slack_enabled
    WHEN 'teams_enabled' THEN feature.teams_enabled
    WHEN 'sso_enabled' THEN feature.sso_enabled
    WHEN 'export_enabled' THEN feature.export_enabled
    WHEN 'whitelabel_enabled' THEN feature.whitelabel_enabled
    WHEN 'custom_branding' THEN feature.custom_branding
    WHEN 'goal_alignment' THEN feature.goal_alignment
    ELSE false
  END
  INTO result
  FROM public.org_features AS feature
  WHERE feature.org_id = p_org_id;

  RETURN coalesce(result, false);
END;
$function$;

-- These RLS helpers previously let a signed-in caller probe another user's org
-- membership by supplying target_user_id. Policy calls use the default current
-- user; only the trusted service role may intentionally inspect another user.
CREATE OR REPLACE FUNCTION public.is_org_member(
  target_org_id uuid,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT target_org_id IS NOT NULL
    AND target_user_id IS NOT NULL
    AND (
      auth.role() = 'service_role'
      OR (auth.uid() IS NOT NULL AND target_user_id = auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM public.org_members AS membership
      WHERE membership.org_id = target_org_id
        AND membership.user_id = target_user_id
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_org_admin(
  target_org_id uuid,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT target_org_id IS NOT NULL
    AND target_user_id IS NOT NULL
    AND (
      auth.role() = 'service_role'
      OR (auth.uid() IS NOT NULL AND target_user_id = auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM public.org_members AS membership
      WHERE membership.org_id = target_org_id
        AND membership.user_id = target_user_id
        AND membership.role IN ('owner', 'admin')
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_org_owner(
  target_org_id uuid,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT target_org_id IS NOT NULL
    AND target_user_id IS NOT NULL
    AND (
      auth.role() = 'service_role'
      OR (auth.uid() IS NOT NULL AND target_user_id = auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM public.org_members AS membership
      WHERE membership.org_id = target_org_id
        AND membership.user_id = target_user_id
        AND membership.role = 'owner'
    );
$function$;

-- Credential/integration RLS policies call this helper with auth.uid(). Keep
-- policy evaluation working, while preventing direct RPC callers from probing
-- whether an arbitrary user is a circle secret manager.
CREATE OR REPLACE FUNCTION public.is_circle_secret_manager(
  p_circle_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT p_circle_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND (
      auth.role() = 'service_role'
      OR (auth.uid() IS NOT NULL AND p_user_id = auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = p_user_id
        AND membership.role IN ('creator', 'owner', 'admin', 'moderator')
    );
$function$;

-- Usage aggregates previously treated NULL circle ids as "all circles," which
-- bypassed the membership predicate. Every authenticated report is now bound
-- to one non-null circle and current membership; lookback windows are clamped.
CREATE OR REPLACE FUNCTION public.get_claude_usage_summary(
  p_circle_id uuid,
  p_days integer DEFAULT 7
)
RETURNS TABLE (
  total_cost numeric,
  total_input bigint,
  total_output bigint,
  total_cache_creation bigint,
  total_cache_read bigint,
  request_count bigint,
  cache_hit_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    coalesce(pg_catalog.sum(usage.estimated_cost), 0)::numeric,
    coalesce(pg_catalog.sum(usage.input_tokens), 0)::bigint,
    coalesce(pg_catalog.sum(usage.output_tokens), 0)::bigint,
    coalesce(pg_catalog.sum(usage.cache_creation_tokens), 0)::bigint,
    coalesce(pg_catalog.sum(usage.cache_read_tokens), 0)::bigint,
    pg_catalog.count(*)::bigint,
    CASE
      WHEN coalesce(pg_catalog.sum(
        usage.cache_read_tokens + usage.cache_creation_tokens + usage.input_tokens
      ), 0) > 0
      THEN pg_catalog.sum(usage.cache_read_tokens)::numeric
        / NULLIF(pg_catalog.sum(
          usage.cache_read_tokens + usage.cache_creation_tokens + usage.input_tokens
        ), 0)::numeric
      ELSE 0
    END
  FROM public.claude_api_usage AS usage
  WHERE p_circle_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND usage.circle_id = p_circle_id
    AND usage.created_at >= pg_catalog.now() - pg_catalog.make_interval(
      days => LEAST(GREATEST(coalesce(p_days, 7), 1), 366)
    )
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_claude_usage_by_model(
  p_circle_id uuid,
  p_days integer DEFAULT 7
)
RETURNS TABLE (
  model text,
  request_count bigint,
  total_cost numeric,
  cache_read bigint,
  cache_creation bigint,
  input_tokens bigint,
  output_tokens bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    usage.model,
    pg_catalog.count(*)::bigint,
    coalesce(pg_catalog.sum(usage.estimated_cost), 0)::numeric,
    coalesce(pg_catalog.sum(usage.cache_read_tokens), 0)::bigint,
    coalesce(pg_catalog.sum(usage.cache_creation_tokens), 0)::bigint,
    coalesce(pg_catalog.sum(usage.input_tokens), 0)::bigint,
    coalesce(pg_catalog.sum(usage.output_tokens), 0)::bigint
  FROM public.claude_api_usage AS usage
  WHERE p_circle_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND usage.circle_id = p_circle_id
    AND usage.created_at >= pg_catalog.now() - pg_catalog.make_interval(
      days => LEAST(GREATEST(coalesce(p_days, 7), 1), 366)
    )
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = auth.uid()
    )
  GROUP BY usage.model
  ORDER BY 3 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_claude_usage_daily(
  p_circle_id uuid,
  p_days integer DEFAULT 30
)
RETURNS TABLE (
  day date,
  total_cost numeric,
  requests bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    (usage.created_at AT TIME ZONE 'UTC')::date,
    coalesce(pg_catalog.sum(usage.estimated_cost), 0)::numeric,
    pg_catalog.count(*)::bigint
  FROM public.claude_api_usage AS usage
  WHERE p_circle_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND usage.circle_id = p_circle_id
    AND usage.created_at >= pg_catalog.now() - pg_catalog.make_interval(
      days => LEAST(GREATEST(coalesce(p_days, 30), 1), 366)
    )
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = auth.uid()
    )
  GROUP BY 1
  ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_claude_usage_by_model_lifetime(
  p_circle_id uuid
)
RETURNS TABLE (
  model text,
  request_count bigint,
  total_cost numeric,
  cache_creation bigint,
  cache_read bigint,
  input_tokens bigint,
  output_tokens bigint,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    usage.model,
    pg_catalog.count(*)::bigint,
    coalesce(pg_catalog.sum(usage.estimated_cost), 0)::numeric,
    coalesce(pg_catalog.sum(usage.cache_creation_tokens), 0)::bigint,
    coalesce(pg_catalog.sum(usage.cache_read_tokens), 0)::bigint,
    coalesce(pg_catalog.sum(usage.input_tokens), 0)::bigint,
    coalesce(pg_catalog.sum(usage.output_tokens), 0)::bigint,
    pg_catalog.min(usage.created_at),
    pg_catalog.max(usage.created_at)
  FROM public.claude_api_usage AS usage
  WHERE p_circle_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND usage.circle_id = p_circle_id
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = auth.uid()
    )
  GROUP BY usage.model
  ORDER BY 3 DESC;
$function$;

-- Prompt versions are user-driven mutations. Bind the prompt row to the JWT,
-- serialize version allocation, and cap caller-controlled payload sizes.
CREATE OR REPLACE FUNCTION public.create_prompt_version(
  p_prompt_id uuid,
  p_content text,
  p_config jsonb DEFAULT '{}'::jsonb,
  p_variables text[] DEFAULT '{}'::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  next_version integer;
  version_id uuid;
BEGIN
  IF caller_id IS NULL
    OR p_prompt_id IS NULL
    OR p_content IS NULL
    OR pg_catalog.length(p_content) < 1
    OR pg_catalog.length(p_content) > 1000000
    OR pg_catalog.octet_length(coalesce(p_config, '{}'::jsonb)::text) > 262144
    OR pg_catalog.cardinality(coalesce(p_variables, '{}'::text[])) > 100
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(coalesce(p_variables, '{}'::text[])) AS variable(value)
      WHERE pg_catalog.length(variable.value) > 200
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'prompt_version_invalid_request';
  END IF;

  PERFORM 1
  FROM public.prompts AS prompt
  WHERE prompt.id = p_prompt_id
    AND prompt.owner_id = caller_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'prompt_version_not_authorized';
  END IF;

  SELECT coalesce(pg_catalog.max(version.version), 0) + 1
  INTO next_version
  FROM public.prompt_versions AS version
  WHERE version.prompt_id = p_prompt_id;

  INSERT INTO public.prompt_versions (
    prompt_id,
    version,
    content,
    config,
    variables
  )
  VALUES (
    p_prompt_id,
    next_version,
    p_content,
    coalesce(p_config, '{}'::jsonb),
    coalesce(p_variables, '{}'::text[])
  )
  RETURNING id INTO version_id;

  INSERT INTO public.prompt_labels (prompt_id, label, version_id)
  VALUES (p_prompt_id, 'latest', version_id)
  ON CONFLICT (prompt_id, label) DO UPDATE
  SET
    version_id = EXCLUDED.version_id,
    updated_at = pg_catalog.clock_timestamp();

  UPDATE public.prompts
  SET updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_prompt_id
    AND owner_id = caller_id;

  RETURN version_id;
END;
$function$;

-- Mention candidate search returned a circle roster and work inventory without
-- checking that the caller belonged to the requested circle.
CREATE OR REPLACE FUNCTION public.search_mention_candidates(
  p_circle_id uuid,
  p_query text,
  p_limit integer DEFAULT 8
)
RETURNS TABLE (
  kind text,
  id uuid,
  label text,
  sublabel text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  normalized_query text := pg_catalog.left(
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_query, ''))),
    80
  );
  bounded_limit integer := LEAST(GREATEST(coalesce(p_limit, 8), 1), 20);
BEGIN
  IF caller_id IS NULL
    OR p_circle_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = caller_id
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'mention_search_not_authorized';
  END IF;

  RETURN QUERY
  SELECT candidate.kind, candidate.id, candidate.label, candidate.sublabel
  FROM (
    SELECT
      'user'::text AS kind,
      profile.id,
      coalesce(profile.display_name, profile.username, 'Member')::text AS label,
      coalesce(profile.username, '')::text AS sublabel
    FROM public.profiles AS profile
    JOIN public.circle_members AS membership
      ON membership.user_id = profile.id
     AND membership.circle_id = p_circle_id
    WHERE normalized_query = ''
      OR pg_catalog.strpos(
        pg_catalog.lower(coalesce(profile.display_name, profile.username, '')),
        normalized_query
      ) > 0

    UNION ALL

    SELECT
      'mission'::text,
      mission.id,
      mission.title::text,
      mission.status::text
    FROM public.circle_missions AS mission
    WHERE mission.circle_id = p_circle_id
      AND mission.status IN ('active', 'draft')
      AND (
        normalized_query = ''
        OR pg_catalog.strpos(pg_catalog.lower(mission.title), normalized_query) > 0
      )

    UNION ALL

    SELECT
      'mission_task'::text,
      task.id,
      task.title::text,
      task.status::text
    FROM public.mission_tasks AS task
    JOIN public.circle_missions AS mission
      ON mission.id = task.mission_id
    WHERE mission.circle_id = p_circle_id
      AND task.status IN ('pending', 'in_progress')
      AND (
        normalized_query = ''
        OR pg_catalog.strpos(pg_catalog.lower(task.title), normalized_query) > 0
      )
  ) AS candidate
  ORDER BY candidate.kind, candidate.label
  LIMIT bounded_limit;
END;
$function$;

-- This helper participates in message INSERT/UPDATE checks. It must not use
-- owner rights to reveal whether an arbitrary message UUID exists outside a
-- thread the current user can see.
CREATE OR REPLACE FUNCTION public.message_reply_matches_thread(
  p_reply_to uuid,
  p_circle_id uuid,
  p_thread_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.message_thread_visible_to_current_user(p_circle_id, p_thread_id)
    AND (
      p_reply_to IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.messages AS parent
        WHERE parent.id = p_reply_to
          AND parent.circle_id = p_circle_id
          AND parent.thread_id = p_thread_id
      )
    );
$function$;

-- Compatibility helper for the two credential-control RPCs. Their deployed
-- bodies call this historical name, while the hardened serializer is named
-- site_credential_public_json. Keeping this invoker helper non-client-callable
-- fixes those RPCs without widening secret access.
CREATE OR REPLACE FUNCTION public.circle_site_credential_public_json(
  credential public.circle_site_credentials
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT public.site_credential_public_json(credential);
$function$;

REVOKE ALL ON FUNCTION public.circle_site_credential_public_json(
  public.circle_site_credentials
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.circle_site_credential_public_json(
  public.circle_site_credentials
) TO service_role;

-- Never expose encryption material as a client-callable RPC. Credential
-- functions owned by postgres can continue to call this helper internally.
ALTER FUNCTION public.site_credential_encryption_key()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.site_credential_encryption_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.site_credential_encryption_key() FROM anon;
REVOKE ALL ON FUNCTION public.site_credential_encryption_key() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.site_credential_encryption_key() TO service_role;

-- Scheduled automation dispatch reads the service-role key and invokes every
-- due automation. pg_cron/postgres retains owner execution; Edge maintenance
-- may use the service role, but browser clients may not dispatch the sweep.
ALTER FUNCTION public.run_due_automations()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.run_due_automations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_due_automations() FROM anon;
REVOKE ALL ON FUNCTION public.run_due_automations() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_due_automations() TO service_role;

-- These legacy award APIs let callers choose user, amount, reason, and event
-- metadata, with no idempotency authority. They cannot safely remain client
-- RPCs. Route awards through a server-owned event ledger before restoring any
-- authenticated grant.
ALTER FUNCTION public.award_points(uuid, integer, text, jsonb)
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.award_points(uuid, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_points(uuid, integer, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.award_points(uuid, integer, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_points(uuid, integer, text, jsonb) TO service_role;

ALTER FUNCTION public.award_xp(uuid, integer, text, jsonb)
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.award_xp(uuid, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_xp(uuid, integer, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.award_xp(uuid, integer, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_xp(uuid, integer, text, jsonb) TO service_role;

-- Until the claimant-bound Office response migration is applied, the legacy
-- stream RPC has no way to prove the authenticated caller owns a response id.
-- Keep it server-only rather than allowing arbitrary response overwrites.
ALTER FUNCTION public.stream_response(
  uuid,
  text,
  text,
  bigint,
  integer,
  text,
  bigint,
  bigint,
  bigint,
  bigint
) SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.stream_response(
  uuid,
  text,
  text,
  bigint,
  integer,
  text,
  bigint,
  bigint,
  bigint,
  bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stream_response(
  uuid,
  text,
  text,
  bigint,
  integer,
  text,
  bigint,
  bigint,
  bigint,
  bigint
) FROM anon;
REVOKE ALL ON FUNCTION public.stream_response(
  uuid,
  text,
  text,
  bigint,
  integer,
  text,
  bigint,
  bigint,
  bigint,
  bigint
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.stream_response(
  uuid,
  text,
  text,
  bigint,
  integer,
  text,
  bigint,
  bigint,
  bigint,
  bigint
) TO service_role;

-- Agent analytics does have a provable client ownership boundary. Preserve the
-- existing authenticated caller by binding the target agent to auth.uid(),
-- requiring current circle membership, and bounding every numeric mutation.
CREATE OR REPLACE FUNCTION public.increment_agent_analytics(
  p_agent_id uuid,
  p_tokens bigint,
  p_latency_ms integer
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL
    OR p_agent_id IS NULL
    OR p_tokens IS NULL
    OR p_tokens < 0
    OR p_tokens > 1000000000
    OR p_latency_ms IS NULL
    OR p_latency_ms < 0
    OR p_latency_ms > 86400000
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'agent_analytics_invalid_request';
  END IF;

  UPDATE public.circle_office_agents AS agent
  SET
    token_usage_today = coalesce(agent.token_usage_today, 0) + p_tokens,
    token_usage_total = coalesce(agent.token_usage_total, 0) + p_tokens,
    message_count_today = coalesce(agent.message_count_today, 0) + 1,
    message_count_total = coalesce(agent.message_count_total, 0) + 1,
    last_response_ms = p_latency_ms,
    updated_at = pg_catalog.clock_timestamp()
  WHERE agent.id = p_agent_id
    AND agent.owner_id = caller_id
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = agent.circle_id
        AND membership.user_id = caller_id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'agent_analytics_not_authorized';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.increment_agent_analytics(uuid, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_agent_analytics(uuid, bigint, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_agent_analytics(uuid, bigint, integer) TO authenticated;

-- Audited authenticated RPC/RLS helper allowlist. Every entry either derives
-- identity from auth.uid(), proves current ownership/membership, or is rewritten
-- above to do so. Missing functions are ignored so this emergency migration is
-- safe across the project's divergent historical migration baselines.
DO $block$
DECLARE
  function_signature text;
  function_oid regprocedure;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.can_access_check_in(uuid)',
    'public.can_access_reaction_target(uuid,uuid)',
    'public.can_list_circle_site_credentials(uuid)',
    'public.can_manage_circle_site_credentials(uuid)',
    'public.chat_thread_invitee_is_circle_member(uuid,uuid)',
    'public.check_org_feature(uuid,text)',
    'public.claim_agent_action_call(uuid,uuid,uuid,text,text,text,text,text,text,jsonb,integer)',
    'public.create_private_chat_thread(uuid,text,text)',
    'public.create_prompt_version(uuid,text,jsonb,text[])',
    'public.current_user_created_circle(uuid)',
    'public.delete_circle_site_credential(uuid)',
    'public.delete_user_api_key(uuid)',
    'public.discover_public_circles(text,integer,integer)',
    'public.finish_agent_action_call(uuid,uuid,uuid,text,text,text,text,text,text,uuid,text,jsonb)',
    'public.get_circle_integration_secret_values(uuid)',
    'public.get_circle_site_credential_secret(uuid,text)',
    'public.get_claude_usage_by_model(uuid,integer)',
    'public.get_claude_usage_by_model_lifetime(uuid)',
    'public.get_claude_usage_daily(uuid,integer)',
    'public.get_claude_usage_summary(uuid,integer)',
    'public.get_my_circle_ids()',
    'public.get_my_mention_unread_count()',
    'public.get_my_mentions(integer)',
    'public.get_my_org_ids()',
    'public.get_user_api_key(uuid,text,text)',
    'public.get_user_circles_fast(uuid)',
    'public.increment_agent_analytics(uuid,bigint,integer)',
    'public.invoke_agent(uuid,uuid,text,uuid)',
    'public.is_circle_member(uuid)',
    'public.is_circle_secret_manager(uuid,uuid)',
    'public.is_org_admin(uuid,uuid)',
    'public.is_org_member(uuid,uuid)',
    'public.is_org_owner(uuid,uuid)',
    'public.join_circle_by_invite_code(text)',
    'public.join_public_circle(uuid)',
    'public.list_circle_site_credential_access_log(uuid,uuid,integer)',
    'public.list_circle_integration_secret_keys(uuid)',
    'public.list_circle_site_credentials(uuid,text)',
    'public.list_user_api_keys()',
    'public.mark_my_mentions_seen()',
    'public.message_reply_matches_thread(uuid,uuid,uuid)',
    'public.message_thread_visible_to_current_user(uuid,uuid)',
    'public.public_circle_join_is_available(uuid)',
    'public.record_circle_site_credential_test_result(uuid,boolean,text,jsonb)',
    'public.save_circle_integration_secrets(uuid,jsonb)',
    'public.search_mention_candidates(uuid,text,integer)',
    'public.set_message_reaction(uuid,text,boolean)',
    'public.shares_circle_with_user(uuid)',
    'public.start_agent_action_call(uuid,uuid,uuid,text,text,text,text,text,text,uuid)',
    'public.store_circle_site_credential(uuid,text,text,text,text,text,jsonb,text,text,jsonb,timestamptz,timestamptz)',
    'public.store_user_api_key(text,text,text,text)',
    'public.sync_agent_token_snapshot(uuid,uuid,text,bigint,bigint,bigint,integer,numeric,text,text)',
    'public.task_image_path_authorized(text)',
    'public.update_circle_site_credential_controls(uuid,text,text,text,text,jsonb,jsonb,timestamptz,timestamptz,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean)',
    'public.user_can_see_chat_thread(uuid)',
    'public.user_is_circle_member(uuid)'
  ]
  LOOP
    function_oid := pg_catalog.to_regprocedure(function_signature);
    IF function_oid IS NULL THEN
      CONTINUE;
    END IF;

    IF function_signature IN (
      'public.get_circle_integration_secret_values(uuid)',
      'public.list_circle_integration_secret_keys(uuid)',
      'public.save_circle_integration_secrets(uuid,jsonb)'
    ) THEN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %s SET search_path = pg_catalog, public, integration_secrets_private, extensions',
        function_oid
      );
    ELSE
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %s SET search_path = pg_catalog, public, extensions',
        function_oid
      );
    END IF;
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO authenticated',
      function_oid
    );
  END LOOP;
END;
$block$;

-- The legacy and claimant-bound Office writers share the same argument
-- signatures. Restore browser execution only when the installed definition is
-- the boolean claimant-bound implementation from the authority migration.
DO $block$
DECLARE
  function_signature text;
  function_oid regprocedure;
  function_result text;
  function_source text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.stream_response(uuid,text,text,bigint,integer,text,bigint,bigint,bigint,bigint)',
    'public.mark_message_done(uuid)'
  ]
  LOOP
    function_oid := pg_catalog.to_regprocedure(function_signature);
    IF function_oid IS NULL THEN
      CONTINUE;
    END IF;

    SELECT
      pg_catalog.pg_get_function_result(procedure.oid),
      procedure.prosrc
    INTO function_result, function_source
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = function_oid;

    IF function_result = 'boolean'
      AND pg_catalog.strpos(function_source, 'auth.uid()') > 0
      AND pg_catalog.strpos(function_source, 'claimant_user_id') > 0
    THEN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %s SET search_path = pg_catalog, public, extensions',
        function_oid
      );
      EXECUTE pg_catalog.format(
        'GRANT EXECUTE ON FUNCTION %s TO authenticated',
        function_oid
      );
    END IF;
  END LOOP;
END;
$block$;

COMMENT ON FUNCTION public.site_credential_encryption_key() IS
  'Internal/service-only credential encryption helper; never a client RPC.';
COMMENT ON FUNCTION public.run_due_automations() IS
  'Service-only scheduled automation sweep.';
COMMENT ON FUNCTION public.award_points(uuid, integer, text, jsonb) IS
  'Service-only until awards are server-derived and idempotent.';
COMMENT ON FUNCTION public.award_xp(uuid, integer, text, jsonb) IS
  'Service-only until XP events are server-derived and idempotent.';
COMMENT ON FUNCTION public.stream_response(
  uuid,
  text,
  text,
  bigint,
  integer,
  text,
  bigint,
  bigint,
  bigint,
  bigint
) IS 'Service-only legacy response writer; replace with claimant-bound authority migration.';
COMMENT ON FUNCTION public.increment_agent_analytics(uuid, bigint, integer) IS
  'Authenticated owner-only bounded Office agent analytics increment.';
COMMENT ON FUNCTION public.check_org_feature(uuid, text) IS
  'Authenticated organization-member boolean feature lookup with a fixed feature allowlist.';
COMMENT ON FUNCTION public.create_prompt_version(uuid, text, jsonb, text[]) IS
  'Authenticated prompt-owner-only bounded and serialized prompt version mutation.';
COMMENT ON FUNCTION public.search_mention_candidates(uuid, text, integer) IS
  'Authenticated circle-member-only bounded mention candidate search.';

NOTIFY pgrst, 'reload schema';

COMMIT;
