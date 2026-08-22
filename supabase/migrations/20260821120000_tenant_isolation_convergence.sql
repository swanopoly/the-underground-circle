-- Tenant-isolation convergence for personal credentials, Circle rows,
-- private Chat derivatives, reports, and private Storage objects.
--
-- PostgreSQL permissive RLS policies are ORed. Several historical policies
-- admitted a row through creator/installer/org authority without also proving
-- that the caller is still a member of the exact Circle. This migration adds
-- restrictive guards (AND semantics), fully converges the most sensitive
-- policy sets, and makes ambiguous legacy private-thread derivatives fail
-- closed instead of guessing their audience.

BEGIN;

DO $tenant_isolation_preflight$
DECLARE
  required_table text;
  required_column text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'public.circles',
    'public.profiles',
    'public.featured_trades',
    'public.featured_trade_executions',
    'public.spirit_learnings',
    'public.user_points',
    'public.user_badges',
    'public.user_xp',
    'public.research_agent_runs',
    'public.circle_members',
    'public.circle_chat_threads',
    'public.circle_chat_thread_members',
    'public.messages',
    'public.direct_messages',
    'public.message_attachments',
    'public.agent_plans',
    'public.agent_plan_steps',
    'public.agent_plan_questions',
    'public.agent_plan_artifacts',
    'public.chat_checkpoints',
    'public.computer_use_schedules',
    'public.scheduled_actions',
    'public.integrations',
    'public.user_site_credentials',
    'public.user_api_keys',
    'public.oauth_provider_credentials',
    'public.user_google_credentials',
    'public.user_github_tokens',
    'public.agent_connect_tokens',
    'public.circle_integrations',
    'public.circle_integration_secrets',
    'public.circle_github_connections',
    'public.tasks',
    'public.circle_missions',
    'public.circle_rooms',
    'public.project_rooms',
    'public.room_files',
    'public.room_secrets',
    'public.reports',
    'public.slack_connections',
    'public.teams_connections',
    'storage.buckets',
    'storage.objects',
    'realtime.messages'
  ]
  LOOP
    IF to_regclass(required_table) IS NULL THEN
      RAISE EXCEPTION 'tenant_isolation_convergence: required table % is missing', required_table
        USING ERRCODE = '42P01';
    END IF;
  END LOOP;

  FOREACH required_column IN ARRAY ARRAY[
    'public.circles.api_key',
    'public.circles.discord_bot_token',
    'public.circles.discord_webhook_url',
    'public.circle_github_connections.webhook_secret',
    'public.user_xp.user_id'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS required_column_info
      WHERE required_column_info.table_schema = split_part(required_column, '.', 1)
        AND required_column_info.table_name = split_part(required_column, '.', 2)
        AND required_column_info.column_name = split_part(required_column, '.', 3)
    ) THEN
      RAISE EXCEPTION 'tenant_isolation_convergence: required column % is missing', required_column
        USING ERRCODE = '42703';
    END IF;
  END LOOP;

  IF to_regprocedure('public.message_thread_visible_to_current_user(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'tenant_isolation_convergence: apply the canonical thread-authority migration first'
      USING ERRCODE = '42883';
  END IF;

  IF to_regprocedure('public.message_attachment_row_visible_v1(uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'tenant_isolation_convergence: apply message-attachment visibility integrity first'
      USING ERRCODE = '42883';
  END IF;

  IF to_regprocedure('realtime.topic()') IS NULL THEN
    RAISE EXCEPTION 'tenant_isolation_convergence: realtime.topic() is unavailable'
      USING ERRCODE = '42883';
  END IF;
END
$tenant_isolation_preflight$;

CREATE OR REPLACE FUNCTION public.current_user_is_exact_circle_member_v1(
  p_circle_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = auth.uid()
    );
$function$;

REVOKE ALL ON FUNCTION public.current_user_is_exact_circle_member_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_exact_circle_member_v1(uuid)
  TO authenticated;

-- Raw Circle rows are exact-current-member data. Public discovery stays on
-- discover_public_circles(), whose bounded projection intentionally excludes
-- invite codes, settings, credentials, and every future raw column.
ALTER TABLE public.circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circles FORCE ROW LEVEL SECURITY;

DO $drop_circle_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'circles'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.circles',
      policy_row.policyname
    );
  END LOOP;
END
$drop_circle_policies$;

CREATE POLICY circles_exact_member_select_v1
ON public.circles
FOR SELECT
TO authenticated
USING (public.current_user_is_exact_circle_member_v1(id));

CREATE POLICY circles_creator_insert_v1
ON public.circles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

CREATE POLICY circles_current_creator_update_v1
ON public.circles
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.current_user_is_exact_circle_member_v1(id)
)
WITH CHECK (
  created_by = auth.uid()
  AND public.current_user_is_exact_circle_member_v1(id)
);

CREATE POLICY circles_current_creator_delete_v1
ON public.circles
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.current_user_is_exact_circle_member_v1(id)
);

REVOKE ALL ON TABLE public.circles FROM PUBLIC, anon;
REVOKE SELECT ON TABLE public.circles FROM authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.circles TO authenticated;
GRANT ALL ON TABLE public.circles TO service_role;

-- RLS controls rows, not columns. Remove every historical column-level SELECT
-- grant before installing a bounded member projection on the base table. The
-- three retained capability secrets remain stored for creator/service control,
-- but an authenticated SELECT cannot name them or obtain them through '*'.
DO $revoke_circle_column_selects$
DECLARE
  column_row record;
BEGIN
  FOR column_row IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'circles'
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE SELECT (%I) ON TABLE public.circles FROM PUBLIC, anon, authenticated',
      column_row.column_name
    );
  END LOOP;
END
$revoke_circle_column_selects$;

GRANT SELECT (
  id,
  name,
  description,
  invite_code,
  max_members,
  created_by,
  created_at,
  discord_guild_id,
  discord_connected_at,
  vibe,
  rules,
  circle_image_url,
  org_id,
  is_public,
  settings,
  circle_type,
  icon,
  accent_color,
  check_in_format,
  tags
) ON TABLE public.circles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_circle_capability_secrets_v1(
  p_circle_id uuid
)
RETURNS TABLE (
  circle_id uuid,
  api_key text,
  discord_bot_token text,
  discord_webhook_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    circle.id,
    circle.api_key,
    circle.discord_bot_token,
    circle.discord_webhook_url
  FROM public.circles AS circle
  WHERE circle.id = p_circle_id
    AND (
      auth.role() = 'service_role'
      OR (
        auth.uid() IS NOT NULL
        AND circle.created_by = auth.uid()
        AND public.current_user_is_exact_circle_member_v1(circle.id)
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.get_circle_capability_secrets_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_circle_capability_secrets_v1(uuid)
  TO authenticated, service_role;

-- circle_members cannot query itself from its policy without recursion. The
-- fixed-path SECURITY DEFINER helper above gives SELECT/UPDATE/DELETE exact
-- current-member AND semantics while leaving creator bootstrap/public-join
-- INSERT policies intact.
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS circle_members_exact_member_select_guard_v1
  ON public.circle_members;
CREATE POLICY circle_members_exact_member_select_guard_v1
ON public.circle_members
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (public.current_user_is_exact_circle_member_v1(circle_id));

DROP POLICY IF EXISTS circle_members_exact_member_update_guard_v1
  ON public.circle_members;
CREATE POLICY circle_members_exact_member_update_guard_v1
ON public.circle_members
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (public.current_user_is_exact_circle_member_v1(circle_id))
WITH CHECK (public.current_user_is_exact_circle_member_v1(circle_id));

DROP POLICY IF EXISTS circle_members_exact_member_delete_guard_v1
  ON public.circle_members;
CREATE POLICY circle_members_exact_member_delete_guard_v1
ON public.circle_members
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.current_user_is_exact_circle_member_v1(circle_id));

-- Direct messages are private participant records, independent of Circle
-- membership. This restrictive SELECT defeats any permissive-policy drift.
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS direct_messages_exact_participant_select_guard_v1
  ON public.direct_messages;
CREATE POLICY direct_messages_exact_participant_select_guard_v1
ON public.direct_messages
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (sender_id = auth.uid() OR receiver_id = auth.uid());

-- Keep the canonical Chat helper current and install restrictive SELECT guards
-- on every private-thread root. Existing command-specific write policies keep
-- their narrower mutation semantics.
CREATE OR REPLACE FUNCTION public.message_thread_visible_to_current_user(
  p_circle_id uuid,
  p_thread_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND p_thread_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      JOIN public.circle_chat_threads AS thread
        ON thread.id = p_thread_id
       AND thread.circle_id = p_circle_id
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = auth.uid()
        AND (
          thread.visibility = 'circle'
          OR thread.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.circle_chat_thread_members AS thread_member
            WHERE thread_member.thread_id = thread.id
              AND thread_member.user_id = auth.uid()
          )
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.message_thread_visible_to_current_user(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_thread_visible_to_current_user(uuid, uuid)
  TO authenticated;

DO $thread_circle_unique$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.circle_chat_threads'::regclass
      AND conname = 'circle_chat_threads_id_circle_unique_v1'
  ) THEN
    ALTER TABLE public.circle_chat_threads
      ADD CONSTRAINT circle_chat_threads_id_circle_unique_v1
      UNIQUE (id, circle_id);
  END IF;
END
$thread_circle_unique$;

ALTER TABLE public.circle_chat_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.circle_chat_thread_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS circle_chat_threads_exact_visibility_guard_v1
  ON public.circle_chat_threads;
CREATE POLICY circle_chat_threads_exact_visibility_guard_v1
ON public.circle_chat_threads
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (public.message_thread_visible_to_current_user(circle_id, id));

DROP POLICY IF EXISTS circle_chat_thread_members_exact_visibility_guard_v1
  ON public.circle_chat_thread_members;
CREATE POLICY circle_chat_thread_members_exact_visibility_guard_v1
ON public.circle_chat_thread_members
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = circle_chat_thread_members.thread_id
      AND public.message_thread_visible_to_current_user(thread.circle_id, thread.id)
  )
);

DROP POLICY IF EXISTS messages_exact_thread_visibility_guard_v1
  ON public.messages;
CREATE POLICY messages_exact_thread_visibility_guard_v1
ON public.messages
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (public.message_thread_visible_to_current_user(circle_id, thread_id));

DROP POLICY IF EXISTS message_attachments_exact_thread_visibility_guard_v2
  ON public.message_attachments;
CREATE POLICY message_attachments_exact_thread_visibility_guard_v2
ON public.message_attachments
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
);

