-- Canonical thread-scoped authority for public.messages.
--
-- Why this is a convergence migration:
--   * the February/March message migrations created both title-cased and
--     lowercase policy names, and permissive PostgreSQL policies are ORed;
--   * every historical SELECT policy stopped at circle membership and leaked
--     private/shared thread messages to other members of the same circle;
--   * the historical UPDATE policy let any circle member rewrite every column
--     on every message, even though it was described as a reactions policy;
--   * thread_id and reply_to were never enforced as same-circle/same-thread
--     lineage at the database boundary.
--
-- Compatibility boundary (intentional and explicit): current authenticated
-- Chat clients create bot rows with user_id = auth.uid() and finalize the bot's
-- persisted metadata by updating that creator-owned row's content. This
-- migration preserves that path. It prevents every *other* member from changing
-- the bot row, but it cannot prove that a creator-authored is_bot=true payload
-- came from a trusted model runtime. Strict bot provenance requires a later
-- trusted server/RPC write lane; blocking creator-owned bot writes here would
-- break current Chat persistence and refresh recovery.

-- A NOT VALID CHECK is enforced for every NEW row immediately while allowing
-- legacy NULL rows to exist long enough for the deterministic repair below.
-- This closes the live-write race between backfill and SET NOT NULL without
-- relying on LOCK TABLE (which is not runnable under psql autocommit).
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_thread_id_convergence_nn;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_thread_id_convergence_nn
  CHECK (thread_id IS NOT NULL) NOT VALID;

-- Existing circle-wide history was already backfilled by
-- 20260414_circle_chat_threads.sql. Repeat only the deterministic legacy repair
-- so partially migrated environments converge before thread_id becomes NOT NULL.
UPDATE public.messages AS message
SET thread_id = thread.id
FROM public.circle_chat_threads AS thread
WHERE message.thread_id IS NULL
  AND thread.circle_id = message.circle_id
  AND thread.visibility = 'circle';

-- Do not guess when lineage is still ambiguous or corrupted. Raising stops the
-- migration before any policy is replaced; under psql autocommit the temporary
-- new-row guard remains fail-closed until the data is repaired and this reruns.
DO $lineage_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.messages AS message
    WHERE message.thread_id IS NULL
  ) THEN
    RAISE EXCEPTION 'messages_thread_rls: legacy messages remain without a canonical circle thread'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.messages AS message
    JOIN public.circle_chat_threads AS thread ON thread.id = message.thread_id
    WHERE thread.circle_id IS DISTINCT FROM message.circle_id
  ) THEN
    RAISE EXCEPTION 'messages_thread_rls: message/thread circle lineage mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.messages AS message
    JOIN public.messages AS parent ON parent.id = message.reply_to
    WHERE parent.circle_id IS DISTINCT FROM message.circle_id
       OR parent.thread_id IS DISTINCT FROM message.thread_id
  ) THEN
    RAISE EXCEPTION 'messages_thread_rls: reply target is outside the message thread'
      USING ERRCODE = '23514';
  END IF;
END
$lineage_guard$;

ALTER TABLE public.messages
  VALIDATE CONSTRAINT messages_thread_id_convergence_nn;
ALTER TABLE public.messages
  ALTER COLUMN thread_id SET NOT NULL;
ALTER TABLE public.messages
  DROP CONSTRAINT messages_thread_id_convergence_nn;

-- One non-recursive, SECURITY DEFINER visibility predicate for message RLS.
-- A private/shared thread member who has since left the circle is denied: both
-- current circle membership and current thread visibility are required.
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

-- Keep reply validation out of the messages RLS expression itself. Querying
-- public.messages recursively from its own policy can recurse indefinitely.
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
  SELECT p_reply_to IS NULL OR EXISTS (
    SELECT 1
    FROM public.messages AS parent
    WHERE parent.id = p_reply_to
      AND parent.circle_id = p_circle_id
      AND parent.thread_id = p_thread_id
  );
$function$;