-- Agent plans historically stored an arbitrary text thread_id and exposed all
-- descendants Circle-wide. Canonical UUID lineage is backfilled only when the
-- legacy value names a real thread in the same Circle. A UUID-looking legacy
-- value that cannot be proven is ambiguous private data and fails closed;
-- null/non-UUID legacy plans retain their documented Circle-wide behavior.
ALTER TABLE public.agent_plans
  ADD COLUMN IF NOT EXISTS chat_thread_id uuid;

UPDATE public.agent_plans AS plan
SET chat_thread_id = thread.id
FROM public.circle_chat_threads AS thread
WHERE plan.chat_thread_id IS NULL
  AND pg_catalog.btrim(COALESCE(plan.thread_id, ''))
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND thread.id = pg_catalog.btrim(plan.thread_id)::uuid
  AND thread.circle_id = plan.circle_id;

DO $agent_plan_thread_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.agent_plans'::regclass
      AND conname = 'agent_plans_chat_thread_circle_fk_v1'
  ) THEN
    ALTER TABLE public.agent_plans
      ADD CONSTRAINT agent_plans_chat_thread_circle_fk_v1
      FOREIGN KEY (chat_thread_id, circle_id)
      REFERENCES public.circle_chat_threads(id, circle_id)
      ON DELETE CASCADE;
  END IF;
END
$agent_plan_thread_fk$;

CREATE INDEX IF NOT EXISTS idx_agent_plans_chat_thread_v1
  ON public.agent_plans(circle_id, chat_thread_id, updated_at DESC)
  WHERE chat_thread_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.agent_plan_scope_visible_v1(
  p_circle_id uuid,
  p_chat_thread_id uuid,
  p_legacy_thread_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    public.current_user_is_exact_circle_member_v1(p_circle_id)
    AND CASE
      WHEN p_chat_thread_id IS NOT NULL THEN
        public.message_thread_visible_to_current_user(
          p_circle_id,
          p_chat_thread_id
        )
      WHEN pg_catalog.btrim(COALESCE(p_legacy_thread_id, '')) = '' THEN true
      WHEN pg_catalog.btrim(p_legacy_thread_id)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN false
      ELSE true
    END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_plan_child_scope_visible_v1(
  p_plan_id uuid,
  p_circle_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.agent_plans AS plan
    WHERE plan.id = p_plan_id
      AND plan.circle_id = p_circle_id
      AND public.agent_plan_scope_visible_v1(
        plan.circle_id,
        plan.chat_thread_id,
        plan.thread_id
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.agent_plan_scope_visible_v1(uuid, uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agent_plan_child_scope_visible_v1(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_plan_scope_visible_v1(uuid, uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_plan_child_scope_visible_v1(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_agent_plan_thread_scope_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  legacy_thread_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
    OR NEW.chat_thread_id IS DISTINCT FROM OLD.chat_thread_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'agent_plan_scope_is_immutable'
      USING ERRCODE = '23514';
  END IF;

  IF pg_catalog.btrim(COALESCE(NEW.thread_id, ''))
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    legacy_thread_id := pg_catalog.btrim(NEW.thread_id)::uuid;

    IF NEW.chat_thread_id IS NULL AND EXISTS (
      SELECT 1
      FROM public.circle_chat_threads AS thread
      WHERE thread.id = legacy_thread_id
        AND thread.circle_id = NEW.circle_id
    ) THEN
      NEW.chat_thread_id := legacy_thread_id;
    END IF;

    IF NEW.chat_thread_id IS NULL
       OR NEW.chat_thread_id IS DISTINCT FROM legacy_thread_id THEN
      RAISE EXCEPTION 'agent_plan_thread_scope_is_ambiguous'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.chat_thread_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = NEW.chat_thread_id
      AND thread.circle_id = NEW.circle_id
  ) THEN
    RAISE EXCEPTION 'agent_plan_thread_circle_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_agent_plan_thread_scope_v1()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agent_plans_guard_thread_scope_v1
  ON public.agent_plans;
CREATE TRIGGER agent_plans_guard_thread_scope_v1
BEFORE INSERT OR UPDATE ON public.agent_plans
FOR EACH ROW
EXECUTE FUNCTION public.guard_agent_plan_thread_scope_v1();

ALTER TABLE public.agent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plan_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plan_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plan_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plan_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plan_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_plan_artifacts FORCE ROW LEVEL SECURITY;

DO $drop_agent_plan_policies$
DECLARE
  table_name text;
  policy_row record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agent_plans',
    'agent_plan_steps',
    'agent_plan_questions',
    'agent_plan_artifacts'
  ]
  LOOP
    FOR policy_row IN
      SELECT policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY %I ON public.%I',
        policy_row.policyname,
        table_name
      );
    END LOOP;
  END LOOP;
END
$drop_agent_plan_policies$;

CREATE POLICY agent_plans_exact_scope_select_v1
ON public.agent_plans
FOR SELECT
TO authenticated
USING (
  public.agent_plan_scope_visible_v1(circle_id, chat_thread_id, thread_id)
);

CREATE POLICY agent_plans_exact_scope_insert_v1
ON public.agent_plans
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.agent_plan_scope_visible_v1(circle_id, chat_thread_id, thread_id)
);

CREATE POLICY agent_plans_exact_scope_update_v1
ON public.agent_plans
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.agent_plan_scope_visible_v1(circle_id, chat_thread_id, thread_id)
)
WITH CHECK (
  created_by = auth.uid()
  AND public.agent_plan_scope_visible_v1(circle_id, chat_thread_id, thread_id)
);

CREATE POLICY agent_plans_exact_scope_delete_v1
ON public.agent_plans
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.agent_plan_scope_visible_v1(circle_id, chat_thread_id, thread_id)
);

CREATE POLICY agent_plan_steps_exact_scope_all_v1
ON public.agent_plan_steps
FOR ALL
TO authenticated
USING (public.agent_plan_child_scope_visible_v1(plan_id, circle_id))
WITH CHECK (public.agent_plan_child_scope_visible_v1(plan_id, circle_id));

CREATE POLICY agent_plan_questions_exact_scope_all_v1
ON public.agent_plan_questions
FOR ALL
TO authenticated
USING (public.agent_plan_child_scope_visible_v1(plan_id, circle_id))
WITH CHECK (public.agent_plan_child_scope_visible_v1(plan_id, circle_id));

CREATE POLICY agent_plan_artifacts_exact_scope_all_v1
ON public.agent_plan_artifacts
FOR ALL
TO authenticated
USING (public.agent_plan_child_scope_visible_v1(plan_id, circle_id))
WITH CHECK (public.agent_plan_child_scope_visible_v1(plan_id, circle_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_plan_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_plan_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_plan_artifacts TO authenticated;
GRANT ALL ON TABLE public.agent_plans TO service_role;
GRANT ALL ON TABLE public.agent_plan_steps TO service_role;
GRANT ALL ON TABLE public.agent_plan_questions TO service_role;
GRANT ALL ON TABLE public.agent_plan_artifacts TO service_role;

-- Checkpoints have no trustworthy legacy thread lineage. Add a canonical UUID
-- without guessing a backfill, and hide/reject every NULL row for authenticated
-- callers. Trusted service maintenance can still inspect legacy rows.
ALTER TABLE public.chat_checkpoints
  ADD COLUMN IF NOT EXISTS chat_thread_id uuid;

DO $checkpoint_thread_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.chat_checkpoints'::regclass
      AND conname = 'chat_checkpoints_chat_thread_circle_fk_v1'
  ) THEN
    ALTER TABLE public.chat_checkpoints
      ADD CONSTRAINT chat_checkpoints_chat_thread_circle_fk_v1
      FOREIGN KEY (chat_thread_id, circle_id)
      REFERENCES public.circle_chat_threads(id, circle_id)
      ON DELETE CASCADE;
  END IF;
END
$checkpoint_thread_fk$;

CREATE INDEX IF NOT EXISTS idx_chat_checkpoints_chat_thread_created_v1
  ON public.chat_checkpoints(circle_id, chat_thread_id, created_at DESC)
  WHERE chat_thread_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.chat_checkpoints_enforce_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.chat_thread_id IS DISTINCT FROM OLD.chat_thread_id
    OR NEW.session_key IS DISTINCT FROM OLD.session_key
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.tool_kind IS DISTINCT FROM OLD.tool_kind
    OR NEW.target_kind IS DISTINCT FROM OLD.target_kind
    OR NEW.target_id IS DISTINCT FROM OLD.target_id
    OR NEW.before_json IS DISTINCT FROM OLD.before_json
    OR NEW.after_json IS DISTINCT FROM OLD.after_json
    OR NEW.diff_summary IS DISTINCT FROM OLD.diff_summary
    OR NEW.hash_before IS DISTINCT FROM OLD.hash_before
    OR NEW.hash_after IS DISTINCT FROM OLD.hash_after
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'chat_checkpoints snapshot is immutable after commit';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.chat_checkpoints_enforce_immutable()
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.chat_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_checkpoints FORCE ROW LEVEL SECURITY;

DO $drop_checkpoint_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_checkpoints'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.chat_checkpoints',
      policy_row.policyname
    );
  END LOOP;
END
$drop_checkpoint_policies$;

CREATE POLICY chat_checkpoints_exact_thread_select_v1
ON public.chat_checkpoints
FOR SELECT
TO authenticated
USING (
  chat_thread_id IS NOT NULL
  AND public.message_thread_visible_to_current_user(circle_id, chat_thread_id)
);

CREATE POLICY chat_checkpoints_exact_thread_insert_v1
ON public.chat_checkpoints
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND chat_thread_id IS NOT NULL
  AND public.message_thread_visible_to_current_user(circle_id, chat_thread_id)
);

CREATE POLICY chat_checkpoints_exact_thread_update_v1
ON public.chat_checkpoints
FOR UPDATE
TO authenticated
USING (
  chat_thread_id IS NOT NULL
  AND public.message_thread_visible_to_current_user(circle_id, chat_thread_id)
)
WITH CHECK (
  chat_thread_id IS NOT NULL
  AND public.message_thread_visible_to_current_user(circle_id, chat_thread_id)
);

REVOKE ALL ON TABLE public.chat_checkpoints FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chat_checkpoints TO authenticated;
GRANT ALL ON TABLE public.chat_checkpoints TO service_role;

-- Public discovery may identify a public Circle, but private Storage URLs are
-- never part of that projection. Members resolve the current icon through the
-- raw Circle row and an authenticated signed-URL read.
CREATE OR REPLACE FUNCTION public.discover_public_circles(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  max_members integer,
  created_at timestamptz,
  circle_image_url text,
  member_count bigint,
  active_missions bigint,
  is_member boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  normalized_search text := pg_catalog.left(
    pg_catalog.btrim(COALESCE(p_search, '')),
    80
  );
  bounded_limit integer := least(
    greatest(COALESCE(p_limit, 50), 1),
    50
  );
  bounded_offset integer := least(
    greatest(COALESCE(p_offset, 0), 0),
    500
  );
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'authentication_required';
  END IF;

  RETURN QUERY
  SELECT
    circle.id,
    circle.name,
    circle.description,
    circle.max_members,
    circle.created_at,
    NULL::text AS circle_image_url,
    (
      SELECT count(*)
      FROM public.circle_members AS membership_count
      WHERE membership_count.circle_id = circle.id
    )::bigint AS member_count,
    (
      SELECT count(*)
      FROM public.circle_missions AS mission
      WHERE mission.circle_id = circle.id
        AND mission.status = 'active'
    )::bigint AS active_missions,
    EXISTS (
      SELECT 1
      FROM public.circle_members AS caller_membership
      WHERE caller_membership.circle_id = circle.id
        AND caller_membership.user_id = caller_id
    ) AS is_member
  FROM public.circles AS circle
  WHERE circle.is_public IS TRUE
    AND (
      normalized_search = ''
      OR pg_catalog.strpos(
        pg_catalog.lower(
          COALESCE(circle.name, '') || ' ' || COALESCE(circle.description, '')
        ),
        pg_catalog.lower(normalized_search)
      ) > 0
    )
  ORDER BY circle.created_at DESC, circle.id
  LIMIT bounded_limit
  OFFSET bounded_offset;
END
$function$;

REVOKE ALL ON FUNCTION public.discover_public_circles(text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discover_public_circles(text, integer, integer)
  TO authenticated;

-- Personal API-key rows retain the narrower non-OAuth policies from the OAuth
-- control-plane migration. This restrictive owner guard composes with them and
-- prevents a future/broad permissive policy from exposing another account.
ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_api_keys_exact_owner_guard_v1
  ON public.user_api_keys;
CREATE POLICY user_api_keys_exact_owner_guard_v1
ON public.user_api_keys
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- These legacy personal credential tables are client-managed but self-only.
-- Drop every historical policy so an unknown FOR ALL/TO PUBLIC policy cannot
-- OR around the canonical owner policies.
DO $converge_personal_credential_policies$
DECLARE
  table_name text;
  policy_row record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'integrations',
    'user_site_credentials',
    'agent_connect_tokens'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      table_name
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
      table_name
    );

    FOR policy_row IN
      SELECT policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY %I ON public.%I',
        policy_row.policyname,
        table_name
      );
    END LOOP;
  END LOOP;
END
$converge_personal_credential_policies$;

CREATE POLICY integrations_owner_select_v1
ON public.integrations FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY integrations_owner_insert_v1
ON public.integrations FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY integrations_owner_update_v1
ON public.integrations FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
CREATE POLICY integrations_owner_delete_v1
ON public.integrations FOR DELETE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY user_site_credentials_owner_select_v1
ON public.user_site_credentials FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY user_site_credentials_owner_insert_v1
ON public.user_site_credentials FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY user_site_credentials_owner_update_v1
ON public.user_site_credentials FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
CREATE POLICY user_site_credentials_owner_delete_v1
ON public.user_site_credentials FOR DELETE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY agent_connect_tokens_owner_select_v1
ON public.agent_connect_tokens FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY agent_connect_tokens_owner_insert_v1
ON public.agent_connect_tokens FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    circle_id IS NULL
    OR public.current_user_is_exact_circle_member_v1(circle_id)
  )
);
CREATE POLICY agent_connect_tokens_owner_delete_v1
ON public.agent_connect_tokens FOR DELETE TO authenticated
USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.integrations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integrations TO authenticated;
GRANT ALL ON TABLE public.integrations TO service_role;

REVOKE ALL ON TABLE public.user_site_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_site_credentials TO authenticated;
GRANT ALL ON TABLE public.user_site_credentials TO service_role;

REVOKE ALL ON TABLE public.agent_connect_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.agent_connect_tokens TO authenticated;
GRANT ALL ON TABLE public.agent_connect_tokens TO service_role;

-- OAuth credential rows contain bearer/refresh tokens and are never a browser
-- table surface. FORCE RLS plus restrictive authenticated denials keep them
-- service-only even if a permissive policy is accidentally added later.
DO $force_service_only_credential_tables$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'oauth_provider_credentials',
    'user_google_credentials',
    'user_github_tokens'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      table_name
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
      table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS service_only_authenticated_deny_guard_v1 ON public.%I',
      table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY service_only_authenticated_deny_guard_v1 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false)',
      table_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      table_name
    );
    EXECUTE pg_catalog.format(
      'GRANT ALL ON TABLE public.%I TO service_role',
      table_name
    );
  END LOOP;
END
$force_service_only_credential_tables$;

-- Nested Circle integration secrets have no direct circle_id column. Require
-- exact current membership in the parent integration as a restrictive guard;
-- manager policies continue to decide which current members may read/write.
CREATE OR REPLACE FUNCTION public.current_user_is_exact_integration_member_v1(
  p_integration_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.circle_integrations AS integration
    JOIN public.circle_members AS membership
      ON membership.circle_id = integration.circle_id
     AND membership.user_id = auth.uid()
    WHERE integration.id = p_integration_id
  );
$function$;

REVOKE ALL ON FUNCTION public.current_user_is_exact_integration_member_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_exact_integration_member_v1(uuid)
  TO authenticated;

DO $converge_circle_integration_secret_surface$
DECLARE
  secret_relkind "char";
BEGIN
  SELECT target.relkind
  INTO secret_relkind
  FROM pg_catalog.pg_class AS target
  WHERE target.oid = 'public.circle_integration_secrets'::regclass;

  IF secret_relkind IN ('r', 'p') THEN
    ALTER TABLE public.circle_integration_secrets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.circle_integration_secrets FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS circle_integration_secrets_exact_member_guard_v1
      ON public.circle_integration_secrets;
    CREATE POLICY circle_integration_secrets_exact_member_guard_v1
    ON public.circle_integration_secrets
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (public.current_user_is_exact_integration_member_v1(integration_id))
    WITH CHECK (public.current_user_is_exact_integration_member_v1(integration_id));
  ELSIF secret_relkind = 'v' THEN
    -- §40 moves the ciphertext table out of public and leaves this
    -- service-role-only compatibility view for existing Edge readers.
    REVOKE ALL ON TABLE public.circle_integration_secrets
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT ON TABLE public.circle_integration_secrets TO service_role;
  ELSE
    RAISE EXCEPTION
      'tenant_isolation_convergence: unsupported public.circle_integration_secrets relkind %',
      secret_relkind
      USING ERRCODE = '42809';
  END IF;
END
$converge_circle_integration_secret_surface$;

-- GitHub webhook verification secrets are plaintext compatibility data consumed
-- only by service-role webhook handling. Preserve the values, but remove every
-- authenticated/public column grant and expose only the non-secret connection
-- projection to Circle members. Existing row policies plus the catalog-wide
-- restrictive circle_id guard continue to enforce exact current membership.
ALTER TABLE public.circle_github_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_github_connections FORCE ROW LEVEL SECURITY;

REVOKE SELECT ON TABLE public.circle_github_connections
  FROM PUBLIC, anon, authenticated;

DO $revoke_github_connection_column_selects$
DECLARE
  column_row record;