REVOKE ALL ON FUNCTION public.message_thread_visible_to_current_user(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_thread_visible_to_current_user(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.message_thread_visible_to_current_user(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.message_reply_matches_thread(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_reply_matches_thread(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.message_reply_matches_thread(uuid, uuid, uuid) TO authenticated;

-- Keep the original helper names safe for any callers outside this migration.
-- Both now require current circle membership and use a fixed search path.
CREATE OR REPLACE FUNCTION public.user_is_circle_member(p_circle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = p_circle_id
      AND membership.user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_can_see_chat_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = p_thread_id
      AND public.message_thread_visible_to_current_user(thread.circle_id, thread.id)
  );
$function$;

REVOKE ALL ON FUNCTION public.user_is_circle_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_is_circle_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_is_circle_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.user_can_see_chat_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_see_chat_thread(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_can_see_chat_thread(uuid) TO authenticated;

-- Invitation checks must be non-recursive: circle_chat_thread_members RLS
-- cannot safely query itself, and circle_members has had recursive policies in
-- older deployments. Bind the invitee, exact thread, and inviting owner here.
CREATE OR REPLACE FUNCTION public.chat_thread_invitee_is_circle_member(
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    JOIN public.circle_members AS membership
      ON membership.circle_id = thread.circle_id
     AND membership.user_id = p_user_id
    WHERE thread.id = p_thread_id
      AND thread.created_by = auth.uid()
      AND public.message_thread_visible_to_current_user(thread.circle_id, thread.id)
  );
$function$;

REVOKE ALL ON FUNCTION public.chat_thread_invitee_is_circle_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_thread_invitee_is_circle_member(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.chat_thread_invitee_is_circle_member(uuid, uuid) TO authenticated;

-- Every writer, including service role, must keep member roles inside the
-- owning circle. Only created_by may hold role='owner'; invited users are
-- role='member'. Cascading thread deletion remains available because this is an
-- INSERT/UPDATE guard, not a DELETE guard.
CREATE OR REPLACE FUNCTION public.validate_chat_thread_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_circle_id uuid;
  v_created_by uuid;
BEGIN
  SELECT thread.circle_id, thread.created_by
  INTO v_circle_id, v_created_by
  FROM public.circle_chat_threads AS thread
  WHERE thread.id = NEW.thread_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = v_circle_id
      AND membership.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'chat_thread_invitee_not_circle_member'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM v_created_by)
     OR (NEW.role = 'member' AND NEW.user_id = v_created_by) THEN
    RAISE EXCEPTION 'chat_thread_member_role_invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.validate_chat_thread_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_chat_thread_member() FROM anon;
REVOKE ALL ON FUNCTION public.validate_chat_thread_member() FROM authenticated;

DROP TRIGGER IF EXISTS trg_validate_chat_thread_member ON public.circle_chat_thread_members;
CREATE TRIGGER trg_validate_chat_thread_member
BEFORE INSERT OR UPDATE ON public.circle_chat_thread_members
FOR EACH ROW
EXECUTE FUNCTION public.validate_chat_thread_member();

-- Direct authenticated updates may rename/archive/configure a private/shared
-- thread, but cannot move it to another circle, transfer created_by, change the
-- default thread's identity, or directly promote visibility. A visibility
-- transition is accepted only as a nested, derived result of the membership
-- trigger and only when the active member count proves the target state.
CREATE OR REPLACE FUNCTION public.guard_authenticated_chat_thread_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_other_member_count integer;
  v_expected_visibility text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Direct authenticated writes may change only the creator-facing settings.
  -- Nested trusted triggers additionally own visibility and thread activity.
  -- This allowlist also freezes lineage and any future columns by default.
  IF pg_trigger_depth() <= 1 AND (
    (to_jsonb(NEW) - 'title' - 'default_model' - 'archived' - 'updated_at')
    IS DISTINCT FROM
    (to_jsonb(OLD) - 'title' - 'default_model' - 'archived' - 'updated_at')
  ) THEN
    RAISE EXCEPTION 'chat_thread_immutable_identity'
      USING ERRCODE = '42501';
  END IF;

  IF pg_trigger_depth() > 1 AND (
    (to_jsonb(NEW)
      - 'title'
      - 'default_model'
      - 'archived'
      - 'updated_at'
      - 'visibility'
      - 'last_message_at'
      - 'last_message_preview')
    IS DISTINCT FROM
    (to_jsonb(OLD)
      - 'title'
      - 'default_model'
      - 'archived'
      - 'updated_at'
      - 'visibility'
      - 'last_message_at'
      - 'last_message_preview')
  ) THEN
    RAISE EXCEPTION 'chat_thread_immutable_identity'
      USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.default_model IS DISTINCT FROM OLD.default_model
    OR NEW.archived IS DISTINCT FROM OLD.archived
  ) AND OLD.created_by IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'chat_thread_settings_creator_only'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.visibility = 'circle' AND NEW.archived IS TRUE THEN
    RAISE EXCEPTION 'chat_thread_default_cannot_archive'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    IF OLD.visibility = 'circle'
       OR NEW.visibility = 'circle'
       OR pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'chat_thread_direct_visibility_change_denied'
        USING ERRCODE = '42501';
    END IF;

    SELECT count(*)
    INTO v_other_member_count
    FROM public.circle_chat_thread_members AS thread_member
    JOIN public.circle_members AS circle_member
      ON circle_member.user_id = thread_member.user_id
     AND circle_member.circle_id = NEW.circle_id
    WHERE thread_member.thread_id = NEW.id
      AND thread_member.user_id <> NEW.created_by;

    v_expected_visibility := CASE
      WHEN v_other_member_count > 0 THEN 'shared'
      ELSE 'private'
    END;

    IF NEW.visibility IS DISTINCT FROM v_expected_visibility THEN
      RAISE EXCEPTION 'chat_thread_visibility_not_membership_derived'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_authenticated_chat_thread_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_authenticated_chat_thread_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.guard_authenticated_chat_thread_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS trg_guard_authenticated_chat_thread_mutation ON public.circle_chat_threads;
CREATE TRIGGER trg_guard_authenticated_chat_thread_mutation
BEFORE UPDATE ON public.circle_chat_threads
FOR EACH ROW
EXECUTE FUNCTION public.guard_authenticated_chat_thread_mutation();

-- Rebuild the membership-derived visibility trigger as SECURITY DEFINER. This
-- lets an invited member leave and demote the thread even though that member is
-- not created_by. The mutation guard above admits only this nested, proven
-- private/shared transition; direct visibility updates remain denied.
CREATE OR REPLACE FUNCTION public.cct_visibility_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_other_count integer;
  v_thread_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_thread_id := NEW.thread_id;
  ELSE
    v_thread_id := OLD.thread_id;
  END IF;

  SELECT count(*)
  INTO v_other_count
  FROM public.circle_chat_thread_members AS thread_member
  JOIN public.circle_chat_threads AS thread ON thread.id = thread_member.thread_id
  JOIN public.circle_members AS circle_member
    ON circle_member.circle_id = thread.circle_id
   AND circle_member.user_id = thread_member.user_id
  WHERE thread_member.thread_id = v_thread_id
    AND thread_member.user_id <> thread.created_by;

  IF v_other_count > 0 THEN
    UPDATE public.circle_chat_threads
    SET visibility = 'shared', updated_at = now()
    WHERE id = v_thread_id
      AND visibility = 'private';
  ELSE
    UPDATE public.circle_chat_threads
    SET visibility = 'private', updated_at = now()
    WHERE id = v_thread_id
      AND visibility = 'shared';
  END IF;

  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.cct_visibility_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cct_visibility_sync() FROM anon;
REVOKE ALL ON FUNCTION public.cct_visibility_sync() FROM authenticated;

-- The original message-touch trigger is retained, but its SECURITY INVOKER
-- function could not update a creator-owned thread when another invited/circle
-- member posted. Replacing the function (the existing trigger keeps its OID)
-- makes recency updates exact, RLS-independent, and non-user-callable.
CREATE OR REPLACE FUNCTION public.circle_chat_threads_touch_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.circle_chat_threads
  SET last_message_at = NEW.created_at,
      last_message_preview = left(COALESCE(NEW.content, ''), 140),
      updated_at = now()
  WHERE id = NEW.thread_id
    AND circle_id = NEW.circle_id
    AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.circle_chat_threads_touch_on_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.circle_chat_threads_touch_on_message() FROM anon;
REVOKE ALL ON FUNCTION public.circle_chat_threads_touch_on_message() FROM authenticated;

DROP TRIGGER IF EXISTS trg_cct_touch ON public.messages;
CREATE TRIGGER trg_cct_touch
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.circle_chat_threads_touch_on_message();

ALTER TABLE public.circle_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_chat_thread_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cct_read ON public.circle_chat_threads;
DROP POLICY IF EXISTS cct_insert ON public.circle_chat_threads;
DROP POLICY IF EXISTS cct_update ON public.circle_chat_threads;
DROP POLICY IF EXISTS cct_delete ON public.circle_chat_threads;

DO $drop_thread_policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'circle_chat_threads'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.circle_chat_threads', v_policy.policyname);
  END LOOP;
END
$drop_thread_policies$;

CREATE POLICY cct_read
ON public.circle_chat_threads
FOR SELECT
TO authenticated
USING (
  public.message_thread_visible_to_current_user(circle_id, id)
);

CREATE POLICY cct_insert
ON public.circle_chat_threads
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND visibility = 'private'
  AND public.user_is_circle_member(circle_id)
  AND parent_thread_id IS NULL
  AND lineage_root_id IS NULL
  AND archived IS FALSE
  AND last_message_preview IS NULL
  AND created_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
  AND updated_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
  AND last_message_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
);

CREATE POLICY cct_update
ON public.circle_chat_threads
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.message_thread_visible_to_current_user(circle_id, id)
)
WITH CHECK (
  created_by = auth.uid()
  AND public.message_thread_visible_to_current_user(circle_id, id)
);

CREATE POLICY cct_delete
ON public.circle_chat_threads
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  AND visibility <> 'circle'
  AND public.message_thread_visible_to_current_user(circle_id, id)
);

DROP POLICY IF EXISTS cct_members_read ON public.circle_chat_thread_members;
DROP POLICY IF EXISTS cct_members_insert ON public.circle_chat_thread_members;
DROP POLICY IF EXISTS cct_members_update ON public.circle_chat_thread_members;
DROP POLICY IF EXISTS cct_members_delete ON public.circle_chat_thread_members;

DO $drop_thread_member_policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'circle_chat_thread_members'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.circle_chat_thread_members', v_policy.policyname);
  END LOOP;
END
$drop_thread_member_policies$;

CREATE POLICY cct_members_read
ON public.circle_chat_thread_members
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = thread_id
      AND public.message_thread_visible_to_current_user(thread.circle_id, thread.id)
  )
);