BEGIN
  FOR column_row IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'circle_github_connections'
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE SELECT (%I) ON TABLE public.circle_github_connections FROM PUBLIC, anon, authenticated',
      column_row.column_name
    );
  END LOOP;
END
$revoke_github_connection_column_selects$;

GRANT SELECT (
  id,
  circle_id,
  connected_by,
  owner,
  repo,
  full_name,
  default_branch,
  webhook_id,
  events_enabled,
  notify_chat,
  notify_activity,
  is_active,
  last_event_at,
  event_count,
  created_at,
  updated_at
) ON TABLE public.circle_github_connections TO authenticated;
GRANT ALL ON TABLE public.circle_github_connections TO service_role;

COMMENT ON COLUMN public.circle_github_connections.webhook_secret IS
  'Legacy plaintext webhook HMAC secret retained for service-role verification compatibility; browser roles have no SELECT privilege.';

-- Office terminal command/response broadcasts and Circle presence carry
-- Circle-private runtime state. Realtime Authorization evaluates RLS on
-- realtime.messages only for channels opened with private:true. Exact
-- permissive policies admit the three canonical topic shapes; matching
-- restrictive prefix guards prevent any historical broad policy from
-- OR-admitting a malformed topic or a caller who lost Circle membership.
-- DEPLOYMENT PREREQUISITE: disable Realtime "Allow public access" in the
-- Supabase project settings and open these clients with private:true. SQL
-- policies cannot change or prove that project-level switch; until it is off,
-- this policy catalog is not evidence that private-channel RLS is enforced.
CREATE OR REPLACE FUNCTION public.office_realtime_topic_is_protected_v1(
  p_topic text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT
    p_topic LIKE 'office-terminal-cmd-%'
    OR p_topic LIKE 'office-terminal-resp-%'
    OR p_topic LIKE 'circle-presence-%';
$function$;

CREATE OR REPLACE FUNCTION public.office_realtime_topic_circle_id_v1(
  p_topic text
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN p_topic ~* '^(office-terminal-cmd|office-terminal-resp|circle-presence)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN pg_catalog.right(p_topic, 36)::uuid
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.office_realtime_topic_authorized_v1(
  p_topic text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id =
        public.office_realtime_topic_circle_id_v1(p_topic)
        AND membership.user_id = auth.uid()
    );
$function$;

REVOKE ALL ON FUNCTION public.office_realtime_topic_is_protected_v1(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.office_realtime_topic_circle_id_v1(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.office_realtime_topic_authorized_v1(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_realtime_topic_is_protected_v1(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.office_realtime_topic_circle_id_v1(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.office_realtime_topic_authorized_v1(text)
  TO authenticated;

-- Hosted Supabase owns realtime.messages through supabase_realtime_admin and
-- keeps RLS enabled. The postgres migration role may manage policies but must
-- not ALTER the platform-owned table.

DROP POLICY IF EXISTS office_realtime_exact_select_v1
  ON realtime.messages;
CREATE POLICY office_realtime_exact_select_v1
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.office_realtime_topic_authorized_v1(realtime.topic())
);

DROP POLICY IF EXISTS office_realtime_exact_insert_v1
  ON realtime.messages;
CREATE POLICY office_realtime_exact_insert_v1
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  public.office_realtime_topic_authorized_v1(realtime.topic())
);

DROP POLICY IF EXISTS office_realtime_prefix_select_guard_v1
  ON realtime.messages;
CREATE POLICY office_realtime_prefix_select_guard_v1
ON realtime.messages
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  NOT public.office_realtime_topic_is_protected_v1(realtime.topic())
  OR public.office_realtime_topic_authorized_v1(realtime.topic())
);

DROP POLICY IF EXISTS office_realtime_prefix_insert_guard_v1
  ON realtime.messages;
CREATE POLICY office_realtime_prefix_insert_guard_v1
ON realtime.messages
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  NOT public.office_realtime_topic_is_protected_v1(realtime.topic())
  OR public.office_realtime_topic_authorized_v1(realtime.topic())
);

-- Nested Room records are exact-current-Circle-member data. One fixed-path
-- helper covers both the active circle_rooms surface and project_rooms lineage.
CREATE OR REPLACE FUNCTION public.current_user_is_exact_room_member_v1(
  p_room_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_room_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.circle_rooms AS room
        JOIN public.circle_members AS membership
          ON membership.circle_id = room.circle_id
         AND membership.user_id = auth.uid()
        WHERE room.id = p_room_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.project_rooms AS room
        JOIN public.circle_members AS membership
          ON membership.circle_id = room.circle_id
         AND membership.user_id = auth.uid()
        WHERE room.id = p_room_id
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.current_user_is_exact_room_member_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_exact_room_member_v1(uuid)
  TO authenticated;

DO $room_nested_restrictive_guards$
DECLARE
  table_row record;
BEGIN
  FOR table_row IN
    SELECT DISTINCT table_info.table_name
    FROM information_schema.columns AS table_info
    JOIN pg_catalog.pg_class AS relation
      ON relation.relname = table_info.table_name
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
     AND namespace.nspname = table_info.table_schema
    WHERE table_info.table_schema = 'public'
      AND table_info.column_name = 'room_id'
      AND table_info.data_type = 'uuid'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS exact_current_room_member_guard_v1 ON public.%I',
      table_row.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY exact_current_room_member_guard_v1 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (room_id IS NULL OR public.current_user_is_exact_room_member_v1(room_id)) WITH CHECK (room_id IS NULL OR public.current_user_is_exact_room_member_v1(room_id))',
      table_row.table_name
    );
  END LOOP;
END
$room_nested_restrictive_guards$;

-- Service-role runners bypass RLS, so revocation must be re-proven in the
-- exact transaction that claims/dispatches work. These helpers inspect the
-- captured owner, not auth.uid(), and the triggers fire for every database
-- role including service_role.
CREATE OR REPLACE FUNCTION public.user_has_exact_circle_thread_access_v1(
  p_user_id uuid,
  p_circle_id uuid,
  p_thread_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    p_user_id IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = p_user_id
    )
    AND (
      p_thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = p_thread_id
          AND thread.circle_id = p_circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = p_user_id
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = p_user_id
            )
          )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.user_has_exact_circle_thread_access_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_exact_circle_thread_access_v1(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.current_user_has_exact_circle_thread_access_v1(
  p_circle_id uuid,
  p_thread_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    public.current_user_is_exact_circle_member_v1(p_circle_id)
    AND (
      p_thread_id IS NULL
      OR public.message_thread_visible_to_current_user(p_circle_id, p_thread_id)
    );
$function$;

REVOKE ALL ON FUNCTION public.current_user_has_exact_circle_thread_access_v1(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_exact_circle_thread_access_v1(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_computer_schedule_claim_scope_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.next_run_at > OLD.next_run_at THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.thread_id IS DISTINCT FROM OLD.thread_id THEN
      RAISE EXCEPTION 'computer_schedule_claim_scope_changed'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.active IS NOT TRUE
       OR NOT public.user_has_exact_circle_thread_access_v1(
         NEW.created_by,
         NEW.circle_id,
         NEW.thread_id
       ) THEN
      RAISE EXCEPTION 'computer_schedule_claim_authority_revoked'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_computer_schedule_claim_scope_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS zz_guard_computer_schedule_claim_scope_v1
  ON public.computer_use_schedules;
CREATE TRIGGER zz_guard_computer_schedule_claim_scope_v1
BEFORE UPDATE ON public.computer_use_schedules
FOR EACH ROW
EXECUTE FUNCTION public.guard_computer_schedule_claim_scope_v1();

CREATE OR REPLACE FUNCTION public.guard_scheduled_action_dispatch_scope_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NOT NULL THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.circle_id IS DISTINCT FROM OLD.circle_id THEN
      RAISE EXCEPTION 'scheduled_action_dispatch_scope_changed'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.circle_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = NEW.circle_id
        AND membership.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'scheduled_action_dispatch_authority_revoked'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_scheduled_action_dispatch_scope_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS zz_guard_scheduled_action_dispatch_scope_v1
  ON public.scheduled_actions;
CREATE TRIGGER zz_guard_scheduled_action_dispatch_scope_v1
BEFORE UPDATE ON public.scheduled_actions
FOR EACH ROW
EXECUTE FUNCTION public.guard_scheduled_action_dispatch_scope_v1();

-- Raw watch rows contain task text and prior findings. They belong only to the
-- creating account while that account remains authorized for the exact Circle
-- and private/shared/circle thread. Shared status needs a separate sanitized
-- projection, not a broad raw-table SELECT policy.
ALTER TABLE public.computer_use_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.computer_use_schedules FORCE ROW LEVEL SECURITY;

DO $drop_computer_schedule_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'computer_use_schedules'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.computer_use_schedules',
      policy_row.policyname
    );
  END LOOP;
END
$drop_computer_schedule_policies$;

CREATE POLICY computer_use_schedules_owner_scope_select_v1
ON public.computer_use_schedules
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  AND public.current_user_has_exact_circle_thread_access_v1(
    circle_id,
    thread_id
  )
);

CREATE POLICY computer_use_schedules_owner_scope_insert_v1
ON public.computer_use_schedules
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.current_user_has_exact_circle_thread_access_v1(
    circle_id,
    thread_id
  )
);

CREATE POLICY computer_use_schedules_owner_scope_update_v1
ON public.computer_use_schedules
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.current_user_has_exact_circle_thread_access_v1(
    circle_id,
    thread_id
  )
)
WITH CHECK (
  created_by = auth.uid()
  AND public.current_user_has_exact_circle_thread_access_v1(
    circle_id,
    thread_id
  )
);

CREATE POLICY computer_use_schedules_owner_scope_delete_v1
ON public.computer_use_schedules
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.current_user_has_exact_circle_thread_access_v1(
    circle_id,
    thread_id
  )
);

-- scheduled_actions.payload may contain webhook headers, recipients, content,
-- and connector details. Raw rows are owner-only; Circle members do not gain
-- payload access merely because an action is Circle-scoped.
ALTER TABLE public.scheduled_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_actions FORCE ROW LEVEL SECURITY;

DO $drop_scheduled_action_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scheduled_actions'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.scheduled_actions',
      policy_row.policyname
    );
  END LOOP;