CREATE POLICY cct_members_insert
ON public.circle_chat_thread_members
FOR INSERT
TO authenticated
WITH CHECK (
  role = 'member'
  AND added_by = auth.uid()
  AND user_id <> auth.uid()
  AND public.chat_thread_invitee_is_circle_member(thread_id, user_id)
);

CREATE POLICY cct_members_delete
ON public.circle_chat_thread_members
FOR DELETE
TO authenticated
USING (
  role = 'member'
  AND EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = thread_id
      AND public.message_thread_visible_to_current_user(thread.circle_id, thread.id)
      AND (thread.created_by = auth.uid() OR user_id = auth.uid())
  )
);

-- Fill the legacy no-thread caller path with the one unambiguous circle thread,
-- then enforce exact circle/thread/reply lineage for every writer, including
-- service-role writers that bypass RLS. Missing or ambiguous defaults fail closed.
CREATE OR REPLACE FUNCTION public.assign_and_validate_message_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.thread_id IS NULL THEN
    SELECT thread.id
    INTO NEW.thread_id
    FROM public.circle_chat_threads AS thread
    WHERE thread.circle_id = NEW.circle_id
      AND thread.visibility = 'circle';

    IF NEW.thread_id IS NULL THEN
      RAISE EXCEPTION 'messages_thread_required'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = NEW.thread_id
      AND thread.circle_id = NEW.circle_id
  ) THEN
    RAISE EXCEPTION 'messages_thread_circle_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reply_to IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS parent
    WHERE parent.id = NEW.reply_to
      AND parent.circle_id = NEW.circle_id
      AND parent.thread_id = NEW.thread_id
  ) THEN
    RAISE EXCEPTION 'messages_reply_thread_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assign_and_validate_message_thread() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_and_validate_message_thread() FROM anon;