END
$drop_scheduled_action_policies$;

CREATE POLICY scheduled_actions_owner_scope_select_v1
ON public.scheduled_actions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND (
    circle_id IS NULL
    OR public.current_user_is_exact_circle_member_v1(circle_id)
  )
);

CREATE POLICY scheduled_actions_owner_scope_insert_v1
ON public.scheduled_actions
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    circle_id IS NULL
    OR public.current_user_is_exact_circle_member_v1(circle_id)
  )
);

CREATE POLICY scheduled_actions_owner_scope_update_v1
ON public.scheduled_actions
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND (
    circle_id IS NULL
    OR public.current_user_is_exact_circle_member_v1(circle_id)
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND (
    circle_id IS NULL
    OR public.current_user_is_exact_circle_member_v1(circle_id)
  )
);

CREATE POLICY scheduled_actions_owner_scope_delete_v1
ON public.scheduled_actions
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND (
    circle_id IS NULL
    OR public.current_user_is_exact_circle_member_v1(circle_id)
  )
);


-- Slack/Teams connection rows may target an organization, a Circle, or both.
-- Every non-null target must authorize installed_by, and a combined target
-- must bind the Circle to the exact same organization. This BEFORE trigger is
-- the atomic commit-time recheck for service-role OAuth callbacks.
CREATE OR REPLACE FUNCTION public.connection_targets_authorized_for_user_v1(
  p_user_id uuid,
  p_org_id uuid,
  p_circle_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    p_user_id IS NOT NULL
    AND (p_org_id IS NOT NULL OR p_circle_id IS NOT NULL)
    AND (
      p_org_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.org_members AS membership
        WHERE membership.org_id = p_org_id
          AND membership.user_id = p_user_id
          AND membership.role IN ('owner', 'admin')
      )
    )
    AND (
      p_circle_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_members AS membership
        WHERE membership.circle_id = p_circle_id
          AND membership.user_id = p_user_id
          AND membership.role = 'creator'
      )
    )
    AND (
      p_org_id IS NULL
      OR p_circle_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circles AS circle
        WHERE circle.id = p_circle_id
          AND circle.org_id = p_org_id
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_connection_targets_v1(
  p_org_id uuid,
  p_circle_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT public.connection_targets_authorized_for_user_v1(
    auth.uid(),
    p_org_id,
    p_circle_id
  );
$function$;

REVOKE ALL ON FUNCTION public.connection_targets_authorized_for_user_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_can_manage_connection_targets_v1(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_connection_targets_v1(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_connection_target_binding_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.installed_by IS DISTINCT FROM OLD.installed_by
  ) THEN
    RAISE EXCEPTION 'connection_target_binding_is_immutable'
      USING ERRCODE = '23514';
  END IF;

  IF auth.role() <> 'service_role'
     AND (auth.uid() IS NULL OR NEW.installed_by IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'connection_installer_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_active IS TRUE
     AND NOT public.connection_targets_authorized_for_user_v1(
       NEW.installed_by,
       NEW.org_id,
       NEW.circle_id
     ) THEN
    RAISE EXCEPTION 'connection_target_authority_revoked_or_mismatched'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_connection_target_binding_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS slack_connections_guard_target_binding_v1
  ON public.slack_connections;
CREATE TRIGGER slack_connections_guard_target_binding_v1
BEFORE INSERT OR UPDATE ON public.slack_connections
FOR EACH ROW
EXECUTE FUNCTION public.guard_connection_target_binding_v1();

DROP TRIGGER IF EXISTS teams_connections_guard_target_binding_v1
  ON public.teams_connections;
CREATE TRIGGER teams_connections_guard_target_binding_v1
BEFORE INSERT OR UPDATE ON public.teams_connections
FOR EACH ROW
EXECUTE FUNCTION public.guard_connection_target_binding_v1();

ALTER TABLE public.slack_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teams_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS slack_connections_exact_target_guard_v1
  ON public.slack_connections;
CREATE POLICY slack_connections_exact_target_guard_v1
ON public.slack_connections
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.current_user_can_manage_connection_targets_v1(org_id, circle_id))
WITH CHECK (
  installed_by = auth.uid()
  AND public.current_user_can_manage_connection_targets_v1(org_id, circle_id)
);

DROP POLICY IF EXISTS teams_connections_exact_target_guard_v1
  ON public.teams_connections;
CREATE POLICY teams_connections_exact_target_guard_v1
ON public.teams_connections
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.current_user_can_manage_connection_targets_v1(org_id, circle_id))
WITH CHECK (
  installed_by = auth.uid()
  AND public.current_user_can_manage_connection_targets_v1(org_id, circle_id)
);

-- Reports are private to their creator and to the explicit non-empty set of
-- Circles sealed into metadata.circle_ids. A pending creator-owned row may be
-- read/deleted before Edge seals an omitted selection; every non-pending row
-- fails closed unless all recorded Circles are still exact current memberships
-- in the report's organization.
CREATE OR REPLACE FUNCTION public.report_circle_scope_is_empty_v1(
  p_metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN p_metadata IS NULL OR NOT (p_metadata ? 'circle_ids') THEN true
    WHEN pg_catalog.jsonb_typeof(p_metadata -> 'circle_ids') <> 'array' THEN false
    ELSE pg_catalog.jsonb_array_length(p_metadata -> 'circle_ids') = 0
  END;
$function$;

CREATE OR REPLACE FUNCTION public.report_circle_scope_authorized_v1(
  p_org_id uuid,
  p_metadata jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  circle_ids jsonb;
  circle_id_text text;
  normalized_circle_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR p_org_id IS NULL
     OR p_metadata IS NULL
     OR pg_catalog.jsonb_typeof(p_metadata) <> 'object' THEN
    RETURN false;
  END IF;

  circle_ids := p_metadata -> 'circle_ids';
  IF circle_ids IS NULL
     OR pg_catalog.jsonb_typeof(circle_ids) <> 'array'
     OR pg_catalog.jsonb_array_length(circle_ids) = 0 THEN
    RETURN false;
  END IF;

  FOR circle_id_text IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements_text(circle_ids)
  LOOP
    IF circle_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
    normalized_circle_id := circle_id_text::uuid;

    IF NOT EXISTS (
      SELECT 1
      FROM public.circles AS circle
      JOIN public.circle_members AS membership
        ON membership.circle_id = circle.id
       AND membership.user_id = auth.uid()
      WHERE circle.id = normalized_circle_id
        AND circle.org_id = p_org_id
    ) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION
  WHEN invalid_text_representation OR data_exception THEN
    RETURN false;
END
$function$;

REVOKE ALL ON FUNCTION public.report_circle_scope_is_empty_v1(jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_circle_scope_authorized_v1(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_circle_scope_is_empty_v1(jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_circle_scope_authorized_v1(uuid, jsonb)
  TO authenticated;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports FORCE ROW LEVEL SECURITY;

DO $drop_report_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reports'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.reports',
      policy_row.policyname
    );
  END LOOP;
END
$drop_report_policies$;

CREATE POLICY reports_creator_exact_scope_select_v1
ON public.reports
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  AND (
    public.report_circle_scope_authorized_v1(org_id, metadata)
    OR (
      status = 'pending'
      AND public.report_circle_scope_is_empty_v1(metadata)
    )
  )
);

CREATE POLICY reports_creator_exact_scope_insert_v1
ON public.reports
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND status = 'pending'
  AND file_url IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.org_members AS membership
    WHERE membership.org_id = reports.org_id
      AND membership.user_id = auth.uid()
      AND membership.role IN ('owner', 'admin')
  )
  AND (
    public.report_circle_scope_is_empty_v1(metadata)
    OR public.report_circle_scope_authorized_v1(org_id, metadata)
  )
);

CREATE POLICY reports_creator_exact_scope_delete_v1
ON public.reports
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  AND (
    public.report_circle_scope_authorized_v1(org_id, metadata)
    OR (
      status = 'pending'
      AND public.report_circle_scope_is_empty_v1(metadata)
    )
  )
);

REVOKE ALL ON TABLE public.reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.reports TO authenticated;
GRANT ALL ON TABLE public.reports TO service_role;

-- ── Private Storage convergence ────────────────────────────────────────────
-- Canonical paths:
--   task-images   <task UUID>/<single filename>
--   room-files    rooms/<circle_rooms UUID>/<single filename>
--   circle-images circles/<Circle UUID>/icon.<safe image extension>
--   reports       reports/<org UUID>/<report UUID>/<single filename>
-- Reports are service-written/read only through signed URLs. The other three
-- buckets expose authenticated exact-scope SELECT and owner-bound mutations.

CREATE OR REPLACE FUNCTION public.task_image_path_authorized(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]{1,180}$'
    AND EXISTS (
      SELECT 1
      FROM public.tasks AS task
      JOIN public.circle_members AS membership
        ON membership.circle_id = task.circle_id
       AND membership.user_id = auth.uid()
      WHERE task.id::text = pg_catalog.split_part(p_name, '/', 1)
    );
$function$;

CREATE OR REPLACE FUNCTION public.room_file_path_authorized_v1(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_name ~* '^rooms/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]{1,180}$'
    AND EXISTS (
      SELECT 1
      FROM public.circle_rooms AS room
      JOIN public.circle_members AS membership
        ON membership.circle_id = room.circle_id
       AND membership.user_id = auth.uid()
      WHERE room.id::text = pg_catalog.split_part(p_name, '/', 2)
    );
$function$;

CREATE OR REPLACE FUNCTION public.circle_image_path_member_v1(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_name ~* '^circles/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/icon\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$'
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id::text = pg_catalog.split_part(p_name, '/', 2)
        AND membership.user_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public.circle_image_path_creator_v1(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    public.circle_image_path_member_v1(p_name)
    AND EXISTS (
      SELECT 1
      FROM public.circles AS circle
      WHERE circle.id::text = pg_catalog.split_part(p_name, '/', 2)
        AND circle.created_by = auth.uid()
    );
$function$;

REVOKE ALL ON FUNCTION public.task_image_path_authorized(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.room_file_path_authorized_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.circle_image_path_member_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.circle_image_path_creator_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_image_path_authorized(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.room_file_path_authorized_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.circle_image_path_member_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.circle_image_path_creator_v1(text) TO authenticated;

DO $private_bucket_identity_preflight$
DECLARE
  bucket_name text;
BEGIN
  FOREACH bucket_name IN ARRAY ARRAY[
    'task-images',
    'room-files',
    'circle-images',
    'reports'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM storage.buckets AS bucket
      WHERE (bucket.id = bucket_name AND bucket.name <> bucket_name)
         OR (bucket.name = bucket_name AND bucket.id <> bucket_name)
    ) THEN
      RAISE EXCEPTION 'tenant_isolation_convergence: % bucket identity mismatch; inspect before applying', bucket_name
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
END
$private_bucket_identity_preflight$;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES
  (
    'task-images',
    'task-images',
    false,
    10485760,
    ARRAY[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
      'application/pdf', 'application/json', 'text/plain', 'text/markdown',
      'text/csv'
    ]::text[]
  ),
  ('room-files', 'room-files', false, 52428800, NULL),
  (
    'circle-images',
    'circle-images',
    false,
    5242880,
    ARRAY[
      'image/avif', 'image/bmp', 'image/gif', 'image/heic', 'image/heif',
      'image/jpeg', 'image/png', 'image/webp'
    ]::text[]
  ),
  (
    'reports',
    'reports',
    false,
    52428800,
    ARRAY['text/csv', 'text/html', 'application/pdf']::text[]
  )
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

UPDATE storage.buckets
SET public = false
WHERE id IN ('task-images', 'room-files', 'circle-images', 'reports')
  AND name = id;

-- Hosted Supabase owns storage.objects through supabase_storage_admin and
-- keeps RLS enabled. The postgres migration role may manage policies but must
-- not ALTER the platform-owned table.

-- Remove every historical/canonical policy name owned by these buckets. The
-- restrictive guards below also defeat any unknown broad permissive policy.
DROP POLICY IF EXISTS "Authenticated users can upload task images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for task images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete task images" ON storage.objects;
DROP POLICY IF EXISTS "Task members can upload owned task images" ON storage.objects;
DROP POLICY IF EXISTS "Task image owners can delete own uploads" ON storage.objects;

DROP POLICY IF EXISTS tenant_task_images_member_select_v1 ON storage.objects;
DROP POLICY IF EXISTS tenant_task_images_owner_insert_v1 ON storage.objects;
DROP POLICY IF EXISTS tenant_task_images_owner_delete_v1 ON storage.objects;
DROP POLICY IF EXISTS tenant_room_files_member_select_v1 ON storage.objects;
DROP POLICY IF EXISTS tenant_room_files_owner_insert_v1 ON storage.objects;
DROP POLICY IF EXISTS tenant_room_files_owner_delete_v1 ON storage.objects;
DROP POLICY IF EXISTS tenant_circle_images_member_select_v1 ON storage.objects;
DROP POLICY IF EXISTS tenant_circle_images_creator_insert_v1 ON storage.objects;
DROP POLICY IF EXISTS tenant_circle_images_creator_update_v1 ON storage.objects;
DROP POLICY IF EXISTS tenant_circle_images_creator_delete_v1 ON storage.objects;

CREATE POLICY tenant_task_images_member_select_v1
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'task-images'
  AND public.task_image_path_authorized(name)
);

CREATE POLICY tenant_task_images_owner_insert_v1
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'task-images'
  AND owner_id::text = auth.uid()::text
  AND public.task_image_path_authorized(name)
);

CREATE POLICY tenant_task_images_owner_delete_v1
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'task-images'
  AND owner_id::text = auth.uid()::text
  AND public.task_image_path_authorized(name)
);

CREATE POLICY tenant_room_files_member_select_v1
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'room-files'
  AND public.room_file_path_authorized_v1(name)
);

CREATE POLICY tenant_room_files_owner_insert_v1
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'room-files'
  AND owner_id::text = auth.uid()::text
  AND public.room_file_path_authorized_v1(name)
);

CREATE POLICY tenant_room_files_owner_delete_v1
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'room-files'
  AND owner_id::text = auth.uid()::text
  AND public.room_file_path_authorized_v1(name)
);

CREATE POLICY tenant_circle_images_member_select_v1
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'circle-images'
  AND public.circle_image_path_member_v1(name)
);