REVOKE ALL ON FUNCTION public.assign_and_validate_message_thread() FROM authenticated;

DROP TRIGGER IF EXISTS trg_messages_assign_and_validate_thread ON public.messages;
CREATE TRIGGER trg_messages_assign_and_validate_thread
BEFORE INSERT OR UPDATE OF circle_id, thread_id, reply_to
ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.assign_and_validate_message_thread();

-- True only when a reactions JSON object changes the authenticated user's own
-- membership. Every other user id, every unchanged key, and every non-reaction
-- column remains outside this helper. It also rejects malformed/new empty keys.
CREATE OR REPLACE FUNCTION public.message_reactions_are_self_only_change(
  p_old_reactions jsonb,
  p_new_reactions jsonb,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old jsonb := COALESCE(p_old_reactions, '{}'::jsonb);
  v_new jsonb := COALESCE(p_new_reactions, '{}'::jsonb);
  v_key text;
  v_old_values jsonb;
  v_new_values jsonb;
  v_old_other text[];
  v_new_other text[];
  v_new_count integer;
  v_new_distinct_count integer;
  v_changed_key_count integer := 0;
BEGIN
  IF p_user_id IS NULL
     OR jsonb_typeof(v_old) <> 'object'
     OR jsonb_typeof(v_new) <> 'object' THEN
    RETURN false;
  END IF;

  SELECT count(*)
  INTO v_new_count
  FROM jsonb_object_keys(v_new);

  IF v_new_count > 128 OR octet_length(v_new::text) > 65536 THEN
    RETURN false;
  END IF;

  FOR v_key IN
    SELECT key_name
    FROM (
      SELECT jsonb_object_keys(v_old) AS key_name
      UNION
      SELECT jsonb_object_keys(v_new) AS key_name
    ) AS keys
  LOOP
    -- An unchanged legacy key is not rewritten and cannot widen authority.
    IF (v_old ? v_key) AND (v_new ? v_key)
       AND (v_old -> v_key) = (v_new -> v_key) THEN
      CONTINUE;
    END IF;

    v_changed_key_count := v_changed_key_count + 1;
    IF v_changed_key_count > 1 THEN
      RETURN false;
    END IF;

    IF btrim(v_key) = ''
       OR char_length(v_key) > 32
       OR octet_length(v_key) > 128
       OR v_key IN ('__proto__', 'prototype', 'constructor')
       OR EXISTS (
         SELECT 1
         FROM generate_series(1, char_length(v_key)) AS position(index)
         WHERE ascii(substr(v_key, position.index, 1)) < 32
            OR ascii(substr(v_key, position.index, 1)) = 127
       ) THEN
      RETURN false;
    END IF;

    v_old_values := COALESCE(v_old -> v_key, '[]'::jsonb);
    v_new_values := COALESCE(v_new -> v_key, '[]'::jsonb);

    IF jsonb_typeof(v_old_values) <> 'array'
       OR jsonb_typeof(v_new_values) <> 'array' THEN
      RETURN false;
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_old_values) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_new_values) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
    ) THEN
      RETURN false;
    END IF;

    SELECT count(*), count(DISTINCT item.value)
    INTO v_new_count, v_new_distinct_count
    FROM jsonb_array_elements_text(v_new_values) AS item(value);

    IF v_new_count <> v_new_distinct_count
       OR (v_new ? v_key AND v_new_count = 0) THEN
      RETURN false;
    END IF;

    SELECT COALESCE(array_agg(value ORDER BY value), ARRAY[]::text[])
    INTO v_old_other
    FROM (
      SELECT DISTINCT item.value
      FROM jsonb_array_elements_text(v_old_values) AS item(value)
      WHERE item.value <> p_user_id::text
    ) AS other_users;

    SELECT COALESCE(array_agg(value ORDER BY value), ARRAY[]::text[])
    INTO v_new_other
    FROM (
      SELECT DISTINCT item.value
      FROM jsonb_array_elements_text(v_new_values) AS item(value)
      WHERE item.value <> p_user_id::text
    ) AS other_users;

    IF v_old_other IS DISTINCT FROM v_new_other THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.message_reactions_are_self_only_change(jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_reactions_are_self_only_change(jsonb, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.message_reactions_are_self_only_change(jsonb, jsonb, uuid) FROM authenticated;

-- RLS decides whether the row is visible; this trigger decides which columns
-- an authenticated user may actually change. Service-role/Postgres maintenance
-- has auth.uid() = NULL and stays compatible. For authenticated clients:
--   * authenticated INSERT timestamps are server-owned;
--   * every UPDATE column except content/reactions is immutable;
--   * content is creator-only (including creator-owned bot finalization);
--   * reactions may only add/remove the caller's own id.
CREATE OR REPLACE FUNCTION public.guard_authenticated_message_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := statement_timestamp();
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'content' - 'reactions')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'content' - 'reactions') THEN
    RAISE EXCEPTION 'messages_immutable_identity'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.content IS DISTINCT FROM OLD.content
     AND OLD.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'messages_content_creator_only'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.reactions IS DISTINCT FROM OLD.reactions
     AND NOT public.message_reactions_are_self_only_change(
       OLD.reactions,
       NEW.reactions,
       v_user_id
     ) THEN
    RAISE EXCEPTION 'messages_reaction_self_only'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_authenticated_message_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_authenticated_message_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.guard_authenticated_message_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS trg_messages_guard_authenticated_mutation ON public.messages;
CREATE TRIGGER trg_messages_guard_authenticated_mutation
BEFORE INSERT OR UPDATE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.guard_authenticated_message_mutation();

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Explicitly remove every historical title-cased and lowercase policy name.
-- Quoted identifiers are case-sensitive, so both variants can coexist.
DROP POLICY IF EXISTS "Circle members can read messages" ON public.messages;
DROP POLICY IF EXISTS "Circle members can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update message reactions" ON public.messages;
DROP POLICY IF EXISTS "circle members can read messages" ON public.messages;
DROP POLICY IF EXISTS "users can insert own messages" ON public.messages;
DROP POLICY IF EXISTS "users can update reactions" ON public.messages;
DROP POLICY IF EXISTS "users can delete own messages" ON public.messages;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.messages;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON public.messages;

-- Also converge unknown environment-specific policy drift. Leaving one
-- permissive policy behind would OR it with the canonical predicates below.
DO $drop_message_policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'messages'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.messages', v_policy.policyname);
  END LOOP;
END
$drop_message_policies$;

CREATE POLICY messages_select_thread_visible
ON public.messages
FOR SELECT
TO authenticated
USING (
  public.message_thread_visible_to_current_user(circle_id, thread_id)
);

CREATE POLICY messages_insert_thread_visible
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.message_thread_visible_to_current_user(circle_id, thread_id)
  AND public.message_reply_matches_thread(reply_to, circle_id, thread_id)
  AND jsonb_typeof(COALESCE(reactions, '{}'::jsonb)) = 'object'
  AND COALESCE(reactions, '{}'::jsonb) = '{}'::jsonb
);