CREATE POLICY tenant_circle_images_creator_insert_v1
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'circle-images'
  AND owner_id::text = auth.uid()::text
  AND public.circle_image_path_creator_v1(name)
);

CREATE POLICY tenant_circle_images_creator_update_v1
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'circle-images'
  AND owner_id::text = auth.uid()::text
  AND public.circle_image_path_creator_v1(name)
)
WITH CHECK (
  bucket_id = 'circle-images'
  AND owner_id::text = auth.uid()::text
  AND public.circle_image_path_creator_v1(name)
);

CREATE POLICY tenant_circle_images_creator_delete_v1
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'circle-images'
  AND owner_id::text = auth.uid()::text
  AND public.circle_image_path_creator_v1(name)
);

DROP POLICY IF EXISTS tenant_private_storage_authenticated_select_guard_v1
  ON storage.objects;
DROP POLICY IF EXISTS tenant_private_storage_authenticated_insert_guard_v1
  ON storage.objects;
DROP POLICY IF EXISTS tenant_private_storage_authenticated_update_guard_v1
  ON storage.objects;
DROP POLICY IF EXISTS tenant_private_storage_authenticated_delete_guard_v1
  ON storage.objects;
DROP POLICY IF EXISTS tenant_private_storage_anon_select_guard_v1
  ON storage.objects;
DROP POLICY IF EXISTS tenant_private_storage_anon_insert_guard_v1
  ON storage.objects;
DROP POLICY IF EXISTS tenant_private_storage_anon_update_guard_v1
  ON storage.objects;
DROP POLICY IF EXISTS tenant_private_storage_anon_delete_guard_v1
  ON storage.objects;

CREATE POLICY tenant_private_storage_authenticated_select_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  CASE bucket_id
    WHEN 'task-images' THEN public.task_image_path_authorized(name)
    WHEN 'room-files' THEN public.room_file_path_authorized_v1(name)
    WHEN 'circle-images' THEN public.circle_image_path_member_v1(name)
    WHEN 'reports' THEN false
    ELSE true
  END
);

CREATE POLICY tenant_private_storage_authenticated_insert_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  CASE bucket_id
    WHEN 'task-images' THEN
      owner_id::text = auth.uid()::text
      AND public.task_image_path_authorized(name)
    WHEN 'room-files' THEN
      owner_id::text = auth.uid()::text
      AND public.room_file_path_authorized_v1(name)
    WHEN 'circle-images' THEN
      owner_id::text = auth.uid()::text
      AND public.circle_image_path_creator_v1(name)
    WHEN 'reports' THEN false
    ELSE true
  END
);

CREATE POLICY tenant_private_storage_authenticated_update_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  CASE bucket_id
    WHEN 'task-images' THEN false
    WHEN 'room-files' THEN false
    WHEN 'circle-images' THEN
      owner_id::text = auth.uid()::text
      AND public.circle_image_path_creator_v1(name)
    WHEN 'reports' THEN false
    ELSE true
  END
)
WITH CHECK (
  CASE bucket_id
    WHEN 'task-images' THEN false
    WHEN 'room-files' THEN false
    WHEN 'circle-images' THEN
      owner_id::text = auth.uid()::text
      AND public.circle_image_path_creator_v1(name)
    WHEN 'reports' THEN false
    ELSE true
  END
);

CREATE POLICY tenant_private_storage_authenticated_delete_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  CASE bucket_id
    WHEN 'task-images' THEN
      owner_id::text = auth.uid()::text
      AND public.task_image_path_authorized(name)
    WHEN 'room-files' THEN
      owner_id::text = auth.uid()::text
      AND public.room_file_path_authorized_v1(name)
    WHEN 'circle-images' THEN
      owner_id::text = auth.uid()::text
      AND public.circle_image_path_creator_v1(name)
    WHEN 'reports' THEN false
    ELSE true
  END
);

CREATE POLICY tenant_private_storage_anon_select_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO anon
USING (bucket_id NOT IN ('task-images', 'room-files', 'circle-images', 'reports'));

CREATE POLICY tenant_private_storage_anon_insert_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO anon
WITH CHECK (bucket_id NOT IN ('task-images', 'room-files', 'circle-images', 'reports'));

CREATE POLICY tenant_private_storage_anon_update_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO anon
USING (bucket_id NOT IN ('task-images', 'room-files', 'circle-images', 'reports'))
WITH CHECK (bucket_id NOT IN ('task-images', 'room-files', 'circle-images', 'reports'));

CREATE POLICY tenant_private_storage_anon_delete_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO anon
USING (bucket_id NOT IN ('task-images', 'room-files', 'circle-images', 'reports'));

-- Direct and nested Circle records get restrictive current-membership guards.
-- This is intentionally catalog-driven: it covers old owner/creator/installer
-- policy names without needing to know each historical spelling, while
-- preserving the narrower permissive policies that decide allowed commands.
DO $direct_circle_restrictive_guards$
DECLARE
  table_row record;
BEGIN
  FOR table_row IN
    SELECT DISTINCT column_info.table_name
    FROM information_schema.columns AS column_info
    JOIN pg_catalog.pg_class AS relation
      ON relation.relname = column_info.table_name
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
     AND namespace.nspname = column_info.table_schema
    WHERE column_info.table_schema = 'public'
      AND column_info.column_name = 'circle_id'
      AND column_info.data_type = 'uuid'
      AND relation.relkind IN ('r', 'p')
      AND column_info.table_name NOT IN (
        'circle_members',
        'agent_connect_tokens'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      table_row.table_name
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
      table_row.table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS exact_current_circle_member_guard_v1 ON public.%I',
      table_row.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY exact_current_circle_member_guard_v1 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (circle_id IS NULL OR public.current_user_is_exact_circle_member_v1(circle_id)) WITH CHECK (circle_id IS NULL OR public.current_user_is_exact_circle_member_v1(circle_id))',
      table_row.table_name
    );
  END LOOP;
END
$direct_circle_restrictive_guards$;

CREATE OR REPLACE FUNCTION public.current_user_is_exact_task_member_v1(
  p_task_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.tasks AS task
    JOIN public.circle_members AS membership
      ON membership.circle_id = task.circle_id
     AND membership.user_id = auth.uid()
    WHERE task.id = p_task_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.current_user_is_exact_mission_member_v1(
  p_mission_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.circle_missions AS mission
    JOIN public.circle_members AS membership
      ON membership.circle_id = mission.circle_id
     AND membership.user_id = auth.uid()
    WHERE mission.id = p_mission_id
  );
$function$;

REVOKE ALL ON FUNCTION public.current_user_is_exact_task_member_v1(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_is_exact_mission_member_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_exact_task_member_v1(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_exact_mission_member_v1(uuid)
  TO authenticated;

DO $nested_task_mission_restrictive_guards$
DECLARE
  table_row record;
BEGIN
  FOR table_row IN
    SELECT DISTINCT column_info.table_name
    FROM information_schema.columns AS column_info
    JOIN pg_catalog.pg_class AS relation
      ON relation.relname = column_info.table_name
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
     AND namespace.nspname = column_info.table_schema
    WHERE column_info.table_schema = 'public'
      AND column_info.column_name = 'task_id'
      AND column_info.data_type = 'uuid'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS exact_current_task_member_guard_v1 ON public.%I',
      table_row.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY exact_current_task_member_guard_v1 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (task_id IS NULL OR public.current_user_is_exact_task_member_v1(task_id)) WITH CHECK (task_id IS NULL OR public.current_user_is_exact_task_member_v1(task_id))',
      table_row.table_name
    );
  END LOOP;

  FOR table_row IN
    SELECT DISTINCT column_info.table_name
    FROM information_schema.columns AS column_info
    JOIN pg_catalog.pg_class AS relation
      ON relation.relname = column_info.table_name
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
     AND namespace.nspname = column_info.table_schema
    WHERE column_info.table_schema = 'public'
      AND column_info.column_name = 'mission_id'
      AND column_info.data_type = 'uuid'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS exact_current_mission_member_guard_v1 ON public.%I',
      table_row.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY exact_current_mission_member_guard_v1 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (mission_id IS NULL OR public.current_user_is_exact_mission_member_v1(mission_id)) WITH CHECK (mission_id IS NULL OR public.current_user_is_exact_mission_member_v1(mission_id))',
      table_row.table_name
    );
  END LOOP;
END
$nested_task_mission_restrictive_guards$;

-- Room secrets were documented as encrypted but the active UI can persist raw
-- values. They are therefore personal credentials, not shared Room records.
-- Ambiguous legacy NULL-owner rows stay stored for operator recovery but fail
-- closed under RLS; a NOT VALID constraint rejects every new NULL owner.
ALTER TABLE public.room_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_secrets FORCE ROW LEVEL SECURITY;

DO $drop_room_secrets_shared_unique$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT constraint_info.conname
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = 'public.room_secrets'::regclass
      AND constraint_info.contype = 'u'
      AND pg_catalog.pg_get_constraintdef(constraint_info.oid)
        ~* '^UNIQUE \(room_id, key\)'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.room_secrets DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END
$drop_room_secrets_shared_unique$;
ALTER TABLE public.room_secrets
  DROP CONSTRAINT IF EXISTS room_secrets_created_by_required_v1;
ALTER TABLE public.room_secrets
  ADD CONSTRAINT room_secrets_created_by_required_v1
  CHECK (created_by IS NOT NULL) NOT VALID;

DO $room_secrets_owner_unique$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.room_secrets'::regclass
      AND conname = 'room_secrets_room_owner_key_unique_v1'
  ) THEN
    ALTER TABLE public.room_secrets
      ADD CONSTRAINT room_secrets_room_owner_key_unique_v1
      UNIQUE (room_id, created_by, key);
  END IF;
END
$room_secrets_owner_unique$;

DO $drop_room_secret_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'room_secrets'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.room_secrets',
      policy_row.policyname
    );
  END LOOP;
END
$drop_room_secret_policies$;

CREATE POLICY room_secrets_owner_scope_select_v1
ON public.room_secrets
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  AND public.current_user_is_exact_room_member_v1(room_id)
);

CREATE POLICY room_secrets_owner_scope_insert_v1
ON public.room_secrets
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.current_user_is_exact_room_member_v1(room_id)
);

CREATE POLICY room_secrets_owner_scope_update_v1
ON public.room_secrets
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.current_user_is_exact_room_member_v1(room_id)
)
WITH CHECK (
  created_by = auth.uid()
  AND public.current_user_is_exact_room_member_v1(room_id)
);

CREATE POLICY room_secrets_owner_scope_delete_v1
ON public.room_secrets
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.current_user_is_exact_room_member_v1(room_id)
);

REVOKE ALL ON TABLE public.room_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.room_secrets TO authenticated;
GRANT ALL ON TABLE public.room_secrets TO service_role;

-- Raw profiles contain Office preferences/layouts, training/privacy settings,
-- wallet/account details, and other owner-private fields. Converge the base
-- table to self-only. The bounded safe_profiles view is the sole cross-user
-- profile surface and includes only presentation/streak fields; wallet fields
-- are null for peers.
CREATE OR REPLACE FUNCTION public.users_share_current_circle_v1(
  p_other_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_other_user_id IS NOT NULL
    AND (
      p_other_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.circle_members AS caller_membership
        JOIN public.circle_members AS peer_membership
          ON peer_membership.circle_id = caller_membership.circle_id
         AND peer_membership.user_id = p_other_user_id
        WHERE caller_membership.user_id = auth.uid()
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.users_share_current_circle_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_share_current_circle_v1(uuid)
  TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

DO $drop_profile_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.profiles',
      policy_row.policyname
    );
  END LOOP;
END
$drop_profile_policies$;

CREATE POLICY profiles_self_select_v1
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY profiles_self_insert_v1
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

CREATE POLICY profiles_self_update_v1
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

CREATE OR REPLACE VIEW public.safe_profiles
WITH (security_barrier = true)
AS
SELECT
  profile.id,
  profile.username,
  profile.display_name,
  profile.avatar_url,
  profile.bio,
  profile.current_streak,
  profile.longest_streak,
  profile.created_at,
  CASE WHEN profile.id = auth.uid() THEN profile.wallet_address ELSE NULL END
    AS wallet_address,
  CASE WHEN profile.id = auth.uid() THEN profile.wallet_chain ELSE NULL END
    AS wallet_chain
FROM public.profiles AS profile
WHERE public.users_share_current_circle_v1(profile.id);

DO $safe_profiles_security_mode$
BEGIN
  -- PostgreSQL 15 introduced security_invoker. Older releases are definer by
  -- default and reject the reloption at parse time, so set it dynamically only
  -- where supported. This also clears the historical PG15 invoker=true option.
  IF pg_catalog.current_setting('server_version_num')::integer >= 150000 THEN
    EXECUTE
      'ALTER VIEW public.safe_profiles SET (security_invoker = false)';
  END IF;
END
$safe_profiles_security_mode$;

REVOKE ALL ON TABLE public.safe_profiles FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.safe_profiles TO authenticated;

-- Trade recommendations, executions, and learned strategy content are personal
-- account data. Remove the historical authenticated-wide featured-trades read
-- and converge all three tables to exact owner browser surfaces.
DO $converge_personal_trading_policies$
DECLARE
  table_name text;
  policy_row record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'featured_trades',
    'featured_trade_executions',
    'spirit_learnings'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      table_name
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
      table_name
    );

    FOR policy_row IN
      SELECT policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY %I ON public.%I',
        policy_row.policyname,
        table_name
      );
    END LOOP;
  END LOOP;
END
$converge_personal_trading_policies$;