CREATE POLICY messages_update_thread_visible
ON public.messages
FOR UPDATE
TO authenticated
USING (
  public.message_thread_visible_to_current_user(circle_id, thread_id)
)
WITH CHECK (
  public.message_thread_visible_to_current_user(circle_id, thread_id)
  AND public.message_reply_matches_thread(reply_to, circle_id, thread_id)
);

CREATE POLICY messages_delete_creator_thread_visible
ON public.messages
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.message_thread_visible_to_current_user(circle_id, thread_id)
);

-- Atomic self-reaction mutation. It locks the exact visible row and can only
-- add/remove auth.uid(); callers never submit or replace the full reactions
-- object, so concurrent reactions cannot overwrite one another.
CREATE OR REPLACE FUNCTION public.set_message_reaction(
  p_message_id uuid,
  p_emoji text,
  p_add boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_emoji text := btrim(COALESCE(p_emoji, ''));
  v_reactions jsonb;
  v_users jsonb;
  v_reaction_key_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'messages_reaction_auth_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_add IS NULL
     OR v_emoji = ''
     OR char_length(v_emoji) > 32
     OR octet_length(v_emoji) > 128
     OR v_emoji IN ('__proto__', 'prototype', 'constructor')
     OR EXISTS (
       SELECT 1
       FROM generate_series(1, char_length(v_emoji)) AS position(index)
       WHERE ascii(substr(v_emoji, position.index, 1)) < 32
          OR ascii(substr(v_emoji, position.index, 1)) = 127
     ) THEN
    RAISE EXCEPTION 'messages_reaction_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(message.reactions, '{}'::jsonb)
  INTO v_reactions
  FROM public.messages AS message
  WHERE message.id = p_message_id
    AND public.message_thread_visible_to_current_user(
      message.circle_id,
      message.thread_id
    )
  FOR UPDATE;

  IF NOT FOUND OR jsonb_typeof(v_reactions) <> 'object' THEN
    RAISE EXCEPTION 'messages_reaction_target_unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)
  INTO v_reaction_key_count
  FROM jsonb_object_keys(v_reactions);

  IF v_reaction_key_count > 128
     OR octet_length(v_reactions::text) > 65536 THEN
    RAISE EXCEPTION 'messages_reaction_state_invalid'
      USING ERRCODE = '22023';
  END IF;

  v_users := COALESCE(v_reactions -> v_emoji, '[]'::jsonb);
  IF jsonb_typeof(v_users) <> 'array'
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_users) AS item(value)
       WHERE jsonb_typeof(item.value) <> 'string'
     ) THEN
    RAISE EXCEPTION 'messages_reaction_state_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_add THEN
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_users) AS item(value)
      WHERE item.value = v_user_id::text
    ) THEN
      IF NOT (v_reactions ? v_emoji)
         AND v_reaction_key_count >= 128 THEN
        RAISE EXCEPTION 'messages_reaction_key_limit'
          USING ERRCODE = '22023';
      END IF;
      v_users := v_users || to_jsonb(v_user_id::text);
    END IF;
    v_reactions := jsonb_set(v_reactions, ARRAY[v_emoji], v_users, true);
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(item.value) ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_users
    FROM jsonb_array_elements_text(v_users) WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value <> v_user_id::text;

    IF jsonb_array_length(v_users) = 0 THEN
      v_reactions := v_reactions - v_emoji;
    ELSE
      v_reactions := jsonb_set(v_reactions, ARRAY[v_emoji], v_users, true);
    END IF;
  END IF;

  IF octet_length(v_reactions::text) > 65536 THEN
    RAISE EXCEPTION 'messages_reaction_size_limit'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.messages AS message
  SET reactions = v_reactions
  WHERE message.id = p_message_id;

  RETURN v_reactions;
END
$function$;

REVOKE ALL ON FUNCTION public.set_message_reaction(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_message_reaction(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_message_reaction(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.set_message_reaction(uuid, text, boolean) IS
  'Atomically add/remove only auth.uid() on one visible thread-scoped message reaction.';

-- Thread INSERT/UPDATE/DELETE drives the sidebar subscription. `messages` was
-- published in 20260221, but circle_chat_threads never was. Guard both the
-- publication and membership so local/self-hosted installs without the
-- Supabase publication remain runnable and re-applying cannot duplicate it.
DO $realtime_publication$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'circle_chat_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.circle_chat_threads;
  END IF;
END
$realtime_publication$;

NOTIFY pgrst, 'reload schema';