CREATE POLICY featured_trades_owner_select_v1
ON public.featured_trades
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY featured_trade_executions_owner_select_v1
ON public.featured_trade_executions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY featured_trade_executions_owner_insert_v1
ON public.featured_trade_executions
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.featured_trades AS trade
    WHERE trade.id = featured_trade_id
      AND trade.user_id = auth.uid()
  )
);

CREATE POLICY featured_trade_executions_owner_update_v1
ON public.featured_trade_executions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.featured_trades AS trade
    WHERE trade.id = featured_trade_id
      AND trade.user_id = auth.uid()
  )
);

CREATE POLICY spirit_learnings_owner_select_v1
ON public.spirit_learnings
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.featured_trades FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.featured_trades TO authenticated;
GRANT ALL ON TABLE public.featured_trades TO service_role;

REVOKE ALL ON TABLE public.featured_trade_executions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.featured_trade_executions TO authenticated;
GRANT ALL ON TABLE public.featured_trade_executions TO service_role;

REVOKE ALL ON TABLE public.spirit_learnings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.spirit_learnings TO authenticated;
GRANT ALL ON TABLE public.spirit_learnings TO service_role;

-- Leaderboard/profile-adjacent gamification rows previously exposed every
-- account through USING (true). Preserve current-Circle peer reads, but keep
-- every mutation tied to the authenticated row owner.
DO $drop_peer_gamification_policies$
DECLARE
  target_table text;
  policy_row record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'user_points',
    'user_badges',
    'user_xp'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      target_table
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
      target_table
    );

    FOR policy_row IN
      SELECT policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY %I ON public.%I',
        policy_row.policyname,
        target_table
      );
    END LOOP;
  END LOOP;
END
$drop_peer_gamification_policies$;

CREATE POLICY user_points_current_circle_select_v1
ON public.user_points
FOR SELECT
TO authenticated
USING (public.users_share_current_circle_v1(user_id));

CREATE POLICY user_points_self_insert_v1
ON public.user_points
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY user_points_self_update_v1
ON public.user_points
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY user_points_self_delete_v1
ON public.user_points
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY user_badges_current_circle_select_v1
ON public.user_badges
FOR SELECT
TO authenticated
USING (public.users_share_current_circle_v1(user_id));

CREATE POLICY user_badges_self_insert_v1
ON public.user_badges
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY user_badges_self_update_v1
ON public.user_badges
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY user_badges_self_delete_v1
ON public.user_badges
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY user_xp_current_circle_select_v1
ON public.user_xp
FOR SELECT
TO authenticated
USING (public.users_share_current_circle_v1(user_id));

CREATE POLICY user_xp_self_insert_v1
ON public.user_xp
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY user_xp_self_update_v1
ON public.user_xp
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY user_xp_self_delete_v1
ON public.user_xp
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.user_points FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_points TO authenticated;
GRANT ALL ON TABLE public.user_points TO service_role;

REVOKE ALL ON TABLE public.user_badges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_badges TO authenticated;
GRANT ALL ON TABLE public.user_badges TO service_role;

REVOKE ALL ON TABLE public.user_xp FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_xp TO authenticated;
GRANT ALL ON TABLE public.user_xp TO service_role;

-- The research run log has no tenant/owner key and contains raw query,
-- summary, and error material. Without exact row authority, browser access
-- cannot be made safe; retain it as a service-run operational audit only.
ALTER TABLE public.research_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_agent_runs FORCE ROW LEVEL SECURITY;

DO $drop_research_run_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'research_agent_runs'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.research_agent_runs',
      policy_row.policyname
    );
  END LOOP;
END
$drop_research_run_policies$;

REVOKE ALL ON TABLE public.research_agent_runs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.research_agent_runs TO service_role;

-- The legacy fallback RPC accepted an arbitrary user UUID under SECURITY
-- DEFINER and therefore bypassed RLS for cross-account Circle enumeration.
-- Preserve the deployed bounded TABLE wire shape, but bind both the argument
-- and membership predicate to auth.uid(). The projection omits every Circle
-- capability-secret column entirely; nonmembers and anon receive no function
-- authority.
CREATE OR REPLACE FUNCTION public.get_user_circles(
  user_uuid uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  invite_code text,
  max_members integer,
  created_by uuid,
  created_at timestamptz,
  member_count bigint,
  user_role text,
  circle_image_url text,
  vibe text,
  tab_visibility jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR (user_uuid IS NOT NULL AND user_uuid IS DISTINCT FROM auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      circle.id,
      circle.name,
      circle.description,
      circle.invite_code,
      circle.max_members,
      circle.created_by,
      circle.created_at,
      count(member_count.user_id)::bigint,
      membership.role,
      circle.circle_image_url,
      circle.vibe,
      circle.tab_visibility
    FROM public.circles AS circle
    JOIN public.circle_members AS membership
      ON membership.circle_id = circle.id
     AND membership.user_id = auth.uid()
    LEFT JOIN public.circle_members AS member_count
      ON member_count.circle_id = circle.id
    GROUP BY
      circle.id,
      circle.name,
      circle.description,
      circle.invite_code,
      circle.max_members,
      circle.created_by,
      circle.created_at,
      membership.role,
      circle.circle_image_url,
      circle.vibe,
      circle.tab_visibility
    ORDER BY circle.created_at DESC
  ;
END
$function$;

REVOKE ALL ON FUNCTION public.get_user_circles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_circles(uuid) TO authenticated;

COMMENT ON COLUMN public.agent_connect_tokens.token IS
  'Legacy plaintext one-time connect token. RLS is exact owner-only; hash-at-rest requires a coordinated Edge lookup and client one-time-display migration.';

-- Source readiness receipt. This proves catalog shape after application, not
-- multi-account behavior or the Realtime project setting. Before release,
-- independently verify that Realtime "Allow public access" is disabled, then
-- run authenticated private-channel and tenant-revocation canaries.
SELECT
  (
    SELECT bool_and(bucket.public IS FALSE)
    FROM storage.buckets AS bucket
    WHERE bucket.id IN ('task-images', 'room-files', 'circle-images', 'reports')
  ) AS all_reviewed_buckets_private,
  (
    SELECT count(*) = 4
    FROM storage.buckets AS bucket
    WHERE bucket.id IN ('task-images', 'room-files', 'circle-images', 'reports')
  ) AS all_reviewed_buckets_present,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_plans'
      AND column_name = 'chat_thread_id'
      AND data_type = 'uuid'
  ) AS agent_plan_thread_scope_present,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_checkpoints'
      AND column_name = 'chat_thread_id'
      AND data_type = 'uuid'
  ) AS checkpoint_thread_scope_present,
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.integrations'::regclass
  ) AS integrations_force_rls,
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.user_site_credentials'::regclass
  ) AS site_credentials_force_rls,
  (
    NOT pg_catalog.has_column_privilege(
      'authenticated', 'public.circles', 'api_key', 'SELECT'
    )
    AND NOT pg_catalog.has_column_privilege(
      'authenticated', 'public.circles', 'discord_bot_token', 'SELECT'
    )
    AND NOT pg_catalog.has_column_privilege(
      'authenticated', 'public.circles', 'discord_webhook_url', 'SELECT'
    )
  ) AS circle_member_secret_columns_denied,
  to_regprocedure('public.get_circle_capability_secrets_v1(uuid)') IS NOT NULL
    AS circle_creator_secret_rpc_present,
  NOT pg_catalog.has_column_privilege(
    'authenticated',
    'public.circle_github_connections',
    'webhook_secret',
    'SELECT'
  ) AS github_webhook_secret_browser_denied,
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.profiles'::regclass
  ) AS raw_profiles_force_rls,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS safe_profile_view
    WHERE safe_profile_view.oid = 'public.safe_profiles'::regclass
      AND safe_profile_view.relkind = 'v'
      AND NOT (
        'security_invoker=true' = ANY(
          COALESCE(safe_profile_view.reloptions, ARRAY[]::text[])
        )
      )
  ) AS safe_profiles_projection_present,
  (
    SELECT count(*) = 3
      AND bool_and(target.relrowsecurity AND target.relforcerowsecurity)
    FROM pg_catalog.pg_class AS target
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = target.relnamespace
    WHERE namespace.nspname = 'public'
      AND target.relname IN (
        'featured_trades',
        'featured_trade_executions',
        'spirit_learnings'
      )
  ) AS personal_trading_force_rls,
  (
    SELECT count(*) = 3
      AND bool_and(target.relrowsecurity AND target.relforcerowsecurity)
    FROM pg_catalog.pg_class AS target
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = target.relnamespace
    WHERE namespace.nspname = 'public'
      AND target.relname IN ('user_points', 'user_badges', 'user_xp')
  ) AS peer_gamification_force_rls,
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.research_agent_runs'::regclass
  ) AS research_runs_force_rls,
  (
    SELECT count(*) = 4
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname IN (
        'office_realtime_exact_select_v1',
        'office_realtime_exact_insert_v1',
        'office_realtime_prefix_select_guard_v1',
        'office_realtime_prefix_insert_guard_v1'
      )
  ) AS office_realtime_authorization_present,
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.agent_connect_tokens'::regclass
  ) AS connect_tokens_force_rls,
  to_regprocedure('public.guard_computer_schedule_claim_scope_v1()') IS NOT NULL
    AS watch_claim_revocation_guard_present,
  to_regprocedure('public.guard_scheduled_action_dispatch_scope_v1()') IS NOT NULL
    AS scheduled_dispatch_revocation_guard_present,
  to_regprocedure('public.guard_connection_target_binding_v1()') IS NOT NULL
    AS oauth_connection_binding_guard_present;

COMMIT;

NOTIFY pgrst, 'reload schema';
